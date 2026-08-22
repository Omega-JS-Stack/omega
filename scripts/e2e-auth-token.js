/**
 * Root `npm run test:auth` — desktop/extension SIGN-IN TOKEN round trip (cp260).
 *
 * The custom-token sync flow (extension background `omega:syncAuth`, desktop
 * client-bridge renderer sync) had ZERO e2e coverage, which is how a broken
 * response read (`data.response.token` against a `{ token }` body) shipped
 * unnoticed. This lane proves the whole loop against real infrastructure,
 * fully offline: the playground backend's emulator stack (auth + functions +
 * hosting) plus the real Firebase client SDK.
 *
 * Proof, in order:
 *   1. A real user signs up + signs in against the AUTH emulator (real
 *      firebase SDK from @omega.js/client's dependency tree — no stubs).
 *   2. The DESKTOP caller — the real `client-bridge._fetchCustomToken` with
 *      the real url-helpers — exchanges the user's ID token for a custom
 *      token at POST /omega/user/token.
 *   3. That custom token actually signs in a second app instance and lands
 *      on the SAME uid (the round trip, end to end).
 *
 * That is ALL this lane proves — the cross-boundary round trip (desktop ↔
 * backend). The route's own HTTP wire contract (`{ token }` at the top level,
 * no legacy `response` envelope, the retired `command` lane refusing to mint)
 * is a single-package assertion and lives in @omega.js/backend's route suite:
 * packages/backend/test/routes/user/token.test.js (#46 push-down).
 *
 * This is the fast WIRE lane — library code called from node. The REAL-SURFACE
 * proofs of the same chain are its siblings: scripts/e2e-extension-auth.js (the
 * background SW inside actual Chrome) and scripts/e2e-desktop-auth.js (the app
 * inside actual Electron, signed in by an OS-delivered deep link).
 *
 * Knobs: OMEGA_SKIP_E2E=1 skips (matches the sibling e2e lanes).
 */
const path = require('path');
const fs = require('fs');
const net = require('net');
const { spawn } = require('child_process');
const { createRequire } = require('module');
const assert = require('assert');

if (process.env.OMEGA_SKIP_E2E === '1') {
  console.log('⏭ OMEGA_SKIP_E2E=1 — skipping auth-token e2e');
  process.exit(0);
}

const ROOT = path.join(__dirname, '..');
const PLAYGROUND_BACKEND = path.join(ROOT, 'brands', 'omega-playground', 'targets', 'backend');
const DESKTOP_SRC = path.join(ROOT, 'packages', 'desktop', 'src');
const LOG_DIR = path.join(ROOT, '.temp', 'auth-token-e2e');

const { readPortsFile } = require('@omega.js/config');
const { createStepsLog } = require('./steps-log');

const EMULATOR_READY_TIMEOUT = 240000;
const READY_MARKER = /Emulator ready\. Press Ctrl\+C/i;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const failures = [];
const stepsLog = createStepsLog(LOG_DIR);

// Every verdict lands in .temp/auth-token-e2e/steps.log as it happens, so a
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

// -- Emulator lifecycle (mirrors scripts/e2e-verts-company.js) --------------

