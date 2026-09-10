// Restart Manager install machinery — feed discovery, artifact download, and
// silent per-platform install. Install ONLY — RM updates ITSELF via @omega.js/desktop's
// standard autoUpdater once it's running (that's also why Windows uses NSIS:
// electron-updater can only self-update NSIS installs).
//
// The RM app publishes releases through @omega.js/desktop's standard pipeline: versioned
// artifacts + electron-updater feed files (latest-mac.yml / latest.yml /
// latest-linux.yml) on `github.com/<owner>/<repo>/releases`. We fetch the feed
// from the stable `releases/latest/download/<feed>` URL, pick the artifact,
// download it, and install:
//
//   mac    — unzip → <sharedRoot>/app/Restart Manager.app   (no DMG mount, no /Volumes flash)
//   win    — run the NSIS one-click installer with /S        (fully silent, per-user, no admin,
//            lands in %LOCALAPPDATA%\Programs\Restart Manager\)
//   linux  — copy + chmod 755 → app/Restart-Manager.AppImage (no root, no .deb)
//
// mac/linux extract into `app.tmp/` first, then swap into `app/` — a torn
// install is never observable. The advisory install.lock keeps two @omega.js/desktop apps on
// the same machine from running installers concurrently; RM itself ignores it.
//
// Pure helpers (parseFeed, pickArtifact, URL builders) are exported individually
// for build-layer tests. See docs/restart-manager.md.

const path       = require('path');
const fs         = require('fs');
const https      = require('https');
const { spawn }  = require('child_process');
const yaml       = require('js-yaml');
const jetpack    = require('fs-jetpack');
const fetch      = require('wonderful-fetch');
const LoggerLite = require('../logger-lite.js');
const protocol   = require('./protocol.js');

const logger = new LoggerLite('restart-manager');

const WIN_INSTALLER_TIMEOUT_MS = 2 * 60 * 1000;   // NSIS /S should finish well inside this

// electron-updater feed file per platform (produced by @omega.js/desktop's release pipeline).
const FEED_FILES = Object.freeze({
  darwin: 'latest-mac.yml',
  win32:  'latest.yml',
  linux:  'latest-linux.yml',
});

const FEED_TIMEOUT_MS = 30000;
const LOCK_STALE_MS   = 10 * 60 * 1000;    // takeover threshold for a dead holder's lock

/**
 * Build the feed URL for a platform.
 * `feed.url` (full base-URL override, e.g. an air-gapped mirror) wins over
 * the GitHub `owner`/`repo` form.
 *
 * @param {{ owner?: string, repo?: string, url?: string }} feedCfg
 * @param {string} platform - process.platform value.
 * @returns {string} absolute feed URL.
 */
function buildFeedUrl(feedCfg, platform) {
  const feedFile = FEED_FILES[platform];
  if (!feedFile) throw new Error(`restart-manager: unsupported platform "${platform}"`);
  if (feedCfg.url) return `${feedCfg.url.replace(/\/+$/, '')}/${feedFile}`;
  return `https://github.com/${feedCfg.owner}/${feedCfg.repo}/releases/latest/download/${feedFile}`;
}

/**
 * Build the artifact download URL next to the feed.
 * Artifact names are URL-encoded — GitHub renames uploaded assets containing
 * spaces (space → dot) while the feed keeps the original name, so encoding is
 * belt-and-suspenders on top of @omega.js/desktop's already-sanitized artifact names.
 *
 * @param {{ owner?: string, repo?: string, url?: string }} feedCfg
 * @param {string} artifactName - files[].url entry from the parsed feed.
 * @returns {string} absolute artifact URL.
 */
function buildArtifactUrl(feedCfg, artifactName) {
  const encoded = encodeURIComponent(artifactName);
  if (feedCfg.url) return `${feedCfg.url.replace(/\/+$/, '')}/${encoded}`;
  return `https://github.com/${feedCfg.owner}/${feedCfg.repo}/releases/latest/download/${encoded}`;
}

/**
 * Parse an electron-updater feed file (latest*.yml).
 *
 * @param {string} ymlText - raw feed contents.
 * @returns {{ version: string, files: Array<{url: string, sha512?: string, size?: number}> }}
 */
