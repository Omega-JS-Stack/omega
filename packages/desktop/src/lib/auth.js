// Auth: main-process Firebase Auth, the source of truth every renderer syncs with.
//
// This is @omega.js/desktop's analogue of @omega.js/extension's background auth
// (its src/lib/background-auth.js). The pattern:
//
//   1. Main runs its own Firebase Auth instance and is the source of truth for the SESSION.
//   2. When a deep-link auth/token arrives, main calls signInWithCustomToken with that token,
//      then BROADCASTS the token to all renderer windows so their @omega.js/client Firebase
//      instances can sign in with the SAME token.
//   3. On every renderer load, the renderer asks main "I'm at UID X (or null)" via the
//      desktop:auth:sync-request IPC. Main compares with its own UID and either does nothing,
//      tells the renderer to sign out, or fetches a fresh custom token from /omega
//      and sends it to the renderer.
//   4. Sign-out: any renderer can request sign-out via desktop:auth:sign-out. Main signs out
//      its own Firebase + broadcasts desktop:auth:sign-out to all renderers.
//   5. The ACCOUNT crosses the other way: main cannot read Firestore, so every renderer
//      pushes the account document its @omega.js/client resolved
//      (desktop:auth:account-resolved, `{ uid, document, identity }`), and main builds its
//      `user` from it when the uid is its own session's.
//
// Firebase is BUNDLED by esbuild from @omega.js/desktop's module context (@omega.js/client owns it
// in @omega.js/desktop's tree). If loading fails, auth stays in no-op mode and logs the reason.

const { User } = require('@omega.js/account');
const LoggerLite = require('./logger-lite.js');
const authPersistence = require('./auth-persistence.js');
const { requiredPort } = require('../utils/url-helpers.js');
const sanitizeURL = require('../utils/sanitize-url.js');

const logger = new LoggerLite('auth');

const FIREBASE_APP_NAME = 'omega-auth';

