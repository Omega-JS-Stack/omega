/**
 * Test: the `Marketing` contact methods log identifiers, not payloads
 * ([#710](https://github.com/Omega-JS-Stack/omega/issues/710)).
 *
 * Each method's own two lines used to carry a payload into Cloud Logging for the
 * whole retention window: the opening line took `{ email }`, and the closing line
 * took the whole provider results object — which holds that same address again,
 * plus whatever else each provider answered with. Same PII class the #657 sweep
 * took off the auth trigger headlines. What survives at `log` is the verdict per
 * provider; the address and the payloads sit at `debug`.
 *
 * `remove()` was trimmed first; `add()` and `sync()` are the same two lines on the
 * same class of payload, so they are held to the same bar here — one case set per
 * method, driven down each one's happy path.
 *
 * Plain-node control-flow test (no emulator, no network): the provider modules
 * are swapped in place for the call — the same idiom prune-per-provider.test.js
 * uses — and restored after, so an ambient API key can never reach a real
 * provider.
 *
 * Run: npx omega test framework:email/marketing/remove-log-privacy
 */
const Marketing = require('../../../dist/manager/libraries/email/marketing/index.js');
const sendgridProvider = require('../../../dist/manager/libraries/email/providers/sendgrid.js');
const beehiivProvider = require('../../../dist/manager/libraries/email/providers/beehiiv.js');
const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');

const EMAIL = 'contact.person@omegajs-test.dev';

// What each provider answers a contact call with — the payloads the closing line
// used to serialize whole.
const SENDGRID_RESULT = { success: true, jobId: 'job-710', contact: { id: 'contact-710', email: EMAIL } };
const BEEHIIV_RESULT = { success: true, subscriber: { id: 'sub-710', email: EMAIL } };

// The user doc sync() reads: the address, plus the name its provider fields are
// built from — more of the same PII class riding the same two lines.
const USER_DOC = {
  auth: { uid: 'uid-710', email: EMAIL },
  personal: { name: { first: 'Contact', last: 'Person' } },
};

// The log seam: every level the library writes to, recorded verbatim.
function createRecorder(admin) {
  const calls = { log: [], debug: [], warn: [], error: [] };
  const record = (level) => (...args) => calls[level].push(args);

  return {
    calls: calls,
    ctx: {
      Manager: { libraries: { admin: admin || null }, config: {} },
      isTesting: () => false,
      log: record('log'),
      debug: record('debug'),
      warn: record('warn'),
      error: record('error'),
    },
  };
}

/**
 * The one Firestore read add() makes: its consent gate looks the address up, and
 * an empty result is the "pure newsletter contact" path this test drives.
 */
function noUserAdmin() {
  return {
    firestore: () => ({
      collection: () => ({
        where: () => ({
          limit: () => ({
            get: async () => ({ empty: true, docs: [] }),
          }),
        }),
      }),
    }),
  };
}

// A call as one string, the way it lands in Cloud Logging.
function render(args) {
  return args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ');
}

/**
 * Run `fn` with both providers enabled and the named provider functions swapped
 * for the call, always restoring the modules and the env keys afterwards.
 *
 * @param {Array<[object, string, Function]>} stubs - [module, function name, stand-in]
 * @param {Function} fn - The call to make while they are in place.
 */
async function withProviders(stubs, fn) {
  const originals = stubs.map(([module, name]) => module[name]);
  const keys = { SENDGRID_API_KEY: process.env.SENDGRID_API_KEY, BEEHIIV_API_KEY: process.env.BEEHIIV_API_KEY };

  process.env.SENDGRID_API_KEY = 'sg-test-710';
  process.env.BEEHIIV_API_KEY = 'bh-test-710';
  stubs.forEach(([module, name, impl]) => { module[name] = impl; });

  try {
    return await fn();
  } finally {
    stubs.forEach(([module, name], index) => { module[name] = originals[index]; });
    restoreEnv('SENDGRID_API_KEY', keys.SENDGRID_API_KEY);
    restoreEnv('BEEHIIV_API_KEY', keys.BEEHIIV_API_KEY);
  }
}