function parseFeed(ymlText) {
  const doc = yaml.load(ymlText);
  if (!doc || typeof doc !== 'object') throw new Error('restart-manager: feed is not a YAML object');
  if (!doc.version) throw new Error('restart-manager: feed has no version');
  const files = Array.isArray(doc.files) ? doc.files : [];
  return { version: String(doc.version), files };
}

/**
 * Pick the install artifact for a platform from a parsed feed.
 *   darwin — zip, preferring `-<arch>-mac.zip` → `-universal-mac.zip` →
 *            `-mac-universal.zip` (the versionless form, #620) → `-mac.zip`
 *   win32  — the NSIS setup .exe (run silently with /S; NSIS is what lets RM
 *            self-update via electron-updater on Windows)
 *   linux  — the .AppImage entry
 *
 * @param {{ version: string, files: Array<{url: string}> }} feed
 * @param {string} platform - process.platform value.
 * @param {string} arch - process.arch value (mac pick order only).
 * @returns {string} artifact file name.
 */
function pickArtifact(feed, platform, arch) {
  const names = feed.files.map((f) => f.url).filter(Boolean);

  let picked = null;
  if (platform === 'darwin') {
    picked = names.find((n) => n.endsWith(`-${arch}-mac.zip`))
      || names.find((n) => n.endsWith('-universal-mac.zip'))
      // The name @omega.js/desktop packages under since #620 — a feed published
      // before it still answers on one of the forms above.
      || names.find((n) => n.endsWith('-mac-universal.zip'))
      || names.find((n) => n.endsWith('-mac.zip'));
  } else if (platform === 'win32') {
    picked = names.find((n) => n.endsWith('.exe'));
  } else if (platform === 'linux') {
    picked = names.find((n) => n.endsWith('.AppImage'));
  } else {
    throw new Error(`restart-manager: unsupported platform "${platform}"`);
  }

  if (!picked) {
    throw new Error(`restart-manager: no ${platform} artifact in feed (candidates: ${names.join(', ') || 'none'})`);
  }
  return picked;
}

/**
 * Fetch + parse the release feed.
 *
 * @param {{ owner?: string, repo?: string, url?: string }} feedCfg
 * @param {string} platform
 * @returns {Promise<{ version: string, files: Array<{url: string}> }>}
 */
async function fetchFeed(feedCfg, platform) {
  const url = buildFeedUrl(feedCfg, platform);
  logger.log(`fetching release feed ${url}`);
  const text = await fetch(url, { method: 'get', response: 'text', timeout: FEED_TIMEOUT_MS, tries: 2 });
  return parseFeed(text);
}

/**
 * Plain HTTPS download with atomic write. Follows redirects (GitHub release
 * assets 302 to S3). Writes to `<dest>.part` then renames — no partial file
 * is ever observable at `dest`.
 *
 * @param {string} url
 * @param {string} dest - absolute destination path.
 * @param {number} [redirectsLeft]
 * @returns {Promise<void>}
 */
function downloadFile(url, dest, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const tmp = `${dest}.part`;
    const out = fs.createWriteStream(tmp);
    const req = https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        out.close();
        try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
        if (redirectsLeft <= 0) return reject(new Error('too many redirects'));
        return downloadFile(res.headers.location, dest, redirectsLeft - 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        out.close();
        try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
        return reject(new Error(`HTTP ${res.statusCode} downloading ${url}`));
      }
      res.pipe(out);
      out.on('finish', () => {
        out.close(() => {
          try { fs.renameSync(tmp, dest); resolve(); }
          catch (e) { reject(e); }
        });
      });
    });
    req.on('error', (e) => {
      try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
      reject(e);
    });
  });
}

/**
 * Install a downloaded artifact.
 * mac: unzip into `<root>/app/` (atomic swap via app.tmp). linux: copy +
 * chmod 755, same swap. win: run the NSIS one-click installer with /S —
 * fully silent, per-user, installs to %LOCALAPPDATA%\Programs\ where
 * electron-updater can self-update it later.
 *
 * @param {{ root: string, platform: string, artifactPath: string, version: string }} opts
 * @returns {Promise<string>} the installed app path.
 */