function startEmulator() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const emulatorLog = path.join(LOG_DIR, 'emulator.log');
  const logStream = fs.createWriteStream(emulatorLog);

  // Spawn the hoisted local bin DIRECTLY (not via npx) — outside an npm-script
  // PATH the npx shim routes through the Socket Firewall proxy, which breaks
  // firebase-tools' internal emulator REST calls.
  const mgrBin = path.join(ROOT, 'node_modules', '.bin', 'mgr');
  const child = spawn(mgrBin, ['emulator', '--no-seed'], {
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
  console.log('\nAuth-token e2e (desktop/extension custom-token round trip)\n');

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

    const firebaserc = JSON.parse(fs.readFileSync(path.join(PLAYGROUND_BACKEND, '.firebaserc'), 'utf8'));
    const projectId = firebaserc.projects.default;

    // Real firebase client SDK, resolved from @omega.js/client's dependency tree
    const clientRequire = createRequire(path.join(ROOT, 'packages', 'client', 'package.json'));
    const { initializeApp } = clientRequire('firebase/app');
    const {
      getAuth,
      connectAuthEmulator,
      createUserWithEmailAndPassword,
      signInWithCustomToken,
    } = clientRequire('firebase/auth');

    const EMAIL = `token-e2e-${Date.now()}@example.com`;
    const PASSWORD = 'e2e-password-1';

    let user = null;

    await step('a real user signs up against the auth emulator', async () => {
      const app = initializeApp({ apiKey: 'fake-api-key', projectId }, 'auth-e2e-primary');
      const auth = getAuth(app);
      connectAuthEmulator(auth, `http://127.0.0.1:${ports.auth}`, { disableWarnings: true });

      const credential = await createUserWithEmailAndPassword(auth, EMAIL, PASSWORD);
      user = credential.user;
      return `uid ${user.uid}`;
    });

    let customToken = null;

    await step('the REAL desktop client-bridge fetches a custom token from /omega/user/token', async () => {
      // Real desktop modules: the bridge whose _fetchCustomToken is the caller
      // under test, and the real mode/url helpers it resolves its URL with. In
      // the testing environment getApiUrl() maps to the local hosting emulator
      // via the resolved-port env channel (N7).
      process.env.OMEGA_TEST_MODE = 'true';
      process.env.OMEGA_HOSTING_PORT = String(ports.hosting);
      // A testing bridge points its own Firebase Auth at the auth emulator on
      // this same channel (it never reaches real auth from here).
      process.env.OMEGA_AUTH_PORT = String(ports.auth);
      delete process.env.OMEGA_HTTPS_PORT;

      const desktopRequire = createRequire(path.join(ROOT, 'packages', 'desktop', 'package.json'));
      const bridge = desktopRequire(path.join(DESKTOP_SRC, 'lib', 'client-bridge.js'));
      const modeHelpers = desktopRequire(path.join(DESKTOP_SRC, 'utils', 'mode-helpers.js'));
      const urlHelpers = desktopRequire(path.join(DESKTOP_SRC, 'utils', 'url-helpers.js'));

      function HarnessManager(config) { this.config = config; }
      modeHelpers.attachTo(HarnessManager);
      urlHelpers.attachTo(HarnessManager);

      bridge._manager = new HarnessManager({ brand: { id: 'omega-playground' } });

      customToken = await bridge._fetchCustomToken(user);
      assert.equal(typeof customToken, 'string', 'custom token should be a string');
      assert.equal(customToken.split('.').length, 3, 'custom token should be a JWT');
    });

    await step('the custom token signs in a second app instance on the SAME uid', async () => {
      const app = initializeApp({ apiKey: 'fake-api-key', projectId }, 'auth-e2e-secondary');
      const auth = getAuth(app);
      connectAuthEmulator(auth, `http://127.0.0.1:${ports.auth}`, { disableWarnings: true });

      const credential = await signInWithCustomToken(auth, customToken);
      assert.equal(credential.user.uid, user.uid, 'round-tripped uid should match the original user');
    });

  } finally {
    if (emulator) {
      await stopEmulator(emulator.child);
    }
  }

  if (failures.length > 0) {
    console.log(`\n✗ auth-token e2e FAILED (${failures.length} failing step${failures.length === 1 ? '' : 's'})\n`);
    process.exit(1);
  }

  console.log('\n✓ auth-token e2e PASSED\n');
}

main().catch((error) => {
  // A death outside step() — the live-stack preflight guard, a throw on the way
  // up — has no verdict yet; record one so steps.log still answers "why did
  // nothing run?". A step failure propagating out is already on file.
  stepsLog.abort(error);
  console.error(`\n✗ auth-token e2e errored: ${error.message}\n`);
  process.exit(1);
});
