const { describe, it, before, beforeEach, afterEach } = require('node:test');
const { registerHooks } = require('node:module');
const { TEST_CONFIG, assert } = require('./helpers.js');

// The boot creates the Firebase app and auth only; Firestore and messaging load
// on first use, each through its one loader. The four SDK specifiers resolve to
// stubs reading `globalThis.__omegaFirebase` (the session-moments harness), so
// every import asked and every instance created is counted here.
describe('Omega: Firestore and messaging load on first use', () => {

  const STUB_URLS = {
    'firebase/app': 'omega-test-stub:firebase-app',
    'firebase/auth': 'omega-test-stub:firebase-auth',
    'firebase/firestore': 'omega-test-stub:firebase-firestore',
    'firebase/messaging': 'omega-test-stub:firebase-messaging',
  };

  const STUB_SOURCES = {
    'omega-test-stub:firebase-app': `
      export const initializeApp = (config) => globalThis.__omegaFirebase.newApp(config);
      export const getApp = () => globalThis.__omegaFirebase.apps.at(-1);
      export const getApps = () => [];`,
    'omega-test-stub:firebase-auth': `
      export const getAuth = (app) => app.auth;
      export const onAuthStateChanged = (auth, callback) => { auth.callbacks.push(callback); return () => {}; };
      export const connectAuthEmulator = (auth, url) => globalThis.__omegaFirebase.log.push({ op: 'connectAuthEmulator', url });
      export const getIdToken = async () => 'id-token';
      export const signOut = async (auth) => { auth.currentUser = null; return true; };`,
    'omega-test-stub:firebase-firestore': `
      const F = () => globalThis.__omegaFirebase;
      const ref = (db, ...segments) => ({ db, path: segments.join('/') });
      export const initializeFirestore = (app) => F().firestoreFor(app);
      export const getFirestore = (app) => F().firestoreFor(app);
      export const connectFirestoreEmulator = (db, host, port) => F().log.push({ op: 'connectFirestoreEmulator', db, host, port });
      export const doc = ref;
      export const collection = ref;
      export const getDoc = async (target) => { F().log.push({ op: 'getDoc', ref: target }); return F().getDoc(target); };
      export const setDoc = async (target) => { F().log.push({ op: 'setDoc', ref: target }); };
      export const updateDoc = async (target) => { F().log.push({ op: 'updateDoc', ref: target }); };
      export const deleteDoc = async () => {};
      export const getDocs = async () => ({ docs: [], empty: true });
      export const query = () => ({});
      export const where = () => ({});
      export const orderBy = () => ({});
      export const limit = () => ({});
      export const startAt = () => ({});
      export const endAt = () => ({});
      export const onSnapshot = () => () => {};`,
    'omega-test-stub:firebase-messaging': `
      const F = () => globalThis.__omegaFirebase;
      export const getMessaging = (app) => { F().messagingCreated += 1; return { app }; };
      export const isSupported = async () => 'PushManager' in window && 'serviceWorker' in navigator;
      export const getToken = async () => F().token;
      export const deleteToken = async () => true;
      export const onMessage = () => () => {};`,
  };

  // Every import asked of the two lazy SDKs, counted at resolution: a dynamic
  // import resolves on each call, so zero here means nothing asked for it
  const asked = { 'firebase/firestore': 0, 'firebase/messaging': 0 };

  // One Firestore import that fails, the way a chunk that never arrived does: a
  // fresh url whose evaluation throws, so only that one import rejects
  const BROKEN_FIRESTORE_URL = 'omega-test-stub:firebase-firestore-broken';
  let failNextFirestore = false;

  const stubFirebaseModules = () => registerHooks({
    resolve(specifier, context, nextResolve) {
      if (STUB_URLS[specifier]) {
        if (specifier in asked) {
          asked[specifier] += 1;
        }

        if (specifier === 'firebase/firestore' && failNextFirestore) {
          failNextFirestore = false;
          return { url: `${BROKEN_FIRESTORE_URL}-${asked[specifier]}`, shortCircuit: true };
        }

        return { url: STUB_URLS[specifier], shortCircuit: true };
      }

      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      if (STUB_SOURCES[url]) {
        return { format: 'module', shortCircuit: true, source: STUB_SOURCES[url] };
      }

      if (url.startsWith(BROKEN_FIRESTORE_URL)) {
        return { format: 'module', shortCircuit: true, source: `throw new Error('the Firestore chunk failed to load');` };
      }

      return nextLoad(url, context);
    },
  });

  const FIREBASE = { apiKey: 'test-api-key', projectId: 'test-project' };
  const USER = { uid: 'user-1', email: 'user@test.com', emailVerified: true, metadata: {}, providerData: [] };
  const PRO_DOC = { subscription: { product: { id: 'pro' }, status: 'active' } };

  let Omega;

  // One fresh SDK state per test: each initializeApp is a new app holding its
  // own auth and, once asked, its own one Firestore instance
  function resetFirebase() {
    const state = {
      apps: [],
      log: [],
      firestoreCalls: 0,
      firestoreCreated: 0,
      messagingCreated: 0,
      token: 'fcm-token-12345678',
      getDoc: async () => ({ exists: () => true, data: () => PRO_DOC, id: 'user-1' }),
      newApp(config) {
        const app = { name: '[DEFAULT]', options: config, auth: { currentUser: null, callbacks: [] }, firestore: null };
        state.apps.push(app);
        return app;
      },
      firestoreFor(app) {
        state.firestoreCalls += 1;
        if (!app.firestore) {
          state.firestoreCreated += 1;
          app.firestore = { app, id: state.firestoreCreated };
        }
        return app.firestore;
      },
    };

    globalThis.__omegaFirebase = state;
    asked['firebase/firestore'] = 0;
    asked['firebase/messaging'] = 0;
    failNextFirestore = false;

    return state;
  }

  /** Boot a fresh instance the way a surface does; `firebase: false` boots a Firebase-less brand. */
  async function boot({ firebase = true, ...config } = {}) {
    const omega = new Omega();

    // No version check: its interval would hold the test process open
    await omega.initialize({
      ...TEST_CONFIG,
      refreshNewVersion: { enabled: false },
      ...(firebase ? { firebase: { app: { enabled: true, config: FIREBASE } } } : {}),
      ...config,
    });

    return { omega, app: globalThis.__omegaFirebase.apps.at(-1) };
  }

  /** Count the loader's calls while still running the real one. */
  function spyLoader(omega, name) {
    const spy = { calls: 0 };
    const real = omega[name];

    omega[name] = (...args) => {
      spy.calls += 1;
      return real.apply(omega, args);
    };

    return spy;
  }

  const withTimeout = (promise, what) => Promise.race([
    promise,
    new Promise((resolve, reject) => setTimeout(() => reject(new Error(`timed out waiting for ${what}`)), 3000).unref()),
  ]);

  /** Emit a Firebase auth change and wait for the state it lands. */
  function emitAuth(omega, app, user) {
    const landed = new Promise((resolve) => {
      omega.auth.listen((state) => {
        if (!!state.user.authenticated === !!user) {
          resolve(state);
        }
      });
    });

    app.auth.currentUser = user;
    app.auth.callbacks.forEach((callback) => callback(user));

    return withTimeout(landed, 'the auth state to land');
  }

  // Stand-in for the browser's Notification API, steerable per test
  function installNotification(permission) {
    const stub = function Notification() {};
    stub.permission = permission;
    stub.requestPermission = async () => stub.permission;
    global.Notification = stub;
    global.window.Notification = stub;
  }

  before(async () => {
    // Registered here, not at load: hooks route every later require through the
    // ESM loader, and the helpers' Omega import pulls in CJS that will not
    // survive the trip
    stubFirebaseModules();
    Omega = (await import('../src/index.js')).Omega;
  });

  beforeEach(() => {
    resetFirebase();
  });

  afterEach(() => {
    delete global.Notification;
    delete global.window.Notification;
    delete global.window.PushManager;
  });

  it('should import neither Firestore nor messaging while booting a signed-out visitor (case 1)', async () => {
    const { omega, app } = await boot();

    assert.ok(app, 'the boot created the Firebase app');
    await emitAuth(omega, app, null);

    assert.strictEqual(asked['firebase/firestore'], 0, 'firebase/firestore was never imported');
    assert.strictEqual(asked['firebase/messaging'], 0, 'firebase/messaging was never imported');
    assert.strictEqual(globalThis.__omegaFirebase.firestoreCalls, 0, 'and no Firestore instance was asked for');
    assert.strictEqual(globalThis.__omegaFirebase.messagingCreated, 0, 'nor a messaging instance');
  });

  it('should attempt no Firestore load on the account path of a brand with no Firebase config (case 5)', async () => {
    const { omega } = await boot({ firebase: false });
    const loader = spyLoader(omega, 'loadFirebaseFirestore');

    const state = await withTimeout(omega.auth._handleAuthStateChange(USER).then(() => omega.auth.state), 'the account path');

    assert.strictEqual(loader.calls, 0, 'the loader is never asked');
    assert.strictEqual(asked['firebase/firestore'], 0, 'and firebase/firestore is never imported');
    assert.strictEqual(state.denied, false);
    assert.strictEqual(state.user.uid, 'user-1', 'the identity still lands');
  });

  it('should answer isSupported() true with no messaging import, then load messaging once on subscribe (case 6)', async () => {
    const { omega } = await boot();

    global.window.PushManager = function PushManager() {};
    installNotification('granted');
    omega.state.serviceWorker = { scope: '/' };

    assert.strictEqual(omega.notifications.isSupported(), true, 'service worker, push and the Firebase app are support enough');
    assert.strictEqual(asked['firebase/messaging'], 0, 'and answering imported nothing');

    const result = await omega.notifications.subscribe();

    assert.deepStrictEqual(result, { subscribed: true, token: 'fcm-token-12345678' });
    assert.strictEqual(globalThis.__omegaFirebase.messagingCreated, 1, 'the subscribe created messaging');

    assert.strictEqual(await omega.notifications.getToken(), 'fcm-token-12345678');
    assert.strictEqual(globalThis.__omegaFirebase.messagingCreated, 1, 'a later reader reuses the one instance');
  });

  it('should resolve the messaging loader to null where the browser has no push support', async () => {
    const { omega } = await boot();

    assert.strictEqual('PushManager' in global.window, false, 'this browser has no push');
    assert.strictEqual(await omega.loadFirebaseMessaging(), null);
    assert.strictEqual(globalThis.__omegaFirebase.messagingCreated, 0, 'and no messaging instance was made');
  });

  it('should read a signed-in account through the Firestore loader, resolving as before (case 2)', async () => {
    const { omega, app } = await boot();
    const loader = spyLoader(omega, 'loadFirebaseFirestore');

    const state = await emitAuth(omega, app, USER);

    assert.ok(loader.calls >= 1, 'the account read asked the loader');
    assert.strictEqual(state.denied, false);
    assert.strictEqual(state.user.uid, 'user-1');
    assert.strictEqual(state.user.plan, 'pro', 'the account document resolved into the User');

    const read = globalThis.__omegaFirebase.log.find((entry) => entry.op === 'getDoc');
    assert.ok(read, 'the account document was read');
    assert.strictEqual(read.ref.path, 'users/user-1');
    assert.strictEqual(read.ref.db, await omega.loadFirebaseFirestore(), 'on the instance the loader holds');
  });

  it('should create one Firestore instance for two callers asking at once (case 3)', async () => {
    const { omega } = await boot();

    const [first, second] = await Promise.all([omega.loadFirebaseFirestore(), omega.loadFirebaseFirestore()]);

    assert.ok(first, 'the loader resolves an instance');
    assert.strictEqual(first, second, 'both callers hold the same instance');
    assert.strictEqual(globalThis.__omegaFirebase.firestoreCalls, 1, 'the SDK was asked for an instance once');
    assert.strictEqual(globalThis.__omegaFirebase.firestoreCreated, 1);
  });

  it('should connect the Firestore emulator once, before any read, on the local stack (case 4)', async () => {
    const { omega, app } = await boot({ dev: { ports: { auth: 9099, firestore: 8080 } } });
    const log = globalThis.__omegaFirebase.log;
    const connects = () => log.filter((entry) => entry.op === 'connectFirestoreEmulator');

    assert.strictEqual(connects().length, 0, 'the boot connects no Firestore it did not create');

    const [db] = await Promise.all([omega.loadFirebaseFirestore(), omega.loadFirebaseFirestore()]);

    assert.strictEqual(connects().length, 1, 'connected by the time the loader resolves');
    assert.strictEqual(connects()[0].db, db, 'on the one instance');
    assert.strictEqual(connects()[0].port, 8080, 'at the resolved firestore port');

    await emitAuth(omega, app, USER);
    await omega.firestore.doc('users/user-1').get();
    await omega.loadFirebaseFirestore();

    const firstRead = log.findIndex((entry) => entry.op === 'getDoc');
    assert.ok(firstRead !== -1, 'the reads happened');
    assert.ok(log.indexOf(connects()[0]) < firstRead, 'the connect came before the first read');
    assert.strictEqual(connects().length, 1, 'and never again');
  });

  it('should not cache a failed Firestore load: the next call retries and resolves', async () => {
    const { omega } = await boot();

    failNextFirestore = true;
    await assert.rejects(omega.loadFirebaseFirestore(), /the Firestore chunk failed to load/, 'the first caller gets the failure');

    const db = await omega.loadFirebaseFirestore();

    assert.ok(db, 'a second call retries and resolves an instance');
    assert.strictEqual(globalThis.__omegaFirebase.firestoreCreated, 1, 'made once, by the retry');
    assert.strictEqual(await omega.loadFirebaseFirestore(), db, 'and the success is the one kept');
  });
});
