/**
 * Root `npm run test:auth`: the fast WIRE lane for the sign-in custom token,
 * library code called from node against the playground emulator.
 * The emulator seeds its personas; this lane's own (from the roster, signed in
 * with the test password, scripts/roster-persona.js) hands its ID token to the
 * REAL desktop `lib/auth.js` `_fetchCustomToken`, which trades it for a custom
 * token at POST /omega/user/token; that token must sign a second app instance
 * in on the SAME uid. The route's own wire contract lives in the backend's
 * route suite (test/routes/user/token.test.js); the real-surface proofs are
 * test/e2e/desktop-auth.test.js and test/e2e/extension-auth.test.js.
 * Knobs: OMEGA_SKIP_E2E=1 skips (matches the sibling e2e lanes).
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const path = require('path');
const { createRequire } = require('module');

const { startPlaygroundEmulator, stopPlaygroundEmulator, playgroundProjectId } = require('./_emulator');
const { signInPersona } = require('../../scripts/roster-persona');

const ROOT = path.join(__dirname, '..', '..');
const DESKTOP_SRC = path.join(ROOT, 'packages', 'desktop', 'src');
const LOG_DIR = path.join(ROOT, '.temp', 'auth-token-e2e');

// This lane's own seeded persona, never shared with another suite
const PERSONA_LOCALPART = '_test.auth-token-e2e';

module.exports = defineCases({
  type: 'suite',
  description: 'auth-token e2e (desktop/extension custom-token round trip)',
  timeout: 300000,

  setup(ctx) {
    if (process.env.OMEGA_SKIP_E2E === '1') ctx.skip('OMEGA_SKIP_E2E=1');
  },

  async cleanup(ctx) {
    await stopPlaygroundEmulator(ctx.state.emulator);
  },

  tests: [
    {
      name: 'playground emulator boots (auth, functions, hosting) and seeds its personas',
      run: async (ctx) => {
        const { child, ports } = await startPlaygroundEmulator({ logDir: LOG_DIR });
        ctx.state.emulator = child;
        ctx.state.ports = ports;
        console.log(`    hosting :${ports.hosting}, auth :${ports.auth}`);
      },
    },

    {
      name: 'the roster\'s persona signs in against the auth emulator with the test password',
      run: async (ctx) => {
        const { ports } = ctx.state;
        ctx.state.projectId = playgroundProjectId();

        ctx.state.user = await signInPersona({
          apiBase: `http://127.0.0.1:${ports.hosting}`,
          authPort: ports.auth,
          firebaseConfig: { apiKey: 'fake-api-key', projectId: ctx.state.projectId },
          localpart: PERSONA_LOCALPART,
        });
        console.log(`    ${ctx.state.user.email}, uid ${ctx.state.user.uid}`);
      },
    },

    {
      name: 'the REAL desktop auth fetches a custom token from /omega/user/token',
      run: async (ctx) => {
        const { ports, user } = ctx.state;
        // Real desktop modules: lib/auth.js, whose _fetchCustomToken is the caller
        // under test, and the real mode/url helpers it resolves its URL with. In
        // the testing environment getApiUrl() maps to the local hosting emulator
        // via the resolved-port env channel (N7).
        process.env.OMEGA_ENVIRONMENT = 'testing';
        process.env.OMEGA_HOSTING_PORT = String(ports.hosting);
        // A testing main process points its own Firebase Auth at the auth emulator on
        // this same channel (it never reaches real auth from here).
        process.env.OMEGA_AUTH_PORT = String(ports.auth);
        delete process.env.OMEGA_HTTPS_PORT;

        const desktopRequire = createRequire(path.join(ROOT, 'packages', 'desktop', 'package.json'));
        const auth = desktopRequire(path.join(DESKTOP_SRC, 'lib', 'auth.js'));
        const { getEnvironment } = desktopRequire(path.join(DESKTOP_SRC, 'utils', 'mode-helpers.js'));
        const { getApiUrl } = desktopRequire(path.join(DESKTOP_SRC, 'utils', 'url-helpers.js'));
        const { createRequest } = desktopRequire('@omega.js/client/modules/request.js');

        // The one call lib/auth.js makes on the main-process instance,
        // `omega.request()`, built the way src/main.js builds it: the same plain
        // URL helpers, and the e2e user's ID token where main reads its own session's
        const instance = {
          config: { brand: { id: 'playground' } },
          getEnvironment() { return getEnvironment.call(this); },
          getApiUrl(environment) { return getApiUrl(this, environment); },
        };
        instance.request = createRequest({
          getApiUrl: () => instance.getApiUrl(),
          getIdToken: (force) => user.getIdToken(force),
        });
        auth._omega = instance;

        const customToken = await auth._fetchCustomToken();
        ctx.expect(typeof customToken, 'custom token should be a string').toBe('string');
        ctx.expect(customToken.split('.').length, 'custom token should be a JWT').toBe(3);
        ctx.state.customToken = customToken;
      },
    },

    {
      name: 'the custom token signs in a second app instance on the SAME uid',
      run: async (ctx) => {
        const { ports, user, projectId, customToken } = ctx.state;
        // Real firebase client SDK, resolved from @omega.js/client's dependency tree
        const clientRequire = createRequire(path.join(ROOT, 'packages', 'client', 'package.json'));
        const { initializeApp } = clientRequire('firebase/app');
        const { getAuth, connectAuthEmulator, signInWithCustomToken } = clientRequire('firebase/auth');

        const app = initializeApp({ apiKey: 'fake-api-key', projectId }, 'auth-e2e-secondary');
        const auth = getAuth(app);
        connectAuthEmulator(auth, `http://127.0.0.1:${ports.auth}`, { disableWarnings: true });

        const credential = await signInWithCustomToken(auth, customToken);
        ctx.expect(credential.user.uid, 'round-tripped uid should match the original user').toBe(user.uid);
      },
    },
  ],
});
