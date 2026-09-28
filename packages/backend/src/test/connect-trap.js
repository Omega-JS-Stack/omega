/**
 * Connect trap: the runner's guard that a plain `omega test` reaches nothing past
 * this machine. A TCP connect or DNS lookup to any host but loopback throws
 * `CONNECT_TRAP`, so a suite can never reach the real project with whatever
 * credentials the environment carries; the emulator on loopback stays reachable.
 */
const net = require('node:net');
const dns = require('node:dns');

const MARKER = '__omegaConnectTrap';

// The hosts a plain run may reach: this machine, where the emulator listens. The
// unspecified addresses are here because a bind probe resolves them through the
// same lookup an outbound connect uses, and neither leaves the machine.
const LOOPBACK = Object.freeze(['127.0.0.1', '::1', 'localhost', '0.0.0.0', '::']);

/** Is this host loopback? Node connects to `localhost` when a caller names no host. */
function isLoopback(host) {
  return LOOPBACK.includes(host === undefined || host === null ? 'localhost' : String(host));
}

function refuse(what, detail) {
  const error = new Error(
    `connect-trap: ${what} was attempted during a plain test run (${detail}). `
    + 'A plain run reaches only loopback: stub the network client, or run the case under --extended.',
  );
  error.code = 'CONNECT_TRAP';
  return error;
}

// Where a Socket#connect call is headed: Node passes a normalized [options, cb]
// array, an options object, (port, host), or an IPC path
function targetOf(args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  if (first && typeof first === 'object') return { host: first.host, port: first.port, path: first.path };
  if (typeof first === 'number' || /^\d+$/.test(String(first))) {
    return { host: typeof args[1] === 'string' ? args[1] : undefined, port: Number(first) };
  }
  return { path: first };
}

/** Install the trap in this process, once; returns the proof handle on globalThis. */
function install() {
  if (globalThis[MARKER]) return globalThis[MARKER];

  // Every outbound protocol funnels through this one method; an IPC path is local by construction
  const realConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function connect(...args) {
    const target = targetOf(args);
    if (target.path === undefined && !isLoopback(target.host)) {
      throw refuse('a TCP connect', `${target.host}:${target.port}`);
    }
    return realConnect.apply(this, args);
  };

  // A resolver call is an escape in its own right, and it runs before the connect
  const realLookup = dns.lookup;
  dns.lookup = function lookup(hostname, ...rest) {
    if (!isLoopback(hostname)) throw refuse('a DNS lookup', String(hostname));
    return realLookup.call(this, hostname, ...rest);
  };

  const realPromisesLookup = dns.promises.lookup;
  dns.promises.lookup = function lookup(hostname, ...rest) {
    if (!isLoopback(hostname)) throw refuse('a DNS lookup', String(hostname));
    return realPromisesLookup.call(this, hostname, ...rest);
  };

  globalThis[MARKER] = { installed: true, marker: MARKER, loopback: LOOPBACK };
  return globalThis[MARKER];
}

module.exports = { install, isLoopback, LOOPBACK, MARKER };
