const defineCases = require('@omega.js/devkit/test/define-cases');
const { registerHooks } = require('node:module');
const { TEST_CONFIG, createOmega, clearStorage, disposeOmega } = require('./helpers.js');

const beforeEachHook = clearStorage;

module.exports = defineCases({
  type: 'group',
  description: 'firebase-lazy',
  setup: createOmega,
  cleanup: disposeOmega,
  tests: [
    // The boot creates the Firebase app and auth only; Firestore and messaging load
    // on first use, each through its one loader. The four SDK specifiers resolve to
    // stubs reading `globalThis.__omegaFirebase` (the session-moments harness), so
    // every import asked and every instance created is counted here.
    ...(() => {
      const cases = [];
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

      let beforeHookRun;
      const beforeHook = (ctx) => (beforeHookRun ||= Promise.resolve().then(() => (async () => {
        // Registered here, not at load: hooks route every later require through the
        // ESM loader, and the helpers' Omega import pulls in CJS that will not
        // survive the trip
        stubFirebaseModules();
        Omega = (await import('../src/index.js')).Omega;
      })()));

      const beforeEachHook2 = () => {
        resetFirebase();
      };

      const afterEachHook = () => {
        delete global.Notification;
        delete global.window.Notification;
        delete global.window.PushManager;
      };

      cases.push({
        name: 'Omega: Firestore and messaging load on first use > should import neither Firestore nor messaging while booting a signed-out visitor (case 1)',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          beforeEachHook2();
          ctx.after(afterEachHook);
          const { omega, app } = await boot();

          ctx.expect(app, 'the boot created the Firebase app').toBeTruthy();
          await emitAuth(omega, app, null);

          ctx.expect(asked['firebase/firestore'], 'firebase/firestore was never imported').toBe(0);
          ctx.expect(asked['firebase/messaging'], 'firebase/messaging was never imported').toBe(0);
          ctx.expect(globalThis.__omegaFirebase.firestoreCalls, 'and no Firestore instance was asked for').toBe(0);
          ctx.expect(globalThis.__omegaFirebase.messagingCreated, 'nor a messaging instance').toBe(0);
        },
      });

      cases.push({
        name: 'Omega: Firestore and messaging load on first use > should attempt no Firestore load on the account path of a brand with no Firebase config (case 5)',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          beforeEachHook2();
          ctx.after(afterEachHook);
          const { omega } = await boot({ firebase: false });
          const loader = spyLoader(omega, 'loadFirebaseFirestore');

          const state = await withTimeout(omega.auth._handleAuthStateChange(USER).then(() => omega.auth.state), 'the account path');

          ctx.expect(loader.calls, 'the loader is never asked').toBe(0);
          ctx.expect(asked['firebase/firestore'], 'and firebase/firestore is never imported').toBe(0);
          ctx.expect(state.denied).toBe(false);
          ctx.expect(state.user.uid, 'the identity still lands').toBe('user-1');
        },
      });

      cases.push({
        name: 'Omega: Firestore and messaging load on first use > should answer isSupported() true with no messaging import, then load messaging once on subscribe (case 6)',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          beforeEachHook2();
          ctx.after(afterEachHook);
          const { omega } = await boot();

          global.window.PushManager = function PushManager() {};
          installNotification('granted');
          omega.state.serviceWorker = { scope: '/' };

          ctx.expect(omega.notifications.isSupported(), 'service worker, push and the Firebase app are support enough').toBe(true);
          ctx.expect(asked['firebase/messaging'], 'and answering imported nothing').toBe(0);

          const result = await omega.notifications.subscribe();

          ctx.expect(result).toEqual({ subscribed: true, token: 'fcm-token-12345678' });
          ctx.expect(globalThis.__omegaFirebase.messagingCreated, 'the subscribe created messaging').toBe(1);

          ctx.expect(await omega.notifications.getToken()).toBe('fcm-token-12345678');
          ctx.expect(globalThis.__omegaFirebase.messagingCreated, 'a later reader reuses the one instance').toBe(1);
        },
      });

      cases.push({
        name: 'Omega: Firestore and messaging load on first use > should resolve the messaging loader to null where the browser has no push support',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          beforeEachHook2();
          ctx.after(afterEachHook);
          const { omega } = await boot();

          ctx.expect('PushManager' in global.window, 'this browser has no push').toBe(false);
          ctx.expect(await omega.loadFirebaseMessaging()).toBe(null);
          ctx.expect(globalThis.__omegaFirebase.messagingCreated, 'and no messaging instance was made').toBe(0);
        },
      });

      cases.push({
        name: 'Omega: Firestore and messaging load on first use > should read a signed-in account through the Firestore loader, resolving as before (case 2)',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          beforeEachHook2();
          ctx.after(afterEachHook);
          const { omega, app } = await boot();
          const loader = spyLoader(omega, 'loadFirebaseFirestore');

          const state = await emitAuth(omega, app, USER);

          ctx.expect(loader.calls >= 1, 'the account read asked the loader').toBeTruthy();
          ctx.expect(state.denied).toBe(false);
          ctx.expect(state.user.uid).toBe('user-1');
          ctx.expect(state.user.plan, 'the account document resolved into the User').toBe('pro');

          const read = globalThis.__omegaFirebase.log.find((entry) => entry.op === 'getDoc');
          ctx.expect(read, 'the account document was read').toBeTruthy();
          ctx.expect(read.ref.path).toBe('users/user-1');
          ctx.expect(read.ref.db, 'on the instance the loader holds').toBe(await omega.loadFirebaseFirestore());
        },
      });

      cases.push({
        name: 'Omega: Firestore and messaging load on first use > should create one Firestore instance for two callers asking at once (case 3)',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          beforeEachHook2();
          ctx.after(afterEachHook);
          const { omega } = await boot();

          const [first, second] = await Promise.all([omega.loadFirebaseFirestore(), omega.loadFirebaseFirestore()]);

          ctx.expect(first, 'the loader resolves an instance').toBeTruthy();
          ctx.expect(first, 'both callers hold the same instance').toBe(second);
          ctx.expect(globalThis.__omegaFirebase.firestoreCalls, 'the SDK was asked for an instance once').toBe(1);
          ctx.expect(globalThis.__omegaFirebase.firestoreCreated).toBe(1);
        },
      });

      cases.push({
        name: 'Omega: Firestore and messaging load on first use > should connect the Firestore emulator once, before any read, on the local stack (case 4)',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          beforeEachHook2();
          ctx.after(afterEachHook);
          const { omega, app } = await boot({ dev: { ports: { auth: 9099, firestore: 8080 } } });
          const log = globalThis.__omegaFirebase.log;
          const connects = () => log.filter((entry) => entry.op === 'connectFirestoreEmulator');

          ctx.expect(connects().length, 'the boot connects no Firestore it did not create').toBe(0);

          const [db] = await Promise.all([omega.loadFirebaseFirestore(), omega.loadFirebaseFirestore()]);

          ctx.expect(connects().length, 'connected by the time the loader resolves').toBe(1);
          ctx.expect(connects()[0].db, 'on the one instance').toBe(db);
          ctx.expect(connects()[0].port, 'at the resolved firestore port').toBe(8080);

          await emitAuth(omega, app, USER);
          await omega.firestore.doc('users/user-1').get();
          await omega.loadFirebaseFirestore();

          const firstRead = log.findIndex((entry) => entry.op === 'getDoc');
          ctx.expect(firstRead !== -1, 'the reads happened').toBeTruthy();
          ctx.expect(log.indexOf(connects()[0]) < firstRead, 'the connect came before the first read').toBeTruthy();
          ctx.expect(connects().length, 'and never again').toBe(1);
        },
      });

      cases.push({
        name: 'Omega: Firestore and messaging load on first use > should not cache a failed Firestore load: the next call retries and resolves',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          beforeEachHook2();
          ctx.after(afterEachHook);
          const { omega } = await boot();

          failNextFirestore = true;
          await ctx.expect(omega.loadFirebaseFirestore(), 'the first caller gets the failure').rejects.toThrow(/the Firestore chunk failed to load/);

          const db = await omega.loadFirebaseFirestore();

          ctx.expect(db, 'a second call retries and resolves an instance').toBeTruthy();
          ctx.expect(globalThis.__omegaFirebase.firestoreCreated, 'made once, by the retry').toBe(1);
          ctx.expect(await omega.loadFirebaseFirestore(), 'and the success is the one kept').toBe(db);
        },
      });
      return cases;
    })(),
  ],
});
