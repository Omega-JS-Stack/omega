/**
 * Root `npm run test:e2e-extension`: the extension sign-in in a REAL Chrome.
 * The emulator boots and seeds its personas, then the playground extension
 * builds as a TESTING build (after the boot, so the live ports are baked in).
 * This lane's own persona (scripts/roster-persona.js) is minted a custom token;
 * a brand-host tab carrying `?authToken=` signs the background SW in; the
 * popup's `omega:syncAuth` gets a FRESH token for the same uid; a popup opened
 * afterwards renders signed in. Then the worker saves a note, Chrome stops it,
 * and a `notes:count` from a document with no omega context wakes it: the
 * restored session counts the note. Offline: host-resolver rules send the brand
 * host to 127.0.0.1, nothing else. OMEGA_SKIP_E2E=1 skips; no Chrome is a SKIP.
 */
const path = require('path');
const fs = require('fs');
const net = require('net');
const { spawn } = require('child_process');
const assert = require('assert');

if (process.env.OMEGA_SKIP_E2E === '1') {
  console.log('⏭ OMEGA_SKIP_E2E=1 — skipping extension auth e2e');
  process.exit(0);
}

const ROOT = path.join(__dirname, '..');
const PLAYGROUND_BACKEND = path.join(ROOT, 'brands', 'playground-omega', 'targets', 'backend');
const EXTENSION_APP = path.join(ROOT, 'brands', 'playground-omega', 'targets', 'extension');
const PACKAGED_DIR = path.join(EXTENSION_APP, 'packaged', 'chrome', 'raw');
const LOG_DIR = path.join(ROOT, '.temp', 'extension-auth-e2e');
const EXTENSION_DIR = path.join(LOG_DIR, 'extension');

const { readPortsFile } = require('@omega.js/config');
// The snapshot is the ONE `build.js` at the artifact's root since
// [#743](https://github.com/Omega-JS-Stack/omega/issues/743), so this lane reads
// it back the way a browser does: by running the file.
const { readBakedBuildJson } = require(path.join(ROOT, 'packages', 'extension', 'src', 'gulp', 'tasks', 'utils', 'build-json.js'));
const { attachLiveWorker } = require(path.join(ROOT, 'packages', 'extension', 'src', 'test', 'runners', 'service-worker.js'));
const { createStepsLog } = require('./steps-log');
const { mintPersonaToken } = require('./roster-persona');

