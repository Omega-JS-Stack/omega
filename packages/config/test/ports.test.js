// Unit tests for src/ports.js — port auto-allocation (N7).
//
// Real-execution only (no mocks): probes bind real sockets on 127.0.0.1,
// bump-if-taken runs against a real blocker server, and the ports file
// round-trips through a real temp dir. Test ports live in the uncommon
// 42xxx range so parallel suites/CI don't collide with real services.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const {
  CLASSIC_PORTS,
  isPortFree,
  resolvePorts,
  writePortsFile,
  readPortsFile,
  clearPortsFile,
  envName,
  portsToEnv,
  envPort,
} = require('../src/ports.js');

/** Bind a real blocker on a port; returns close(). */
function block(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen({ port, host: '127.0.0.1' }, () => {
      resolve(() => new Promise((done) => server.close(done)));
    });
  });
}

function makeTempProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ports-test-'));
}

// ---- isPortFree

test('isPortFree: free port true, blocked port false', async () => {
  assert.equal(await isPortFree(42801), true);
  const close = await block(42801);
  try {
    assert.equal(await isPortFree(42801), false);
  } finally {
    await close();
  }
});

// ---- resolvePorts

test('resolvePorts: all free → classic values untouched, nothing bumped', async () => {
  const { ports, bumped } = await resolvePorts({ wanted: { a: 42810, b: 42811 } });
  assert.deepEqual(ports, { a: 42810, b: 42811 });
  assert.deepEqual(bumped, []);
});

test('resolvePorts: taken port bumps +1 until free', async () => {
  const close = await block(42820);
  try {
    const { ports, bumped } = await resolvePorts({ wanted: { a: 42820 } });
    assert.equal(ports.a, 42821);
    assert.deepEqual(bumped, ['a']);
  } finally {
    await close();
  }
});

test('resolvePorts: claimed-set prevents two names landing on one port', async () => {
  // b wants a's port — must skip past it even though the OS says it is free.
  const { ports } = await resolvePorts({ wanted: { a: 42830, b: 42830 } });
  assert.equal(ports.a, 42830);
  assert.equal(ports.b, 42831);
});

test('resolvePorts: claimed-set shared across calls (multi-family boots)', async () => {
  const claimed = new Set();
  const first = await resolvePorts({ wanted: { a: 42840 }, claimed });
  const second = await resolvePorts({ wanted: { b: 42840 }, claimed });
  assert.equal(first.ports.a, 42840);
  assert.equal(second.ports.b, 42841);
});

test('resolvePorts: free pin honored verbatim, never bumped', async () => {
  const { ports, bumped } = await resolvePorts({
    wanted: { a: 42850 },
    pins: { a: 42855 },
  });
  assert.equal(ports.a, 42855);
  assert.deepEqual(bumped, []);
});

test('resolvePorts: busy pin throws naming the pin', async () => {
  const close = await block(42860);
  try {
    await assert.rejects(
      () => resolvePorts({ wanted: { a: 42800 }, pins: { a: 42860 } }),
      /pinned via config ports\.a/,
    );
  } finally {
    await close();
  }
});

// ---- ports file

test('ports file: write → read round-trips; clear removes', () => {
  const dir = makeTempProject();
  writePortsFile(dir, { hosting: 5102 });
  assert.deepEqual(readPortsFile(dir), { hosting: 5102 });
  clearPortsFile(dir);
  assert.equal(readPortsFile(dir), null);
});

test('ports file: dead-pid file is stale → null (crash leftover ignored)', () => {
  const dir = makeTempProject();
  const file = path.join(dir, '.temp', 'ports.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // PID 1 is init/launchd — alive but not signalable by a user process on
  // macOS/Linux CI? Use an implausible high pid instead: kill(pid, 0) throws
  // ESRCH for non-existent pids, which is the staleness signal.
  fs.writeFileSync(file, JSON.stringify({ ports: { hosting: 5102 }, pid: 999999999 }));
  assert.equal(readPortsFile(dir), null);
});

test('ports file: absent and malformed both read as null', () => {
  const dir = makeTempProject();
  assert.equal(readPortsFile(dir), null);
  const file = path.join(dir, '.temp', 'ports.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'not json');
  assert.equal(readPortsFile(dir), null);
});

// ---- env mapping

test('envName / portsToEnv / envPort round-trip', () => {
  assert.equal(envName('hosting'), 'OMEGA_HOSTING_PORT');
  const env = portsToEnv({ hosting: 5102, auth: 9100 });
  assert.deepEqual(env, { OMEGA_HOSTING_PORT: '5102', OMEGA_AUTH_PORT: '9100' });
  assert.equal(envPort('hosting', env), 5102);
  assert.equal(envPort('auth', env), 9100);
  assert.equal(envPort('firestore', env), null);
  assert.equal(envPort('hosting', { OMEGA_HOSTING_PORT: 'garbage' }), null);
});

// ---- classic defaults sanity

test('CLASSIC_PORTS carries the historical defaults', () => {
  assert.equal(CLASSIC_PORTS.functions, 5001);
  assert.equal(CLASSIC_PORTS.hosting, 5002);
  assert.equal(CLASSIC_PORTS.firestore, 8080);
  assert.equal(CLASSIC_PORTS.auth, 9099);
  assert.equal(CLASSIC_PORTS.website, 4000);
  assert.equal(CLASSIC_PORTS.livereload, 35729);
  assert.equal(CLASSIC_PORTS.cdp, 9222);
});
