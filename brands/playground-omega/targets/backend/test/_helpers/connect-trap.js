/**
 * Connect trap — the static lane's proof that no test opens a socket.
 *
 * Preloaded into EVERY test process by this target's `test` script
 * (`node --require ./test/_helpers/connect-trap.js --test …`; node forwards the
 * parent's execArgv to each test child, so one flag covers the whole lane).
 *
 * The static lane requires your real source: route handlers, schemas, the
 * framework module itself. One require deeper than you think and that tree
 * reaches firebase-admin's gRPC client — against whatever credentials `.env`
 * and `.omega/secrets/` happen to carry for the REAL project. So the failure
 * mode is made structural: the socket layer itself refuses, loudly, before any
 * DNS lookup or TCP connect can happen.
 *
 * Everything that can open an outbound connection in Node funnels through
 * `net.Socket.prototype.connect` — http/https agents, undici/fetch, gRPC
 * (firebase-admin), and every fetch wrapper on top of them — so trapping that
 * one method covers the lot. `dns.lookup` is trapped too, since a resolver call
 * is already an escape even when the connect never happens.
 *
 * A test that legitimately needs a network client passes it a stub instead. A
 * test that wants the real thing belongs in the EMULATOR lane
 * (`npx omega test`), which boots the environment it talks to.
 */
const net = require('node:net');
const dns = require('node:dns');

const MARKER = '__omegaConnectTrap';

function refuse(what, detail) {
  const error = new Error(
    `connect-trap: ${what} was attempted in the static test lane (${detail}). `
    + 'This lane is socket-free by contract — stub the network client instead.',
  );
  error.code = 'CONNECT_TRAP';
  return error;
}

function describe(target) {
  if (!target) {
    return 'unknown target';
  }
  if (typeof target === 'string' || typeof target === 'number') {
    return String(target);
  }
  return `${target.host || target.path || 'unknown'}:${target.port || '?'}`;
}

// Sockets — the one funnel every outbound protocol goes through.
const realConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function connect(...args) {
  throw refuse('a TCP connect', describe(args[0]));
};

// Resolver — an escape in its own right, and it runs BEFORE the connect above.
const realLookup = dns.lookup;
dns.lookup = function lookup(hostname) {
  throw refuse('a DNS lookup', String(hostname));
};
dns.promises.lookup = function lookup(hostname) {
  throw refuse('a DNS lookup', String(hostname));
};

// The proof handle: test/_unit/socket-free.test.js asserts this is present, so
// a lane that silently lost the --require flag fails instead of passing quietly.
globalThis[MARKER] = {
  installed: true,
  marker: MARKER,
  // The originals are kept ONLY so the trap can describe what it replaced —
  // nothing in the lane is allowed to put them back.
  replaced: { connect: typeof realConnect, lookup: typeof realLookup },
};
