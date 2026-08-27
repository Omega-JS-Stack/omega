/**
 * Self-host Firebase's OAuth helper files into the built site: /__/auth/*
 * plus /__/firebase/init.json, fetched from {projectId}.firebaseapp.com at
 * production build time (UJM fetchFirebaseAuth parity). This is what lets
 * authDomain be the BRAND host on static hosting with no proxy (GitHub
 * Pages): the sign-in redirect stays first-party — which keeps
 * signInWithRedirect working under browser storage partitioning — and
 * /__/auth/handler resolves on the site domain instead of 404ing.
 *
 * Skips (logged, not fatal): no cloud.config.projectId, a demo-* project
 * (offline fixtures), or OMEGA_SKIP_FIREBASE_AUTH=true.
 *
 * The fetch is WRITE-THROUGH to the brand's persistent cache (#548): a
 * failure serves the last good copy with a loud, dated warn instead of
 * failing a build that already emitted every page — offline, sandboxed and
 * rate-limited builds all survive on it. A failure with NOTHING cached is
 * still fatal, because a site shipped without the handler silently breaks
 * sign-in and there is nothing to serve. A framework-baked copy cannot exist:
 * /__/firebase/init.json is project-specific, so the cache is keyed by
 * project id.
 */
const crypto = require('node:crypto');
const path = require('node:path');
const jetpack = require('fs-jetpack');

// The two PAGE files land as .html and their extensionless names are never
// emitted: GitHub Pages serves a literal extensionless FILE as
// application/octet-stream (found live on omegajs.dev, #135) — the browser
// downloads the sign-in page instead of rendering it. The extensionless URL
// Firebase redirects to (/__/auth/handler) resolves to handler.html via
// Pages' clean-URL fallback, which only applies when no literal file exists.
// The iframe page references iframe.js relatively; the ?cb= rewrite busts
// the long-lived edge cache (the scaffolded Cloudflare cache rule pins
// /__/auth/iframe.js for a year). The breaker is a HASH of the fetched
// iframe.js content — it changes exactly when Firebase ships a new helper,
// and stays stable (cache-friendly, idempotent builds) when they don't.
const HELPER_FILES = [
  { remote: '__/auth/handler', local: '__/auth/handler.html' },
  { remote: '__/auth/handler.js' },
  { remote: '__/auth/experiments.js' },
  { remote: '__/auth/iframe', local: '__/auth/iframe.html' },
  { remote: '__/auth/iframe.js' },
  { remote: '__/firebase/init.json' },
];

// The cache's own file: the six helpers land under the cache root at their
// remote paths, and this stamps WHEN they were fetched (the staleness the
// fallback warn names).
const CACHE_META = 'fetched.json';

const IFRAME_PAGE = '__/auth/iframe';
const IFRAME_SCRIPT = '__/auth/iframe.js';
const IFRAME_SRC_MARKER = 'src="iframe.js"';

const TRIES = 3;

/**
 * Fetch one helper file with retries.
 * @param {string} url
 * @returns {Promise<string>}
 */
async function fetchText(url) {
  let lastError;
  for (let attempt = 1; attempt <= TRIES; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        // A 4xx from the static helper host is not transient (wrong project
        // id, helper path gone) — fail fast; retry only network errors + 5xx.
        error.permanent = response.status >= 400 && response.status < 500;
        throw error;
      }
      return await response.text();
    } catch (error) {
      lastError = error;
      if (error.permanent) {
        break;
      }
    }
  }
  throw new Error(`Failed to fetch Firebase auth helper ${url}: ${lastError.message}`);
}

/**
 * Read a complete cached helper set. A PARTIAL cache is no cache — a build
 * shipped from half a helper set breaks sign-in the same way an empty one
 * does, so the miss falls through to the fetch error.
 * @param {string} cacheRoot - per-project cache dir
 * @returns {{ contents: Map<string, string>, fetchedAt: string }|null}
 */
function readCache(cacheRoot) {
  const meta = jetpack.read(path.join(cacheRoot, CACHE_META), 'json');
  if (!meta || !meta.fetchedAt) {
    return null;
  }

  const contents = new Map();
  for (const file of HELPER_FILES) {
    const content = jetpack.read(path.join(cacheRoot, file.remote));
    if (content === undefined) {
      return null;
    }
    contents.set(file.remote, content);
  }

  return { contents, fetchedAt: meta.fetchedAt };
}

