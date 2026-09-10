/**
 * Test: the development-only route folder gate (#238)
 *
 * `routes/test/*` exists to exercise the framework — it echoes the settings
 * engine, increments a usage counter, reflects a redirect, resets a seeded
 * persona — and none of it belongs at a production URL. ONE guard in
 * Middleware.run() covers the whole folder, so a NEW test route is gated the
 * day it lands instead of the day somebody remembers to copy a guard.
 *
 * Run: npx omega test framework:helpers/dev-only-routes
 *
 * The decision is pure (route name + environment), so it runs here directly
 * with the REAL Manager resolving the environment — nothing is hand-rolled.
 * The wiring half is proven by the emulator itself: every `test/routes/test/*`
 * suite still round-trips green, which is the "still serves under the
 * emulator" leg.
 */
const fs = require('fs');
const path = require('path');
const Middleware = require('../../dist/manager/helpers/middleware.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

const { isDevOnlyRouteBlocked, isRouteOutsideRoutesDir, DEV_ONLY_ROUTE_FOLDER } = Middleware;

const ROUTES_DIR = path.resolve(__dirname, '../../dist/manager/routes');

// Every route the framework ships in the dev-only folder, read off DISK rather
// than listed here — a route added tomorrow joins this test automatically.
function listDevOnlyRoutes() {
  const dir = path.join(ROUTES_DIR, DEV_ONLY_ROUTE_FOLDER);
  const names = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      names.push(`${DEV_ONLY_ROUTE_FOLDER}/${entry.name}`);
    } else if (entry.name === 'index.js') {
      names.push(DEV_ONLY_ROUTE_FOLDER);
    }
  }

  return names;
}

