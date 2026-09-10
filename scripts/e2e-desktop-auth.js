/**
 * Root `npm run test:e2e-desktop` — the desktop ↔ backend AUTH boundary, proven
 * in a REAL Electron app across the real app boundary (#46).
 *
 * The fast wire lane (scripts/e2e-auth-token.js) requires the desktop
 * client-bridge in-process from node with a synthetic Manager: it proves the
 * TOKEN contract, never the app. This lane proves the APP: a real consumer
 * bundle booting in a real Electron process, a real deep link arriving the way
 * the OS delivers one, and both sides of the process boundary landing on the
 * emulator user.
 *
 * Proof, in order:
 *   1. The playground backend emulator boots (auth + functions + hosting).
 *   2. A real user signs up against the AUTH emulator and the backend mints its
 *      sign-in custom token at POST /omega/user/token (the node-side setup —
 *      the same seed the sibling lanes use).
 *   3. A consumer app is staged from @omega.js/desktop's bundled fixture, given
 *      a cloud config pointed at the emulator project, and built by the
 *      REAL gulp pipeline into a real dist/main.bundle.js (the boot runner does
 *      the build + the spawn — the production boot path, not lib code in node).
 *   4. A SECOND Electron instance launches carrying
 *      `<brand.id>://auth/token?authToken=…` in its argv. The OS-level
 *      single-instance lock forwards that argv to the running app, whose real
 *      `second-instance` handler parses it, dispatches `auth/token` through the
 *      real deep-link pipeline, and hands the token to client-bridge. Nothing
 *      here calls a route handler directly.
 *   5. BOTH sides of the process boundary are asserted: main's client-bridge is
 *      signed in as the emulator user, and the RENDERER — which learned about it
 *      only through the real `desktop:auth:sign-in-with-token` broadcast — has
 *      its own @omega.js/client Firebase on the same uid, with main's view of
 *      the user agreeing over IPC.
 *
 * Offline: emulator only. Main runs as a TESTING app, so client-bridge connects
 * its Firebase Auth to the local auth emulator; the staged consumer config marks
 * the renderer's @omega.js/client `development` with the resolved dev ports, so
 * its Firebase talks to the same emulator. No leg reaches a real cloud.
 *
 * Two test-time overrides, neither of them an edit to a committed file — the
 * staged copy under packages/desktop/.temp/ carries both:
 *   - a cloud config + `environment`/`dev.ports` block (the committed fixture
 *     ships an EMPTY cloud config on purpose, so its boot suite never inits
 *     Firebase), and
 *   - a renderer entry that parks the renderer Manager on `window` so the lane
 *     can read the renderer's own auth state.
 *
 * Knobs: OMEGA_SKIP_E2E=1 skips (matches the sibling e2e lanes). No electron
 * binary → SKIPPED with the reason printed, exit 0 (never a silent green).
 */
const path = require('path');
const fs = require('fs');
const net = require('net');
const { spawn } = require('child_process');
const { createRequire } = require('module');
const assert = require('assert');

if (process.env.OMEGA_SKIP_E2E === '1') {
  console.log('⏭ OMEGA_SKIP_E2E=1 — skipping desktop auth e2e');
  process.exit(0);
}

const ROOT = path.join(__dirname, '..');
const PLAYGROUND_BACKEND = path.join(ROOT, 'brands', 'playground-omega', 'targets', 'backend');
const DESKTOP = path.join(ROOT, 'packages', 'desktop');
const DESKTOP_DIST = path.join(DESKTOP, 'dist');
const FIXTURE = path.join(DESKTOP, 'src', 'test', 'fixtures', 'consumer-app');
// The staged app lives INSIDE packages/desktop on purpose: the fixture resolves
// gulp/esbuild/firebase through the upward node_modules walk, which only reaches
// the desktop package (and the workspace root) from in here.
const STAGE_DIR = path.join(DESKTOP, '.temp', 'desktop-auth-e2e');
const APP_DIR = path.join(STAGE_DIR, 'app');
const LOG_DIR = path.join(ROOT, '.temp', 'desktop-auth-e2e');

const BRAND_ID = 'desktop-auth-e2e';

const { readPortsFile } = require('@omega.js/config');
const { createStepsLog } = require('./steps-log');

const EMULATOR_READY_TIMEOUT = 240000;
const READY_MARKER = /Emulator ready\. Press Ctrl\+C/i;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const failures = [];
const stepsLog = createStepsLog(LOG_DIR);

// Every verdict lands in .temp/desktop-auth-e2e/steps.log as it happens, so a
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

