/**
 * The shared esbuild stub for `@firebase/auth`, for suites that drive REAL auth
 * modules through esbuild (auth-oauth.test.js, auth-policy.test.js).
 *
 * The modules import the SDK lazily, so a harness bundle must carry something
 * at that specifier — and bundling the real SDK to watch a redirect decision
 * buys nothing. Every member forwards to `globalThis.__firebaseAuth` at CALL
 * time, so a test swaps the whole SDK by assigning that global; the providers
 * are bare classes because the modules only ever `new` them.
 *
 * The member list is the union of what the suites stub: a member nobody imports
 * is inert, and one list beats two that drift apart (#705).
 */

/** The SDK functions, each forwarded to the global at call time. */
const FIREBASE_AUTH_MEMBERS = [
  'getAuth',
  'getAdditionalUserInfo',
  'getRedirectResult',
  'signInWithCustomToken',
  'signInWithPopup',
  'signInWithRedirect',
  'signOut',
];

/** The provider constructors, which the modules only ever instantiate. */
const FIREBASE_AUTH_PROVIDERS = [
  'GoogleAuthProvider',
  'FacebookAuthProvider',
  'TwitterAuthProvider',
  'GithubAuthProvider',
];

/**
 * Build the harness stub for `@firebase/auth`.
 *
 * A suite that needs a member the union does not carry passes its own lists
 * (spread the exported constants to extend rather than replace).
 *
 * @param {object} [options]
 * @param {string[]} [options.members] - the forwarded SDK functions
 * @param {string[]} [options.providers] - the provider constructors
 * @returns {{ filter: RegExp, contents: string }} the specifier to intercept
 *   and the module source to serve for it
 */
function firebaseAuthStub({ members = FIREBASE_AUTH_MEMBERS, providers = FIREBASE_AUTH_PROVIDERS } = {}) {
  return {
    filter: /^@firebase\/auth$/,
    contents: [
      'export default globalThis.__firebaseAuth;',
      ...members.map((name) => `export const ${name} = (...a) => globalThis.__firebaseAuth.${name}(...a);`),
      ...providers.map((name) => `export const ${name} = class {};`),
    ].join(' '),
  };
}

module.exports = { firebaseAuthStub, FIREBASE_AUTH_MEMBERS, FIREBASE_AUTH_PROVIDERS };