const auth = {
  _initialized:    false,
  _omega:          null,
  _firebase:       null,    // firebase/app
  _firebaseAuth:   null,    // auth instance
  _firebaseModule: null,    // firebase/auth namespace (signInWithCustomToken, signOut, ...)
  _callbacks:      [],      // listen() subscribers, each called with `{ user }`
  _ipcRegistered:  false,

  // The account as one `User`, never null: signed out until a renderer pushes the
  // account document of the uid this process's Firebase session holds, and signed
  // out again the moment that session ends
  user: new User(),

  // The newest state, `{ user }`, the shape @omega.js/client's listeners get
  state: null,

  async initialize(omega) {
    if (auth._initialized) {
      return;
    }

    auth._omega = omega;
    auth.state = { user: auth.user };

    // Try to load firebase. If it's not installed, run in no-op mode.
    const ok = await auth._tryLoadFirebase();
    if (!ok) {
      logger.warn('firebase not installed: auth running in no-op mode. `npm i firebase` to enable auth.');
    }

    auth._registerIpc();

    if (ok) {
      // Boot Firebase Auth. With a persistence strategy active (lib/auth-persistence.js,
      // default safeStorage), the session survives restarts: the restore lands async
      // via onAuthStateChanged shortly after boot.
      try {
        const strategy = await authPersistence.resolve(omega);
        auth._firebaseAuth = auth._getFirebaseAuth(strategy);
        // onAuthStateChanged is the source of truth listener.
        auth._firebaseModule.onAuthStateChanged(auth._firebaseAuth, (user) => {
          auth._handleAuthStateChange(user);
        });
        logger.log(`initialize: firebase loaded (persistence: ${strategy ? strategy.name : 'in-memory'})`);
      } catch (e) {
        logger.error('firebase init failed:', e.message);
      }
    }

    auth._initialized = true;
  },

  // Load firebase. Returns true on success. BUNDLED by esbuild from @omega.js/desktop's module context
  // (@omega.js/client owns firebase in @omega.js/desktop's tree), the same treatment as json5 in main.js. In the
  // webpack era it was a webpackIgnore'd runtime import(), which resolves relative to the CONSUMER's
  // main.bundle.js: that walk never reaches @omega.js/desktop's node_modules when @omega.js/desktop is symlinked
  // (`mgr install dev`) and depends on npm hoisting when installed, so every dev app silently
  // ran auth in no-op mode. Interop guards handle both namespace shapes (json5 precedent).
  async _tryLoadFirebase() {
    try {
      const appMod  = require('firebase/app');
      const authMod = require('firebase/auth');

      auth._firebase       = appMod.initializeApp ? appMod : (appMod.default || appMod);
      auth._firebaseModule = authMod.getAuth      ? authMod : (authMod.default || authMod);
      return true;
    } catch (e) {
      logger.warn('firebase load failed:', e.message);
      return false;
    }
  },

  _getFirebaseAuth(strategy) {
    if (auth._firebaseAuth) return auth._firebaseAuth;

    const firebaseConfig = auth._omega.config.cloud?.config;
    if (!firebaseConfig || !Object.keys(firebaseConfig).length) {
      throw new Error('cloud.config is empty: cannot initialize auth.');
    }

    const { initializeApp, getApp } = auth._firebase;
    const { getAuth, initializeAuth } = auth._firebaseModule;

    let app;
    try { app = getApp(FIREBASE_APP_NAME); }
    catch (e) { app = initializeApp(firebaseConfig, FIREBASE_APP_NAME); }

    // With a storage strategy, boot auth on OUR persistence (session survives
    // restarts); without one, firebase's Node default (in-memory) applies.
    if (strategy && initializeAuth) {
      auth._firebaseAuth = initializeAuth(app, {
        persistence: [authPersistence.buildFirebasePersistence(strategy)],
      });
    } else {
      auth._firebaseAuth = getAuth(app);
    }

    // A TESTING run talks to the LOCAL stack, never real auth: the same move
    // getApiUrl() makes when it maps testing to localhost, and the same one
    // @omega.js/extension's background SW makes for its emulator runs. Only an
    // OMEGA_ENVIRONMENT=testing run reaches here; dev and production are untouched.
    if (auth._omega.isTesting()) {
      const { connectAuthEmulator } = auth._firebaseModule;
      const port = auth._authEmulatorPort();
      logger.log(`testing run: connecting auth to the emulator on :${port}`);
      connectAuthEmulator(auth._firebaseAuth, `http://localhost:${port}`, { disableWarnings: true });
    }

    return auth._firebaseAuth;
  },

  // The auth emulator's port, on the same chain getApiUrl() walks: the
  // resolved-port env channel (N7), then the `dev.ports` map the bundle baked
  // into OMEGA_BUILD_JSON
  // ([#745](https://github.com/Omega-JS-Stack/omega/issues/745)). The classic
  // 9099 used to sit under those two as a last resort; it is gone (#834),
  // because nothing identity-checks what answers on it and a neighbouring
  // project's emulator reads as an auth mystery rather than a port problem.
  _authEmulatorPort() {
    return requiredPort(auth._omega, 'OMEGA_AUTH_PORT', 'auth');
  },

  _registerIpc() {
    if (auth._ipcRegistered) return;
    const ipc = auth._omega.ipc;

    // Renderer asks main: "I'm at UID X (or null). Are we in sync?"
    ipc.handle('desktop:auth:sync-request', async ({ contextUid }) => {
      return auth._handleSyncRequest(contextUid);
    });

    // Renderer asks main to sign out (a window's `omega-signout` trigger, or
    // its `omega.signOut()`): main signs out and broadcasts to every window.
    ipc.handle('desktop:auth:sign-out', () => auth.signOut());

    // Renderer asks main for its account, in the shape a renderer pushes one:
    // the stored document of `user` plus the identity of main's own session
    // (never a token field).
    ipc.handle('desktop:auth:get-user', () => {
      const identity = auth._identity(auth._firebaseAuth?.currentUser);
      return { uid: identity ? identity.uid : null, document: auth.user.toJSON(), identity };
    });

    // Renderer pushes the account its @omega.js/client resolved. Main can't run
    // Firestore, so this is how main's `user` learns the REAL account: browser
    // contexts resolve, the authority caches.
    ipc.handle('desktop:auth:account-resolved', (payload) => auth._handleAccountResolved(payload));

    // A renderer's `omega-signin` trigger: the sign-in round trip in the user's browser
    ipc.handle('desktop:auth:open-flow', () => auth._omega.openAuthFlow());

    // A renderer's `omega-account` trigger: the brand site's /account page in the
    // user's browser, on the host getWebsiteUrl() resolves (localhost in dev), the
    // tray's "Visit Website" resolution
    ipc.handle('desktop:auth:open-account', () => {
      const safe = sanitizeURL(new URL('/account', auth._omega.getWebsiteUrl()).toString());
      if (safe) require('electron').shell.openExternal(safe);
    });

    auth._ipcRegistered = true;
  },

  // UID-guarded: a push whose uid is not this session's (a stale push, or one from
  // before main signed in) lands nothing. An accepted push whose account differs
  // from the one `user` holds lands a new User and announces it.
  _handleAccountResolved({ uid, document, identity } = {}) {
    const mainUid = auth._firebaseAuth?.currentUser?.uid || null;
    if (!uid || uid !== mainUid) {
      return { accepted: false };
    }

    const next = new User(document, identity);

    // The account a renderer already pushed: nothing to land or announce
    if (auth.user.uid === next.uid && JSON.stringify(auth.user.toJSON()) === JSON.stringify(next.toJSON())) {
      return { accepted: true };
    }

    logger.log(`account resolved: plan=${next.plan} active=${next.active}`);
    auth._land(next);
    auth._omega.ipc.broadcast('desktop:auth:plan-changed', { document: next.toJSON() });

    return { accepted: true };
  },

  // Land a new User as the state and tell every listener; a throwing listener
  // never stops the others
  _land(user) {
    auth.user = user;
    auth.state = { user };

    for (const callback of [...auth._callbacks]) {
      try {
        callback(auth.state);
      } catch (e) {
        logger.error('auth listener threw:', e);
      }
    }
  },

  _handleAuthStateChange(user) {
    logger.log(`auth state → ${user ? user.email : 'signed out'}`);

    // The pushed account belongs to ONE uid: a sign-out, or a different account
    // signing in, drops it so `user` never claims a session main lost. Renderers
    // re-resolve and push fresh via desktop:auth:account-resolved.
    if (auth.user.authenticated && auth.user.uid !== (user?.uid || null)) {
      auth._land(new User());
    }

    // Tell renderers about the change so they can update UI / re-push their account.
    const identity = auth._identity(user);
    auth._omega.ipc.broadcast('desktop:auth:state-changed', identity);

    // Attribute Sentry events to the signed-in user (or clear on sign-out). When
    // sentry is disabled (no DSN, dev mode, etc.) setUser is a documented no-op.
    auth._omega.sentry.setUser(identity);
  },

  // A renderer reports its uid; main answers whether (and how) it must sync to main's user.
  async _handleSyncRequest(contextUid) {
    if (!auth._firebaseAuth) {
      return { needsSync: false, reason: 'firebase-not-loaded' };
    }

    const bgUser = auth._firebaseAuth.currentUser;
    const bgUid = bgUser?.uid || null;

    // Already in sync.
    if (contextUid === bgUid) {
      return { needsSync: false };
    }

    // Renderer signed in but main signed out → tell renderer to sign out.
    if (!bgUser && contextUid) {
      return { needsSync: true, signOut: true };
    }

    // Main signed in, renderer not (or different user) → fetch a fresh custom token + send.
    try {
      const token = await auth._fetchCustomToken();
      return {
        needsSync: true,
        customToken: token,
        user: auth._identity(bgUser),
      };
    } catch (e) {
      logger.error('sync-request: failed to fetch custom token:', e.message);
      return { needsSync: false, error: e.message };
    }
  },

  async _handleSignOut() {
    try {
      if (auth._firebaseAuth?.currentUser) {
        await auth._firebaseModule.signOut(auth._firebaseAuth);
      }
      auth._omega.ipc.broadcast('desktop:auth:sign-out', {});
      return { success: true };
    } catch (e) {
      logger.error('sign-out failed:', e.message);
      return { success: false, error: e.message };
    }
  },

  // Public API ──────────────────────────────────────────────────────────────────

  /**
   * Listen for state changes: every change after this call, plus a catch-up
   * with the current state, delivered after listen() returns.
   * @param {Function} callback - called with `{ user }`.
   * @returns {Function} the unsubscribe.
   */
  listen(callback) {
    auth._callbacks.push(callback);

    const current = auth.state;
    Promise.resolve().then(() => {
      if (auth.state === current && auth._callbacks.includes(callback)) {
        callback(auth.state);
      }
    });

    return () => {
      const index = auth._callbacks.indexOf(callback);
      if (index > -1) {
        auth._callbacks.splice(index, 1);
      }
    };
  },

  /**
   * Sign in with a custom token and hand the same token to every renderer.
   * Called by lib/deep-link's auth/token built-in.
   * @param {string} token - the Firebase custom token.
   * @returns {Promise<{ success: boolean, user?: object, reason?: string, error?: string }>}
   */
  async handleToken(token) {
    if (!auth._firebaseAuth) {
      logger.warn('handleToken called but firebase not loaded: ignoring.');
      return { success: false, reason: 'firebase-not-loaded' };
    }
    if (!token) {
      logger.warn('handleToken called with no token: ignoring.');
      return { success: false, reason: 'no-token' };
    }

    try {
      const cred = await auth._firebaseModule.signInWithCustomToken(auth._firebaseAuth, token);
      logger.log(`signed in: ${cred.user.email || cred.user.uid}`);

      // Broadcast the token to renderers so they can sign in with the SAME token.
      // Tokens expire in 1 hour and aren't stored.
      auth._omega.ipc.broadcast('desktop:auth:sign-in-with-token', { token });

      return { success: true, user: auth._identity(cred.user) };
    } catch (e) {
      logger.error('signInWithCustomToken failed:', e.message);
      return { success: false, error: e.message };
    }
  },

  /**
   * A fresh Firebase ID token for the signed-in session, for consumer main code
   * calling authenticated backend routes (`Authorization: Bearer <token>`).
   * @param {boolean} [force] - refresh the token even when the cached one is still valid.
   * @returns {Promise<string|null>} the token, or null when signed out or Firebase is absent.
   */
  async getIdToken(force) {
    const u = auth._firebaseAuth?.currentUser;
    return u ? u.getIdToken(force) : null;
  },

  /**
   * Sign main out and broadcast the sign-out to every renderer.
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  async signOut() {
    return auth._handleSignOut();
  },

  // ─── Internals ────────────────────────────────────────────────────────────

  // The sign-in's view of a Firebase user, the identity a `User` is built from:
  // no token field ever crosses the bridge
  _identity(user) {
    if (!user) return null;

    return {
      uid:           user.uid,
      email:         user.email,
      displayName:   user.displayName,
      photoURL:      user.photoURL,
      emailVerified: user.emailVerified,
    };
  },

  // Fetch a fresh custom token for the currently-signed-in user through the
  // instance's `omega.request()`: POST <apiUrl>/omega/user/token, with this
  // session's Bearer token. The route defaults uid to the authenticated caller
  // and responds { token } at the top level.
  async _fetchCustomToken() {
    const data = await auth._omega.request('/omega/user/token', { method: 'POST', body: {} });

    const token = data?.token;
    if (!token) {
      throw new Error('@omega.js/backend response missing token.');
    }
    return token;
  },

  // Tear-down used by tests: signs out and drops the account and the listeners,
  // but keeps registered IPC handlers (they're idempotent via `ipc.handle`
  // duplicate-detection).
  async _resetForTests() {
    try {
      if (auth._firebaseAuth?.currentUser && auth._firebaseModule?.signOut) {
        await auth._firebaseModule.signOut(auth._firebaseAuth);
      }
    } catch (e) { /* ignore */ }
    auth._callbacks = [];
    auth.user = new User();
    auth.state = { user: auth.user };
  },
};

module.exports = auth;