// The env-detection vars are getEnvironment()'s only inputs — clear them for a
// clean slate per case, and restore afterward (mirrors helpers/environment).
function withEnv(overrides, fn) {
  const KEYS = ['OMEGA_TEST_MODE', 'ENVIRONMENT', 'FUNCTIONS_EMULATOR', 'TERM_PROGRAM'];
  const saved = {};
  for (const k of KEYS) saved[k] = process.env[k];
  try {
    for (const k of KEYS) delete process.env[k];
    for (const k of Object.keys(overrides)) process.env[k] = overrides[k];
    return fn();
  } finally {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

module.exports = defineCases({
  description: 'Development-only route folder gate',
  type: 'group',

  tests: [
    {
      name: 'the folder is not empty — the disk read this suite depends on works',
      async run({ assert }) {
        const routes = listDevOnlyRoutes();

        assert.ok(routes.length > 1, `Expected several ${DEV_ONLY_ROUTE_FOLDER}/ routes, got ${routes.length}`);
        assert.contains(routes, 'test/usage', 'the usage route is one of them');
        assert.contains(routes, 'test/redirect', 'and the redirect route');
      },
    },

    {
      name: 'every route in the dev-only folder is refused in production',
      async run({ Manager, assert }) {
        withEnv({ ENVIRONMENT: 'production' }, () => {
          const environment = Manager.getEnvironment();
          assert.equal(environment, 'production', 'the real Manager resolves production');

          for (const route of listDevOnlyRoutes()) {
            assert.equal(
              isDevOnlyRouteBlocked(route, environment),
              true,
              `${route} should be refused in production`
            );
          }
        });
      },
    },

    {
      name: 'a route added to the folder later is refused without touching the guard',
      async run({ Manager, assert }) {
        withEnv({ ENVIRONMENT: 'production' }, () => {
          // Not a file that exists — the point is that the gate keys off the
          // FOLDER, so a handler nobody has written yet is already covered.
          assert.equal(
            isDevOnlyRouteBlocked(`${DEV_ONLY_ROUTE_FOLDER}/some-future-debug-route`, Manager.getEnvironment()),
            true,
            'a not-yet-written test route is gated by default'
          );
        });
      },
    },

    {
      name: 'the same routes serve under the emulator (development AND testing)',
      async run({ Manager, assert }) {
        const scenarios = [
          { env: { FUNCTIONS_EMULATOR: 'true' }, expect: 'development' },
          { env: { OMEGA_TEST_MODE: 'true' }, expect: 'testing' },
        ];

        for (const scenario of scenarios) {
          withEnv(scenario.env, () => {
            const environment = Manager.getEnvironment();
            assert.equal(environment, scenario.expect, `the real Manager resolves ${scenario.expect}`);

            for (const route of listDevOnlyRoutes()) {
              assert.equal(
                isDevOnlyRouteBlocked(route, environment),
                false,
                `${route} must still serve in ${scenario.expect}`
              );
            }
          });
        }
      },
    },

    {
      name: 'test/health is no carve-out either — the folder gate has none',
      async run({ Manager, assert }) {
        // It WAS the one exception: @omega.js/manager's live API check read it
        // on a PRODUCTION host, so gating it would have broken `omega manage`
        // against a real brand. The probe is a REAL route now (`routes/health`,
        // covered by test/routes/health.test.js) and every reader points there,
        // so the exception list — and the mechanism behind it — is gone.
        assert.equal(Middleware.DEV_ONLY_ROUTE_EXCEPTIONS, undefined, 'the exception mechanism is gone, not just emptied');

        withEnv({ ENVIRONMENT: 'production' }, () => {
          assert.equal(isDevOnlyRouteBlocked('test/health', Manager.getEnvironment()), true, 'the old probe path is refused in production like every other test route');
        });
      },
    },

    {
      name: 'routes outside the folder are never gated',
      async run({ Manager, assert }) {
        withEnv({ ENVIRONMENT: 'production' }, () => {
          const environment = Manager.getEnvironment();

          for (const route of ['', 'user/sign-up', 'payments/intent', 'general/uuid', 'testing/thing', 'contest']) {
            assert.equal(
              isDevOnlyRouteBlocked(route, environment),
              false,
              `${route || '<root>'} is a real route and must answer in production`
            );
          }
        });
      },
    },

    {
      name: 'the URL shapes the function path hands in are normalized before the check',
      async run({ Manager, assert }) {
        withEnv({ ENVIRONMENT: 'production' }, () => {
          const environment = Manager.getEnvironment();

          // BackendRouter takes routePath straight off the request URL, so a
          // trailing slash, a .js suffix or a case variant must not walk past
          // the gate.
          for (const route of ['test/usage', 'test/usage/', '/test/usage', 'test/usage.js', 'TEST/usage', 'Test/Usage']) {
            assert.equal(isDevOnlyRouteBlocked(route, environment), true, `${route} is refused in production`);
          }

          // Dot segments: the loader's path.resolve() collapses these to
          // routes/test/usage, so the gate has to read them the same way or a
          // caller reaches the handler with a `./` in front of it.
          for (const route of ['./test/usage', './/test/usage', 'x/../test/usage', './/./test/usage']) {
            assert.equal(isDevOnlyRouteBlocked(route, environment), true, `${route} resolves into the folder and is refused`);
          }
        });
      },
    },

    {
      name: 'a route path may not escape the routes directory',
      async run({ assert }) {
        // path.resolve() rewrites the path the loader require()s, so these are
        // refused on their SHAPE — environment plays no part.
        const escaping = [
          // Climbs out: `/omega/../schemas/test/usage` require()s a schema
          // module as a handler.
          '../schemas/test/usage',
          '../../etc/passwd',
          // Climbs out and back IN — resolves to routes/test/usage, so the
          // folder gate alone never sees a `test` first segment.
          '../routes/test/usage',
          // Absolute: path.resolve() would hand it the whole filesystem.
          '/schemas/test/usage',
          '//schemas/test/usage',
        ];

        for (const route of escaping) {
          assert.equal(isRouteOutsideRoutesDir(route), true, `${route} must be refused before the loader sees it`);
        }
      },
    },

    {
      name: 'ordinary route paths are not mistaken for an escape',
      async run({ assert }) {
        for (const route of ['', 'test/usage', './test/usage', 'x/../test/usage', 'user/sign-up', 'general/uuid', 'items/export']) {
          assert.equal(isRouteOutsideRoutesDir(route), false, `${route || '<root>'} stays inside the routes directory`);
        }
      },
    },
  ],
});
