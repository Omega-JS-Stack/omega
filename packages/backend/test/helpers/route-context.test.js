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
      run: async ({ expect }) => {
        const ctx = new Context(omega());

        expect(ctx.request, 'no req means no request').toBe(null);
        expect(ctx.user instanceof User, 'ctx.user is a User').toBe(true);
        expect(ctx.user.authenticated, 'signed out').toBe(false);
        expect(ctx.user.plan).toBe('basic');
        expect(ctx.data, 'data waits for the pipeline').toBe(undefined);

        ctx.data = { name: 'set' };
        expect(ctx.data.name).toBe('set');
      },
    },
    {
      name: 'the-request-services-are-built-once-on-first-read',
      run: async ({ expect }) => {
        const ctx = new Context(omega());

        expect(ctx.usage, 'one counter per context').toBe(ctx.usage);
        expect(ctx.analytics, 'one analytics per context').toBe(ctx.analytics);
        expect(ctx.email, 'one email door per context').toBe(ctx.email);
        expect(ctx.ai, 'one AI surface per context').toBe(ctx.ai);
        expect(ctx.usage.ctx, 'a request service is bound to its context').toBe(ctx);
      },
    },
    {
      name: 'authenticate-settles-once-per-request',
      run: async ({ expect }) => {
        const ctx = new Context(omega());

        const first = ctx.authenticate();
        const second = ctx.authenticate();

        expect(first, 'the second call is the first answer').toBe(second);

        const user = await first;

        expect(user, 'the answer is ctx.user').toBe(ctx.user);
        expect(user.authenticated, 'no credential, no account').toBe(false);
      },
    },
    {
      name: 'report-returns-decorated-error-without-sending',
      run: async ({ expect }) => {
        const ctx = new Context(omega());

        const error = ctx.report('Something broke', { code: 502 });

        if (!(error instanceof Error)) expect.fail('report() must return an Error');
        expect(error.message).toBe('Something broke');
        expect(error.code).toBe(502);
        expect(typeof error.tag).toBe('string');
        expect(typeof error.usage).toBe('object');
      },
    },
    {
      name: 'report-clamps-codes-into-error-range',
      run: async ({ expect }) => {
        const ctx = new Context(omega());

        expect(ctx.report('x', { code: 200 }).code).toBe(500);
        expect(ctx.report('x', { code: 999 }).code).toBe(500);
        expect(ctx.report('x').code).toBe(500);
        expect(ctx.report('x', { code: 429 }).code).toBe(429);
      },
    },
    {
      name: 'report-preserves-an-existing-error-code-unless-overridden',
      run: async ({ expect }) => {
        const ctx = new Context(omega());

        const carried = Object.assign(new Error('carried'), { code: 404 });
        expect(ctx.report(carried).code).toBe(404);

        const overridden = Object.assign(new Error('overridden'), { code: 404 });
        expect(ctx.report(overridden, { code: 410 }).code).toBe(410);
      },
    },
    {
      name: 'server-faults-capture-to-sentry-automatically',
      run: async ({ expect }) => {
        const ctx = new Context(omega());

        withSentryRecorder(omega(), (captured) => {
          ctx.report('boom', { code: 500 });
          expect(captured.length).toBe(1);
          expect(captured[0].message).toBe('boom');
        });
      },
    },
    {
      name: 'client-faults-never-capture-to-sentry',
      run: async ({ expect }) => {
        const ctx = new Context(omega());

        withSentryRecorder(omega(), (captured) => {
          ctx.report('bad input', { code: 400 });
          ctx.report('limited', { code: 429 });
          expect(captured.length).toBe(0);
        });
      },
    },
    {
      name: 'report-survives-a-null-sentry-handle',
      run: async ({ expect }) => {
        const instance = omega();
        const ctx = new Context(instance);
        const original = instance.sentry;

        instance.sentry = null;
        try {
          const error = ctx.report('no sentry wired', { code: 503 });
          expect(error.code).toBe(503);
        } finally {
          instance.sentry = original;
        }
      },
    },
    {
      name: 'retired-surface-stays-retired',
      run: async ({ expect }) => {
        const ctx = new Context(omega());

        expect(ctx.errorify).toBe(undefined);
        expect(ctx.errorManager).toBe(undefined);
        expect(ctx.logProd).toBe(undefined);
        expect(ctx.parseRepo).toBe(undefined);
        expect(ctx.getHeaderIp).toBe(undefined);
        expect(ctx.ref, 'ctx.req/res/omega replace ctx.ref').toBe(undefined);
        expect(ctx.getUser, 'ctx.user replaces getUser()').toBe(undefined);
        expect(ctx.Manager, 'ctx.omega replaces ctx.Manager').toBe(undefined);
        expect(ctx.resolvedUser, 'authenticate() settles once instead').toBe(undefined);
        expect(ctx.constant, 'the pastTime constant is gone').toBe(undefined);
        expect(ctx.settings, 'ctx.data replaces ctx.settings').toBe(undefined);
        expect(ctx.parseMultipartFormData, 'parseMultipart() replaces it').toBe(undefined);
      },
    },
  ],
});
