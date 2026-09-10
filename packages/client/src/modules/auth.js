// The account schema + subscription derivation live in @omega.js/account — the
// single source of truth shared with @omega.js/backend, so a doc resolved here is
// byte-identical to one resolved by the backend. No generators are injected:
// $uuid/$randomId/$apiKey fields resolve to null (real values always come from
// the backend-written doc).
import { resolveAccount, resolveSubscription } from '@omega.js/account';
import { resolveFeatures } from '@omega.js/account/features';
import { registerTrigger } from './triggers.js';
import { createLogger } from './logger.js';

const logger = createLogger('auth');

// The auth codes the session probe refuses to read as a verdict on the session
// ([#798](https://github.com/Omega-JS-Stack/omega/issues/798)): the connection,
// a throttle, and the Auth server failing to answer at all. They all clear on
// their own, and signing a user out over one loses a session that never died.
// Every OTHER `auth/*` code is a definite verdict, so it signs out.
const TRANSIENT_PROBE_CODES = new Set([
  'auth/network-request-failed',
  'auth/too-many-requests',
  'auth/internal-error',
]);

class Auth {
  constructor(manager) {
    this.manager = manager;
    this._authStateCallbacks = [];
    this._hasProcessedStateChange = false;

    // Bumped by every auth state change so emissions stay strictly ordered: a
    // signed-in emission awaits its account fetch while a signed-out one fires
    // instantly, so a slow fetch would otherwise deliver a STALE signed-in
    // state after a newer signed-out one (#196).
    this._stateGeneration = 0;

    // The one probe in flight, or null (#798; see probeSession)
    this._sessionProbe = null;
  }

  // Check if user is authenticated
  isAuthenticated() {
    return !!this.getUser();
  }

  // Get current user
  getUser() {
    const user = this.manager.firebaseAuth?.currentUser;
    if (!user) return null;

    // Get displayName and photoURL from providerData if not set on main user
    let displayName = user.displayName;
    let photoURL = user.photoURL;

    // If no displayName or photoURL, check providerData
    if ((!displayName || !photoURL) && user.providerData && user.providerData.length > 0) {
      for (const provider of user.providerData) {
        if (!displayName && provider.displayName) {
          displayName = provider.displayName;
        }
        if (!photoURL && provider.photoURL) {
          photoURL = provider.photoURL;
        }
        // Stop if we found both
        if (displayName && photoURL) break;
      }
    }

    // If still no displayName, use email or fallback
    if (!displayName) {
      displayName = user.email ? user.email.split('@')[0] : 'User';
    }

    // If still no photoURL, use a default avatar service
    if (!photoURL) {
      // Use ui-avatars.com which generates avatars from initials
      const name = displayName || user.email.split('@')[0] || 'ME';
      const initials = name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
      photoURL = `https://ui-avatars.com/api/?name=${encodeURIComponent(initials)}&size=200&background=random&color=000`;
    }

    return {
      uid: user.uid,
      email: user.email,
      displayName: displayName,
      photoURL: photoURL,
      emailVerified: user.emailVerified,
      metadata: user.metadata,
      providerData: user.providerData,
    };
  }

  // Listen for auth state changes (waits for settled state before first callback)
  listen(options = {}, callback) {
    // Handle overloaded signatures - if first param is a function, it's the callback
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }

    // If Firebase can't boot, call callback immediately with null. Same
    // condition as initialize(): a projectId-only blob resolves (URL
    // derivation) but never registers onAuthStateChanged, so _authReady
    // would never settle and listeners would hang forever.
    if (!this.manager._resolveFirebaseConfig()?.apiKey) {
      callback({
        user: null,
        account: resolveAccount({}),
      });

      return () => {};
    }

    // Build auth state and call the provided callback.
    // Returns true when it delivered, false when a newer state superseded it.
    const run = async (user) => {
      const generation = this._stateGeneration;
      const state = { user: this.getUser() };

      // Fetch account data if the user is logged in and Firestore is available
      // (every failure but a denied read is captured inside _getAccountData and
      // degrades to null)
      if (user && this.manager.firebaseFirestore) {
        try {
          state.account = await this._getAccountData(user.uid);
        } catch (error) {
          // The one failure _getAccountData rethrows: rules denied the read.
          // Consumers branch on THIS flag and never on an empty account — a doc
          // that is not written yet is the normal state right after signup
          // ([#700](https://github.com/Omega-JS-Stack/omega/issues/700)). The
          // account still resolves to the empty shape below, so nothing
          // downstream has to null-check.
          logger.warn('Account read denied — flagging the state as denied:', error.message);
          state.accountDenied = true;
        }
      }

      // A newer auth state change owns the truth now — delivering this one
      // would hand consumers a stale user out of order. Drop it entirely; the
      // newer run updates the bindings, the storage and the callback.
      if (generation !== this._stateGeneration) {
        logger.warn('Dropping a superseded auth state emission — a newer state change owns the truth');
        return false;
      }

      // Ensure account is always a resolved object
      state.account = state.account || resolveAccount({}, { user: { uid: user?.uid } });

      // Derive resolved subscription state for bindings and consumers
      state.resolved = this.resolveSubscription(state.account);

      // Update bindings and storage once per auth state change
      if (!this._hasProcessedStateChange) {
        this.manager.bindings().update({
          auth: state,
          usage: this._resolveUsage(state),
        });
        this.manager.storage().set('auth', state);

        this._hasProcessedStateChange = true;
      }

      callback(state);

      return true;
    };

