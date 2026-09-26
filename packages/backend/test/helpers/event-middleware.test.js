/**
 * Test: events.js, event trigger handler dispatch
 *
 * Run: npx omega test backend:helpers/event-middleware
 *
 * events.run() is the door every auth/firestore/cron trigger enters: resolve a
 * handler path, build the event's Context, run pre/post hooks around it, and
 * translate failures. All of that is decidable without an emulator —
 * the trigger PAYLOAD (snapshot/change/context) is just data the middleware
 * forwards, and the handler is a real file on disk here.
 *
 * What is NOT unit-testable and deliberately stays at the integration layer:
 * whether Firebase actually invokes these with the right payload (proven by
 * the events/* route suites against the real emulator).
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const events = require('../../dist/omega/events.js');
const { bootOmega } = require('./_boot-omega.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

// Write a handler file and return its absolute path.
function handlerFile(source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-backend-events-'));
  const file = path.join(dir, 'handler.js');
  fs.writeFileSync(file, source);
  return file;
}

// A REAL Omega instance (booted fresh from the bundled fixture) aimed at this
// case's events dir and hooks, with its capture handle recording every report()
// of a server fault: the real report() logs AND captures, returning the
// decorated Error, so `reported` is what went through the one door.
function makeOmega({ cwd, handlers } = {}) {
  const instance = bootOmega();

  instance.cwd = cwd || '/nonexistent-cwd';
  instance.handlers = handlers || {};
  instance.reported = [];
  instance.sentry = { captureException: (e) => instance.reported.push(e) };

  return instance;
}

// Run a trigger under a Cloud Functions target name: the event's Context takes
// its name from FUNCTION_TARGET, and the hook is keyed by that name.
async function asFunction(name, fn) {
  const original = process.env.FUNCTION_TARGET;

  process.env.FUNCTION_TARGET = name;

  try {
    return await fn();
  } finally {
    if (original === undefined) {
      delete process.env.FUNCTION_TARGET;
    } else {
      process.env.FUNCTION_TARGET = original;
    }
  }
}

// Run a thunk with a recording Sentry transport injected on the REAL omega —
// the same seam route-context.test.js uses, so a trigger's capture is proven
// against the framework's actual chokepoint, not a stub of it.
async function withSentryRecorder(omega, fn) {
  const captured = [];
  const original = omega.sentry;

  omega.sentry = { captureException: (e) => captured.push(e) };

  try {
    // AWAITED inside the swap: a handler's throw lands after the first await in
    // events.run(), so restoring on the synchronous return would put the real
    // (null) transport back before the capture ever happened.
    await fn();
    return captured;
  } finally {
    omega.sentry = original;
  }
}

// Resolve/reject of run(), flattened for assertion.
async function settle(promise) {
  try {
    return { resolved: await promise };
  } catch (e) {
    return { rejected: e };
  }
}

module.exports = defineCases({
  description: 'events.run() handler dispatch + hooks',
  type: 'group',

  tests: [
    // ─── Handler resolution ───

    {
      name: 'an-absolute-handler-name-is-used-verbatim',
      async run({ assert }) {
        const file = handlerFile('module.exports = async () => "ran";');

        const outcome = await settle(events.run(makeOmega(), file, {}));

        assert.equal(outcome.resolved, 'ran');
      },
    },

    {
      name: 'a-relative-handler-name-resolves-under-the-consumer-events-dir',
      async run({ assert }) {
        const file = handlerFile('module.exports = async () => "from-events-dir";');
        const cwd = path.dirname(path.dirname(file));
        fs.mkdirSync(path.join(cwd, 'events'), { recursive: true });
        fs.copyFileSync(file, path.join(cwd, 'events', 'users__on-create.js'));

        const outcome = await settle(
          events.run(makeOmega({ cwd }), 'users__on-create', {}),
        );

        assert.equal(outcome.resolved, 'from-events-dir');
      },
    },

    {
      name: 'a-missing-handler-rejects-and-is-reported-not-swallowed',
      async run({ assert }) {
        const omega = makeOmega();

        const outcome = await settle(events.run(omega, 'does/not/exist', {}));

        assert.equal(outcome.rejected instanceof Error, true);
        assert.equal(outcome.rejected.message.includes('Failed to load handler'), true);
        assert.equal(outcome.rejected.cause.code, 'MODULE_NOT_FOUND', 'the require failure survives as the cause');
        assert.equal(omega.reported.length, 1, 'the load failure goes through report() — logged AND captured');
        assert.equal(omega.reported[0], outcome.rejected);
      },
    },

    // ─── The context handed to a handler ───

    {
      name: 'the-handler-receives-omega-ctx-and-the-event-payload',
      async run({ assert }) {
        const file = handlerFile(`module.exports = async (context) => ({
          hasOmega: !!context.omega,
          hasCtx: typeof context.ctx.log === 'function',
          noRequest: context.ctx.request === null,
          user: context.user,
          eventId: context.context && context.context.eventId,
          change: context.change,
          snapshot: context.snapshot,
        });`);
        const payload = {
          user: { uid: 'uid_1' },
          context: { eventId: 'evt_1' },
          change: { before: 'a', after: 'b' },
          snapshot: { id: 'doc_1' },
        };

        const outcome = await settle(events.run(makeOmega(), file, payload));

        assert.deepEqual(outcome.resolved, {
          hasOmega: true,
          hasCtx: true,
          noRequest: true,
          user: { uid: 'uid_1' },
          eventId: 'evt_1',
          change: { before: 'a', after: 'b' },
          snapshot: { id: 'doc_1' },
        });
      },
    },

    {
      name: 'event-keys-absent-from-the-payload-arrive-undefined-not-missing',
      async run({ assert }) {
        const file = handlerFile(`module.exports = async (context) => Object.keys(context).sort().join(',');`);

        const outcome = await settle(events.run(makeOmega(), file, {}));

        assert.equal(outcome.resolved, 'change,context,ctx,omega,snapshot,user');
      },
    },

    // ─── Hooks ───

    {
      name: 'the-named-hook-runs-pre-then-handler-then-post',
      async run({ assert }) {
        const order = [];
        const file = handlerFile('module.exports = async () => "handled";');
        const omega = makeOmega({
          handlers: { 'users/on-create': async (context, phase) => order.push(phase) },
        });

        const outcome = await asFunction('users/on-create', () => settle(events.run(omega, file, {})));

        assert.deepEqual(order, ['pre', 'post']);
        assert.equal(outcome.resolved, 'handled');
      },
    },

    {
      name: 'only-the-hook-registered-under-this-events-name-runs',
      async run({ assert }) {
        const called = [];
        const file = handlerFile('module.exports = async () => "handled";');
        const omega = makeOmega({
          handlers: {
            'users/on-create': async () => called.push('mine'),
            'users/on-delete': async () => called.push('theirs'),
          },
        });

        await asFunction('users/on-create', () => settle(events.run(omega, file, {})));

        assert.deepEqual(called, ['mine', 'mine']);
      },
    },

    {
      name: 'a-throwing-pre-hook-blocks-the-handler',
      async run({ assert }) {
        const file = handlerFile('module.exports = async () => { throw new Error("handler ran"); };');
        const omega = makeOmega({
          handlers: {
            'users/on-create': async (context, phase) => {
              if (phase === 'pre') throw new Error('blocked by pre hook');
            },
          },
        });

        const outcome = await asFunction('users/on-create', () => settle(events.run(omega, file, {})));

        assert.equal(outcome.rejected.message, 'blocked by pre hook');
      },
    },

    // ─── Failure translation ───

    {
      name: 'a-plain-handler-error-rejects-and-is-reported',
      async run({ assert }) {
        const file = handlerFile('module.exports = async () => { throw new Error("handler blew up"); };');
        const omega = makeOmega();

        const outcome = await settle(events.run(omega, file, {}));

        assert.equal(outcome.rejected.message, 'handler blew up', 'the rejection value is the handler\'s own error');
        assert.equal(omega.reported.length, 1, 'a thrown trigger error is a server fault — reported');
        assert.equal(omega.reported[0], outcome.rejected);
      },
    },

    {
      name: 'an-auth-style-error-rethrows-untouched-and-unreported',
      async run({ assert }) {
        // The HttpsError shape verbatim: its constructor sets `httpErrorCode`
        // from the code, which is how a deliberate block is recognized here.
        const file = handlerFile(`module.exports = async () => {
          const e = new Error('permission-denied');
          e.code = 'permission-denied';
          e.httpErrorCode = { canonicalName: 'PERMISSION_DENIED', status: 403 };
          throw e;
        };`);
        const omega = makeOmega();

        const outcome = await settle(events.run(omega, file, {}));

        assert.equal(outcome.rejected.code, 'permission-denied');
        assert.equal(omega.reported.length, 0, 'a blocking auth error is not a framework fault');
      },
    },

    {
      name: 'a-string-code-server-fault-is-reported-not-mistaken-for-a-block',
      async run({ assert }) {
        // ENOENT, ECONNREFUSED, messaging/invalid-token: a string `.code` is a
        // SERVER fault. respond.js parseInts it to NaN and lands it on the 500
        // lane, so a trigger must report it too.
        const file = handlerFile(`module.exports = async () => {
          const e = new Error('ENOENT: no such file or directory');
          e.code = 'ENOENT';
          throw e;
        };`);
        const omega = makeOmega();

        const outcome = await settle(events.run(omega, file, {}));

        assert.equal(outcome.rejected.message.includes('ENOENT'), true);
        assert.equal(omega.reported.length, 1, 'a string-code system error is a framework fault — reported');
        assert.equal(omega.reported[0], outcome.rejected);
      },
    },

    {
      name: 'a-numeric-4xx-code-error-rethrows-unreported',
      async run({ assert }) {
        const file = handlerFile(`module.exports = async () => {
          const e = new Error('bad request');
          e.code = 400;
          throw e;
        };`);
        const omega = makeOmega();

        const outcome = await settle(events.run(omega, file, {}));

        assert.equal(outcome.rejected.code, 400, 'the client-fault code survives untouched');
        assert.equal(omega.reported.length, 0, 'an explicit 4xx is the client lane — never captured');
      },
    },

    {
      name: 'a-numeric-5xx-code-error-is-reported',
      async run({ assert }) {
        const file = handlerFile(`module.exports = async () => {
          const e = new Error('upstream exploded');
          e.code = 503;
          throw e;
        };`);
        const omega = makeOmega();

        const outcome = await settle(events.run(omega, file, {}));

        assert.equal(omega.reported.length, 1, 'a 5xx code is a server fault, exactly as respond.js rules it');
        assert.equal(omega.reported[0], outcome.rejected);
      },
    },

    {
      name: 'an-httpErrorCode-error-also-rethrows-unreported',
      async run({ assert }) {
        const file = handlerFile(`module.exports = async () => {
          const e = new Error('unauthenticated');
          e.httpErrorCode = { status: 401 };
          throw e;
        };`);
        const omega = makeOmega();

        const outcome = await settle(events.run(omega, file, {}));

        assert.equal(outcome.rejected.message, 'unauthenticated');
        assert.equal(omega.reported.length, 0);
      },
    },

    // ─── The capture seam, against the real omega (#380) ───

    {
      name: 'a-thrown-trigger-error-captures-to-sentry',
      async run({ assert }) {
        const omega = bootOmega();

        const file = handlerFile('module.exports = async () => { throw new Error("trigger blew up"); };');

        const captured = await withSentryRecorder(omega, () => settle(events.run(omega, file, {})));

        assert.equal(captured.length, 1, 'an event trigger that throws reaches Sentry, same as a 5xx route');
        assert.equal(captured[0].message, 'trigger blew up');
      },
    },

    {
      name: 'a-handler-that-will-not-load-captures-to-sentry',
      async run({ assert }) {
        const omega = bootOmega();

        const captured = await withSentryRecorder(omega, () => settle(events.run(omega, '/nonexistent/handler/path', {})));

        assert.equal(captured.length, 1);
        assert.equal(captured[0].message.includes('Failed to load handler'), true);
      },
    },

    {
      name: 'a-blocking-auth-error-never-reaches-sentry',
      async run({ assert }) {
        const omega = bootOmega();

        const file = handlerFile(`module.exports = async () => {
          const e = new Error('permission-denied');
          e.code = 'permission-denied';
          e.httpErrorCode = { canonicalName: 'PERMISSION_DENIED', status: 403 };
          throw e;
        };`);

        const captured = await withSentryRecorder(omega, () => settle(events.run(omega, file, {})));

        assert.equal(captured.length, 0, 'the trigger\'s 4xx lane never captures — the same rule respond.js runs');
      },
    },

    {
      name: 'a-string-code-system-error-still-reaches-sentry',
      async run({ assert }) {
        const omega = bootOmega();

        const file = handlerFile(`module.exports = async () => {
          const e = new Error('connect ECONNREFUSED');
          e.code = 'ECONNREFUSED';
          throw e;
        };`);

        const captured = await withSentryRecorder(omega, () => settle(events.run(omega, file, {})));

        assert.equal(captured.length, 1, 'a string .code is not a block — the server fault reaches Sentry');
        assert.equal(captured[0].message.includes('ECONNREFUSED'), true);
      },
    },

    {
      name: 'a-synchronous-handler-return-value-resolves-too',
      async run({ assert }) {
        const file = handlerFile('module.exports = () => ({ ok: true });');

        const outcome = await settle(events.run(makeOmega(), file, {}));

        assert.deepEqual(outcome.resolved, { ok: true });
      },
    },
  ],
});
