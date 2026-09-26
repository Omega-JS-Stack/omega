// Background's auth: the service worker's OWN Firebase app and session, the
// source of truth every page context syncs with. The page contexts reach it
// only through the messenger (lib/messaging.js), the one lane between contexts:
//   omega:syncAuth  a page asks on load, pushing its identity + account document
//   omega:signOut   a page signed out; background signs out and broadcasts it
// and background broadcasts `omega:signInWithToken` / `omega:signOut` back.

// Firebase (static imports - a service worker cannot fetch code at runtime under MV3, so dynamic import() is not an option)
import { initializeApp, getApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signOut, onAuthStateChanged, connectAuthEmulator } from 'firebase/auth';
import { User } from '@omega.js/account';
import { requiredPort } from '../utils/url-helpers.js';
import LoggerLite from './logger-lite.js';
import Messaging from './messaging.js';

// The worker's Firebase app, by name: it never shares the [DEFAULT] app slot
const APP_NAME = 'omega-auth';

/**
 * Background's auth. `user` is always a `User`: signed out until a page
 * context pushes the account document of the uid this worker's Firebase
 * session holds, and signed out again the moment that session ends.
 */
class BackgroundAuth {
  /**
   * @param {object} omega - background's Omega instance (its config, extension, messenger, env and api helpers).
   */
  constructor(omega) {
    this.omega = omega;
    this.logger = new LoggerLite('auth');

    // The account as one `User`, never null
    this.user = new User();

    // The newest state, `{ user }`, the shape @omega.js/client's listeners get
    this.state = { user: this.user };

    // The named Firebase app and its auth, built on first use
    this._app = null;
    this._firebaseAuth = null;

    this._callbacks = [];
  }

  /**
   * Wire the auth lane: the page contexts' messages, the website sign-in
   * redirect, and the persisted session.
   * @returns {void}
   */
  initialize() {
    // Contexts ask background for auth state on load, and report their sign-outs
    this.omega.messenger.onMessage((message, _sender, sendResponse) => {
      if (message.command === 'omega:syncAuth') {
        this.handleSyncAuth(message.payload).then(sendResponse);
        return true; // Keep channel open for async response
      }

      if (message.command === 'omega:signOut') {
        this.handleSignOut().then(sendResponse);
        return true; // Keep channel open for async response
      }
    });

    // Setup auth token listener (for cross-runtime auth)
    this.setupAuthTokenListener();

    // Initialize Firebase auth on startup (restores persisted session if any)
    this.initializeAuth();
  }

  /**
   * Listen for state changes: every change after this call, plus a catch-up
   * with the current state, delivered after listen() returns.
   * @param {Function} callback - called with `{ user }`.
   * @returns {Function} the unsubscribe.
   */
  listen(callback) {
    this._callbacks.push(callback);

    const current = this.state;
    Promise.resolve().then(() => {
      if (this.state === current && this._callbacks.includes(callback)) {
        callback(this.state);
      }
    });

    return () => {
      const index = this._callbacks.indexOf(callback);
      if (index > -1) {
        this._callbacks.splice(index, 1);
      }
    };
  }

  /**
   * Sign this worker's Firebase session out. The state change that follows
   * drops the account (see handleAuthStateChange).
   * @returns {Promise<void>}
   */
  async signOut() {
    // No auth built yet (a Firebase-less brand never builds one) is no session to end
    if (this._firebaseAuth && this._firebaseAuth.currentUser) {
      await signOut(this._firebaseAuth);
    }
  }

  /**
   * A fresh Firebase ID token for this worker's session, for background code
   * calling authenticated backend routes (`Authorization: Bearer <token>`);
   * `omega.request()` attaches it on its own.
   * @param {boolean} [force] - refresh the token even when the cached one is still valid.
   * @returns {Promise<string|null>} the token, or null when signed out or Firebase is absent.
   */
  async getIdToken(force) {
    const user = this._firebaseAuth?.currentUser;
    return user ? user.getIdToken(force) : null;
  }

  // Land a new User as the state and tell every listener; a throwing listener
  // never stops the others
  _land(user) {
    this.user = user;
    this.state = { user };

    for (const callback of [...this._callbacks]) {
      try {
        callback(this.state);
      } catch (error) {
        this.logger.error('Auth state callback error:', error);
      }
    }
  }

