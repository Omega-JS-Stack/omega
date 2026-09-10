/**
 * Root `npm run test:e2e-extension` — the extension ↔ backend AUTH boundary,
 * proven in a REAL Chrome with a REAL built extension (#46).
 *
 * The sibling auth lane (scripts/e2e-auth-token.js) proves the DESKTOP caller's
 * round trip. This one proves the other consumer of the same wire: the MV3
 * background service worker's `omega:syncAuth` flow, running as actual
 * extension code inside actual Chrome — not library functions called in-process
 * from node.
 *
 * Proof, in order:
 *   1. The playground backend emulator boots (auth + functions + hosting) on
 *      its RESOLVED ports — bumped ones whenever the classics are busy.
 *   2. The playground extension app BUILDS (real gulp pipeline) as a TESTING
 *      build — `omega.environment: 'testing'`, which is what makes the SW's
 *      Firebase auth talk to the local auth emulator and getApiUrl() resolve
 *      to the local hosting emulator. Building AFTER the boot is what bakes
 *      the live ports into OMEGA_BUILD_JSON's `config.dev.ports`, the only
 *      channel a browser context has
 *      ([#744](https://github.com/Omega-JS-Stack/omega/issues/744)).
 *   3. A real user signs up against the AUTH emulator and a custom token is
 *      minted for it at POST /omega/user/token (the node-side setup).
 *   4. Chrome loads the built extension unpacked. A tab lands on the brand host
 *      carrying `?authToken=…` — the REAL sign-in path — and the background SW's
 *      tab watcher signs itself in with `signInWithCustomToken`.
 *   5. From the REAL popup context, `chrome.runtime.sendMessage({ command:
 *      'omega:syncAuth' })` makes the SW fetch a FRESH custom token from the
 *      backend emulator and hand it back. The uid equality is asserted INSIDE
 *      the extension context: the SW's user uid and the uid claim of the token
 *      the backend just minted must both be the uid node created.
 *
 * Offline: emulator only. Chrome runs with host-resolver rules that resolve the
 * brand host to 127.0.0.1 and NXDOMAIN everything else — the run cannot reach a
 * real cloud even if a bundle tried.
 *
 * Two test-time overrides, neither of them an edit to a committed file:
 *   - the build runs with OMEGA_TEST_MODE=true (a testing build, not the
 *     committed config), and
 *   - the packaged output is COPIED to .temp/ and granted the `tabs` permission
 *     the sign-in tab watcher needs (the playground consumer's manifest ships
 *     the default empty permission list; a consumer using the website sign-in
 *     flow declares it themselves).
 *
 * Knobs: OMEGA_SKIP_E2E=1 skips (matches the sibling e2e lanes). No puppeteer
 * Chrome installed → SKIPPED with the reason printed, exit 0 (never a silent
 * green).
 */
const path = require('path');
const fs = require('fs');
const net = require('net');
const { spawn } = require('child_process');
const { createRequire } = require('module');
const assert = require('assert');

if (process.env.OMEGA_SKIP_E2E === '1') {
  console.log('⏭ OMEGA_SKIP_E2E=1 — skipping extension auth e2e');
  process.exit(0);
}

const ROOT = path.join(__dirname, '..');
const PLAYGROUND_BACKEND = path.join(ROOT, 'brands', 'playground-omega', 'targets', 'backend');
const EXTENSION_APP = path.join(ROOT, 'brands', 'playground-omega', 'targets', 'extension');
const PACKAGED_DIR = path.join(EXTENSION_APP, 'packaged', 'chromium', 'raw');
const LOG_DIR = path.join(ROOT, '.temp', 'extension-auth-e2e');
const EXTENSION_DIR = path.join(LOG_DIR, 'extension');

const { readPortsFile } = require('@omega.js/config');
// The snapshot is baked into every emitted bundle since
// [#743](https://github.com/Omega-JS-Stack/omega/issues/743) — there is no
// build.json sidecar to read, so this lane reads it back the way a browser does.
const { readBakedBuildJson } = require(path.join(ROOT, 'packages', 'extension', 'src', 'gulp', 'tasks', 'utils', 'build-json.js'));
const { createStepsLog } = require('./steps-log');