// This lane's own seeded persona, never shared with another suite
const PERSONA_LOCALPART = '_test.extension-auth-e2e';

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
    // The one environment input (#817), named the way `omega test` names it for
    // its own children: the build lane keeps a word it inherited, and a bare
    // gulp boot would otherwise bake `development`.
    env: { ...process.env, OMEGA_TEST_MODE: 'true', OMEGA_ENVIRONMENT: 'testing' },
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
  const child = spawn(mgrBin, ['emulator', '--no-https'], {
    cwd: PLAYGROUND_BACKEND,
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

    await step('playground emulator boots (auth, functions, hosting) and seeds its personas', async () => {
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
      // Read the file every context in the artifact loads, which is the thing
      // this lane is about, rather than a sidecar that only described it.
      const buildJsPath = path.join(PACKAGED_DIR, 'build.js');
      if (!fs.existsSync(buildJsPath)) {
        throw new Error(`the packaged artifact carries no build.js at ${PACKAGED_DIR}`);
      }
      buildConfig = readBakedBuildJson(buildJsPath).config;
      if (buildConfig.environment !== 'testing') {
        throw new Error(`build is not a testing build (environment: ${buildConfig.environment})`);
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

    let signIn = null;

    await step('the roster\'s persona signs in with the test password and the backend mints its custom token', async () => {
      const firebaseConfig = { apiKey: buildConfig.cloud.config.apiKey, projectId };
      signIn = await mintPersonaToken({ apiBase, authPort: ports.auth, firebaseConfig, localpart: PERSONA_LOCALPART });
      return `${signIn.email}, uid ${signIn.uid}`;
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
          // emulator, loopback is itself, everything else does not resolve. The
          // wildcard also catches the 127.0.0.1 literal, so it is excluded by name.
          `--host-resolver-rules=MAP ${brandHost} 127.0.0.1,MAP localhost 127.0.0.1,EXCLUDE 127.0.0.1,MAP * ~NOTFOUND`,
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
    // assertions. `ask()` is the messenger shape syncWithBackground() sends,
    // for a context that holds no user yet.
    const askSyncAuth = (page) => page.evaluate(() => new Promise((resolve) => {
      chrome.runtime.sendMessage({ destination: 'background', command: 'omega:syncAuth', payload: { uid: null } }, (response) => {
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
      const authUrl = `http://${brandHost}:${ports.hosting}/?authToken=${signIn.token}`;
      // The SW closes this tab on success, which rejects the in-flight goto.
      await page.goto(authUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
    });

    await step('syncAuth round-trips a FRESH backend token into the extension context', async () => {
      // Everything below runs INSIDE the extension's popup context: the real
      // message the real auth-helpers send, and the uid comparison itself.
      const result = await popup.evaluate(async (expectedUid) => {
        const ask = () => new Promise((resolve) => {
          chrome.runtime.sendMessage({ destination: 'background', command: 'omega:syncAuth', payload: { uid: null } }, (response) => {
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
      }, signIn.uid);

      if (!result.synced) {
        throw new Error(`background never handed a custom token back (last response: ${JSON.stringify(result.last)})`);
      }
      assert.equal(result.backgroundUid, signIn.uid, 'the background SW should be signed in as the persona');
      assert.equal(result.tokenUid, signIn.uid, 'the token the backend minted should carry the persona uid');
      assert.ok(result.uidMatches, 'the extension context asserted the uid round trip');
      return `uid ${result.tokenUid}`;
    });

    await step('a popup opened now signs its own page in, and its bindings show it', async () => {
      // The page's OWN sync on load: its @omega.js/client asks background, takes
      // the relayed custom token, and the playground popup's @show bindings flip.
      const page = await browser.newPage();
      page.on('console', (message) => pageConsole.push(`[popup-after:${message.type()}] ${message.text()}`));
      await page.goto(`chrome-extension://${extensionId}/${popupPath}`, { waitUntil: 'domcontentloaded' });

      await page.waitForFunction(() => {
        const signedIn = document.getElementById('popup-signed-in');
        const signedOut = document.getElementById('popup-signed-out');
        return Boolean(signedIn && signedOut && !signedIn.hidden && signedOut.hidden);
      }, { timeout: 60000 }).catch(() => {
        throw new Error('the popup never rendered its signed-in state from the background relay');
      });
      await page.close();
    });

    // The restart proof runs from an extension-origin document that boots no
    // omega context (the manifest opened as a page) and holds no port, so no
    // omega:syncAuth can push an account into a restarted worker: it answers
    // from its own session, even when Chrome restarts it before the wake.
    let sender = null;
    const askBackground = (command, payload) => sender.evaluate((name, input) => chrome.runtime.sendMessage({
      destination: 'background', command: name, payload: input,
    }), command, payload);
    let signedInCount = null;

    await step('the signed-in worker saves a note and counts it', async () => {
      await popup.close();
      sender = await browser.newPage();
      await sender.goto(`chrome-extension://${extensionId}/manifest.json`);

      // The popup's sync landed the account on background; retry until it has
      const deadline = Date.now() + 30000;
      let created = null;
      while (Date.now() < deadline) {
        created = await askBackground('notes:create', { text: 'restart proof' });
        if (created?.ok) break;
        await sleep(1000);
      }
      if (!created?.ok) {
        throw new Error(`background never saved the note (last answer: ${JSON.stringify(created)})`);
      }

      const counted = await askBackground('notes:count');
      assert.equal(counted?.ok, true, `notes:count should answer ok (got ${JSON.stringify(counted)})`);
      assert.ok(counted.count >= 1, `the signed-in count should include the saved note (got ${counted.count})`);
      signedInCount = counted.count;
      return `count ${signedInCount}`;
    });

    await step('a restarted worker answers the signed-in notes:count with no page context open', async () => {
      // Chrome's own word that the worker stopped: the target list may keep its entry
      const control = await sender.createCDPSession();
      const stopped = new Promise((resolve) => control.on('ServiceWorker.workerVersionUpdated', ({ versions }) => {
        if (versions.some((version) => version.scriptURL.startsWith(`chrome-extension://${extensionId}/`) && version.runningStatus === 'stopped')) {
          resolve();
        }
      }));
      await control.send('ServiceWorker.enable');
      await control.send('ServiceWorker.stopAllWorkers');
      await Promise.race([
        stopped,
        sleep(15000).then(() => { throw new Error('the background service worker never reported stopped'); }),
      ]);
      await control.detach().catch(() => {});

      // The message wakes a fresh worker, which restores its session before
      // answering. The lane's console client from boot pauses the new worker on
      // start, so attaching it live releases that pause.
      const answer = askBackground('notes:count').catch((error) => ({ error: error.message }));
      const live = await attachLiveWorker(browser, extensionId, 30000);
      await live.detach().catch(() => {});
      const counted = await Promise.race([
        answer,
        sleep(60000).then(() => { throw new Error('the restarted worker never answered notes:count'); }),
      ]);
      assert.deepEqual(counted, { ok: true, count: signedInCount }, 'the restarted worker should count the signed-in notes');
      return `count ${counted.count} after the restart`;
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
