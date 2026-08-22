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
  readSiblingPorts,
  envName,
  portsToEnv,
  envPort,
  envPorts,
} = require('../src/ports.js');

/** Bind a real blocker on a port; returns close(). host defaults to
 * 127.0.0.1; pass null for a wildcard listener, '::1' for v6-loopback. */
function block(port, host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(host === null ? { port } : { port, host }, () => {
      resolve(() => new Promise((done) => server.close(done)));
    });
  });
}

/** Pick a real free port from the OS (bind 0, read it back, release) — for
 * cases that must not collide with the fixed 42xxx numbers above. */
function ephemeralPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen({ port: 0, host: '0.0.0.0' }, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
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

test('isPortFree sees listeners on EVERY bind surface (macOS coexistence)', async () => {
  // On macOS/BSD, wildcard and specific-address listeners coexist per port —
  // a single-host probe false-positives and the stack crashes at the real
  // bind (found live: the playground https proxy holds IPv6 *:5002; the
  // second brand's allocator probed 127.0.0.1 only, handed 5002 to the
  // functions emulator, and firebase's own connect-probe refused to boot).
  const wildcard = await block(42802, null);
  try {
    assert.equal(await isPortFree(42802), false, 'wildcard listener must read busy');
  } finally {
    await wildcard();
  }

  const v4only = await block(42802, '127.0.0.1');
  try {
    assert.equal(await isPortFree(42802), false, 'v4-specific listener must read busy');
  } finally {
    await v4only();
  }

  let v6only;
  try {
    v6only = await block(42802, '::1');
  } catch (error) {
    v6only = null; // host without IPv6 — the ::1 leg is vacuously covered
  }
  if (v6only) {
    try {
      assert.equal(await isPortFree(42802), false, 'v6-loopback listener must read busy');
    } finally {
      await v6only();
    }
  }

  assert.equal(await isPortFree(42802), true, 'all listeners closed → free again');
});

test('isPortFree: an IPv4-wildcard (0.0.0.0) holder reads busy', async () => {
  // The shape Docker port forwards and most non-loopback dev servers bind.
  // On macOS/BSD an IPv6-wildcard bind COEXISTS with it, so the ::/::1/
  // 127.0.0.1 probes all succeed and the port false-reads free — the
  // allocator then hands firebase a port it cannot take
  // ([#345](https://github.com/Omega-JS-Stack/omega/issues/345)).
  const port = await ephemeralPort();
  const close = await block(port, '0.0.0.0');
  try {
    assert.equal(await isPortFree(port), false, 'v4-wildcard listener must read busy');
  } finally {
    await close();
  }

  assert.equal(await isPortFree(port), true, 'listener closed → free again');
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

test('resolvePorts: a wanted port held on 0.0.0.0 bumps, never resolves in place', async () => {
  const port = await ephemeralPort();
  const close = await block(port, '0.0.0.0');
  try {
    const { ports, bumped } = await resolvePorts({ wanted: { a: port } });
    assert.equal(ports.a, port + 1);
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

// ---- sibling ports (the map a target hands its browser code)

test('readSiblingPorts: merges live sibling maps, skips own target dir and dead pids, empty without brand root', () => {
  // Brand layout: <root>/config/omega.json5 + targets/{backend,website}
  const brand = fs.mkdtempSync(path.join(os.tmpdir(), 'ports-test-brand-'));
  fs.mkdirSync(path.join(brand, 'config'), { recursive: true });
  fs.writeFileSync(path.join(brand, 'config', 'omega.json5'), '{}');
  const backend = path.join(brand, 'targets', 'backend');
  const website = path.join(brand, 'targets', 'website');
  fs.mkdirSync(path.join(backend, '.temp'), { recursive: true });
  fs.mkdirSync(path.join(website, '.temp'), { recursive: true });

  // Live backend map (our own pid = definitely alive)
  fs.writeFileSync(path.join(backend, '.temp', 'ports.json'), JSON.stringify({
    ports: { hosting: 5003, auth: 9099 }, pid: process.pid, startedAt: 'x',
  }));
  // Own target's file must be skipped even with a live pid (a previous run of THIS server)
  fs.writeFileSync(path.join(website, '.temp', 'ports.json'), JSON.stringify({
    ports: { website: 4999 }, pid: process.pid, startedAt: 'x',
  }));

  assert.deepEqual(readSiblingPorts(website), { hosting: 5003, auth: 9099 });

  // A restarted emulator republishes new numbers — the NEXT read carries them
  // (the whole reason this is a use-time read, #300)
  fs.writeFileSync(path.join(backend, '.temp', 'ports.json'), JSON.stringify({
    ports: { hosting: 5004, auth: 9100 }, pid: process.pid, startedAt: 'x',
  }));
  assert.deepEqual(readSiblingPorts(website), { hosting: 5004, auth: 9100 });

  // Dead-pid sibling map is a crash leftover — ignored
  fs.writeFileSync(path.join(backend, '.temp', 'ports.json'), JSON.stringify({
    ports: { hosting: 5003 }, pid: 999999999, startedAt: 'x',
  }));
  assert.deepEqual(readSiblingPorts(website), {});

  // Standalone consumer (no brand root) → empty map, caller falls back to classics
  assert.deepEqual(readSiblingPorts(makeTempProject()), {});
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

test('envPorts: the whole injected map back out, garbage and foreign vars dropped', () => {
  assert.deepEqual(envPorts(portsToEnv({ hosting: 5102, auth: 9100 })), { hosting: 5102, auth: 9100 });
  assert.deepEqual(envPorts({
    OMEGA_AUTH_PORT: '9100',
    OMEGA_HOSTING_PORT: 'garbage',
    OMEGA_TEST_MODE: 'true',
    PORT: '3000',
  }), { auth: 9100 });
  assert.deepEqual(envPorts({}), {});
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