const EMULATOR_READY_TIMEOUT = 240000;
const BUILD_TIMEOUT = 300000;
const READY_MARKER = /Emulator ready\. Press Ctrl\+C/i;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const stripAnsi = (text) => text.replace(/\x1B\[[0-9;]*m/g, '');

const failures = [];
const stepsLog = createStepsLog(LOG_DIR);

// Every verdict lands in .temp/extension-auth-e2e/steps.log as it happens, so a
// crashed run still names the step that broke.
async function step(name, fn) {
  try {
    const detail = await fn();
    stepsLog.pass(name, detail);
    console.log(`  ✓ ${name}${detail ? ` (${detail})` : ''}`);
  } catch (error) {
    failures.push({ name, error });
    stepsLog.fail(name, error);
    console.log(`  ✗ ${name}\n      ${error.message}`);
    throw error;
  }
}

function isPortListening(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    const done = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.setTimeout(1000, () => done(false));
  });
}

// -- Extension build --------------------------------------------------------

// Run the app's REAL gulp build in testing mode. The gulp process does not
// exit on its own after `build` finishes (open handles in the pipeline), so the
// lane waits for the pipeline's own finish marker and then stops the group.
function buildExtension() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const buildLog = path.join(LOG_DIR, 'build.log');
  const logStream = fs.createWriteStream(buildLog);

  const gulpBin = path.join(ROOT, 'node_modules', '.bin', 'gulp');
  const child = spawn(gulpBin, ['build'], {
    cwd: EXTENSION_APP,
    env: { ...process.env, OMEGA_TEST_MODE: 'true' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`extension build not finished after ${BUILD_TIMEOUT / 1000}s (log: ${buildLog})`));
    }, BUILD_TIMEOUT);

    const watch = (chunk) => {
      const text = stripAnsi(chunk.toString());
      logStream.write(text);
      if (/Finished 'build'/.test(text)) {
        clearTimeout(timer);
        resolve();
      } else if (/'build' errored/.test(text)) {
        clearTimeout(timer);
        reject(new Error(`extension build failed (log: ${buildLog})`));
      }
    };

    child.stdout.on('data', watch);
    child.stderr.on('data', watch);
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`extension build exited early (code ${code}, log: ${buildLog})`));
    });
  }).finally(() => {
    try { process.kill(-child.pid, 'SIGKILL'); } catch (e) { /* already gone */ }
  });
}

// -- Emulator lifecycle (mirrors scripts/e2e-auth-token.js) -----------------

function startEmulator() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const emulatorLog = path.join(LOG_DIR, 'emulator.log');
  const logStream = fs.createWriteStream(emulatorLog);

  // Spawn the hoisted local bin DIRECTLY (not via npx) — outside an npm-script
  // PATH the npx shim routes through the Socket Firewall proxy, which breaks
  // firebase-tools' internal emulator REST calls.
  // --no-https: with mkcert present the interactive command fronts hosting
  // with TLS and moves plain hosting to an internal port — and Chrome would
  // then have to trust the mkcert root for every SW fetch, which this lane
  // does not set up. Plain http keeps the wire itself the thing under test.
  const mgrBin = path.join(ROOT, 'node_modules', '.bin', 'mgr');
  const child = spawn(mgrBin, ['emulator', '--no-seed', '--no-https'], {
    cwd: PLAYGROUND_BACKEND,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });

  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`emulator not ready after ${EMULATOR_READY_TIMEOUT / 1000}s (log: ${emulatorLog})`));
    }, EMULATOR_READY_TIMEOUT);

    const watch = (chunk) => {
      const text = chunk.toString();
      logStream.write(text);
      if (READY_MARKER.test(text)) {
        clearTimeout(timer);
        resolve();
      }
    };

    child.stdout.on('data', watch);
    child.stderr.on('data', watch);
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`emulator exited early (code ${code}, log: ${emulatorLog})`));
    });
  });

  return { child, ready };
}

