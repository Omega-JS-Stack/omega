/**
 * Usage log-privacy test — a usage line names the counter it moved, never the document.
 *
 * `Usage` holds the WHOLE user document (`self.user`) so it can read and write the
 * counters on it, and three of its lines used to hand that document to the logger:
 * the init line and the increment/set lines. The document carries `api.privateKey`,
 * consent, the request IP and attribution, and a backend line lands in Cloud Logging
 * for the whole retention window — the live logs had the private key in them
 * ([#632](https://github.com/Omega-JS-Stack/omega/issues/632)).
 *
 * Plain-node unit test (no emulator, no network): `init()` authenticates through the
 * ctx it is handed, so the document under test is the one this file supplies and the
 * assertions read the captured log output.
 */
const assert = require('node:assert');

const Usage = require('../../src/manager/helpers/usage.js');

// The leak fixture: a user document shaped the way ctx.authenticate() resolves one.
const LEAKED_KEY = 'sk_test_fake_leak';
const UID = 'user-632';
const USER_DOC = {
  auth: { uid: UID, email: 'user@test.dev' },
  api: { clientId: 'client-632', privateKey: LEAKED_KEY },
  consent: { marketing: { status: 'granted', ip: '203.0.113.7' } },
  attribution: { source: 'newsletter' },
  subscription: { product: { id: 'basic' }, status: 'active' },
  usage: { requests: { total: 10, monthly: 4, daily: 2 } },
};

/** One Usage lifecycle: init, increment, set — and every line all three wrote. */
async function captureUsage() {
  const captured = [];
  const record = (...args) => captured.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));

  const Manager = {
    config: { payment: { products: [{ id: 'basic', limits: { requests: 100 } }] } },
    storage: () => ({ get: () => ({ value: () => ({}) }) }),
  };

  const ctx = {
    log: record,
    warn: record,
    error: record,
    isDevelopment: () => true,
    authenticate: async () => JSON.parse(JSON.stringify(USER_DOC)),
    request: { data: {}, geolocation: { ip: '203.0.113.7' } },
  };

  const usage = new Usage(Manager);

  await usage.init(ctx, { log: true });
  usage.increment('requests', 1);
  usage.set('requests', 7);

  return { captured, usage };
}

let run;
const usageRun = () => (run = run || captureUsage());

module.exports = {
  description: 'Usage log privacy (counters named, the user document never serialized)',
  type: 'group',
  tests: [
    {
      name: 'init() line names the user and its usage, not the document',

      async run() {
        const { captured } = await usageRun();
        const line = captured.find((l) => l.includes('Usage.init(): Got user'));

        assert.ok(line, `no Usage.init() line was logged: ${JSON.stringify(captured)}`);
        assert.ok(line.includes(UID), `line does not name the user: ${line}`);
        assert.ok(line.includes('"monthly":4'), `line lost the usage it is about: ${line}`);
        assert.ok(!line.includes('privateKey'), `user document serialized into the log line: ${line}`);
      },
    },

    {
      name: 'increment() line names the metric and its new value',

      async run() {
        const { captured } = await usageRun();
        const line = captured.find((l) => l.includes('Incremented requests'));

        assert.ok(line, `no increment line was logged: ${JSON.stringify(captured)}`);
        assert.ok(line.includes('"monthly":5'), `line lost the incremented value: ${line}`);
        assert.ok(!line.includes('privateKey'), `user document serialized into the log line: ${line}`);
      },
    },

    {
      name: 'set() line names the metric and its new value',

      async run() {
        const { captured } = await usageRun();
        const line = captured.find((l) => l.includes('Set requests'));

        assert.ok(line, `no set line was logged: ${JSON.stringify(captured)}`);
        assert.ok(line.includes('"monthly":7'), `line lost the value it set: ${line}`);
        assert.ok(!line.includes('privateKey'), `user document serialized into the log line: ${line}`);
      },
    },

    {
      name: 'no line of the whole lifecycle carries the private key',

      async run() {
        const { captured } = await usageRun();
        const leaking = captured.filter((l) => l.includes(LEAKED_KEY) || l.includes('privateKey'));

        assert.deepEqual(leaking, [], `private key reached the log: ${JSON.stringify(leaking)}`);
      },
    },
  ],
};
