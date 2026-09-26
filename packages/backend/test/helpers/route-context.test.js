/**
 * Test: the Context: its shape outside HTTP, and the response door, report()
 * plus respond()'s one-door error path
 *
 * Covers:
 *   - A Context built with no req/res (an event, a cron job) has `request`
 *     null, a signed-out `User` as `ctx.user`, and `data` undefined until the
 *     pipeline sets it.
 *   - authenticate() settles ONCE per request: a second call is the same
 *     answer, never a second token verification.
 *   - report(e, {code}) decorates WITHOUT sending: returns an Error carrying
 *     code/tag/usage/schema, clamps codes into 400-599, works with no res
 *     (trigger/cron contexts).
 *   - The Sentry rule: server faults (>= 500) capture automatically; client
 *     faults (4xx) never do. No per-call flags exist.
 *   - respond(error) routes through the same machinery (one door): the wire
 *     side (status, body, omega-properties header) is pinned by the route
 *     round-trip suites; this file pins the factory/capture semantics.
 *
 * Every case builds its Context on a REAL Omega instance booted from the
 * bundled fixture (test/helpers/_boot-omega.js), so the file runs with or
 * without an emulator.
 *
 * Run: npx omega test backend:helpers/route-context
 */
const Context = require('../../dist/omega/context.js');
const { User } = require('../../dist/omega/helpers/account.js');
const { bootOmega } = require('./_boot-omega.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

let booted = null;
const omega = () => (booted = booted || bootOmega());

// Run a thunk with a recording Sentry transport injected (the transport is the
// external boundary: the seam the framework itself null-checks in production
// when Sentry is disabled), restoring the original afterward.
function withSentryRecorder(instance, fn) {
  const captured = [];
  const original = instance.sentry;

  instance.sentry = { captureException: (e) => captured.push(e) };

  try {
    return fn(captured);
  } finally {
    instance.sentry = original;
  }
}

module.exports = defineCases({
  description: 'Context shape + report() + one-door error semantics',
  type: 'group',
  tests: [
    {
      name: 'a-context-with-no-request-is-signed-out-with-no-input',
      run: async ({ assert }) => {
        const ctx = new Context(omega());

        assert.equal(ctx.request, null, 'no req means no request');
        assert.equal(ctx.user instanceof User, true, 'ctx.user is a User');
        assert.equal(ctx.user.authenticated, false, 'signed out');
        assert.equal(ctx.user.plan, 'basic');
        assert.equal(ctx.data, undefined, 'data waits for the pipeline');

        ctx.data = { name: 'set' };
        assert.equal(ctx.data.name, 'set');
      },
    },
    {
      name: 'the-request-services-are-built-once-on-first-read',
      run: async ({ assert }) => {
        const ctx = new Context(omega());

        assert.equal(ctx.usage, ctx.usage, 'one counter per context');
        assert.equal(ctx.analytics, ctx.analytics, 'one analytics per context');
        assert.equal(ctx.email, ctx.email, 'one email door per context');
        assert.equal(ctx.ai, ctx.ai, 'one AI surface per context');
        assert.equal(ctx.usage.ctx, ctx, 'a request service is bound to its context');
      },
    },
    {
      name: 'authenticate-settles-once-per-request',
      run: async ({ assert }) => {
        const ctx = new Context(omega());

        const first = ctx.authenticate();
        const second = ctx.authenticate();

        assert.equal(first, second, 'the second call is the first answer');

        const user = await first;

        assert.equal(user, ctx.user, 'the answer is ctx.user');
        assert.equal(user.authenticated, false, 'no credential, no account');
      },
    },
    {
      name: 'report-returns-decorated-error-without-sending',
      run: async ({ assert }) => {
        const ctx = new Context(omega());

        const error = ctx.report('Something broke', { code: 502 });

        if (!(error instanceof Error)) assert.fail('report() must return an Error');
        assert.equal(error.message, 'Something broke');
        assert.equal(error.code, 502);
        assert.equal(typeof error.tag, 'string');
        assert.equal(typeof error.usage, 'object');
      },
    },
    {
      name: 'report-clamps-codes-into-error-range',
      run: async ({ assert }) => {
        const ctx = new Context(omega());

        assert.equal(ctx.report('x', { code: 200 }).code, 500);
        assert.equal(ctx.report('x', { code: 999 }).code, 500);
        assert.equal(ctx.report('x').code, 500);
        assert.equal(ctx.report('x', { code: 429 }).code, 429);
      },
    },
    {
      name: 'report-preserves-an-existing-error-code-unless-overridden',
      run: async ({ assert }) => {
        const ctx = new Context(omega());

        const carried = Object.assign(new Error('carried'), { code: 404 });
        assert.equal(ctx.report(carried).code, 404);

        const overridden = Object.assign(new Error('overridden'), { code: 404 });
        assert.equal(ctx.report(overridden, { code: 410 }).code, 410);
      },
    },
    {
      name: 'server-faults-capture-to-sentry-automatically',
      run: async ({ assert }) => {
        const ctx = new Context(omega());

        withSentryRecorder(omega(), (captured) => {
          ctx.report('boom', { code: 500 });
          assert.equal(captured.length, 1);
          assert.equal(captured[0].message, 'boom');
        });
      },
    },
    {
      name: 'client-faults-never-capture-to-sentry',
      run: async ({ assert }) => {
        const ctx = new Context(omega());

        withSentryRecorder(omega(), (captured) => {
          ctx.report('bad input', { code: 400 });
          ctx.report('limited', { code: 429 });
          assert.equal(captured.length, 0);
        });
      },
    },
    {
      name: 'report-survives-a-null-sentry-handle',
      run: async ({ assert }) => {
        const instance = omega();
        const ctx = new Context(instance);
        const original = instance.sentry;

        instance.sentry = null;
        try {
          const error = ctx.report('no sentry wired', { code: 503 });
          assert.equal(error.code, 503);
        } finally {
          instance.sentry = original;
        }
      },
    },
    {
      name: 'retired-surface-stays-retired',
      run: async ({ assert }) => {
        const ctx = new Context(omega());

        assert.equal(ctx.errorify, undefined);
        assert.equal(ctx.errorManager, undefined);
        assert.equal(ctx.logProd, undefined);
        assert.equal(ctx.parseRepo, undefined);
        assert.equal(ctx.getHeaderIp, undefined);
        assert.equal(ctx.ref, undefined, 'ctx.req/res/omega replace ctx.ref');
        assert.equal(ctx.getUser, undefined, 'ctx.user replaces getUser()');
        assert.equal(ctx.Manager, undefined, 'ctx.omega replaces ctx.Manager');
        assert.equal(ctx.resolvedUser, undefined, 'authenticate() settles once instead');
        assert.equal(ctx.constant, undefined, 'the pastTime constant is gone');
        assert.equal(ctx.settings, undefined, 'ctx.data replaces ctx.settings');
        assert.equal(ctx.parseMultipartFormData, undefined, 'parseMultipart() replaces it');
      },
    },
  ],
});
