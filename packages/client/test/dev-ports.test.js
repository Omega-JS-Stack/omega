const { describe, it, before, after, afterEach } = require('node:test');
const { assert } = require('./helpers.js');

// modules/dev-ports.js is the ONE home of the local port chain: the
// OMEGA_*_PORT env channel first, then the `dev.ports` map the caller was given,
// then a loud miss. The Omega class and desktop's and extension's url-helpers call it.
let devPorts;

const WRITER = 'the test bundle task';
const ENV_KEYS = ['OMEGA_HOSTING_PORT', 'OMEGA_HTTPS_PORT', 'OMEGA_FUNCTIONS_PORT', 'OMEGA_AUTH_PORT'];
const saved = {};

describe('dev-ports: the local port chain', () => {

  before(async () => {
    devPorts = await import('../src/modules/dev-ports.js');
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      delete process.env[key];
    }
  });

  after(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] !== undefined) process.env[key] = saved[key];
    }
  });

  it('the baked dev.ports value answers when no env channel is published', () => {
    assert.strictEqual(devPorts.localPort({ hosting: 5012 }, 'hosting'), 5012);
  });

  it('the OMEGA_*_PORT env channel wins over the baked value', () => {
    process.env.OMEGA_HOSTING_PORT = '5022';
    assert.strictEqual(devPorts.localPort({ hosting: 5012 }, 'hosting'), 5022);
  });

  it('an env value that is not a positive integer port falls through to the map', () => {
    process.env.OMEGA_HOSTING_PORT = 'nope';
    assert.strictEqual(devPorts.localPort({ hosting: 5012 }, 'hosting'), 5012);
  });

  it('requiredPort throws naming the port and the writer the caller passed', () => {
    assert.throws(() => devPorts.requiredPort(undefined, 'hosting', WRITER), /dev port for `hosting`/);
    assert.throws(() => devPorts.requiredPort({}, 'hosting', WRITER), /the test bundle task/);
  });

  it('localApiUrl: a mapped https port is the mkcert proxy, over https', () => {
    assert.strictEqual(devPorts.localApiUrl({ https: 5003, hosting: 5443 }, WRITER), 'https://localhost:5003');
  });

  // The emulator binds 127.0.0.1, and `localhost` can resolve to ::1 in Node.
  it('localApiUrl: a mapped hosting port alone is the emulator, plain http on 127.0.0.1', () => {
    assert.strictEqual(devPorts.localApiUrl({ hosting: 5012 }, WRITER), 'http://127.0.0.1:5012');
  });

  it('localApiUrl: neither mapped throws naming the hosting port', () => {
    assert.throws(() => devPorts.localApiUrl({}, WRITER), /dev port for `hosting`/);
  });

  it('localFunctionsUrl: the functions emulator on 127.0.0.1, env port over the map', () => {
    assert.strictEqual(devPorts.localFunctionsUrl({ functions: 5011 }, 'demo-app', WRITER), 'http://127.0.0.1:5011/demo-app/us-central1');
    process.env.OMEGA_FUNCTIONS_PORT = '5021';
    assert.strictEqual(devPorts.localFunctionsUrl({ functions: 5011 }, 'demo-app', WRITER), 'http://127.0.0.1:5021/demo-app/us-central1');
  });

  it('localAuthEmulatorUrl: the auth emulator on 127.0.0.1, and a loud miss without it', () => {
    assert.strictEqual(devPorts.localAuthEmulatorUrl({ auth: 9109 }, WRITER), 'http://127.0.0.1:9109');
    assert.throws(() => devPorts.localAuthEmulatorUrl({}, WRITER), /dev port for `auth`/);
  });
});
