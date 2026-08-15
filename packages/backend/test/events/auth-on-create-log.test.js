/**
 * Test: auth:on-create logs ONE headline line
 * ([#230](https://github.com/Omega-JS-Stack/omega/issues/230)).
 *
 * The handler used to dump the whole UserRecord (providerData, passwordHash,
 * metadata) plus the event context onto its opening line — per created user, which
 * buries a dev-boot seed. The headline is now `onCreate: <uid> (<email>)` and
 * nothing else; the full record stays reachable one level down, at debug — silent
 * on a normal run, one `OMEGA_DEBUG=1` away.
 *
 * Real everything: a seeded persona's REAL UserRecord from the emulator's Auth,
 * the real Manager and ctx, the real handler. The persona already has a user doc,
 * so the handler logs its headline and returns at the "already exists" branch —
 * no writes, nothing to clean up. The only stand-in is `console`, the sink.
 *
 * Run: npx omega test framework:events/auth-on-create-log
 */

const onCreate = require('../../src/manager/events/auth/on-create.js');

// Record every console call the thunk makes, restoring console afterward.
async function withConsoleRecorder(fn) {
  const calls = { log: [], debug: [], error: [] };
  const original = { log: console.log, debug: console.debug, error: console.error };

  console.log = (...args) => calls.log.push(args);
  console.debug = (...args) => calls.debug.push(args);
  console.error = (...args) => calls.error.push(args);

  try {
    await fn();
    return calls;
  } finally {
    console.log = original.log;
    console.debug = original.debug;
    console.error = original.error;
  }
}

// The handler forwards the event context straight to the debug line and to the
// consumer hook — this is the 1st-gen EventContext shape for a user creation.
const EVENT_CONTEXT = {
  eventType: 'providers/firebase.auth/eventTypes/user.create',
  resource: { service: 'firebaseauth.googleapis.com' },
};

// The persona's user doc must already exist — that is what sends the handler down
// its read-only "already exists" branch. Checked before every call so a missing doc
// fails the test instead of quietly rewriting a shared account.
async function assertDocExists({ assert, firestore, user }) {
  const doc = await firestore.get(`users/${user.uid}`);

  assert.equal(!!doc?.auth?.uid, true, `precondition: users/${user.uid} should already exist`);
}

// Run the thunk with the debug switch in a known state — the logger reads it live.
async function withDebug(value, fn) {
  const saved = process.env.OMEGA_DEBUG;

  if (value === undefined) {
    delete process.env.OMEGA_DEBUG;
  } else {
    process.env.OMEGA_DEBUG = value;
  }

  try {
    return await fn();
  } finally {
    if (saved === undefined) {
      delete process.env.OMEGA_DEBUG;
    } else {
      process.env.OMEGA_DEBUG = saved;
    }
  }
}

async function runHandler({ Manager, user, debug }) {
  const ctx = Manager.RouteContext({}, { functionName: 'omega_authOnCreate' });
  const admin = Manager.libraries.admin;

  const calls = await withConsoleRecorder(async () => {
    await withDebug(debug, async () => {
      await onCreate({
        Manager: Manager,
        ctx: ctx,
        user: user,
        context: EVENT_CONTEXT,
        libraries: { admin: admin },
      });
    });
  });

  return { calls: calls, headlines: calls.log.filter((args) => String(args[1]).startsWith(`onCreate: ${user.uid} (`)) };
}

module.exports = {
  description: 'auth:on-create logs one headline line, full record at debug',
  type: 'group',
  timeout: 30000,

  tests: [
    {
      name: 'headline-is-uid-and-email-only',
      run: async ({ assert, Manager, accounts, firestore }) => {
        const user = await Manager.libraries.admin.auth().getUser(accounts.basic.uid);

        await assertDocExists({ assert: assert, firestore: firestore, user: user });

        const { headlines } = await runHandler({ Manager: Manager, user: user, debug: undefined });

        assert.equal(headlines.length, 1, `expected one headline line, got ${headlines.length}`);
        assert.equal(headlines[0][1], `onCreate: ${user.uid} (${user.email})`, headlines[0][1]);

        // Prefix + message and nothing else — the record is off this line.
        assert.equal(headlines[0].length, 2, `the headline carries a payload: ${JSON.stringify(headlines[0].slice(2)).slice(0, 200)}`);
      },
    },

    {
      name: 'the-record-does-not-print-on-a-normal-run',
      run: async ({ assert, Manager, accounts, firestore }) => {
        const user = await Manager.libraries.admin.auth().getUser(accounts.basic.uid);

        await assertDocExists({ assert: assert, firestore: firestore, user: user });

        const { calls } = await runHandler({ Manager: Manager, user: user, debug: undefined });

        assert.equal(calls.debug.length, 0, 'the record must stay behind the debug gate by default');
        assert.equal(calls.log.filter((args) => args.includes(user)).length, 0, 'the record must not ride any log line');
      },
    },

    {
      name: 'the-full-record-is-reachable-with-omega-debug',
      run: async ({ assert, Manager, accounts, firestore }) => {
        const user = await Manager.libraries.admin.auth().getUser(accounts.basic.uid);

        await assertDocExists({ assert: assert, firestore: firestore, user: user });

        const { calls } = await runHandler({ Manager: Manager, user: user, debug: '1' });

        const records = calls.debug.filter((args) => args.includes(user));

        assert.equal(records.length, 1, 'the full UserRecord should log once at debug level');
        assert.equal(records[0].includes(EVENT_CONTEXT), true, 'the event context should ride the debug line too');
      },
    },
  ],
};