async function runRemove() {
  const { calls, ctx } = createRecorder();

  await withProviders([
    [sendgridProvider, 'removeContact', async () => SENDGRID_RESULT],
    [beehiivProvider, 'removeContact', async () => BEEHIIV_RESULT],
  ], () => new Marketing(ctx).remove(EMAIL));

  return calls;
}

async function runAdd() {
  const { calls, ctx } = createRecorder(noUserAdmin());

  await withProviders([
    [sendgridProvider, 'addContact', async () => SENDGRID_RESULT],
    [beehiivProvider, 'addContact', async () => BEEHIIV_RESULT],
  ], () => new Marketing(ctx).add({ email: EMAIL, firstName: 'Contact', lastName: 'Person' }));

  return calls;
}

async function runSync() {
  const { calls, ctx } = createRecorder();

  // buildFields() is stubbed alongside the writes: the real ones read a
  // module-level Manager config, and SendGrid's fetches the account's
  // custom-field ids over the network.
  await withProviders([
    [sendgridProvider, 'buildFields', async () => ({})],
    [sendgridProvider, 'addContact', async () => SENDGRID_RESULT],
    [beehiivProvider, 'buildFields', () => []],
    [beehiivProvider, 'addContact', async () => BEEHIIV_RESULT],
  ], () => new Marketing(ctx).sync(USER_DOC));

  return calls;
}

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

/**
 * The four checks one contact method owes: nothing at log/warn/error carries the
 * address or a provider payload, the result line still carries the verdict per
 * provider, and both stay reachable at debug. One set per method — the bar is
 * the same for all three.
 *
 * @param {string} method - 'remove', 'add' or 'sync'.
 * @param {Function} run - The runner that drives that method's happy path.
 */
function privacyCases(method, run) {
  return [
    {
      name: `${method}-no-log-line-carries-the-address`,
      async run({ assert }) {
        const calls = await run();

        for (const args of [...calls.log, ...calls.warn, ...calls.error]) {
          assert.equal(render(args).includes(EMAIL), false, `address written to a log line: ${render(args)}`);
        }
      },
    },

    {
      name: `${method}-no-log-line-carries-a-provider-payload`,
      async run({ assert }) {
        const calls = await run();

        for (const args of [...calls.log, ...calls.warn, ...calls.error]) {
          const line = render(args);

          assert.equal(line.includes('job-710'), false, `the SendGrid payload rides a log line: ${line}`);
          assert.equal(line.includes('sub-710'), false, `the Beehiiv payload rides a log line: ${line}`);
        }
      },
    },

    {
      name: `${method}-the-result-line-names-each-provider-and-its-verdict`,
      async run({ assert }) {
        const calls = await run();
        const line = calls.log.map(render).find((entry) => entry.includes(`Marketing.${method}() result:`));

        assert.ok(line, `no result line was logged: ${calls.log.map(render).join(' | ')}`);
        assert.match(line, /campaigns/, 'the result line should name the campaigns provider');
        assert.match(line, /newsletter/, 'the result line should name the newsletter provider');
        assert.match(line, /ok/, 'the result line should carry each provider\'s verdict');
      },
    },

    {
      name: `${method}-the-address-and-the-payloads-stay-reachable-at-debug`,
      async run({ assert }) {
        const calls = await run();
        const debugged = calls.debug.map(render).join(' | ');

        assert.match(debugged, new RegExp(EMAIL), `the address should stay reachable at debug: ${debugged}`);
        assert.match(debugged, /job-710/, `the SendGrid payload should stay reachable at debug: ${debugged}`);
        assert.match(debugged, /sub-710/, `the Beehiiv payload should stay reachable at debug: ${debugged}`);
      },
    },
  ];
}

module.exports = defineCases({
  description: 'Marketing add()/sync()/remove() log the verdict, never the address or the payloads',
  type: 'group',

  tests: [
    ...privacyCases('remove', runRemove),
    ...privacyCases('add', runAdd),
    ...privacyCases('sync', runSync),
  ],
});
