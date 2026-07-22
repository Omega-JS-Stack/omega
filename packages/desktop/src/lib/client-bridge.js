// Client bridge — main-process Firebase Auth, source of truth for renderers.
//
// This is @omega.js/desktop's analogue of BXM's background-service-worker auth role. The pattern:
//
//   1. Main runs its own Firebase Auth instance and is the source of truth.
//   2. When a deep-link auth/token arrives, main calls signInWithCustomToken with that token,
//      then BROADCASTS the token to all renderer windows so their @omega.js/client Firebase
//      instances can sign in with the SAME token.
//   3. On every renderer load, the renderer asks main "I'm at UID X (or null)" via the
//      desktop:auth:sync-request IPC. Main compares with its own UID and either does nothing,
//      tells the renderer to sign out, or fetches a fresh custom token from /omega
//      and sends it to the renderer.
//   4. Sign-out: any renderer can request sign-out via desktop:auth:sign-out. Main signs out
//      its own Firebase + broadcasts desktop:auth:sign-out to all renderers.
//
// Firebase is BUNDLED by webpack from @omega.js/desktop's module context (@omega.js/client owns it in @omega.js/desktop's
// tree). If loading fails, the bridge stays in no-op mode and logs the reason.

const LoggerLite = require('./logger-lite.js');
const authPersistence = require('./auth-persistence.js');

const logger = new LoggerLite('client-bridge');

const FIREBASE_APP_NAME = 'omega-auth';

