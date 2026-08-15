/**
 * Test: GET /health — the deployed backend's liveness probe
 *
 * The liveness + version endpoint used to live at `test/health`, inside the
 * development-only route folder, and needed a carve-out in the folder gate to
 * answer on a production host. A liveness probe is not a test route: it is now
 * a REAL route at `/omega/health`, so the dev-only folder has zero exceptions
 * ([#238](https://github.com/Omega-JS-Stack/omega/issues/238)).
 *
 * Run: npx omega test framework:routes/health
 *
 * The wiring half round-trips over real HTTP against the emulator. The
 * "answers in production" half is the folder gate's pure decision — the same
 * technique test/helpers/dev-only-routes.test.js uses, because no emulator
 * runs in a production environment.
 */
const Middleware = require('../../src/manager/helpers/middleware.js');

const { isDevOnlyRouteBlocked } = Middleware;

// Everything the probe reports, and nothing else — the payload is a fixed set,
// which is also what makes it echo-proof
const PAYLOAD_KEYS = [
  'status',
  'timestamp',
  'environment',
  'projectId',
  'version',
  'backendVersion',
  'testExtendedMode',
];

module.exports = {
  description: 'Health route (public liveness probe)',
  type: 'group',

  tests: [
    {
      name: 'serves-unauthenticated-with-the-full-payload',
      auth: 'none',
      async run({ http, assert }) {
        const response = await http.as('none').get('omega/health');

        assert.isSuccess(response, 'The liveness probe should answer without auth');
        assert.propertyEquals(response, 'data.status', 'healthy', 'It should report healthy');

        for (const key of PAYLOAD_KEYS) {
          assert.hasProperty(response, `data.${key}`, `The payload should carry ${key}`);
        }

        assert.deepEqual(
          Object.keys(response.data).sort(),
          [...PAYLOAD_KEYS].sort(),
          'The payload should be exactly the documented fields'
        );

        // @omega.js/manager's live API check compares the deployed version to
        // the npm latest, and the test runner reads the mode off this payload
        assert.isType(response.data.version, 'string', 'version should be a string');
        assert.isType(response.data.backendVersion, 'string', 'backendVersion should be a string');
        assert.isType(response.data.testExtendedMode, 'boolean', 'testExtendedMode should be a boolean');
        assert.contains(['development', 'testing', 'production'], response.data.environment, 'environment should be a resolved environment');
        assert.match(response.data.timestamp, /^\d{4}-\d{2}-\d{2}T/, 'timestamp should be an ISO string');
      },
    },

    {
      name: 'echoes-no-request-input',
      auth: 'none',
      async run({ http, assert }) {
        // A public, unauthenticated endpoint that reflected anything a caller
        // sent would be a free open-reflection surface on a production host —
        // the property that made the old carve-out defensible, kept here.
        const response = await http.as('none').get('omega/health', {
          status: 'pwned',
          projectId: 'evil-project',
          environment: 'production',
          injected: '<script>alert(1)</script>',
        });

        assert.isSuccess(response, 'Unknown params should not break the probe');
        assert.propertyEquals(response, 'data.status', 'healthy', 'status is the route\'s own, not the caller\'s');
        assert.notEqual(response.data.projectId, 'evil-project', 'projectId is read from config, never echoed');
        assert.notEqual(response.data.environment, 'production', 'environment is resolved, never echoed');
        assert.deepEqual(
          Object.keys(response.data).sort(),
          [...PAYLOAD_KEYS].sort(),
          'No caller-supplied key should appear in the payload'
        );
      },
    },

    {
      name: 'answers-in-production-and-under-the-emulator',
      async run({ assert }) {
        // The folder gate is a pure decision over (route, environment), so the
        // production leg is provable here — the emulator only ever runs
        // development/testing.
        for (const environment of ['production', 'development', 'testing']) {
          assert.equal(
            isDevOnlyRouteBlocked('health', environment),
            false,
            `The liveness probe must answer in ${environment}`
          );
        }
      },
    },
  ],
};
