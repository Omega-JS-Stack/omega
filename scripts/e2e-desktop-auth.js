/**
 * Root `npm run test:e2e-desktop`: the desktop sign-in in a REAL Electron app.
 * The emulator seeds its personas; this lane's own (scripts/roster-persona.js)
 * is minted a custom token; a consumer app staged from @omega.js/desktop's
 * fixture builds and boots; a SECOND instance carries
 * `<brand.id>://auth/token?authToken=` so the OS single-instance lock forwards
 * it through the real deep-link pipeline. Main's session and the renderer's own
 * Firebase must both land on the persona, and a sign-out in main must end both
 * (the renderer through the real broadcast). Offline: emulator only. The staged
 * copy (never committed) carries a cloud config and a renderer entry that parks
 * the instance on `window`. OMEGA_SKIP_E2E=1 skips; no electron is a SKIP.
 */
const path = require('path');
const fs = require('fs');
const net = require('net');
const { spawn } = require('child_process');

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
const { mintPersonaToken } = require('./roster-persona');

// This lane's own seeded persona, never shared with another suite
const PERSONA_LOCALPART = '_test.desktop-auth-e2e';

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
      // The .deb target needs a homepage and a maintainer (#872): build-config
      // refuses the config without them, so the staged brand spells both.
      url: 'https://desktop-auth-e2e.test',
      contact: { email: 'support@desktop-auth-e2e.test' },
      images: { icon: '' },
    },
    // The baked word. The RUNNING environment beats it (#925): the boot lane
    // names `testing`, main and the renderer both answer it, and the renderer's
    // @omega.js/client connects to the auth/firestore emulators in any
    // non-production environment, reading the ports from `dev.ports`.
    environment: 'development',
    dev: { ports },
    cloud: {
      provider: 'firebase',
      // The renderer's @omega.js/client boots Messaging, which refuses a config
      // without appId and messagingSenderId, so the staged brand carries both
      config: { apiKey, projectId, appId: '1:000000000000:web:desktopauthe2e', messagingSenderId: '000000000000' },
    },
    monitoring: { providers: { sentry: { dsn: '' } } },
    analytics: { providers: { google: { id: '' } } },
    targets: {
      desktop: {
        type: 'desktop',
        startup: { mode: 'normal' },
        releases: { enabled: false },
      },
    },
  };
  fs.writeFileSync(path.join(APP_DIR, 'config', 'omega.json5'), `${JSON.stringify(config, null, 2)}\n`);

  // Renderer entry override: park the instance on window so the lane can read
  // the RENDERER's own auth state (the fixture's entry keeps no reference).
  const rendererEntry = path.join(APP_DIR, 'src', 'assets', 'js', 'components', 'main', 'index.js');
  fs.writeFileSync(rendererEntry, [
    '// Staged for scripts/e2e-desktop-auth.js — the fixture entry plus a window',
    '// handle, so the lane can read this renderer\'s own @omega.js/client auth state.',
    "import omega from '@omega.js/desktop/renderer';",
    '',
    'window.__omegaAuthE2E = omega;',
    'omega.initialize();',
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
    description: 'main-process auth is live on the emulator, not yet the persona',
    timeout: 30000,
    inspect: async ({ omega, expect }) => {
      expect(omega._initialized).toBe(true);
      // Firebase actually loaded (an empty cloud.config leaves auth in no-op
      // mode, which would make every assertion below vacuous).
      expect(Boolean(omega.auth._firebaseAuth)).toBe(true);
      expect(omega.isTesting()).toBe(true);
      const current = omega.auth._firebaseAuth.currentUser;
      expect(current?.uid === process.env.OMEGA_E2E_UID).toBe(false);
    },
  },

  {
    description: 'a REAL second instance delivers the deep link; main signs in as the persona',
    timeout: 150000,
    inspect: async ({ omega, expect, appRoot }) => {
      const { spawn } = require('child_process');

      const url = `${process.env.OMEGA_E2E_SCHEME}://auth/token?authToken=${process.env.OMEGA_E2E_TOKEN}`;

      // Observe the dispatch without claiming it: a consumer handler runs BEFORE
      // the built-in and, leaving ctx.handled false, lets the built-in do the
      // real work. This is how we know the token arrived through the pipeline.
      global.__omega_e2e_dispatch = null;
      omega.deepLink.on('auth/token', (ctx) => {
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
        // Main's own Firebase session: `omega.auth.user` builds from the account a
        // renderer pushes, which needs the Firestore read this lane does not stage
        user = omega.auth._firebaseAuth.currentUser;
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
    description: 'the renderer reflects the same persona (own Firebase + main over IPC)',
    timeout: 90000,
    inspect: async ({ omega, expect }) => {
      const { BrowserWindow } = require('electron');

      const win = omega.windows.get('main') || BrowserWindow.getAllWindows()[0];
      expect(Boolean(win && !win.isDestroyed())).toBe(true);

      // The renderer learned about the sign-in ONLY through the real
      // desktop:auth:sign-in-with-token broadcast — nothing pushes it here.
      const read = () => win.webContents.executeJavaScript(`(async () => {
        const instance = window.__omegaAuthE2E;
        const rendererUid = instance?.firebaseAuth?.currentUser?.uid || null;
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

  {
    description: 'a sign-out ends main\'s session and the renderer follows the broadcast',
    timeout: 60000,
    inspect: async ({ omega, expect }) => {
      const { BrowserWindow } = require('electron');

      const win = omega.windows.get('main') || BrowserWindow.getAllWindows()[0];
      const readRendererUid = () => win.webContents.executeJavaScript(
        '(window.__omegaAuthE2E?.firebaseAuth?.currentUser?.uid || null)',
      ).catch(() => 'unreadable');

      // Both sides start on the persona, so the sign-out below cannot pass vacuously
      expect(omega.auth._firebaseAuth.currentUser?.uid).toBe(process.env.OMEGA_E2E_UID);
      expect(await readRendererUid()).toBe(process.env.OMEGA_E2E_UID);

      const result = await omega.auth.signOut();
      expect(result.success).toBe(true);
      expect(omega.auth._firebaseAuth.currentUser).toBeNull();
      expect(omega.auth.user.authenticated).toBe(false);

      // The renderer signs out ONLY on the desktop:auth:sign-out broadcast
      let rendererUid = await readRendererUid();
      for (let i = 0; i < 60 && rendererUid !== null; i++) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        rendererUid = await readRendererUid();
      }
      expect(rendererUid).toBeNull();
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

    await step('playground emulator boots (auth, functions, hosting) and seeds its personas', async () => {
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

    let signIn = null;

    await step('the roster\'s persona signs in with the test password and the backend mints its custom token', async () => {
      signIn = await mintPersonaToken({ apiBase, authPort: ports.auth, firebaseConfig: { apiKey, projectId }, localpart: PERSONA_LOCALPART });
      return `${signIn.email}, uid ${signIn.uid}`;
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
      OMEGA_E2E_TOKEN:          signIn.token,
      OMEGA_E2E_UID:            signIn.uid,
      OMEGA_E2E_EMAIL:          signIn.email,
      OMEGA_E2E_ELECTRON_BIN:   electronBin,
      OMEGA_E2E_SECOND_INSTANCE_LOG: path.join(LOG_DIR, 'second-instance.log'),
    });
    delete process.env.OMEGA_HTTPS_PORT;

    await step('the app builds + boots in a REAL Electron process, the deep link signs it in, and a sign-out reaches the renderer', async () => {
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
