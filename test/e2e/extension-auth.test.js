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
const defineCases = require('@omega.js/devkit/test/define-cases');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const { startPlaygroundEmulator, stopPlaygroundEmulator, playgroundProjectId } = require('./_emulator');
const { mintPersonaToken } = require('../../scripts/roster-persona');

const ROOT = path.join(__dirname, '..', '..');
const EXTENSION_APP = path.join(ROOT, 'brands', 'playground-omega', 'targets', 'extension');
const PACKAGED_DIR = path.join(EXTENSION_APP, 'packaged', 'chrome', 'raw');
const LOG_DIR = path.join(ROOT, '.temp', 'extension-auth-e2e');
const EXTENSION_DIR = path.join(LOG_DIR, 'extension');

// The snapshot is the ONE `build.js` at the artifact's root, so this lane reads
// it back the way a browser does: by running the file.
const { readBakedBuildJson } = require(path.join(ROOT, 'packages', 'extension', 'src', 'gulp', 'tasks', 'utils', 'build-json.js'));
const { attachLiveWorker } = require(path.join(ROOT, 'packages', 'extension', 'src', 'test', 'runners', 'service-worker.js'));

// This lane's own seeded persona, never shared with another suite
const PERSONA_LOCALPART = '_test.extension-auth-e2e';