// -- Emulator lifecycle (mirrors scripts/e2e-auth-token.js) -----------------

function startEmulator() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const emulatorLog = path.join(LOG_DIR, 'emulator.log');
  const logStream = fs.createWriteStream(emulatorLog);

  // Spawn the hoisted local bin DIRECTLY (not via npx) — outside an npm-script
  // PATH the npx shim routes through the Socket Firewall proxy, which breaks
  // firebase-tools' internal emulator REST calls.
  // --no-https: the app resolves its API base from the OMEGA_*_PORT env channel
  // and speaks plain http to the hosting emulator; an mkcert-fronted stack would
  // move plain hosting off the port the child was told about.
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

// -- The staged consumer app ------------------------------------------------

// Copy the bundled fixture and apply the two test-time overrides. Everything
// else — main.js, preload, views, styles — is the fixture verbatim, so what
// boots here is the same consumer shape the desktop boot suite proves.
function stageApp({ projectId, apiKey, ports }) {
  fs.rmSync(APP_DIR, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(APP_DIR), { recursive: true });
  fs.cpSync(FIXTURE, APP_DIR, {
    recursive: true,
    filter: (src) => !/[\\/](node_modules|dist|logs)$/.test(src),
  });

  fs.writeFileSync(path.join(APP_DIR, 'package.json'), `${JSON.stringify({
    name: 'desktop-auth-e2e-consumer',
    version: '1.0.0',
    private: true,
    description: 'Staged @omega.js/desktop consumer for scripts/e2e-desktop-auth.js — generated, never committed.',
    main: 'dist/main.bundle.js',
    // A real consumer always declares its framework — ensureTarget's locality
    // check (#675) refuses a target without it. `file:` is the linked-brand
    // shape; from APP_DIR that path is packages/desktop itself.
    devDependencies: { '@omega.js/desktop': 'file:../../..' },
  }, null, 2)}\n`);

  // JSON is valid JSON5 — the config loader reads this the same way it reads a
  // hand-written one.
  const config = {
    brand: {
      id: BRAND_ID,
      name: 'Desktop Auth E2E',
      images: { icon: '' },
    },
    // The renderer's @omega.js/client reads `environment` + `dev.ports`: development
    // is what makes IT connect to the auth/firestore emulators (main gets there
    // through OMEGA_TEST_MODE instead). Desktop's own environment is unaffected —
    // it resolves from OMEGA_TEST_MODE / app.isPackaged, never this key.
    environment: 'development',
    dev: { ports },
    cloud: {
      provider: 'firebase',
      config: { apiKey, projectId },
    },
    monitoring: { providers: { sentry: { dsn: '' } } },
    analytics: { providers: { google: { id: '' } } },
    targets: {
      desktop: {
        startup: { mode: 'normal' },
        releases: { enabled: false },
      },
    },
  };
  fs.writeFileSync(path.join(APP_DIR, 'config', 'omega.json5'), `${JSON.stringify(config, null, 2)}\n`);

  // Renderer entry override — park the Manager on window so the lane can read
  // the RENDERER's own auth state (the fixture's entry keeps no reference).
  const rendererEntry = path.join(APP_DIR, 'src', 'assets', 'js', 'components', 'main', 'index.js');
  fs.writeFileSync(rendererEntry, [
    '// Staged for scripts/e2e-desktop-auth.js — the fixture entry plus a window',
    '// handle, so the lane can read this renderer\'s own @omega.js/client auth state.',
    "const Manager = require('@omega.js/desktop/renderer');",
    '',
    'const manager = new Manager();',
    'window.__omegaAuthE2E = manager;',
    'manager.initialize();',
    '',
  ].join('\n'));
}

// -- The boot-layer tests (run INSIDE the spawned Electron app) --------------
//
// inspect bodies are serialized to the child — no closures over this file.
// `require`, `process`, and `Buffer` are injected; everything else arrives on
// process.env (set below, inherited by the spawn).

