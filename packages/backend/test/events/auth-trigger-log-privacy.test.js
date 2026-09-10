/**
 * Test: the three remaining auth triggers open with the uid and nothing else
 * ([#657](https://github.com/Omega-JS-Stack/omega/issues/657)).
 *
 * `beforeCreate`, `beforeSignIn` and `onDelete` each used to open with
 * `ctx.log(..., user, context)` — the whole Firebase user record (email, display
 * name, provider data, password hash) plus the trigger context (IP, user agent,
 * credential) into Cloud Logging, on every signup and every sign-in. The headline
 * is now the uid alone, the #641 shape `onCreate` already carries, and the fat
 * payload sits one level down at `debug` — silent on a normal run, one
 * `OMEGA_DEBUG=1` away.
 *
 * Pure: the log seam #632 added is `ctx` itself, so a recorder in its place reads
 * every line the handler writes with no emulator, no admin SDK and no ports. The
 * only stand-ins are that recorder and the Firestore/Usage doubles the handlers
 * reach for AFTER the line under test.
 *
 * Note on the IP: `beforeCreate`'s rate-limit lines still name the client IP,
 * deliberately — it is the rate limiter's KEY, not the user's identity. The line
 * this test is about is the headline, and the headline is asserted whole.
 *
 * Run: npx omega test framework:events/auth-trigger-log-privacy
 */
