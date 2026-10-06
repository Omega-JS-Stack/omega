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
const pipeline = require('../../dist/omega/pipeline.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

const { isDevOnlyRouteBlocked } = pipeline;

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

module.exports = defineCases({
  description: 'Health route (public liveness probe)',
  type: 'group',

  tests: [
    {
      name: 'serves-unauthenticated-with-the-full-payload',
      auth: 'none',
      async run({ http, expect }) {
        const response = await http.as('none').get('omega/health');

        expect(response, 'The liveness probe should answer without auth').toBeSuccess();
        expect(response, 'It should report healthy').toHaveProperty('data.status', 'healthy');

        for (const key of PAYLOAD_KEYS) {
          expect(response, `The payload should carry ${key}`).toHaveProperty(`data.${key}`);
        }

        expect(Object.keys(response.data).sort(), 'The payload should be exactly the documented fields').toEqual([...PAYLOAD_KEYS].sort());

        // @omega.js/manager's live API check compares the deployed version to
        // the npm latest, and the test runner reads the mode off this payload
        expect(response.data.version, 'version should be a string').toBeTypeOf('string');
        expect(response.data.backendVersion, 'backendVersion should be a string').toBeTypeOf('string');
        expect(response.data.testExtendedMode, 'testExtendedMode should be a boolean').toBeTypeOf('boolean');
        expect(['development', 'testing', 'production'], 'environment should be a resolved environment').toContain(response.data.environment);
        expect(response.data.timestamp, 'timestamp should be an ISO string').toMatch(/^\d{4}-\d{2}-\d{2}T/);
      },
    },

    {
      name: 'echoes-no-request-input',
      auth: 'none',
      async run({ http, expect }) {
        // A public, unauthenticated endpoint that reflected anything a caller
        // sent would be a free open-reflection surface on a production host —
        // the property that made the old carve-out defensible, kept here.
        const response = await http.as('none').get('omega/health', {
          status: 'pwned',
          projectId: 'evil-project',
          environment: 'production',
          injected: '<script>alert(1)</script>',
        });

        expect(response, 'Unknown params should not break the probe').toBeSuccess();
        expect(response, 'status is the route\'s own, not the caller\'s').toHaveProperty('data.status', 'healthy');
        expect(response.data.projectId, 'projectId is read from config, never echoed').not.toBe('evil-project');
        expect(response.data.environment, 'environment is resolved, never echoed').not.toBe('production');
        expect(Object.keys(response.data).sort(), 'No caller-supplied key should appear in the payload').toEqual([...PAYLOAD_KEYS].sort());
      },
    },

    {
      name: 'answers-in-production-and-under-the-emulator',
      async run({ expect }) {
        // The folder gate is a pure decision over (route, environment), so the
        // production leg is provable here — the emulator only ever runs
        // development/testing.
        for (const environment of ['production', 'development', 'testing']) {
          expect(isDevOnlyRouteBlocked('health', environment), `The liveness probe must answer in ${environment}`).toBe(false);
        }
      },
    },
  ],
});