const bridge = {
  _initialized:    false,
  _manager:        null,
  _firebase:       null,    // firebase/app
  _firebaseAuth:   null,    // auth instance
  _firebaseModule: null,    // firebase/auth namespace (signInWithCustomToken, signOut, ...)
  _stateSubs:      new Set(), // main-side subscribers fn(user)
  _ipcRegistered:  false,
  _resolvedPlan:   null,    // renderer-resolved subscription { plan, active, trialing, cancelling }
  _resolvedRoles:  null,    // renderer-resolved account roles { admin, betaTester, ... }

  async initialize(manager) {
    if (bridge._initialized) {
      return;
    }

    bridge._manager = manager;

    // Try to load firebase. If it's not installed, run in no-op mode.
    const ok = await bridge._tryLoadFirebase();
    if (!ok) {
      logger.warn('firebase not installed — client-bridge running in no-op mode. `npm i firebase` to enable auth.');
    }

    bridge._registerIpc();

    if (ok) {
      // Boot Firebase Auth. With a persistence strategy active (lib/auth-persistence.js,
      // default safeStorage), the session survives restarts — the restore lands async
      // via onAuthStateChanged shortly after boot.
      try {
        const strategy = await authPersistence.resolve(manager);
        bridge._firebaseAuth = bridge._getFirebaseAuth(strategy);
        // onAuthStateChanged is the source of truth listener.
        bridge._firebaseModule.onAuthStateChanged(bridge._firebaseAuth, (user) => {
          bridge._handleAuthStateChange(user);
        });
        logger.log(`initialize — firebase loaded (persistence: ${strategy ? strategy.name : 'in-memory'})`);
      } catch (e) {
        logger.error('firebase init failed:', e.message);
      }
    }

    bridge._initialized = true;
  },

  // Load firebase. Returns true on success. BUNDLED by webpack from @omega.js/desktop's module context
  // (@omega.js/client owns firebase in @omega.js/desktop's tree) — same treatment as json5 in main.js. It was
  // previously a webpackIgnore'd runtime import(), which resolves relative to the CONSUMER's
  // main.bundle.js: that walk never reaches @omega.js/desktop's node_modules when @omega.js/desktop is symlinked
  // (`mgr install dev`) and depends on npm hoisting when installed — every dev app silently
  // ran the bridge in no-op mode. Interop guards handle both namespace shapes (json5 precedent).
  async _tryLoadFirebase() {
    try {
      const appMod  = require('firebase/app');
      const authMod = require('firebase/auth');

      bridge._firebase       = appMod.initializeApp ? appMod : (appMod.default || appMod);
      bridge._firebaseModule = authMod.getAuth      ? authMod : (authMod.default || authMod);
      return true;
    } catch (e) {
      logger.warn('firebase load failed:', e.message);
      return false;
    }
  },

  _getFirebaseAuth(strategy) {
    if (bridge._firebaseAuth) return bridge._firebaseAuth;

    const firebaseConfig = bridge._manager.config.cloud?.config;
    if (!firebaseConfig || !Object.keys(firebaseConfig).length) {
      throw new Error('cloud.config is empty — cannot initialize auth.');
    }

    const { initializeApp, getApp } = bridge._firebase;
    const { getAuth, initializeAuth } = bridge._firebaseModule;

    let app;
    try { app = getApp(FIREBASE_APP_NAME); }
    catch (e) { app = initializeApp(firebaseConfig, FIREBASE_APP_NAME); }

    // With a storage strategy, boot auth on OUR persistence (session survives
    // restarts); without one, firebase's Node default (in-memory) applies.
    if (strategy && initializeAuth) {
      bridge._firebaseAuth = initializeAuth(app, {
        persistence: [authPersistence.buildFirebasePersistence(strategy)],
      });
    } else {
      bridge._firebaseAuth = getAuth(app);
    }
    return bridge._firebaseAuth;
  },

  _registerIpc() {
    if (bridge._ipcRegistered) return;
    const ipc = bridge._manager.ipc;

    // Renderer asks main: "I'm at UID X (or null). Are we in sync?"
    ipc.handle('desktop:auth:sync-request', async ({ contextUid }) => {
      return bridge._handleSyncRequest(contextUid);
    });

    // Renderer asks main to sign out.
    ipc.handle('desktop:auth:sign-out', async () => {
      return bridge._handleSignOut();
    });

    // Renderer asks main for the current user (uid + email + displayName, no token).
    ipc.handle('desktop:auth:get-user', () => {
      const u = bridge._firebaseAuth?.currentUser;
      return u ? bridge._snapshotUser(u) : null;
    });

    // Renderer pushes its @omega.js/client account resolution (auth().listen() settled:
    // Firestore account fetched, subscription resolved). Main can't run Firestore,
    // so this is how main-side plan gates learn the REAL plan — BXM's "browser
    // contexts resolve, authority caches" split. UID-guarded: a stale push from a
    // renderer that hasn't synced yet is dropped.
    ipc.handle('desktop:auth:account-resolved', ({ uid, resolved, roles } = {}) => {
      const mainUid = bridge._firebaseAuth?.currentUser?.uid || null;
      if (!uid || uid !== mainUid) {
        return { accepted: false };
      }

      const changed = JSON.stringify(resolved) !== JSON.stringify(bridge._resolvedPlan)
        || JSON.stringify(roles || null) !== JSON.stringify(bridge._resolvedRoles);
      bridge._resolvedPlan  = resolved || null;
      bridge._resolvedRoles = roles || null;

      if (changed) {
        logger.log(`account resolved — plan=${resolved?.plan || '(none)'} active=${!!resolved?.active}`);
        bridge._manager.ipc.broadcast('desktop:auth:plan-changed', { resolved: bridge._resolvedPlan, roles: bridge._resolvedRoles });
        // Main-side subscribers see the same user snapshot again with plan now known.
        const u = bridge._firebaseAuth?.currentUser;
        bridge._stateSubs.forEach((fn) => {
          try { fn(u ? bridge._snapshotUser(u) : null); } catch (e) { logger.error('onAuthChange subscriber threw:', e); }
        });
      }
      return { accepted: true };
    });

    bridge._ipcRegistered = true;
  },

  _handleAuthStateChange(user) {
    logger.log(`auth state → ${user ? user.email : 'signed out'}`);

    // Sign-out (or a different user signing in) invalidates the cached resolution —
    // renderers re-resolve and push fresh via desktop:auth:account-resolved.
    if (!user) {
      bridge._resolvedPlan = null;
      bridge._resolvedRoles = null;
    }

    // Notify any main-side subscribers (consumer code that called manager.omega.onAuthChange).
    const snap = user ? bridge._snapshotUser(user) : null;
    bridge._stateSubs.forEach((fn) => {
      try { fn(snap); } catch (e) { logger.error('onAuthChange subscriber threw:', e); }
    });

    // Tell renderers about the change so they can update UI / refresh menu items.
    bridge._manager.ipc.broadcast('desktop:auth:state-changed', snap);

    // Attribute Sentry events to the signed-in user (or clear on sign-out). When
    // sentry is disabled (no DSN, dev mode, etc.) setUser is a documented no-op.
    bridge._manager.sentry.setUser(snap);
  },

  // BXM's syncAuth pattern, ported to Electron.
  async _handleSyncRequest(contextUid) {
    if (!bridge._firebaseAuth) {
      return { needsSync: false, reason: 'firebase-not-loaded' };
    }

    const bgUser = bridge._firebaseAuth.currentUser;
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
      const token = await bridge._fetchCustomToken(bgUser);
      return {
        needsSync: true,
        customToken: token,
        user: bridge._snapshotUser(bgUser),
      };
    } catch (e) {
      logger.error('sync-request: failed to fetch custom token:', e.message);
      return { needsSync: false, error: e.message };
    }
  },

  async _handleSignOut() {
    try {
      if (bridge._firebaseAuth?.currentUser) {
        await bridge._firebaseModule.signOut(bridge._firebaseAuth);
      }
      bridge._manager.ipc.broadcast('desktop:auth:sign-out', {});
      return { success: true };
    } catch (e) {
      logger.error('sign-out failed:', e.message);
      return { success: false, error: e.message };
    }
  },

  // Public API ──────────────────────────────────────────────────────────────────

  // Called by lib/deep-link's auth/token built-in.
  async handleAuthToken(token) {
    if (!bridge._firebaseAuth) {
      logger.warn('handleAuthToken called but firebase not loaded — ignoring.');
      return { success: false, reason: 'firebase-not-loaded' };
    }
    if (!token) {
      logger.warn('handleAuthToken called with no token — ignoring.');
      return { success: false, reason: 'no-token' };
    }

    try {
      const cred = await bridge._firebaseModule.signInWithCustomToken(bridge._firebaseAuth, token);
      logger.log(`signed in: ${cred.user.email || cred.user.uid}`);

      // Broadcast the token to renderers so they can sign in with the SAME token.
      // Tokens expire in 1 hour and aren't stored.
      bridge._manager.ipc.broadcast('desktop:auth:sign-in-with-token', { token });

      return { success: true, user: bridge._snapshotUser(cred.user) };
    } catch (e) {
      logger.error('signInWithCustomToken failed:', e.message);
      return { success: false, error: e.message };
    }
  },

  // Subscribe to auth state changes on the main side (e.g. for menu/tray refresh).
  onAuthChange(fn) {
    bridge._stateSubs.add(fn);
    return () => bridge._stateSubs.delete(fn);
  },

  // Snapshot of the current user (sync), or null.
  getCurrentUser() {
    const u = bridge._firebaseAuth?.currentUser;
    return u ? bridge._snapshotUser(u) : null;
  },

  // The renderer-resolved subscription ({ plan, active, trialing, cancelling }) or null
  // while no renderer has resolved yet. THE main-side plan source — consumer plan gates
  // read this (@omega.js/client's resolveSubscription output, pushed via desktop:auth:account-resolved).
  getResolvedPlan() {
    return bridge._resolvedPlan;
  },

  // The renderer-resolved account roles ({ admin, betaTester, ... }) or null.
  getResolvedRoles() {
    return bridge._resolvedRoles;
  },

  // Fresh Firebase ID token for the signed-in user (async), or null when
  // signed out / Firebase absent. For consumer main code calling
  // authenticated backend routes (`Authorization: Bearer <token>`).
  async getIdToken() {
    const u = bridge._firebaseAuth?.currentUser;
    return u ? u.getIdToken() : null;
  },

  // Force sign-out from main code.
  async signOut() {
    return bridge._handleSignOut();
  },

  // ─── Internals ────────────────────────────────────────────────────────────

  _snapshotUser(user) {
    return {
      uid:           user.uid,
      email:         user.email,
      displayName:   user.displayName,
      photoURL:      user.photoURL,
      emailVerified: user.emailVerified,
    };
  },

  // Fetch a fresh custom token for the currently-signed-in user via the shared
  // @omega.js/client request layer. Mirrors BXM: POST <apiUrl>/omega/user/token —
  // the route defaults uid to the authenticated caller and responds { token }
  // at the top level.
  async _fetchCustomToken(user) {
    const { createRequest } = require('@omega.js/client/modules/request.js');

    const request = createRequest({
      getApiUrl: () => bridge._manager.getApiUrl(),
      getIdToken: (force) => user.getIdToken(force),
    });

    const data = await request('/omega/user/token', { method: 'POST', body: {} });

    const token = data?.token;
    if (!token) {
      throw new Error('@omega.js/backend response missing token.');
    }
    return token;
  },

  // Tear-down used by tests — wipes state but keeps registered IPC handlers
  // (they're idempotent via `ipc.handle` duplicate-detection).
  async _resetForTests() {
    try {
      if (bridge._firebaseAuth?.currentUser && bridge._firebaseModule?.signOut) {
        await bridge._firebaseModule.signOut(bridge._firebaseAuth);
      }
    } catch (e) { /* ignore */ }
    bridge._stateSubs.clear();
  },
};

module.exports = bridge;
