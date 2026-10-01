/**
 * The sign-in lanes' one way to a user: a persona the backend emulator seeded,
 * found through the roster route and signed in with the fixed test password.
 *
 * Each lane names its OWN machinery persona (packages/backend's
 * lane-accounts.js) by localpart and makes one call here, which asks
 * `GET /omega/test/roster?machinery=true` for it against the playground backend.
 * No lane creates an account, and no lane reads a credential from the environment.
 */
const path = require('path');
const { createRequire } = require('module');
const { resolvedBrandHost, composeTargetConfig } = require('@omega.js/config');
const { TEST_ACCOUNT_PASSWORD } = require('../packages/backend/src/test/test-accounts.js');

const ROOT = path.join(__dirname, '..');
// The backend every sign-in lane boots, and so the seeder's domain source
const PLAYGROUND_BACKEND = path.join(ROOT, 'brands', 'playground-omega', 'targets', 'backend');

/**
 * A seeded persona's email: its localpart on the brand's HOST, the seeder's own
 * derivation, so the address is the one the account was seeded on.
 * @param {object} config - The brand's resolved backend config.
 * @param {string} localpart - The persona's localpart, e.g. `_test.basic`.
 * @returns {string} The persona's email.
 */
function personaEmail(config, localpart) {
  const host = resolvedBrandHost(config);
  if (!host) {
    throw new Error('brand.url is missing: persona emails cannot be derived');
  }

  return `${localpart}@${host}`;
}

/**
 * The lane's persona, as the running playground backend's roster offers it.
 * @param {object} options
 * @param {string} options.apiBase - The hosting emulator origin (`http://127.0.0.1:<port>`).
 * @param {string} options.localpart - The persona's localpart, e.g. `_test.desktop-auth-e2e`.
 * @returns {Promise<{ email: string, password: string }>} How the persona signs in.
 */
async function fetchRosterPersona({ apiBase, localpart }) {
  const response = await fetch(`${apiBase}/omega/test/roster?machinery=true`);
  if (response.status !== 200) {
    throw new Error(`GET /omega/test/roster should 200 (got ${response.status})`);
  }

  const { personas } = await response.json();
  if (!personas.some((persona) => persona.localpart === localpart)) {
    throw new Error(`the roster does not offer ${localpart}: did the emulator seed its personas, and is the backend running as testing?`);
  }

  const config = composeTargetConfig(PLAYGROUND_BACKEND, 'backend').config;
  return { email: personaEmail(config, localpart), password: TEST_ACCOUNT_PASSWORD };
}

/**
 * Find the lane's persona on the roster and sign it in against the auth
 * emulator with the real Firebase client SDK.
 * @param {object} options
 * @param {string} options.apiBase - The hosting emulator origin.
 * @param {number} options.authPort - The auth emulator port.
 * @param {{ apiKey: string, projectId: string }} options.firebaseConfig - The emulator project.
 * @param {string} options.localpart - The persona's localpart.
 * @returns {Promise<object>} The signed-in Firebase user.
 */
async function signInPersona({ apiBase, authPort, firebaseConfig, localpart }) {
  const persona = await fetchRosterPersona({ apiBase, localpart });

  // Resolved from @omega.js/client's dependency tree, the SDK every surface ships
  const clientRequire = createRequire(path.join(ROOT, 'packages', 'client', 'package.json'));
  const { initializeApp } = clientRequire('firebase/app');
  const { getAuth, connectAuthEmulator, signInWithEmailAndPassword } = clientRequire('firebase/auth');

  const app = initializeApp(firebaseConfig, `roster-${persona.email}`);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://127.0.0.1:${authPort}`, { disableWarnings: true });

  const { user } = await signInWithEmailAndPassword(auth, persona.email, persona.password);
  return user;
}

/**
 * Sign the lane's persona in and have the backend mint its sign-in custom token
 * at POST /omega/user/token: what a surface's own sign-in receives from the website.
 * @param {object} options
 * @param {string} options.apiBase - The hosting emulator origin.
 * @param {number} options.authPort - The auth emulator port.
 * @param {{ apiKey: string, projectId: string }} options.firebaseConfig - The emulator project.
 * @param {string} options.localpart - The persona's localpart.
 * @returns {Promise<{ uid: string, email: string, token: string }>} The persona and its custom token.
 */
async function mintPersonaToken({ apiBase, authPort, firebaseConfig, localpart }) {
  const user = await signInPersona({ apiBase, authPort, firebaseConfig, localpart });
  const response = await fetch(`${apiBase}/omega/user/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${await user.getIdToken(true)}` },
    body: JSON.stringify({}),
  });
  if (response.status !== 200) {
    throw new Error(`POST /omega/user/token should 200 (got ${response.status})`);
  }

  const { token } = await response.json();
  if (typeof token !== 'string') {
    throw new Error('the backend minted no custom token');
  }

  return { uid: user.uid, email: user.email, token };
}

module.exports = { personaEmail, fetchRosterPersona, signInPersona, mintPersonaToken };