  // Handle auth sync request from other contexts (popup, page, options, sidepanel)
  // Compares the context's UID with background's and provides a fresh token only
  // if different. In sync, the pushed account document IS this session's, so
  // background lands the same `User` the page holds.
  // Resolves the response the page reads; never rejects.
  async handleSyncAuth(payload = {}) {
    try {
      const contextUid = payload.uid || null; // UID from asking context (or null)

      // Get or initialize Firebase auth
      const auth = this.getFirebaseAuth();
      const bgUser = auth.currentUser;
      const bgUid = bgUser?.uid || null;

      this.logger.log('syncAuth: Comparing UIDs - context:', contextUid, 'background:', bgUid);

      // Already in sync (both null, or same UID)
      if (contextUid === bgUid) {
        if (contextUid) {
          const { uid, email, displayName, photoURL, emailVerified } = payload;
          this._land(new User(payload.document, { uid, email, displayName, photoURL, emailVerified }));
        }

        this.logger.log('syncAuth: Already in sync');
        return { needsSync: false };
      }

      // Context is signed in but background is not → context should sign out
      if (!bgUser && contextUid) {
        this.logger.log('syncAuth: Background signed out, telling context to sign out');
        return { needsSync: true, signOut: true };
      }

      // Background is signed in, context is not (or different user) → provide token
      this.logger.log('syncAuth: Fetching fresh custom token for context...', bgUser.email);

      // Fetch a fresh custom token from the /user/token route through the
      // instance's omega.request(), with this worker's Bearer token (uid
      // defaults server-side to the authenticated caller). getApiUrl() throws
      // when brand.url is missing: a misconfigured brand should fail loudly,
      // never call a foreign host.
      const data = await this.omega.request('/omega/user/token', { method: 'POST', body: {} });

      // Check for token in response ({ token } at the top level)
      if (!data.token) {
        throw new Error('No token in server response');
      }

      this.logger.log('syncAuth: Got fresh custom token, sending to context');

      // Send user info and fresh custom token
      return {
        needsSync: true,
        customToken: data.token,
        user: {
          uid: bgUser.uid,
          email: bgUser.email,
          displayName: bgUser.displayName,
          photoURL: bgUser.photoURL,
          emailVerified: bgUser.emailVerified,
        },
      };

    } catch (error) {
      this.logger.error('syncAuth error:', error.message);
      return { needsSync: false, error: error.message };
    }
  }

  // Handle sign-out request from a context
  // Signs out background's Firebase and broadcasts to all other contexts
  async handleSignOut() {
    try {
      this.logger.log('handleSignOut: Signing out background Firebase...');

      await this.signOut();

      // Broadcast to all contexts
      await this.broadcastSignOut();

      this.logger.log('handleSignOut: Complete');
      return { success: true };
    } catch (error) {
      this.logger.error('handleSignOut error:', error.message);
      return { success: false, error: error.message };
    }
  }

  // Broadcast sign-out to all open extension contexts
  async broadcastSignOut() {
    this.logger.log('Broadcasting sign-out...');

    await this.omega.messenger.send({ destination: Messaging.BROADCAST, command: 'omega:signOut' });

    this.logger.log('Sign-out broadcast complete');
  }

