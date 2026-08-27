/**
 * The static lane's socket-free contract, asserted rather than assumed.
 *
 * `test/_helpers/connect-trap.js` is preloaded into every test process by the
 * `test` script. If that flag is ever dropped from package.json, or node stops
 * forwarding execArgv to test children, the rest of this lane would still pass
 * — quietly able to reach the REAL Firebase project through the framework tree
 * registration.test.js loads, with whatever credentials the environment happens
 * to carry. This file is what turns that silent regression into a red test.
 *
 * Nothing here is yours to fill in: leave it as shipped.
 *
 *   node --require ./test/_helpers/connect-trap.js --test test/_unit/socket-free.test.js
 */
const assert = require('node:assert/strict');
const test = require('node:test');
const net = require('node:net');
const dns = require('node:dns');

test('the connect trap is loaded in this test process', () => {
  assert.ok(
    globalThis.__omegaConnectTrap?.installed,
    'the connect-trap preload is missing — the static lane can reach the network',
  );
});

test('opening a TCP socket is refused', () => {
  const socket = new net.Socket();

  assert.throws(
    () => socket.connect(443, 'firestore.googleapis.com'),
    (e) => e.code === 'CONNECT_TRAP',
    'a TCP connect went through — the live Firestore is one call away',
  );
});

test('resolving a hostname is refused', () => {
  assert.throws(
    () => dns.lookup('firestore.googleapis.com', () => {}),
    (e) => e.code === 'CONNECT_TRAP',
    'a DNS lookup went through',
  );
});
