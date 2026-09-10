const { describe, it, before, beforeEach } = require('node:test');
const { registerHooks } = require('node:module');
const { getManager, TEST_CONFIG, assert } = require('./helpers.js');

// #798: the probe is only worth having if something ASKS it. The boot wires the
// two free moments of doubt (the tab coming back into view, and the network
// coming back) beside the auth state listener, so web, desktop and extension
// get them from the one place. The third moment, a 401, is the request layer's
// onUnauthorized dep (request.test.js).
describe('Manager: the session probe\'s moments of doubt (#798)', () => {

  const USER = { uid: 'user-1', email: 'user@test.com', emailVerified: true, metadata: {}, providerData: [] };

  // Booting Firebase is what registers the moments, so the SDK is the seam:
  // the four lazily-imported specifiers resolve to stubs reading
  // `globalThis.__omegaFirebase` (the #700 firestore stub's pattern). Nothing
  // else in this file imports them.
  const STUB_URLS = {
    'firebase/app': 'omega-test-stub:firebase-app',
    'firebase/auth': 'omega-test-stub:firebase-auth',
    'firebase/firestore': 'omega-test-stub:firebase-firestore',
    'firebase/messaging': 'omega-test-stub:firebase-messaging',
  };

  const STUB_SOURCES = {
    'omega-test-stub:firebase-app': `export const initializeApp = () => globalThis.__omegaFirebase.app;
                                     export const getApp = () => globalThis.__omegaFirebase.app;
                                     export const getApps = () => [];`,
    'omega-test-stub:firebase-auth': `export const getAuth = () => globalThis.__omegaFirebase.auth;
                                      export const onAuthStateChanged = (auth, callback) => { globalThis.__omegaFirebase.authCallbacks.push(callback); return () => {}; };
                                      export const getIdToken = (...args) => globalThis.__omegaFirebase.getIdToken(...args);
                                      export const signOut = (...args) => globalThis.__omegaFirebase.signOut(...args);`,
    'omega-test-stub:firebase-firestore': `export const initializeFirestore = () => ({});`,
    'omega-test-stub:firebase-messaging': `export const getMessaging = () => ({});`,
  };

  const stubFirebaseModules = () => registerHooks({
    resolve(specifier, context, nextResolve) {
      if (STUB_URLS[specifier]) {
        return { url: STUB_URLS[specifier], shortCircuit: true };
      }

      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      if (STUB_SOURCES[url]) {
        return { format: 'module', shortCircuit: true, source: STUB_SOURCES[url] };
      }

      return nextLoad(url, context);
    },
  });

  // Every call the probe makes to the stubbed SDK
  const calls = { getIdToken: [], signOut: 0 };

  // Flush the microtask queue so the probe's lazy `import('firebase/auth')`
  // has landed and the stub has really been called
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  const listeners = (target, type) => global.__omegaListeners[target][type] || [];

  // What a dispatched event does: every registered handler runs. The version
  // check owns an `online` listener of its own, so firing the whole set is
  // also the honest way to prove exactly ONE of them probes.
  const dispatch = (target, type) => listeners(target, type).forEach((handler) => handler());

  before(async () => {
    // Registered here, not at load: hooks route every later require through the
    // ESM loader, and the helpers' Manager import pulls in CJS that will not
    // survive the trip.
    stubFirebaseModules();

    globalThis.__omegaFirebase = {
      app: { name: '[DEFAULT]' },
      auth: { currentUser: null },
      authCallbacks: [],
      getIdToken: async (user, force) => {
        calls.getIdToken.push({ uid: user.uid, force });
        throw Object.assign(new Error('Firebase: Error (auth/user-token-expired).'), { code: 'auth/user-token-expired' });
      },
      signOut: async () => {
        calls.signOut++;
        globalThis.__omegaFirebase.auth.currentUser = null;
        return true;
      },
    };

    // A config the SDK can actually boot: apiKey is what gates _initializeFirebase
    await getManager().initialize({
      ...TEST_CONFIG,
      firebase: { app: { enabled: true, config: { apiKey: 'test-api-key', projectId: 'test-project' } } },
    });
  });

  beforeEach(() => {
    calls.getIdToken = [];
    calls.signOut = 0;
    globalThis.__omegaFirebase.auth.currentUser = USER;
  });

  it('should register visibilitychange on the document and online on the window', () => {
    assert.strictEqual(listeners('document', 'visibilitychange').length, 1, 'ONE registration per manager instance');
    assert.ok(listeners('window', 'online').length >= 1, 'the network coming back is the second moment');
  });

  it('should probe when the tab comes back into view, and not while it is hidden', async () => {
    global.document.visibilityState = 'hidden';
    dispatch('document', 'visibilitychange');
    await flush();
    assert.strictEqual(calls.getIdToken.length, 0, 'a tab going away asks nothing');

    global.document.visibilityState = 'visible';
    dispatch('document', 'visibilitychange');
    await flush();

    assert.strictEqual(calls.getIdToken.length, 1, 'the tab coming back re-asks the Auth server');
    assert.strictEqual(calls.getIdToken[0].force, true, 'and it is the FORCED refresh');
    assert.strictEqual(calls.signOut, 1, 'a revoked session signs out, and the emission drives the policy listener');
  });

  it('should probe when the network comes back', async () => {
    dispatch('window', 'online');
    await flush();

    assert.strictEqual(calls.getIdToken.length, 1, 'exactly one of the online listeners is the probe');
    assert.strictEqual(calls.signOut, 1);
  });
});