async function installArtifact(opts) {
  const { root, platform, artifactPath, version } = opts;

  if (platform === 'win32') {
    logger.log(`running NSIS installer silently: ${artifactPath} /S`);
    await runSilentInstaller(artifactPath);
    const exePath = protocol.getInstalledAppPath(root, platform);
    if (!fs.existsSync(exePath)) {
      throw new Error(`restart-manager: installer finished but ${exePath} is missing`);
    }
    logger.log(`installed restart-manager v${version} → ${exePath}`);
    return exePath;
  }

  const appDir = protocol.getAppDir(root);
  const tmpDir = `${appDir}.tmp`;

  // Fresh staging dir.
  removeDirNoAsar(tmpDir);
  jetpack.dir(tmpDir);

  if (platform === 'darwin') {
    const extractZip = require('extract-zip');
    await extractZip(artifactPath, { dir: tmpDir });
  } else if (platform === 'linux') {
    const target = path.join(tmpDir, protocol.RM_APP_NAMES.linux);
    jetpack.copy(artifactPath, target);
    fs.chmodSync(target, 0o755);
  } else {
    throw new Error(`restart-manager: unsupported platform "${platform}"`);
  }

  // Swap: remove old app/, rename staging into place (rename-retry guards
  // transient locks).
  removeDirNoAsar(appDir);
  await renameWithRetry(tmpDir, appDir);

  const appPath = protocol.getInstalledAppPath(root, platform);
  logger.log(`installed restart-manager v${version} → ${appPath}`);
  return appPath;
}

// Run an NSIS one-click installer fully silently and wait for it to finish.
function runSilentInstaller(installerPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(installerPath, ['/S'], { stdio: 'ignore' });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('restart-manager: silent installer timed out'));
    }, WIN_INSTALLER_TIMEOUT_MS);
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      reject(new Error(`restart-manager: installer exited with code ${code}`));
    });
  });
}

/**
 * Acquire the advisory install lock (wx-flag create). A lock whose holder pid
 * is dead OR that is older than LOCK_STALE_MS is taken over.
 *
 * @param {string} root
 * @param {{ pid: number, hostAppId: string }} meta
 * @returns {boolean} true when acquired.
 */
function acquireInstallLock(root, meta) {
  const lockPath = protocol.getLockPath(root);
  jetpack.dir(root);
  const payload = JSON.stringify({ pid: meta.pid, hostAppId: meta.hostAppId, acquiredAt: Date.now() });

  try {
    fs.writeFileSync(lockPath, payload, { flag: 'wx' });
    return true;
  } catch (e) {
    if (e.code !== 'EEXIST') return false;
  }

  // Lock exists — stale (dead holder or too old) means we take over.
  let existing = null;
  try { existing = JSON.parse(fs.readFileSync(lockPath, 'utf8')); } catch (_) { /* corrupt = stale */ }
  const holderAlive = existing && pidAlive(existing.pid);
  const fresh = existing && Number.isFinite(existing.acquiredAt) && (Date.now() - existing.acquiredAt) < LOCK_STALE_MS;
  if (holderAlive && fresh) return false;

  try {
    fs.writeFileSync(lockPath, payload);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Release the advisory install lock (best-effort).
 *
 * @param {string} root
 */
function releaseInstallLock(root) {
  try { fs.unlinkSync(protocol.getLockPath(root)); } catch (_) { /* ignore */ }
}

/**
 * Liveness check by pid. EPERM means "alive but not ours".
 *
 * @param {number} pid
 * @returns {boolean}
 */
function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

// Remove a dir that may contain .app/.asar entries — jetpack won't walk into
// asar paths unless process.noAsar is set (same guard the legacy lib used).
function removeDirNoAsar(dir) {
  if (!jetpack.exists(dir)) return;
  const prev = process.noAsar;
  process.noAsar = true;
  try { jetpack.remove(dir); } finally { process.noAsar = prev; }
}

// Windows keeps exe/dir locks alive briefly after the owning process exits;
// retry the swap on EBUSY/EPERM before giving up.
async function renameWithRetry(from, to, tries = 5, delayMs = 500) {
  for (let i = 0; i < tries; i++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (e) {
      const retryable = e.code === 'EBUSY' || e.code === 'EPERM' || e.code === 'ENOTEMPTY';
      if (!retryable || i === tries - 1) throw e;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      removeDirNoAsar(to);
    }
  }
}

module.exports = {
  FEED_FILES,
  buildFeedUrl,
  buildArtifactUrl,
  parseFeed,
  pickArtifact,
  fetchFeed,
  downloadFile,
  installArtifact,
  acquireInstallLock,
  releaseInstallLock,
  pidAlive,
};
