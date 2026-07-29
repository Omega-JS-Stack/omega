/**
 * Test: helpers/event-middleware.js — event trigger handler dispatch
 *
 * Run: npx omega test backend:helpers/event-middleware
 *
 * EventMiddleware is the door every auth/firestore/cron trigger enters:
 * resolve a handler path, build the event context, run pre/post hooks around
 * it, and translate failures. All of that is decidable without an emulator —
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
const EventMiddleware = require('../../src/manager/helpers/event-middleware.js');

// Write a handler file and return its absolute path.
function handlerFile(source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-backend-events-'));
  const file = path.join(dir, 'handler.js');
  fs.writeFileSync(file, source);
  return file;
}

// The Manager surface EventMiddleware reads: cwd, libraries, handlers, and
// a RouteContext with the log/error/meta.name shape it uses.
function makeManager({ cwd, handlers, name } = {}) {
  const errors = [];
  return {
    cwd: cwd || '/nonexistent-cwd',
    libraries: { marker: 'libs' },
    handlers,
    errors,
    RouteContext: () => ({
      log: () => {},
      error: (...args) => errors.push(args),
      meta: { name: name || 'unnamed' },
    }),
  };
}

// Resolve/reject of run(), flattened for assertion.
async function settle(promise) {
  try {
    return { resolved: await promise };
  } catch (e) {
    return { rejected: e };
  }
}

module.exports = {
  description: 'EventMiddleware handler dispatch + hooks',
  type: 'group',

  tests: [
    // ─── Handler resolution ───

    {
      name: 'an-absolute-handler-name-is-used-verbatim',
      async run({ assert }) {
        const file = handlerFile('module.exports = async () => "ran";');

        const outcome = await settle(new EventMiddleware(makeManager(), {}).run(file));

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
          new EventMiddleware(makeManager({ cwd }), {}).run('users__on-create'),
        );

        assert.equal(outcome.resolved, 'from-events-dir');
      },
    },

    {
      name: 'a-missing-handler-rejects-and-is-logged-not-swallowed',
      async run({ assert }) {
        const Manager = makeManager();

        const outcome = await settle(new EventMiddleware(Manager, {}).run('does/not/exist'));

        assert.equal(outcome.rejected instanceof Error, true);
        assert.equal(outcome.rejected.code, 'MODULE_NOT_FOUND');
        assert.equal(Manager.errors.length, 1, 'the load failure is reported');
        assert.equal(String(Manager.errors[0][0]).includes('Failed to load handler'), true);
      },
    },

    // ─── The context handed to a handler ───

    {
      name: 'the-handler-receives-manager-ctx-libraries-and-the-event-payload',
      async run({ assert }) {
        const file = handlerFile(`module.exports = async (context) => ({
          hasManager: !!context.Manager,
          hasCtx: typeof context.ctx.log === 'function',
          libraries: context.libraries.marker,
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

        const outcome = await settle(new EventMiddleware(makeManager(), payload).run(file));

        assert.deepEqual(outcome.resolved, {
          hasManager: true,
          hasCtx: true,
          libraries: 'libs',
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

        const outcome = await settle(new EventMiddleware(makeManager(), {}).run(file));

        assert.equal(outcome.resolved, 'Manager,change,context,ctx,libraries,snapshot,user');
      },
    },

    // ─── Hooks ───

    {
      name: 'the-named-hook-runs-pre-then-handler-then-post',
      async run({ assert }) {
        const order = [];
        const file = handlerFile('module.exports = async () => "handled";');
        const Manager = makeManager({
          name: 'users/on-create',
          handlers: { 'users/on-create': async (context, phase) => order.push(phase) },
        });

        const outcome = await settle(new EventMiddleware(Manager, {}).run(file));

        assert.deepEqual(order, ['pre', 'post']);
        assert.equal(outcome.resolved, 'handled');
      },
    },

    {
      name: 'only-the-hook-registered-under-this-events-name-runs',
      async run({ assert }) {
        const called = [];
        const file = handlerFile('module.exports = async () => "handled";');
        const Manager = makeManager({
          name: 'users/on-create',
          handlers: {
            'users/on-create': async () => called.push('mine'),
            'users/on-delete': async () => called.push('theirs'),
          },
        });

        await settle(new EventMiddleware(Manager, {}).run(file));

        assert.deepEqual(called, ['mine', 'mine']);
      },
    },

    {
      name: 'a-throwing-pre-hook-blocks-the-handler',
      async run({ assert }) {
        const file = handlerFile('module.exports = async () => { throw new Error("handler ran"); };');
        const Manager = makeManager({
          name: 'users/on-create',
          handlers: {
            'users/on-create': async (context, phase) => {
              if (phase === 'pre') throw new Error('blocked by pre hook');
            },
          },
        });

        const outcome = await settle(new EventMiddleware(Manager, {}).run(file));

        assert.equal(outcome.rejected.message, 'blocked by pre hook');
      },
    },

    // ─── Failure translation ───

    {
      name: 'a-plain-handler-error-rejects-and-is-logged',
      async run({ assert }) {
        const file = handlerFile('module.exports = async () => { throw new Error("handler blew up"); };');
        const Manager = makeManager();

        const outcome = await settle(new EventMiddleware(Manager, {}).run(file));

        assert.equal(outcome.rejected.message, 'handler blew up');
        assert.equal(Manager.errors.length, 1);
        assert.equal(String(Manager.errors[0][0]).includes('Handler error'), true);
      },
    },

    {
      name: 'an-auth-style-error-rethrows-untouched-and-unlogged',
      async run({ assert }) {
        const file = handlerFile(`module.exports = async () => {
          const e = new Error('permission-denied');
          e.code = 'permission-denied';
          throw e;
        };`);
        const Manager = makeManager();

        const outcome = await settle(new EventMiddleware(Manager, {}).run(file));

        assert.equal(outcome.rejected.code, 'permission-denied');
        assert.equal(Manager.errors.length, 0, 'a blocking auth error is not a framework fault');
      },
    },

    {
      name: 'an-httpErrorCode-error-also-rethrows-unlogged',
      async run({ assert }) {
        const file = handlerFile(`module.exports = async () => {
          const e = new Error('unauthenticated');
          e.httpErrorCode = { status: 401 };
          throw e;
        };`);
        const Manager = makeManager();

        const outcome = await settle(new EventMiddleware(Manager, {}).run(file));

        assert.equal(outcome.rejected.message, 'unauthenticated');
        assert.equal(Manager.errors.length, 0);
      },
    },

    {
      name: 'a-synchronous-handler-return-value-resolves-too',
      async run({ assert }) {
        const file = handlerFile('module.exports = () => ({ ok: true });');

        const outcome = await settle(new EventMiddleware(makeManager(), {}).run(file));

        assert.deepEqual(outcome.resolved, { ok: true });
      },
    },
  ],
};