    // Once listeners: wait for auth to settle, fire once, done.
    // A superseded run must be RE-DELIVERED here: a once listener holds no
    // subscription, so nothing would ever re-issue it and every awaiting caller
    // (checkout boot, the extension auth helpers) would hang forever. Each retry
    // re-reads the current user, so the loop settles as soon as auth stops
    // changing. The persistent path below needs no loop — it IS subscribed, so
    // the superseding state change re-issues through _authStateCallbacks.
    if (options.once) {
      this.manager._authReady.then(async () => {
        let delivered = false;

        while (!delivered) {
          delivered = await run(this.manager.firebaseAuth?.currentUser || null);

          if (!delivered) {
            logger.warn('Re-running a superseded once listener with the newest auth state');
          }
        }
      });

      return () => {};
    }

    // Persistent listeners: subscribe to all auth state changes (initial + future)
    // If auth already settled, fire the first callback via the promise to catch up
    const unsubscribe = this._subscribe(run);

    if (this.manager._firebaseAuthInitialized) {
      this.manager._authReady.then(() => {
        run(this.manager.firebaseAuth?.currentUser || null);
      });
    }

    return unsubscribe;
  }

  // Subscribe to ongoing auth state changes (sign-in, sign-out after initial settle)
  _subscribe(callback) {
    this._authStateCallbacks.push(callback);

    return () => {
      const index = this._authStateCallbacks.indexOf(callback);
      if (index > -1) {
        this._authStateCallbacks.splice(index, 1);
      }
    };
  }

  // Called by Manager when Firebase auth state changes
  _handleAuthStateChange(user) {
    // Supersede any in-flight emission before starting this one
    this._stateGeneration++;

    // Reset state processing flag for new auth state
    this._hasProcessedStateChange = false;

    // Call all persistent listener callbacks
    this._authStateCallbacks.forEach(callback => {
      try {
        callback(user);
      } catch (error) {
        console.error('Auth state callback error:', error);
      }
    });
  }

  // Resolves calculated subscription fields that require derivation logic
  // (shared @omega.js/account implementation — same math as the backend).
  // Returns: { plan, active, trialing, cancelling, everPaid }
  // Falls back to the stored auth state when no account is passed.
  resolveSubscription(account) {
    return resolveSubscription(account || this.manager.storage().get('auth', {})?.account);
  }

  // Resolve usage bindings from account data + the EFFECTIVE limits of the
  // resolved plan ([#647](https://github.com/Omega-JS-Stack/omega/issues/647)).
  // Returns, per counted feature:
  //   { monthly, daily, total, limit, left, day: { limit, used, left }, override }
  //
  // Both halves are config: the FEATURES CATALOG (`config.features`) says what
  // a feature is and whether it is counted, and the product's `features` map
  // (`config.payment.products[].features`) says what this tier promises. The
  // arithmetic — the per-user override winning over the plan's number, the day
  // share of a month limit — is @omega.js/account's, the same module the
  // backend's `consume` gate reads, so a bar can never draw a limit the gate
  // would not enforce.
  _resolveUsage(state) {
    const accountUsage = state.account?.usage || {};
    const productId    = state.resolved?.plan || 'basic';
    const products     = this.manager.config.payment?.products || [];
    const product      = products.find(p => p.id === productId) || {};
    const catalog      = this.manager.config.features || {};

    const usage = {};

    for (const resolved of resolveFeatures({ catalog, product, account: state.account })) {
      if (!resolved.counted) {
        continue;
      }

      usage[resolved.id] = {
        ...(accountUsage[resolved.id] || {}),
        limit: resolved.limit,
        left: resolved.left,
        override: resolved.override,
        day: resolved.day,
      };
    }

    // A counter the account carries that the catalog no longer defines still
    // rides the bindings — a page that reads it must not blank out mid-release
    for (const key of Object.keys(accountUsage)) {
      if (key !== 'overrides' && !usage[key]) {
        usage[key] = { ...accountUsage[key], limit: 0 };
      }
    }

    return usage;
  }

  // Get ID token for the current user
  async getIdToken(forceRefresh = false) {
    try {
      const user = this.manager.firebaseAuth.currentUser;

      const { getIdToken } = await import('firebase/auth');
      return await getIdToken(user, forceRefresh);
    } catch (error) {
      console.error('Get ID token error:', error);
      throw error;
    }
  }

  // Ask the Auth SERVER whether this session is still good, at a moment of
  // doubt ([#798](https://github.com/Omega-JS-Stack/omega/issues/798)). Firebase
  // itself only asks at page load and at the hourly refresh, so a revoked,
  // disabled or deleted account keeps an open tab signed in until a reload,
  // and a dev backend restart leaves the tab on a session the emulator no
  // longer has. The probe is a FORCED token refresh, which exchanges the
  // refresh token with the Auth server; it never asks our backend, so dev and
  // production run the same code.
  //
  // Resolves 'signed-out' | 'alive' | 'gone' | 'unknown', and never rejects on
  // the classification itself: callers fire it and move on.
  probeSession() {
    if (!this.isAuthenticated()) {
      return Promise.resolve('signed-out');
    }

    // One probe in flight per instance: focus, online and a 401 arrive
    // together all the time, and they are all asking the same question.
    if (this._sessionProbe) {
      return this._sessionProbe;
    }

    this._sessionProbe = this._runSessionProbe().finally(() => {
      this._sessionProbe = null;
    });

    return this._sessionProbe;
  }

  async _runSessionProbe() {
    try {
      await this.getIdToken(true);
      return 'alive';
    } catch (error) {
      const code = error.code || '';

      // An auth error carrying a verdict means the session is gone: expired,
      // revoked, disabled, deleted. Sign out: the onAuthStateChanged emission
      // is what drives every surface's policy listener.
      if (code.startsWith('auth/') && !TRANSIENT_PROBE_CODES.has(code)) {
        logger.warn(`Session is gone (${code}); signing out`);
        await this.signOut();
        return 'gone';
      }

      // A bad connection, a throttle and a failing Auth server never sign
      // anyone out, and neither does the "Backend starting" window: keep the
      // user and say nothing louder.
      logger.log(`Session probe inconclusive (${code || error.message}); keeping the user signed in`);
      return 'unknown';
    }
  }

  // Sign in with custom token
  async signInWithCustomToken(token) {
    try {
      if (!this.manager.firebaseAuth) {
        throw new Error('Firebase Auth is not initialized');
      }

      const { signInWithCustomToken } = await import('firebase/auth');
      const userCredential = await signInWithCustomToken(this.manager.firebaseAuth, token);
      return userCredential.user;
    } catch (error) {
      console.error('Sign in with custom token error:', error);
      throw error;
    }
  }

  // Sign in with email and password
  async signInWithEmailAndPassword(email, password) {
    try {
      if (!this.manager.firebaseAuth) {
        throw new Error('Firebase Auth is not initialized');
      }

      const { signInWithEmailAndPassword } = await import('firebase/auth');
      const userCredential = await signInWithEmailAndPassword(this.manager.firebaseAuth, email, password);
      return userCredential.user;
    } catch (error) {
      console.error('Sign in with email and password error:', error);
      throw error;
    }
  }

  // Sign out the current user
  async signOut() {
    try {
      const { signOut } = await import('firebase/auth');
      await signOut(this.manager.firebaseAuth);
      return true;
    } catch (error) {
      console.error('Sign out error:', error);
      throw error;
    }
  }

  // Get account data from Firestore
  async _getAccountData(uid) {
    try {
      if (!this.manager.firebaseFirestore) {
        return null;
      }

      const { doc, getDoc } = await import('firebase/firestore');

      const accountDoc = doc(this.manager.firebaseFirestore, 'users', uid);
      const snapshot = await getDoc(accountDoc);

      // Get current Firebase user to pass uid and email to resolver
      const firebaseUser = this.manager.firebaseAuth?.currentUser || { uid };

      if (snapshot.exists()) {
        // Resolve the account data to ensure proper structure and defaults
        const rawData = snapshot.data();
        const resolvedAccount = resolveAccount(rawData, { user: firebaseUser });
        return resolvedAccount;
      }

      // If no account exists, return resolved empty object for consistent structure
      return resolveAccount({}, { user: firebaseUser });
    } catch (error) {
      // Capture here — every failure passes through this catch, so monitoring
      // sees them all: the degrade-to-null path below never surfaces to callers,
      // and the permission-denied rethrow is captured before it throws.
      console.error('Get account data error:', error);
      this.manager.sentry().captureException(new Error('Failed to get account data', { cause: error }));

      // Rules refused the read: a REAL failure, and the caller has to be able to
      // tell it apart from a doc that simply is not written yet — that one
      // resolves to an empty account above and is normal
      // ([#700](https://github.com/Omega-JS-Stack/omega/issues/700)). Every
      // other failure keeps degrading to null.
      if (error?.code === 'permission-denied') {
        throw error;
      }

      return null;
    }
  }

  // Register the GENERIC auth triggers on the shared click-trigger registry
  // (#16). `omega-signout` is the one cross-surface trigger — web, desktop and
  // extension all get it from here; surface-specific ones (the extension's
  // `omega-signin`) are registered by that surface.
  setupEventListeners() {
    registerTrigger('signout', async () => {
      try {
        // Show confirmation
        if (!confirm('Are you sure you want to sign out?')) {
          return;
        }

        // Sign out
        await this.signOut();

        // Show success notification
        this.manager.utilities().showNotification('Successfully signed out.', 'success');

      } catch (error) {
        console.error('Sign out error:', error);
        // Show error notification if utilities are available
        this.manager.utilities().showNotification('Failed to sign out. Please try again.', 'danger');
      }
    });
  }

}

export default Auth;
