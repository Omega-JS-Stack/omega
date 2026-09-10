// Unit tests for src/test/port-hold.js — the e2e lanes' classic-port hold.
//
// Real sockets, on a private high range: the module's whole promise is what a
// real bind does or does not see, and it never runs against the classic ports
// here (holding :4000 in a unit test would take a developer's dev server).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { CLASSIC_PORTS } = require('@omega.js/config');

const { holdClassicPorts, releasePorts, holdAddress, CLASSIC_HOLD_PORTS } = require('../src/test/port-hold.js');

/** Can this address still be bound? (the allocator's question, one address of it) */
function bindable(port, host) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen({ port, host }, () => server.close(() => resolve(true)));
  });
}

function listen(port, host) {
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => socket.end('alive'));
    server.once('error', reject);
    server.listen({ port, host }, () => resolve(server));
  });
}

function connect(port, host) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ port, host }, () => { socket.end(); resolve(true); });
    socket.once('error', reject);
  });
}

test('CLASSIC_HOLD_PORTS is every classic port plus the two HTTPS proxy ports, deduped', () => {
  for (const port of Object.values(CLASSIC_PORTS)) {
    assert.ok(CLASSIC_HOLD_PORTS.includes(port), `the allocator starts from ${port} — it must be held`);
  }
  assert.ok(CLASSIC_HOLD_PORTS.includes(4443), "web's internal HTTPS port");
  assert.ok(CLASSIC_HOLD_PORTS.includes(5443), "the backend's internal HTTPS port");
  assert.equal(CLASSIC_HOLD_PORTS.length, new Set(CLASSIC_HOLD_PORTS).size, 'no port is held twice');
});

test('a held port reads as taken to the allocator, and releasing gives it back', async () => {
  const ports = [46041, 46042];
  const hold = await holdClassicPorts(ports);

  try {
    assert.deepEqual(hold.held, ports);
    assert.deepEqual(hold.busy, []);
    for (const port of ports) {
      assert.equal(await bindable(port, '127.0.0.1'), false, `:${port} must be taken while held`);
    }
  } finally {
    releasePorts(hold.servers);
  }

  for (const port of ports) {
    assert.equal(await bindable(port, '127.0.0.1'), true, `:${port} must be free again after release`);
  }
});

test("somebody else's live listener is reported busy and left completely alone", async () => {
  const port = 46043;
  const incumbent = await listen(port, '127.0.0.1');

  try {
    const hold = await holdClassicPorts([port]);
    assert.deepEqual(hold.busy, [port]);
    assert.deepEqual(hold.held, []);
    // The partial binds are closed, not kept: SO_REUSEADDR would let a
    // more-specific socket win and steal their localhost traffic for the run.
    assert.deepEqual(hold.servers, []);
    assert.equal(await connect(port, '127.0.0.1'), true, 'their listener still answers');
    releasePorts(hold.servers);
  } finally {
    incumbent.close();
  }
});

test('releasePorts is safe on an empty list and on already-closed listeners', async () => {
  const hold = await holdClassicPorts([46044]);
  releasePorts(hold.servers);
  releasePorts(hold.servers);
  releasePorts(undefined);
  assert.equal(await bindable(46044, '127.0.0.1'), true);
});

// ---- an address family this host does not have is NOT a busy port

test('a ::1 bind refused for want of IPv6 is not applicable, never busy', async () => {
  const seen = [];
  // The three codes a host with IPv6 off answers with. A hold that read them
  // as "busy" would report every classic port taken and bump the whole stack
  // for nothing.
  for (const code of ['EADDRNOTAVAIL', 'EAFNOSUPPORT', 'EINVAL']) {
    const bind = async (port, host) => {
      seen.push(host);
      if (host === '::1') return { status: 'unavailable' };
      return { status: 'held', server: { close: () => {} } };
    };

    const hold = await holdClassicPorts([46051], { bind });
    assert.deepEqual(hold.held, [46051], `${code} must not make the port busy`);
    assert.deepEqual(hold.busy, []);
    assert.equal(hold.servers.length, 2, 'the two addresses that DO exist are held');
  }
  assert.deepEqual(seen.slice(0, 3), ['127.0.0.1', '::1', null], 'every address is still attempted');
});

test('holdAddress classifies the real bind error: EADDRINUSE busy, missing family not applicable', async () => {
  // Real socket, real error: something else owns it, so the bind fails EADDRINUSE.
  const port = 46052;
  const incumbent = await listen(port, '127.0.0.1');
  try {
    assert.deepEqual(await holdAddress(port, '127.0.0.1'), { status: 'busy' });
  } finally {
    incumbent.close();
  }

  // The address family branch, driven by an address this host cannot bind.
  const unavailable = await holdAddress(port, '203.0.113.7');
  assert.equal(unavailable.status, 'unavailable', 'EADDRNOTAVAIL is a family this host lacks, not an occupant');
});

test('one busy address makes the whole port busy, and the partial binds are closed', async () => {
  const closed = [];
  const bind = async (port, host) => (host === null
    ? { status: 'busy' }
    : { status: 'held', server: { close: () => closed.push(host) } });

  const hold = await holdClassicPorts([46053], { bind });

  assert.deepEqual(hold.busy, [46053]);
  assert.deepEqual(hold.held, []);
  assert.deepEqual(hold.servers, []);
  assert.deepEqual(closed, ['127.0.0.1', '::1'], 'SO_REUSEADDR means a kept partial bind would steal their traffic');
});
