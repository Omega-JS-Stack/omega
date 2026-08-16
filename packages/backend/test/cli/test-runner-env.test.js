/**
 * Test: the env the test runner child is spawned with
 * ([#292](https://github.com/Omega-JS-Stack/omega/issues/292)).
 *
 * The command carried the two emulator hosts but never the PROJECT they belong
 * to, so the runner's `process.env.GCLOUD_PROJECT` was empty and every read of
 * it downstream fell back to a default — including the auth bulk-clear URL,
 * which the emulator answers 200 for whatever project it names. The wipe
 * reported success and cleared a store the run never touched.
 *
 * Run: npx omega test backend:cli/test-runner-env
 *
 * The command builder is pure (a resolved test config in, a shell string out),
 * so this runs here directly — the wipe's own behavior against a real emulator
 * is proven in helpers/wipe-auth-project.
 */
const TestCommand = require('../../src/cli/commands/test.js');

const PROJECT_ID = 'demo-omega-backend';

// A resolved test config the way execute() builds one (loadProjectConfig has
// already hard-failed on a missing cloud.config.projectId by this point).
const TEST_CONFIG = {
  cloud: { config: { projectId: PROJECT_ID } },
  apiUrl: 'http://127.0.0.1:5002',
  projectDir: '/tmp/omega-fixture',
  testPaths: [],
  emulatorPorts: { firestore: 8080, auth: 9099, hosting: 5002 },
};

function buildCommand(testConfig) {
  const command = new TestCommand({ firebaseProjectPath: testConfig.projectDir, argv: {}, options: {} });

  return command.buildTestCommand(testConfig);
}

module.exports = {
  description: 'the test runner child is told which project it is testing',
  type: 'group',

  tests: [
    {
      name: 'the-command-exports-gcloud-project-from-the-resolved-config',
      run({ assert }) {
        assert.match(buildCommand(TEST_CONFIG), new RegExp(`GCLOUD_PROJECT='${PROJECT_ID}'`));
      },
    },

    {
      name: 'the-emulator-hosts-still-ride-along-with-it',
      run({ assert }) {
        const command = buildCommand(TEST_CONFIG);

        assert.match(command, /FIRESTORE_EMULATOR_HOST='127\.0\.0\.1:8080'/);
        assert.match(command, /FIREBASE_AUTH_EMULATOR_HOST='127\.0\.0\.1:9099'/);
      },
    },

    {
      name: 'bumped-ports-and-the-project-id-travel-together',
      run({ assert }) {
        // The auto-start path rebuilds the command from the RESOLVED ports after
        // boot; the project id is the same either way.
        const command = buildCommand({
          ...TEST_CONFIG,
          emulatorPorts: { firestore: 8081, auth: 9100, hosting: 5003 },
        });

        assert.match(command, new RegExp(`GCLOUD_PROJECT='${PROJECT_ID}'`));
        assert.match(command, /FIREBASE_AUTH_EMULATOR_HOST='127\.0\.0\.1:9100'/);
      },
    },

    // ─── the stack the runner's own URL getters resolve
    // ([#291](https://github.com/Omega-JS-Stack/omega/issues/291)) ───

    {
      name: 'the-resolved-port-map-rides-along-with-the-command',
      run({ assert }) {
        // Journey tests call route handlers IN-PROCESS, so the runner's Manager
        // builds URLs from OMEGA_*_PORT exactly like a function worker does.
        // Unset, every getter fell back to the classic defaults and answered for
        // a stack that may not be there.
        const command = buildCommand({
          ...TEST_CONFIG,
          emulatorPorts: { firestore: 8081, auth: 9100, hosting: 5003, functions: 5004 },
        });

        assert.match(command, /OMEGA_HOSTING_PORT='5003'/);
        assert.match(command, /OMEGA_FUNCTIONS_PORT='5004'/);
        assert.match(command, /OMEGA_FIRESTORE_PORT='8081'/);
      },
    },

    {
      name: 'the-https-front-is-never-handed-to-the-runner',
      run({ assert }) {
        // `omega emulator` defaults HTTPS on: hosting moves to an internal plain
        // port and the mkcert proxy takes the classic one. The runner has no CA
        // for that cert — handed the TLS port it would send the test processor's
        // auto-webhook through the proxy and fail on the handshake, so it gets
        // hosting's INTERNAL port and nothing else.
        const command = buildCommand({
          ...TEST_CONFIG,
          apiUrl: 'http://127.0.0.1:5443',
          emulatorPorts: { firestore: 8080, auth: 9099, hosting: 5443, https: 5002 },
        });

        assert.match(command, /OMEGA_HOSTING_PORT='5443'/);
        assert.notMatch(command, /OMEGA_HTTPS_PORT/);
      },
    },
  ],
};