/**
 * Write the freshly fetched helper set through to the cache (the RAW fetched
 * bytes — the iframe rewrite is derived from them on every build, so a cached
 * build emits the same file the fetched one did).
 * @param {string} cacheRoot - per-project cache dir
 * @param {Map<string, string>} contents - remote path → content
 */
function writeCache(cacheRoot, contents) {
  for (const file of HELPER_FILES) {
    jetpack.write(path.join(cacheRoot, file.remote), contents.get(file.remote));
  }
  jetpack.write(path.join(cacheRoot, CACHE_META), { fetchedAt: new Date().toISOString() });
}

/**
 * Fetch the Firebase auth helper files into the built site.
 * @param {object} options
 * @param {object} options.siteData - resolved omega config shape (reads cloud.config.projectId)
 * @param {string} options.outDir - built-site output dir
 * @param {object} options.logger - devkit logger
 * @param {string} [options.baseUrl] - source origin override (tests serve the fixture files locally)
 * @param {string} [options.cacheDir] - persistent cache root (the brand's .omega/cache/firebase-auth)
 * @returns {Promise<{ skipped: string|false, cached?: boolean }>}
 */
async function fetchFirebaseAuthHelpers(options) {
  const { siteData, outDir, logger } = options;
  const projectId = siteData.cloud && siteData.cloud.config && siteData.cloud.config.projectId;

  if (process.env.OMEGA_SKIP_FIREBASE_AUTH === 'true') {
    logger.warn('firebase-auth: skipped via OMEGA_SKIP_FIREBASE_AUTH — sign-in redirects will 404 on this build');
    return { skipped: 'env' };
  }
  if (!projectId) {
    logger.log('firebase-auth: no cloud.config.projectId — helper files skipped');
    return { skipped: 'no-project' };
  }
  if (projectId.startsWith('demo-')) {
    logger.log(`firebase-auth: offline project ${projectId} — helper files skipped`);
    return { skipped: 'demo-project' };
  }

  const base = options.baseUrl || `https://${projectId}.firebaseapp.com`;
  // init.json is project-specific, so one cache per project id
  const cacheRoot = options.cacheDir ? path.join(options.cacheDir, projectId) : null;

  // Fetch everything first — the iframe rewrite needs iframe.js' content
  let contents;
  let cached = false;
  try {
    contents = new Map(await Promise.all(HELPER_FILES.map(async (file) => {
      const content = await fetchText(`${base}/${file.remote}`);
      return [file.remote, content];
    })));
    if (cacheRoot) {
      writeCache(cacheRoot, contents);
    }
  } catch (error) {
    // Nothing cached = nothing to serve: a site without the handler breaks
    // sign-in silently, so the build still fails loudly.
    const fallback = cacheRoot && readCache(cacheRoot);
    if (!fallback) {
      throw error;
    }

    const age = Math.floor((Date.now() - Date.parse(fallback.fetchedAt)) / 86400000);
    logger.warn(`firebase-auth: fetch from ${base} failed (${error.message}) — serving the CACHED helper files fetched ${fallback.fetchedAt} (${age} day(s) old); rerun online to refresh them`);
    contents = fallback.contents;
    cached = true;
  }

  const scriptHash = crypto.createHash('md5').update(contents.get(IFRAME_SCRIPT)).digest('hex').slice(0, 8);
  const iframePage = contents.get(IFRAME_PAGE);
  if (iframePage.includes(IFRAME_SRC_MARKER)) {
    contents.set(IFRAME_PAGE, iframePage.replace(IFRAME_SRC_MARKER, `src="iframe.js?cb=${scriptHash}"`));
  } else {
    // Firebase changed the iframe markup — the year-long edge cache on
    // iframe.js can now serve a stale script against a new handler.
    logger.warn(`firebase-auth: ${IFRAME_SRC_MARKER} not found in ${IFRAME_PAGE} — cache breaker NOT applied; check Firebase's helper markup`);
  }

  for (const file of HELPER_FILES) {
    jetpack.write(path.join(outDir, file.local || file.remote), contents.get(file.remote));
  }

  logger.log(`firebase-auth: self-hosted ${HELPER_FILES.length} helper files from ${cached ? 'the local cache' : `${projectId}.firebaseapp.com`} → /__/`);
  return { skipped: false, cached };
}

module.exports = { fetchFirebaseAuthHelpers, HELPER_FILES };