async function stopEmulator(child) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  try { process.kill(-child.pid, 'SIGINT'); } catch (e) { return; }
  const result = await Promise.race([exited.then(() => 'clean'), sleep(20000)]);
  if (result !== 'clean') {
    try { process.kill(-child.pid, 'SIGKILL'); } catch (e) { /* already gone */ }
  }
}

// ---------------------------------------------------------------------------

async function main() {
  console.log('\nExtension auth e2e (real Chrome, real extension, syncAuth ↔ backend)\n');

  let puppeteer = null;
  try {
    puppeteer = require('puppeteer');
    const chrome = puppeteer.executablePath();
    if (!chrome || !fs.existsSync(chrome)) {
      throw new Error(`puppeteer's Chrome is not installed at ${chrome}`);
    }
  } catch (error) {
    console.log(`⏭ SKIPPED — ${error.message}`);
    console.log('   install it with `npx puppeteer browsers install chrome`\n');
    process.exit(0);
  }

  let emulator = null;
  let browser = null;
  let ports = null;
  const swConsole = [];
  const pageConsole = [];

  try {
    // Never clobber a live playground stack
    const incumbent = readPortsFile(PLAYGROUND_BACKEND);
    if (incumbent?.hosting && await isPortListening(incumbent.hosting)) {
      throw new Error(`a playground emulator stack is already running (hosting :${incumbent.hosting}) — stop it and re-run`);
    }

    await step('playground emulator boots (auth, functions, hosting)', async () => {
      emulator = startEmulator();
      await emulator.ready;
      ports = readPortsFile(PLAYGROUND_BACKEND);
      if (!ports?.hosting || !ports?.auth) {
        throw new Error(`resolved port map incomplete: ${JSON.stringify(ports)}`);
      }
      return `hosting :${ports.hosting}, auth :${ports.auth}`;
    });

    let buildConfig = null;

    // The build runs AFTER the boot on purpose: the bundle task bakes the
    // sibling backend's resolved ports into the snapshot's `dev.ports`, which is
    // the ONLY channel the extension contexts have — so a bumped stack reaches
    // the SW ([#744](https://github.com/Omega-JS-Stack/omega/issues/744)).
    await step('the playground extension builds as a TESTING build', async () => {
      await buildExtension();

      const manifestPath = path.join(PACKAGED_DIR, 'manifest.json');
      if (!fs.existsSync(manifestPath)) {
        throw new Error(`no packaged build at ${PACKAGED_DIR}`);
      }
      // Read it out of the SERVICE WORKER's own bundle — the artifact whose bake
      // this lane is about, rather than a sidecar that only described it.
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const serviceWorker = manifest.background?.service_worker;
      if (!serviceWorker) {
        throw new Error('the packaged manifest declares no background.service_worker — nothing to read the bake from');
      }
      buildConfig = readBakedBuildJson(path.join(PACKAGED_DIR, serviceWorker)).config;
      if (buildConfig.omega?.environment !== 'testing') {
        throw new Error(`build is not a testing build (omega.environment: ${buildConfig.omega?.environment})`);
      }
      if (!buildConfig.cloud?.config?.apiKey) {
        throw new Error('build config carries no cloud.config — the SW cannot initialize Firebase');
      }

      // The bake is the mechanism under test: what the SW will reach for
      // hosting (getApiUrl) and auth (background.js) must be the live stack.
      const baked = buildConfig.dev?.ports || {};
      if (baked.hosting !== ports.hosting || baked.auth !== ports.auth) {
        throw new Error(`the build baked hosting :${baked.hosting}, auth :${baked.auth}, but the live emulator is on hosting :${ports.hosting}, auth :${ports.auth}`);
      }
      return `brand ${buildConfig.brand.url}, baked hosting :${baked.hosting}, auth :${baked.auth}`;
    });

    let popupPath = null;

    await step('the built extension is staged with the `tabs` permission', async () => {
      fs.rmSync(EXTENSION_DIR, { recursive: true, force: true });
      fs.cpSync(PACKAGED_DIR, EXTENSION_DIR, { recursive: true });

      const manifestPath = path.join(EXTENSION_DIR, 'manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      manifest.permissions = [...new Set([...(manifest.permissions || []), 'tabs'])];
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

      popupPath = manifest.action?.default_popup;
      if (!popupPath) {
        throw new Error('the built manifest declares no action.default_popup — no context to sync from');
      }
      return path.relative(ROOT, EXTENSION_DIR);
    });

    const apiBase = `http://127.0.0.1:${ports.hosting}`;
    const firebaserc = JSON.parse(fs.readFileSync(path.join(PLAYGROUND_BACKEND, '.firebaserc'), 'utf8'));
    const projectId = firebaserc.projects.default;

    // Real firebase client SDK, resolved from @omega.js/client's dependency tree
    const clientRequire = createRequire(path.join(ROOT, 'packages', 'client', 'package.json'));
    const { initializeApp } = clientRequire('firebase/app');
    const { getAuth, connectAuthEmulator, createUserWithEmailAndPassword } = clientRequire('firebase/auth');

    const EMAIL = `extension-e2e-${Date.now()}@example.com`;
    const PASSWORD = 'e2e-password-1';

    let user = null;
    let signInToken = null;

    await step('a real user signs up against the auth emulator', async () => {
      const app = initializeApp({ apiKey: buildConfig.cloud.config.apiKey, projectId }, 'extension-e2e');
      const auth = getAuth(app);
      connectAuthEmulator(auth, `http://127.0.0.1:${ports.auth}`, { disableWarnings: true });

      const credential = await createUserWithEmailAndPassword(auth, EMAIL, PASSWORD);
      user = credential.user;
      return `uid ${user.uid}`;
    });

    await step('the backend mints the sign-in custom token for that user', async () => {
      const idToken = await user.getIdToken(true);
      const response = await fetch(`${apiBase}/omega/user/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({}),
      });
      if (response.status !== 200) {
        throw new Error(`POST /omega/user/token should 200 (got ${response.status})`);
      }
      signInToken = (await response.json()).token;
      assert.equal(typeof signInToken, 'string', 'custom token should be a string');
    });

    const brandHost = new URL(buildConfig.brand.url).hostname;
    let extensionId = null;

    await step('Chrome loads the built extension and its service worker comes up', async () => {
      browser = await puppeteer.launch({
        headless: 'new',
        args: [
          `--disable-extensions-except=${EXTENSION_DIR}`,
          `--load-extension=${EXTENSION_DIR}`,
          '--no-sandbox',
          '--disable-dev-shm-usage',
          // Offline by construction: the brand host is the local hosting
          // emulator, localhost is itself, everything else does not resolve.
          `--host-resolver-rules=MAP ${brandHost} 127.0.0.1,MAP localhost 127.0.0.1,MAP * ~NOTFOUND`,
        ],
      });

      const swTarget = await browser.waitForTarget(
        (target) => target.type() === 'service_worker' && target.url().startsWith('chrome-extension://'),
        { timeout: 30000 },
      );
      extensionId = swTarget.url().split('/')[2];

      const worker = await swTarget.worker();
      if (!worker) {
        throw new Error('could not attach to the background service worker');
      }
      worker.on('console', (message) => swConsole.push(`[${message.type()}] ${message.text()}`));
      return `extension ${extensionId}`;
    });

    // The popup is the REAL context the auth-helpers sync from — one page,
    // reused: it both proves the SW finished booting and carries the sync
    // assertions. `ask()` is the exact message syncWithBackground() sends.
    const askSyncAuth = (page) => page.evaluate(() => new Promise((resolve) => {
      chrome.runtime.sendMessage({ command: 'omega:syncAuth', contextUid: null }, (response) => {
        resolve(chrome.runtime.lastError ? { error: chrome.runtime.lastError.message } : (response || {}));
      });
    }));

    let popup = null;

    await step('the popup context reaches the background SW (boot complete)', async () => {
      popup = await browser.newPage();
      popup.on('console', (message) => pageConsole.push(`[popup:${message.type()}] ${message.text()}`));
      await popup.goto(`chrome-extension://${extensionId}/${popupPath}`, { waitUntil: 'domcontentloaded' });

      // An answered syncAuth means initialize() ran to completion — including
      // the tab watcher the sign-in step below depends on.
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        const response = await askSyncAuth(popup);
        if (response && !response.error) return;
        await sleep(1000);
      }
      throw new Error('the background service worker never answered omega:syncAuth');
    });

    await step('the background SW signs itself in from the brand-site auth tab', async () => {
      // The REAL sign-in path: the brand site lands with ?authToken=…, the
      // SW's tab watcher picks it up, signs in with signInWithCustomToken
      // against the auth emulator, and closes the tab.
      const page = await browser.newPage();
      page.on('console', (message) => pageConsole.push(`[auth-tab:${message.type()}] ${message.text()}`));
      const authUrl = `http://${brandHost}:${ports.hosting}/?authToken=${signInToken}`;
      // The SW closes this tab on success, which rejects the in-flight goto.
      await page.goto(authUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
    });

    await step('syncAuth round-trips a FRESH backend token into the extension context', async () => {
      // Everything below runs INSIDE the extension's popup context: the real
      // message the real auth-helpers send, and the uid comparison itself.
      const result = await popup.evaluate(async (expectedUid) => {
        const ask = () => new Promise((resolve) => {
          chrome.runtime.sendMessage({ command: 'omega:syncAuth', contextUid: null }, (response) => {
            resolve(chrome.runtime.lastError ? { error: chrome.runtime.lastError.message } : (response || {}));
          });
        });

        const deadline = Date.now() + 60000;
        let last = null;
        while (Date.now() < deadline) {
          last = await ask();
          if (last.needsSync && last.customToken) {
            const claims = JSON.parse(atob(last.customToken.split('.')[1]));
            return {
              synced: true,
              backgroundUid: last.user && last.user.uid,
              tokenUid: claims.uid,
              uidMatches: last.user && last.user.uid === expectedUid && claims.uid === expectedUid,
            };
          }
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        return { synced: false, last };
      }, user.uid);

      if (!result.synced) {
        throw new Error(`background never handed a custom token back (last response: ${JSON.stringify(result.last)})`);
      }
      assert.equal(result.backgroundUid, user.uid, 'the background SW should be signed in as the e2e user');
      assert.equal(result.tokenUid, user.uid, 'the token the backend minted should carry the e2e uid');
      assert.ok(result.uidMatches, 'the extension context asserted the uid round trip');
      return `uid ${result.tokenUid}`;
    });
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    if (emulator) {
      await stopEmulator(emulator.child);
    }
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.writeFileSync(path.join(LOG_DIR, 'sw.log'), `${swConsole.join('\n')}\n`);
    fs.writeFileSync(path.join(LOG_DIR, 'page.log'), `${pageConsole.join('\n')}\n`);
  }

  if (failures.length > 0) {
    console.log(`\n✗ extension auth e2e FAILED (${failures.length} failing step${failures.length === 1 ? '' : 's'}) — logs: ${path.relative(ROOT, LOG_DIR)}/\n`);
    process.exit(1);
  }

  console.log('\n✓ extension auth e2e PASSED\n');
}

main().catch((error) => {
  // A death outside step() — the live-stack preflight guard, a throw on the way
  // up — has no verdict yet; record one so steps.log still answers "why did
  // nothing run?". A step failure propagating out is already on file.
  stepsLog.abort(error);
  console.error(`\n✗ extension auth e2e errored: ${error.message}`);
  console.error(`   logs: ${path.relative(ROOT, LOG_DIR)}/\n`);
  process.exit(1);
});