const bootTests = [
  {
    description: 'main-process client-bridge is live on the emulator, not yet the e2e user',
    timeout: 30000,
    inspect: async ({ manager, expect }) => {
      expect(manager._initialized).toBe(true);
      // Firebase actually loaded (an empty cloud.config leaves the bridge in
      // no-op mode — that would make every assertion below vacuous).
      expect(Boolean(manager.omega._firebaseAuth)).toBe(true);
      expect(manager.isTesting()).toBe(true);
      const current = manager.omega.getCurrentUser();
      expect(current?.uid === process.env.OMEGA_E2E_UID).toBe(false);
    },
  },

  {
    description: 'a REAL second instance delivers the deep link; main signs in as the emulator user',
    timeout: 150000,
    inspect: async ({ manager, expect, appRoot }) => {
      const { spawn } = require('child_process');

      const url = `${process.env.OMEGA_E2E_SCHEME}://auth/token?authToken=${process.env.OMEGA_E2E_TOKEN}`;

      // Observe the dispatch without claiming it: a consumer handler runs BEFORE
      // the built-in and, leaving ctx.handled false, lets the built-in do the
      // real work. This is how we know the token arrived through the pipeline.
      global.__omega_e2e_dispatch = null;
      manager.deepLink.on('auth/token', (ctx) => {
        global.__omega_e2e_dispatch = { source: ctx.source, url: ctx.url, hasToken: Boolean(ctx.query?.authToken) };
      });

      // The OS single-instance lock forwards this argv to US (second-instance).
      // The duplicate quits itself the moment it loses the lock.
      const env = Object.assign({}, process.env);
      delete env.OMEGA_TEST_BOOT;
      delete env.OMEGA_TEST_BOOT_HARNESS;
      delete env.OMEGA_TEST_BOOT_SPEC;
      // Same scrub runners/boot.js does at its own spawn — with this set, the
      // duplicate boots as plain node, `electron.app` is undefined, and it dies
      // before it can hand us its argv.
      delete env.ELECTRON_RUN_AS_NODE;
      // A testing run wipes its userData at boot — and Electron's
      // single-instance lock LIVES there. Without this the duplicate deletes our
      // lock, wins one of its own, and no argv is ever forwarded.
      env.OMEGA_TEST_KEEP_USERDATA = '1';
      const log = require('fs').openSync(process.env.OMEGA_E2E_SECOND_INSTANCE_LOG, 'w');
      // The duplicate must boot the SAME app the primary booted: the staged
      // test root (#110), not the project root — whose dist/ no longer exists.
      const child = spawn(process.env.OMEGA_E2E_ELECTRON_BIN, [appRoot, url], {
        cwd: appRoot,
        env,
        stdio: ['ignore', log, log],
      });
      const exited = new Promise((resolve) => child.on('exit', resolve));

      let user = null;
      for (let i = 0; i < 120; i++) {
        user = manager.omega.getCurrentUser();
        if (user?.uid === process.env.OMEGA_E2E_UID) break;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 15000))]);
      // If forwarding is broken the duplicate never loses the lock and never
      // quits on its own — reap it so a failing run leaves no orphan Electron.
      if (child.exitCode === null) child.kill('SIGKILL');

      const dispatch = global.__omega_e2e_dispatch;
      expect(Boolean(dispatch)).toBe(true);
      expect(dispatch.source).toBe('warm-start');
      expect(dispatch.hasToken).toBe(true);
      expect(user?.uid).toBe(process.env.OMEGA_E2E_UID);
      expect(user?.email).toBe(process.env.OMEGA_E2E_EMAIL);
    },
  },

  {
    description: 'the renderer reflects the same emulator user (own Firebase + main over IPC)',
    timeout: 90000,
    inspect: async ({ manager, expect }) => {
      const { BrowserWindow } = require('electron');

      const win = manager.windows.get('main') || BrowserWindow.getAllWindows()[0];
      expect(Boolean(win && !win.isDestroyed())).toBe(true);

      // The renderer learned about the sign-in ONLY through the real
      // desktop:auth:sign-in-with-token broadcast — nothing pushes it here.
      const read = () => win.webContents.executeJavaScript(`(async () => {
        const manager = window.__omegaAuthE2E;
        const rendererUid = manager?.omega?.auth?.()?.getUser?.()?.uid || null;
        const mainUser = await window.desktop.ipc.invoke('desktop:auth:get-user').catch(() => null);
        return { rendererUid, mainUid: mainUser?.uid || null };
      })()`).catch(() => null);

      let state = null;
      for (let i = 0; i < 120; i++) {
        state = await read();
        if (state?.rendererUid === process.env.OMEGA_E2E_UID) break;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      expect(state?.rendererUid).toBe(process.env.OMEGA_E2E_UID);
      expect(state?.mainUid).toBe(process.env.OMEGA_E2E_UID);
    },
  },
];

// ---------------------------------------------------------------------------