  // Setup auth token listener (monitors tabs for auth tokens from website)
  setupAuthTokenListener() {
    // DEBUG: Log the full config to see what we have
    this.logger.log('setupAuthTokenListener called');
    this.logger.log('config:', this.omega.config);

    // The sign-in round trip lands on the BRAND site (/token redirects with
    // ?authToken=…), so match the brand.url host, never authDomain, which
    // is an auth concern that must stay free to change independently.
    const brandUrl = this.omega.config.brand?.url;

    // Skip if no brand url configured: there is no site to watch for the redirect
    if (!brandUrl) {
      this.logger.log('No brand.url configured, skipping auth token listener');
      return;
    }

    const brandHost = new URL(brandUrl).hostname;

    // Log
    this.logger.log(`Setting up auth token listener for domain: ${brandHost}`);

    // Listen for tab URL changes
    this.omega.extension.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      // Only process when URL changes and is complete
      if (changeInfo.status !== 'complete' || !tab.url) {
        return;
      }

      // Parse the URL
      let tabUrl;
      try {
        tabUrl = new URL(tab.url);
      } catch (e) {
        return;
      }

      // Log every tab update for auth domain matching
      this.logger.log(`Tab updated: ${tabUrl.hostname} (looking for: ${brandHost})`);

      // Check if this is our brand site
      if (tabUrl.hostname !== brandHost) {
        return;
      }

      // Log - we found our domain
      this.logger.log(`Auth domain matched! Checking for authToken param...`);

      // Check for authToken param
      const authToken = tabUrl.searchParams.get('authToken');
      if (!authToken) {
        this.logger.log(`No authToken param found in URL: ${tabUrl.href}`);
        return;
      }

      // Get source tab ID to restore after auth
      const authSourceTabId = tabUrl.searchParams.get('authSourceTabId');

      // Log
      this.logger.log('Auth token detected in tab:', tabId);

      // Handle the auth token
      this.handleAuthToken(authToken, tabId, authSourceTabId ? parseInt(authSourceTabId, 10) : null);
    });
  }

  // Initialize Firebase auth on startup
  // Firebase Auth persists sessions in IndexedDB - we just need to initialize it
  initializeAuth() {
    // Skip without a Firebase config: a Firebase-less brand has no session to restore
    const firebaseConfig = this.omega.config.cloud?.config;
    if (!firebaseConfig) {
      this.logger.log('Firebase config not available, skipping auth initialization');
      return;
    }

    // Initialize Firebase auth - it will auto-restore from IndexedDB if session exists
    this.logger.log('Initializing Firebase Auth (will restore persisted session if any)...');
    const auth = this.getFirebaseAuth();

    // Check if already signed in (Firebase restored from IndexedDB)
    if (auth.currentUser) {
      this.logger.log('Firebase restored session from persistence:', auth.currentUser.email);
    } else {
      this.logger.log('No persisted Firebase session found');
    }
  }

  // Get or initialize Firebase auth (reuse existing instance)
  getFirebaseAuth() {
    // Return existing instance if available
    if (this._firebaseAuth) {
      return this._firebaseAuth;
    }

    // Get Firebase config
    const firebaseConfig = this.omega.config.cloud?.config;
    if (!firebaseConfig) {
      throw new Error('Firebase config not available');
    }

    // Try to get existing app or create new one
    try {
      this._app = getApp(APP_NAME);
    } catch (e) {
      this._app = initializeApp(firebaseConfig, APP_NAME);
    }

    // Get auth and set up state listener (only once)
    this._firebaseAuth = getAuth(this._app);

    // A TESTING build talks to the LOCAL stack, never real auth: the same
    // call getApiUrl() makes when it maps testing to localhost, and the same
    // move @omega.js/client makes for emulator runs. Only a build baked with
    // OMEGA_TEST_MODE=true reaches here; dev and production are untouched.
    if (this.omega.isTesting()) {
      // An extension context has no `process.env`, so the resolved map arrives
      // BAKED in OMEGA_BUILD_JSON's `config.dev.ports`
      // ([#300](https://github.com/Omega-JS-Stack/omega/issues/300)). The
      // classic auth port used to sit under it for a build made with no stack
      // up; it is gone (#834), numbers and all, because a neighbouring
      // project's emulator holding that port reads as an auth mystery rather
      // than as a port problem.
      const port = requiredPort(this.omega, 'OMEGA_AUTH_PORT', 'auth');
      this.logger.log(`Testing build: connecting auth to the emulator on :${port}`);
      connectAuthEmulator(this._firebaseAuth, `http://localhost:${port}`, { disableWarnings: true });
    }

    // Set up auth state change listener (background is source of truth)
    onAuthStateChanged(this._firebaseAuth, (user) => {
      this.handleAuthStateChange(user);
    });

    return this._firebaseAuth;
  }

  // Handle Firebase auth state changes (source of truth for all contexts).
  // The pushed account belongs to ONE uid: a sign-out, or a different account
  // signing in, drops it so `user` never claims a session this worker lost.
  handleAuthStateChange(user) {
    this.logger.log('Auth state changed:', user?.email || 'signed out');

    if (this.user.authenticated && this.user.uid !== (user?.uid || null)) {
      this._land(new User());
    }
  }

  // Handle auth token from website (custom token from /token page)
  async handleAuthToken(token, tabId, authSourceTabId = null) {
    try {
      // Log
      this.logger.log('Processing auth token...');

      // Get or initialize Firebase auth
      const auth = this.getFirebaseAuth();

      // Sign in with custom token
      this.logger.log('Calling signInWithCustomToken...');
      const userCredential = await signInWithCustomToken(auth, token);
      const user = userCredential.user;

      // Log
      this.logger.log('Signed in successfully:', user.email);

      // Broadcast token to all open extension contexts so they can sign in immediately
      // Token is NOT stored - it expires in 1 hour and is only needed for initial sign-in
      this.broadcastAuthToken(token);

      // Close the auth tab
      await this.omega.extension.tabs.remove(tabId);
      this.logger.log('Auth tab closed');

      // Reactivate the source tab if provided
      if (authSourceTabId) {
        try {
          await this.omega.extension.tabs.update(authSourceTabId, { active: true });
          this.logger.log('Restored source tab:', authSourceTabId);
        } catch (e) {
          // Tab may have been closed, ignore
          this.logger.log('Could not restore source tab (may be closed):', authSourceTabId);
        }
      }

    } catch (error) {
      this.logger.error('Error handling auth token:', error);
    }
  }

  // Broadcast auth token to all open extension contexts
  // Used during initial sign-in to immediately sync all open popups, pages, etc.
  async broadcastAuthToken(token) {
    this.logger.log('Broadcasting token...');

    await this.omega.messenger.send({ destination: Messaging.BROADCAST, command: 'omega:signInWithToken', payload: { token } });

    this.logger.log('Token broadcast complete');
  }
}

export default BackgroundAuth;
export { BackgroundAuth };
