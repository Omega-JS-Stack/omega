/**
 * Usage log-privacy test — a usage line names the counter it moved, never the document.
 *
 * `Usage` holds the WHOLE user document (`self.user`) so it can read and write the
 * counters on it, and its lines used to hand that document to the logger. The document
 * carries `api.privateKey`, consent, the request IP and attribution, and a backend line
 * lands in Cloud Logging for the whole retention window — the live logs had the private
 * key in them ([#632](https://github.com/Omega-JS-Stack/omega/issues/632)).
 *
 * The promise survives the `consume` rewrite
 * ([#647](https://github.com/Omega-JS-Stack/omega/issues/647)): the two lines that
 * exist now — the resolve line and the count line — name the account and the counter
 * and nothing else.
 *
 * Plain-node unit test (no emulator, no network): the counter authenticates through the
 * ctx it is handed, so the document under test is the one this file supplies and the
 * assertions read the captured log output.
 */
const assert = require('node:assert');

const Usage = require('../../dist/manager/helpers/usage.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

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

/** One counter lifecycle: attach, consume — and every line it wrote. */
async function captureUsage() {
  const captured = [];
  const record = (...args) => captured.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));

  const Manager = {
    config: {
      features: { requests: { name: 'API Requests', usage: { pace: false } } },
      payment: { products: [{ id: 'basic', features: { requests: 100 } }] },
    },
    storage: () => ({ get: () => ({ value: () => ({}) }), set: () => ({ write: () => {} }) }),
    libraries: {},
  };

  const ctx = {
    log: record,
    warn: record,
    error: record,
    isDevelopment: () => true,
    report: (e, opts) => {
      const error = e instanceof Error ? e : new Error(e);
      error.code = (opts || {}).code || 500;
      return error;
    },
    authenticate: async () => JSON.parse(JSON.stringify(USER_DOC)),
    request: { data: {}, geolocation: { ip: '203.0.113.7' } },
  };

  const usage = new Usage(Manager);

  usage.attach(ctx, { log: true });

  // The write is the one thing that would need Firestore — the LINES are the subject
  usage.write = async () => {};

  await usage.consume('requests', 1);

  return { captured, usage };
}

let run;
const usageRun = () => (run = run || captureUsage());

module.exports = defineCases({
  description: 'Usage log privacy (counters named, the user document never serialized)',
  type: 'group',
  tests: [
    {
      name: 'resolve() line names the user and its usage, not the document',

      async run() {
        const { captured } = await usageRun();
        const line = captured.find((l) => l.includes('Usage.resolve(): Resolved'));

        assert.ok(line, `no Usage.resolve() line was logged: ${JSON.stringify(captured)}`);
        assert.ok(line.includes(UID), `line does not name the user: ${line}`);
        assert.ok(line.includes('"monthly":4'), `line lost the usage it is about: ${line}`);
        assert.ok(!line.includes('privateKey'), `user document serialized into the log line: ${line}`);
      },
    },

    {
      name: 'count() line names the feature and its new value',

      async run() {
        const { captured } = await usageRun();
        const line = captured.find((l) => l.includes('Counted 1 requests'));

        assert.ok(line, `no count line was logged: ${JSON.stringify(captured)}`);
        assert.ok(line.includes('"monthly":5'), `line lost the counted value: ${line}`);
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
});
