/**
 * Test: RouteContext response door — report() + respond()'s one-door error path
 *
 * Covers the cp263 semantics:
 *   - report(e, {code}) decorates WITHOUT sending: returns an Error carrying
 *     code/tag/usage/schema, clamps codes into 400-599, works with no res
 *     (trigger/cron contexts).
 *   - The Sentry rule: server faults (>= 500) capture automatically; client
 *     faults (4xx) never do. No per-call flags exist.
 *   - respond(error) routes through the same machinery (one door) — the wire
 *     side (status, body, omega-properties header) is pinned by the route
 *     round-trip suites; this file pins the factory/capture semantics.
 *
 * Run: npx omega test backend:helpers/route-context
 */

// Run a thunk with a recording Sentry transport injected (the transport is the
// external boundary — the seam the framework itself null-checks in production
// when Sentry is disabled), restoring the original afterward.
function withSentryRecorder(Manager, fn) {
  const captured = [];
  const original = Manager.libraries.sentry;

  Manager.libraries.sentry = { captureException: (e) => captured.push(e) };

  try {
    return fn(captured);
  } finally {
    Manager.libraries.sentry = original;
  }
}

module.exports = {
  description: 'RouteContext report() + one-door error semantics',
  type: 'group',
  tests: [
    {
      name: 'report-returns-decorated-error-without-sending',
      run: async ({ assert, Manager }) => {
        const ctx = Manager.RouteContext({});

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
      run: async ({ assert, Manager }) => {
        const ctx = Manager.RouteContext({});

        assert.equal(ctx.report('x', { code: 200 }).code, 500);
        assert.equal(ctx.report('x', { code: 999 }).code, 500);
        assert.equal(ctx.report('x').code, 500);
        assert.equal(ctx.report('x', { code: 429 }).code, 429);
      },
    },
    {
      name: 'report-preserves-an-existing-error-code-unless-overridden',
      run: async ({ assert, Manager }) => {
        const ctx = Manager.RouteContext({});

        const carried = Object.assign(new Error('carried'), { code: 404 });
        assert.equal(ctx.report(carried).code, 404);

        const overridden = Object.assign(new Error('overridden'), { code: 404 });
        assert.equal(ctx.report(overridden, { code: 410 }).code, 410);
      },
    },
    {
      name: 'server-faults-capture-to-sentry-automatically',
      run: async ({ assert, Manager }) => {
        const ctx = Manager.RouteContext({});

        withSentryRecorder(Manager, (captured) => {
          ctx.report('boom', { code: 500 });
          assert.equal(captured.length, 1);
          assert.equal(captured[0].message, 'boom');
        });
      },
    },
    {
      name: 'client-faults-never-capture-to-sentry',
      run: async ({ assert, Manager }) => {
        const ctx = Manager.RouteContext({});

        withSentryRecorder(Manager, (captured) => {
          ctx.report('bad input', { code: 400 });
          ctx.report('limited', { code: 429 });
          assert.equal(captured.length, 0);
        });
      },
    },
    {
      name: 'report-survives-a-null-sentry-library',
      run: async ({ assert, Manager }) => {
        const ctx = Manager.RouteContext({});
        const original = Manager.libraries.sentry;

        Manager.libraries.sentry = null;
        try {
          const error = ctx.report('no sentry wired', { code: 503 });
          assert.equal(error.code, 503);
        } finally {
          Manager.libraries.sentry = original;
        }
      },
    },
    {
      name: 'retired-surface-stays-retired',
      run: async ({ assert, Manager }) => {
        const ctx = Manager.RouteContext({});

        assert.equal(ctx.errorify, undefined);
        assert.equal(ctx.errorManager, undefined);
        assert.equal(ctx.logProd, undefined);
        assert.equal(ctx.parseRepo, undefined);
        assert.equal(ctx.getHeaderIp, undefined);
        assert.equal(Manager.Assistant, undefined);
      },
    },
  ],
};