async function main() {
  console.log('\nDesktop auth e2e (real Electron app, real deep link, main + renderer)\n');

  let electronBin = null;
  try {
    electronBin = require(require.resolve('electron', { paths: [DESKTOP] }));
    if (!electronBin || !fs.existsSync(electronBin)) {
      throw new Error(`the electron binary is not installed at ${electronBin}`);
    }
  } catch (error) {
    console.log(`⏭ SKIPPED — ${error.message}`);
    console.log('   install it with `npm install` at the monorepo root\n');
    process.exit(0);
  }

  const bootRunnerPath = path.join(DESKTOP_DIST, 'test', 'runners', 'boot.js');
  if (!fs.existsSync(bootRunnerPath)) {
    console.log(`⏭ SKIPPED — @omega.js/desktop has no dist at ${path.relative(ROOT, DESKTOP_DIST)}`);
    console.log('   build it with `npm run prepare -w @omega.js/desktop`\n');
    process.exit(0);
  }
  const { runBootTests } = require(bootRunnerPath);

  let emulator = null;
  let ports = null;

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

    const apiBase = `http://127.0.0.1:${ports.hosting}`;
    const firebaserc = JSON.parse(fs.readFileSync(path.join(PLAYGROUND_BACKEND, '.firebaserc'), 'utf8'));
    const projectId = firebaserc.projects.default;
    const apiKey = 'fake-api-key';

    // Real firebase client SDK, resolved from @omega.js/client's dependency tree
    const clientRequire = createRequire(path.join(ROOT, 'packages', 'client', 'package.json'));
    const { initializeApp } = clientRequire('firebase/app');
    const { getAuth, connectAuthEmulator, createUserWithEmailAndPassword } = clientRequire('firebase/auth');

    const EMAIL = `desktop-e2e-${Date.now()}@example.com`;
    const PASSWORD = 'e2e-password-1';

    let user = null;
    let signInToken = null;

    await step('a real user signs up against the auth emulator', async () => {
      const app = initializeApp({ apiKey, projectId }, 'desktop-e2e');
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

    await step('a consumer app is staged from the bundled fixture', async () => {
      stageApp({ projectId, apiKey, ports });
      return path.relative(ROOT, APP_DIR);
    });

    // Everything the spawned Electron app needs: the boot runner passes
    // process.env straight through to the child.
    Object.assign(process.env, {
      OMEGA_TEST_BOOT_PROJECT:  APP_DIR,
      OMEGA_HOSTING_PORT:       String(ports.hosting),
      OMEGA_AUTH_PORT:          String(ports.auth),
      OMEGA_FUNCTIONS_PORT:     String(ports.functions),
      OMEGA_E2E_SCHEME:         BRAND_ID,
      OMEGA_E2E_TOKEN:          signInToken,
      OMEGA_E2E_UID:            user.uid,
      OMEGA_E2E_EMAIL:          EMAIL,
      OMEGA_E2E_ELECTRON_BIN:   electronBin,
      OMEGA_E2E_SECOND_INSTANCE_LOG: path.join(LOG_DIR, 'second-instance.log'),
    });
    delete process.env.OMEGA_HTTPS_PORT;

    await step('the app builds + boots in a REAL Electron process, and the deep link signs it in', async () => {
      const counts = await runBootTests({
        tests: bootTests,
        projectRoot: APP_DIR,
        frameworkDistRoot: DESKTOP_DIST,
      });
      if (counts.failed > 0 || counts.passed !== bootTests.length) {
        throw new Error(`boot layer: ${counts.passed} passed, ${counts.failed} failed, ${counts.skipped} skipped`);
      }
      return `${counts.passed} boot assertions`;
    });
  } finally {
    if (emulator) {
      await stopEmulator(emulator.child);
    }
  }

  if (failures.length > 0) {
    console.log(`\n✗ desktop auth e2e FAILED (${failures.length} failing step${failures.length === 1 ? '' : 's'})`);
    console.log(`   logs: ${path.relative(ROOT, LOG_DIR)}/ — staged app: ${path.relative(ROOT, APP_DIR)}\n`);
    process.exit(1);
  }

  console.log('\n✓ desktop auth e2e PASSED\n');
}

main().catch((error) => {
  // A death outside step() — the live-stack preflight guard, a throw on the way
  // up — has no verdict yet; record one so steps.log still answers "why did
  // nothing run?". A step failure propagating out is already on file.
  stepsLog.abort(error);
  console.error(`\n✗ desktop auth e2e errored: ${error.message}`);
  console.error(`   logs: ${path.relative(ROOT, LOG_DIR)}/ — staged app: ${path.relative(ROOT, APP_DIR)}\n`);
  process.exit(1);
});