const beforeCreate = require('../../dist/manager/events/auth/before-create.js');
const beforeSignIn = require('../../dist/manager/events/auth/before-signin.js');
const onDelete = require('../../dist/manager/events/auth/on-delete.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

const UID = '_test-657-uid';
const EMAIL = 'leaky.person@omegajs-test.dev';
const DISPLAY_NAME = 'Leaky Person';
const IP = '203.0.113.9';

// A UserRecord the way both trigger flavors receive it — the material that used
// to ride the headline.
const USER = {
  uid: UID,
  email: EMAIL,
  emailVerified: true,
  displayName: DISPLAY_NAME,
  photoURL: 'https://cdn.omegajs-test.dev/leaky-person.png',
  passwordHash: 'hash-657',
  providerData: [{ providerId: 'password', uid: EMAIL, email: EMAIL, displayName: DISPLAY_NAME }],
  metadata: { creationTime: '2026-08-30T00:00:00Z', lastSignInTime: '2026-08-30T00:00:00Z' },
};

// AuthEventContext (blocking functions): carries the IP, the user agent, the locale.
const AUTH_CONTEXT = {
  ipAddress: IP,
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
  locale: 'en-US',
  eventId: 'event-657',
  additionalUserInfo: { providerId: 'password', email: EMAIL, isNewUser: true },
};

// EventContext (1st-gen triggers): no IP, no user agent.
const EVENT_CONTEXT = {
  eventId: 'event-657',
  eventType: 'providers/firebase.auth/eventTypes/user.delete',
  resource: { service: 'firebaseauth.googleapis.com' },
};

// The log seam: every level the handlers write to, recorded verbatim.
function createRecorder() {
  const calls = { log: [], debug: [], error: [] };
  const record = (level) => (...args) => calls[level].push(args);

  return {
    calls: calls,
    ctx: { log: record('log'), debug: record('debug'), error: record('error') },
  };
}

// A call as one string, the way it lands in Cloud Logging.
function render(args) {
  return args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ');
}

// No hooks/auth/*.js under this dir, so the consumer hook lookup is a no-op.
const MANAGER = { cwd: __dirname, config: {} };

async function runBeforeCreate() {
  const { calls, ctx } = createRecorder();

  // The rate limiter is the handler's real path — only the Usage counter is a
  // double: attach/forKey/consume, the #647 shape the gate calls.
  const counter = {
    attach: () => counter,
    forKey: () => counter,
    consume: async () => ({ used: 1, left: 1, day: { used: 1, left: 1 } }),
  };
  const Manager = { ...MANAGER, Usage: () => counter };

  await beforeCreate({ Manager: Manager, ctx: ctx, user: USER, context: AUTH_CONTEXT, libraries: { functions: {} } });

  return calls;
}

async function runBeforeSignIn() {
  const { calls, ctx } = createRecorder();
  const admin = { firestore: () => ({ doc: () => ({ set: async () => undefined }) }) };

  await beforeSignIn({ Manager: MANAGER, ctx: ctx, user: USER, context: AUTH_CONTEXT, libraries: { admin: admin } });

  return calls;
}

async function runOnDelete() {
  const { calls, ctx } = createRecorder();

  // No user doc, so the handler writes its headline and returns before the
  // delete, the marketing removal and the conversion.
  const admin = { firestore: () => ({ doc: () => ({ get: async () => ({ exists: false }) }) }) };

  await onDelete({ Manager: MANAGER, ctx: ctx, user: USER, context: EVENT_CONTEXT, libraries: { admin: admin } });

  return calls;
}

// What the marketing library answers `remove()` with: one entry per enabled
// provider, each carrying that provider's own payload — the address included.
const MARKETING_RESULT = {
  campaigns: { success: true, jobId: 'job-710', contact: { email: EMAIL, name: DISPLAY_NAME } },
  newsletter: { success: true, subscriber: { id: 'sub-710', email: EMAIL } },
};

// The full run: an existing doc, so the handler goes past its headline into the
// delete, the marketing removal and the conversion. The marketing removal is
// fire-and-forget, so the caller drains the microtask queue before reading.
async function runOnDeleteWithDoc() {
  const { calls, ctx } = createRecorder();

  const admin = {
    firestore: () => ({
      doc: () => ({
        get: async () => ({ exists: true, data: () => ({ auth: { uid: UID, email: EMAIL } }) }),
        delete: async () => undefined,
      }),
    }),
  };

  const Manager = { ...MANAGER, Email: () => ({ remove: async () => MARKETING_RESULT }) };

  await onDelete({ Manager: Manager, ctx: ctx, user: USER, context: EVENT_CONTEXT, libraries: { admin: admin } });
  await new Promise((resolve) => setImmediate(resolve));

  return calls;
}

// The two claims every trigger makes, asserted the same way for each.
function assertHeadlineIsUidAlone({ assert, calls, tag }) {
  const headline = calls.log[0];

  assert.ok(headline, `${tag}: no headline line was logged`);
  assert.equal(headline[0], `${tag}: ${UID}`, `${tag}: headline is not the uid alone: ${render(headline)}`);
  assert.equal(headline.length, 1, `${tag}: the headline carries a payload: ${render(headline.slice(1))}`);
}

function assertNothingPrivateRidesTheLog({ assert, calls, tag, context }) {
  const written = [...calls.log, ...calls.error];

  for (const args of written) {
    const line = render(args);

    assert.equal(line.includes(EMAIL), false, `${tag}: email written to a log line: ${line}`);
    assert.equal(line.includes(DISPLAY_NAME), false, `${tag}: display name written to a log line: ${line}`);
    assert.equal(args.includes(USER), false, `${tag}: the user record rides a log line: ${line}`);
    assert.equal(args.includes(context), false, `${tag}: the trigger context rides a log line: ${line}`);
  }

  // Not deleted — moved behind the debug gate, which is dropped whole unless
  // OMEGA_DEBUG is set.
  const records = calls.debug.filter((args) => args.includes(USER) && args.includes(context));

  assert.equal(records.length, 1, `${tag}: the full record should stay reachable at debug level`);
}

module.exports = defineCases({
  description: 'auth triggers log the uid only',
  type: 'group',

  tests: [
    {
      name: 'before-create-headline-is-the-uid-alone',
      async run({ assert }) {
        assertHeadlineIsUidAlone({ assert: assert, calls: await runBeforeCreate(), tag: 'beforeCreate' });
      },
    },

    {
      name: 'before-create-never-logs-the-record-or-the-context',
      async run({ assert }) {
        assertNothingPrivateRidesTheLog({ assert: assert, calls: await runBeforeCreate(), tag: 'beforeCreate', context: AUTH_CONTEXT });
      },
    },

    {
      name: 'before-signin-headline-is-the-uid-alone',
      async run({ assert }) {
        assertHeadlineIsUidAlone({ assert: assert, calls: await runBeforeSignIn(), tag: 'beforeSignIn' });
      },
    },

    {
      name: 'before-signin-never-logs-the-record-or-the-context',
      async run({ assert }) {
        assertNothingPrivateRidesTheLog({ assert: assert, calls: await runBeforeSignIn(), tag: 'beforeSignIn', context: AUTH_CONTEXT });
      },
    },

    {
      name: 'on-delete-headline-is-the-uid-alone',
      async run({ assert }) {
        assertHeadlineIsUidAlone({ assert: assert, calls: await runOnDelete(), tag: 'onDelete' });
      },
    },

    {
      name: 'on-delete-never-logs-the-record-or-the-context',
      async run({ assert }) {
        assertNothingPrivateRidesTheLog({ assert: assert, calls: await runOnDelete(), tag: 'onDelete', context: EVENT_CONTEXT });
      },
    },

    // ─── The marketing removal's own line ([#710]) ───

    {
      name: 'on-delete-marketing-remove-logs-the-uid-and-a-count',
      async run({ assert }) {
        const calls = await runOnDeleteWithDoc();
        const line = calls.log.find((args) => String(args[0]).includes('Marketing remove'));

        assert.ok(line, `no marketing-remove line was logged: ${calls.log.map(render).join(' | ')}`);
        assert.equal(line.length, 1, `the line carries the provider result: ${render(line.slice(1))}`);
        assert.match(render(line), new RegExp(UID), 'the line should name the account the removal was for');
        assert.match(render(line), /2/, 'the line should count the providers that answered');
      },
    },

    {
      name: 'on-delete-marketing-remove-keeps-the-result-behind-the-debug-gate',
      async run({ assert }) {
        const calls = await runOnDeleteWithDoc();

        for (const args of [...calls.log, ...calls.error]) {
          assert.equal(args.includes(MARKETING_RESULT), false, `the provider result rides a log line: ${render(args)}`);
          assert.equal(render(args).includes(EMAIL), false, `email written to a log line: ${render(args)}`);
        }

        const records = calls.debug.filter((args) => args.includes(MARKETING_RESULT));

        assert.equal(records.length, 1, 'the provider result should stay reachable at debug level');
      },
    },
  ],
});