const BUILD_TIMEOUT = 300000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const stripAnsi = (text) => text.replace(/\x1B\[[0-9;]*m/g, '');

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
    // The one environment input, named the way `omega test` names it for its
    // own children: a bare gulp boot would otherwise bake `development`.
    env: { ...process.env, OMEGA_ENVIRONMENT: 'testing' },
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

// The messenger shape syncWithBackground() sends, for a context that holds no user yet.
function askSyncAuth(page) {
  return page.evaluate(() => new Promise((resolve) => {
    chrome.runtime.sendMessage({ destination: 'background', command: 'omega:syncAuth', payload: { uid: null } }, (response) => {
      resolve(chrome.runtime.lastError ? { error: chrome.runtime.lastError.message } : (response || {}));
    });
  }));
}

function askBackground(sender, command, payload) {
  return sender.evaluate((name, input) => chrome.runtime.sendMessage({
    destination: 'background', command: name, payload: input,
  }), command, payload);
}

module.exports = defineCases({
  type: 'suite',
  description: 'extension auth e2e (real Chrome, real extension, syncAuth to backend)',
  timeout: 300000,

  setup(ctx) {
    if (process.env.OMEGA_SKIP_E2E === '1') ctx.skip('OMEGA_SKIP_E2E=1');

    try {
      ctx.state.puppeteer = require('puppeteer');
      const chrome = ctx.state.puppeteer.executablePath();
      if (!chrome || !fs.existsSync(chrome)) {
        throw new Error(`puppeteer's Chrome is not installed at ${chrome}`);
      }
    } catch (error) {
      ctx.skip(`${error.message} (install it with \`npx puppeteer browsers install chrome\`)`);
    }

    ctx.state.swConsole = [];
    ctx.state.pageConsole = [];
  },

  async cleanup(ctx) {
    const { browser, emulator, swConsole, pageConsole } = ctx.state;
    // A skipped lane collected nothing, so it writes no logs.
    if (!swConsole) return;
    if (browser) {
      await browser.close().catch(() => {});
    }
    await stopPlaygroundEmulator(emulator);
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.writeFileSync(path.join(LOG_DIR, 'sw.log'), `${swConsole.join('\n')}\n`);
    fs.writeFileSync(path.join(LOG_DIR, 'page.log'), `${pageConsole.join('\n')}\n`);
  },

  tests: [
    {
      name: 'playground emulator boots (auth, functions, hosting) and seeds its personas',
      run: async (ctx) => {
        // --no-https: with mkcert present hosting would be fronted with TLS, and
        // Chrome would then have to trust the mkcert root for every SW fetch,
        // which this lane does not set up. Plain http keeps the wire under test.
        const { child, ports } = await startPlaygroundEmulator({ logDir: LOG_DIR, args: ['--no-https'] });
        ctx.state.emulator = child;
        ctx.state.ports = ports;
        console.log(`    hosting :${ports.hosting}, auth :${ports.auth}`);
      },
    },

    {
      // The build runs AFTER the boot on purpose: the bundle task bakes the
      // sibling backend's resolved ports into the snapshot's `dev.ports`, the
      // ONLY channel the extension contexts have, so a bumped stack reaches the SW.
      name: 'the playground extension builds as a TESTING build',
      // The build's own ceiling rejects first, naming its log; this is the backstop.
      timeout: BUILD_TIMEOUT + 60000,
      run: async (ctx) => {
        const { ports } = ctx.state;
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
        const buildConfig = readBakedBuildJson(buildJsPath).config;
        ctx.state.buildConfig = buildConfig;
        if (buildConfig.environment !== 'testing') {
          throw new Error(`build is not a testing build (environment: ${buildConfig.environment})`);
        }
        if (!buildConfig.cloud?.config?.apiKey) {
          throw new Error('build config carries no cloud.config: the SW cannot initialize Firebase');
        }

        // The bake is the mechanism under test: what the SW will reach for
        // hosting (getApiUrl) and auth (background.js) must be the live stack.
        const baked = buildConfig.dev?.ports || {};
        if (baked.hosting !== ports.hosting || baked.auth !== ports.auth) {
          throw new Error(`the build baked hosting :${baked.hosting}, auth :${baked.auth}, but the live emulator is on hosting :${ports.hosting}, auth :${ports.auth}`);
        }
        console.log(`    brand ${buildConfig.brand.url}, baked hosting :${baked.hosting}, auth :${baked.auth}`);
      },
    },

    {
      name: 'the built extension is staged with the `tabs` permission',
      run: (ctx) => {
        fs.rmSync(EXTENSION_DIR, { recursive: true, force: true });
        fs.cpSync(PACKAGED_DIR, EXTENSION_DIR, { recursive: true });

        const manifestPath = path.join(EXTENSION_DIR, 'manifest.json');
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        manifest.permissions = [...new Set([...(manifest.permissions || []), 'tabs'])];
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

        ctx.state.popupPath = manifest.action?.default_popup;
        if (!ctx.state.popupPath) {
          throw new Error('the built manifest declares no action.default_popup: no context to sync from');
        }
        console.log(`    ${path.relative(ROOT, EXTENSION_DIR)}`);
      },
    },

    {
      name: 'the roster\'s persona signs in with the test password and the backend mints its custom token',
      run: async (ctx) => {
        const { ports, buildConfig } = ctx.state;
        const firebaseConfig = { apiKey: buildConfig.cloud.config.apiKey, projectId: playgroundProjectId() };
        const apiBase = `http://127.0.0.1:${ports.hosting}`;
        const signIn = await mintPersonaToken({ apiBase, authPort: ports.auth, firebaseConfig, localpart: PERSONA_LOCALPART });
        ctx.state.signIn = signIn;
        console.log(`    ${signIn.email}, uid ${signIn.uid}`);
      },
    },

    {
      name: 'Chrome loads the built extension and its service worker comes up',
      run: async (ctx) => {
        const { state } = ctx;
        state.brandHost = new URL(state.buildConfig.brand.url).hostname;
        state.browser = await state.puppeteer.launch({
          headless: 'new',
          args: [
            `--disable-extensions-except=${EXTENSION_DIR}`,
            `--load-extension=${EXTENSION_DIR}`,
            '--no-sandbox',
            '--disable-dev-shm-usage',
            // Offline by construction: the brand host is the local hosting emulator,
            // loopback is itself, everything else does not resolve. The wildcard
            // also catches the 127.0.0.1 literal, so it is excluded by name.
            `--host-resolver-rules=MAP ${state.brandHost} 127.0.0.1,MAP localhost 127.0.0.1,EXCLUDE 127.0.0.1,MAP * ~NOTFOUND`,
          ],
        });

        const swTarget = await state.browser.waitForTarget(
          (target) => target.type() === 'service_worker' && target.url().startsWith('chrome-extension://'),
          { timeout: 30000 },
        );
        state.extensionId = swTarget.url().split('/')[2];

        const worker = await swTarget.worker();
        if (!worker) {
          throw new Error('could not attach to the background service worker');
        }
        worker.on('console', (message) => state.swConsole.push(`[${message.type()}] ${message.text()}`));
        console.log(`    extension ${state.extensionId}`);
      },
    },

    {
      // The popup is the REAL context the auth-helpers sync from, one page reused:
      // it both proves the SW finished booting and carries the sync assertions.
      name: 'the popup context reaches the background SW (boot complete)',
      run: async (ctx) => {
        const { state } = ctx;
        state.popup = await state.browser.newPage();
        state.popup.on('console', (message) => state.pageConsole.push(`[popup:${message.type()}] ${message.text()}`));
        await state.popup.goto(`chrome-extension://${state.extensionId}/${state.popupPath}`, { waitUntil: 'domcontentloaded' });

        // An answered syncAuth means initialize() ran to completion, including
        // the tab watcher the sign-in case below depends on.
        const deadline = Date.now() + 30000;
        while (Date.now() < deadline) {
          const response = await askSyncAuth(state.popup);
          if (response && !response.error) return;
          await sleep(1000);
        }
        throw new Error('the background service worker never answered omega:syncAuth');
      },
    },

    {
      name: 'the background SW signs itself in from the brand-site auth tab',
      run: async (ctx) => {
        const { state } = ctx;
        // The REAL sign-in path: the brand site lands with ?authToken=, the SW's
        // tab watcher picks it up, signs in with signInWithCustomToken against
        // the auth emulator, and closes the tab.
        const page = await state.browser.newPage();
        page.on('console', (message) => state.pageConsole.push(`[auth-tab:${message.type()}] ${message.text()}`));
        const authUrl = `http://${state.brandHost}:${state.ports.hosting}/?authToken=${state.signIn.token}`;
        // The SW closes this tab on success, which rejects the in-flight goto.
        await page.goto(authUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
      },
    },

    {
      name: 'syncAuth round-trips a FRESH backend token into the extension context',
      run: async (ctx) => {
        const { state, expect } = ctx;
        // Everything below runs INSIDE the extension's popup context: the real
        // message the real auth-helpers send, and the uid comparison itself.
        const result = await state.popup.evaluate(async (expectedUid) => {
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
        }, state.signIn.uid);

        if (!result.synced) {
          throw new Error(`background never handed a custom token back (last response: ${JSON.stringify(result.last)})`);
        }
        expect(result.backgroundUid, 'the background SW should be signed in as the persona').toBe(state.signIn.uid);
        expect(result.tokenUid, 'the token the backend minted should carry the persona uid').toBe(state.signIn.uid);
        expect(result.uidMatches, 'the extension context asserted the uid round trip').toBeTruthy();
        console.log(`    uid ${result.tokenUid}`);
      },
    },

    {
      name: 'a popup opened now signs its own page in, and its bindings show it',
      run: async (ctx) => {
        const { state } = ctx;
        // The page's OWN sync on load: its @omega.js/client asks background, takes
        // the relayed custom token, and the playground popup's @show bindings flip.
        const page = await state.browser.newPage();
        page.on('console', (message) => state.pageConsole.push(`[popup-after:${message.type()}] ${message.text()}`));
        await page.goto(`chrome-extension://${state.extensionId}/${state.popupPath}`, { waitUntil: 'domcontentloaded' });

        await page.waitForFunction(() => {
          const signedIn = document.getElementById('popup-signed-in');
          const signedOut = document.getElementById('popup-signed-out');
          return Boolean(signedIn && signedOut && !signedIn.hidden && signedOut.hidden);
        }, { timeout: 60000 }).catch(() => {
          throw new Error('the popup never rendered its signed-in state from the background relay');
        });
        await page.close();
      },
    },

    {
      // The restart proof runs from an extension-origin document that boots no omega
      // context (the manifest opened as a page) and holds no port, so no syncAuth can
      // push an account into a restarted worker: it answers from its own session.
      name: 'the signed-in worker saves a note and counts it',
      run: async (ctx) => {
        const { state, expect } = ctx;
        await state.popup.close();
        state.sender = await state.browser.newPage();
        await state.sender.goto(`chrome-extension://${state.extensionId}/manifest.json`);

        // The popup's sync landed the account on background; retry until it has
        const deadline = Date.now() + 30000;
        let created = null;
        while (Date.now() < deadline) {
          created = await askBackground(state.sender, 'notes:create', { text: 'restart proof' });
          if (created?.ok) break;
          await sleep(1000);
        }
        if (!created?.ok) {
          throw new Error(`background never saved the note (last answer: ${JSON.stringify(created)})`);
        }

        const counted = await askBackground(state.sender, 'notes:count');
        expect(counted?.ok, `notes:count should answer ok (got ${JSON.stringify(counted)})`).toBe(true);
        expect(counted.count >= 1, `the signed-in count should include the saved note (got ${counted.count})`).toBeTruthy();
        state.signedInCount = counted.count;
        console.log(`    count ${state.signedInCount}`);
      },
    },

    {
      name: 'a restarted worker answers the signed-in notes:count with no page context open',
      run: async (ctx) => {
        const { state, expect } = ctx;
        // Chrome's own word that the worker stopped: the target list may keep its entry
        const control = await state.sender.createCDPSession();
        const stopped = new Promise((resolve) => control.on('ServiceWorker.workerVersionUpdated', ({ versions }) => {
          if (versions.some((version) => version.scriptURL.startsWith(`chrome-extension://${state.extensionId}/`) && version.runningStatus === 'stopped')) {
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
        const answer = askBackground(state.sender, 'notes:count').catch((error) => ({ error: error.message }));
        const live = await attachLiveWorker(state.browser, state.extensionId, 30000);
        await live.detach().catch(() => {});
        const counted = await Promise.race([
          answer,
          sleep(60000).then(() => { throw new Error('the restarted worker never answered notes:count'); }),
        ]);
        expect(counted, 'the restarted worker should count the signed-in notes').toEqual({ ok: true, count: state.signedInCount });
        console.log(`    count ${counted.count} after the restart`);
      },
    },
  ],
});
