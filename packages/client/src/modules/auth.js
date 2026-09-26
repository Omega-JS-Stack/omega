// The account is a `User` from @omega.js/account, the same class the backend
// builds, so a document resolved here is byte-identical to one resolved there.
// The browser never assigns `User.generators`: $uuid/$randomId/$apiKey fields
// resolve to null (real values always come from the backend-written doc).
import { User } from '@omega.js/account';
import { resolveFeatures } from '@omega.js/account/features';
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
  constructor(omega) {
    this.omega = omega;
    this._authStateCallbacks = [];

    // Bumped by every auth state change so builds stay strictly ordered: a
    // signed-in build awaits its account fetch while a signed-out one lands
    // instantly, so a slow fetch would otherwise land a STALE signed-in state
    // after a newer signed-out one (#196).
    this._stateGeneration = 0;

    // The newest build's promise (see _buildState), or null before the first
    this._newestBuild = null;

    // The one probe in flight, or null (#798; see probeSession)
    this._sessionProbe = null;

    // The account as one `User`, never null: signed out until Firebase settles,
    // then replaced once per auth state change, before anything reads it
    this.user = new User();

    // The newest LANDED state, `{ user, denied }`, or null until the first one
    // lands. Every consumer of one auth state change reads this same object.
    this.state = null;

    // Resolves the first time a state lands and never rejects: once listeners
    // wait on it, then read the newest landed state
    this._settledResolve = null;
    this.settled = new Promise((resolve) => {
      this._settledResolve = resolve;
    });
  }

  /**
   * The sign-in's view of a Firebase user: the identity a `User` is built from.
   * displayName and photoURL fall back to the provider entries, then to the
   * email prefix and a generated initials avatar, so a profile always has both.
   * @param {object|null} user - the Firebase user, or null when signed out
   * @returns {{ uid: string, email: string|null, displayName: string, photoURL: string, emailVerified: boolean }|null}
   */
  _identity(user) {
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
      emailVerified: user.emailVerified === true,
    };
  }

  // Listen for auth state changes. Every listener receives the state
  // _landState built, never a build of its own: one account fetch
  // and one `User` per auth state change, however many listen.
  listen(options = {}, callback) {
    // Handle overloaded signatures - if first param is a function, it's the callback
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }

    // If Firebase can't boot, call back immediately with the signed-out user.
    // Same condition as initialize(): a projectId-only blob resolves (URL
    // derivation) but never registers onAuthStateChanged, so no state would
    // ever land and listeners would hang forever.
    if (!this.omega._resolveFirebaseConfig()?.apiKey) {
      callback({
        user: new User(),
        denied: false,
      });

      return () => {};
    }

    // Once listeners: the first landed state settles them, and they read the
    // newest landed state at that moment, so a state superseded mid-fetch is
    // never theirs and nothing re-runs
    if (options.once) {
      this.settled.then(() => callback(this.state));

      return () => {};
    }

    // Persistent listeners: every future state change, plus a catch-up with the
    // state already landed. The catch-up is async so a listener always hears
    // about its state after listen() returns, and it is skipped when the
    // listener unsubscribed or a newer state reached it through the loop first.
    const unsubscribe = this._subscribe(callback);

    if (this.state) {
      const landed = this.state;

      Promise.resolve().then(() => {
        if (this.state === landed && this._authStateCallbacks.includes(callback)) {
          this._deliver(callback);
        }
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

  // Hand the landed state to one persistent listener; a throwing listener never
  // stops the others
  _deliver(callback) {
    try {
      callback(this.state);
    } catch (error) {
      console.error('Auth state callback error:', error);
    }
  }

  // Called by the Omega instance when Firebase auth state changes. Not awaited
  // by the caller, since the account fetch must never block Firebase's callback.
  _handleAuthStateChange(firebaseUser) {
    return this._buildState(firebaseUser);
  }

  /** Re-read the account for the current Firebase user and land it as a new state: resolves with the newest landed `{ user, denied }`. */
  async reload() {
    let landed = await this._buildState(this.omega.firebaseAuth?.currentUser || null);

    // Superseded mid-fetch: follow the newest build until one lands. Never
    // spins on the same build: a build only reports false when a newer
    // _buildState bumped the generation, and that call replaced _newestBuild.
    while (!landed) {
      landed = await this._newestBuild;
    }

    return this.state;
  }

  // Start a state build for this Firebase user, superseding any in flight, and
  // record it as the newest so a superseded reload() can follow it
  _buildState(firebaseUser) {
    const generation = ++this._stateGeneration;

    this._newestBuild = this._landState(generation, firebaseUser);

    return this._newestBuild;
  }

  // The ONE place an auth state is built and landed. Resolves true when it
  // landed, false when a newer build superseded it.
  async _landState(generation, firebaseUser) {
    const identity = this._identity(firebaseUser);
    let document = {};
    let denied = false;

    // Fetch the account document if the user is logged in and Firestore is
    // available (every failure but a denied read is captured inside
    // _getAccountData and degrades to null)
    if (firebaseUser && this.omega.firebaseFirestore) {
      try {
        document = (await this._getAccountData(firebaseUser.uid)) || {};
      } catch (error) {
        // The one failure _getAccountData rethrows: rules denied the read.
        // Consumers branch on `denied` and never on an empty account, since a
        // doc that is not written yet is the normal state right after signup
        // ([#700](https://github.com/Omega-JS-Stack/omega/issues/700)). The
        // User still builds from the identity below, so nothing downstream
        // has to null-check.
        logger.warn('Account read denied, flagging the state as denied:', error.message);
        denied = true;
      }
    }

    // A newer auth state change owns the truth now: landing this one would
    // hand consumers a stale user out of order. Drop it entirely; the newer
    // build updates the bindings, the storage and the listeners.
    if (generation !== this._stateGeneration) {
      logger.warn('Dropping a superseded auth state emission: a newer state change owns the truth');
      return false;
    }

    // The one User for this state change, in place before anything reads it
    this.user = new User(document, identity);
    this.state = { user: this.user, denied };

    // Bindings read the live User, so `auth.user.plan` resolves through its
    // getter; storage serializes it to the stored document (User.toJSON)
    this.omega.bindings.update({
      auth: { user: this.user },
      usage: this._resolveUsage(this.user),
    });
    this.omega.storage.set('auth', this.state);

    this._settledResolve();

    // Iterate a copy: a listener may unsubscribe while it is being called
    for (const callback of [...this._authStateCallbacks]) {
      this._deliver(callback);
    }

    return true;
  }

  // Resolve usage bindings from the User's stored usage + the EFFECTIVE limits
  // of its plan, `user.plan` ([#647](https://github.com/Omega-JS-Stack/omega/issues/647)).
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
  _resolveUsage(user) {
    const accountUsage = user.usage || {};
    const productId    = user.plan;
    const products     = this.omega.config.payment?.products || [];
    const product      = products.find(p => p.id === productId) || {};
    const catalog      = this.omega.config.features || {};

    const usage = {};

    for (const resolved of resolveFeatures({ catalog, product, account: user })) {
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
      const user = this.omega.firebaseAuth.currentUser;

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
    // The Firebase session itself, not `this.user`: the probe refreshes that
    // session's token, and it runs whether or not anything listens to auth
    if (!this.omega.firebaseAuth?.currentUser) {
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
      if (!this.omega.firebaseAuth) {
        throw new Error('Firebase Auth is not initialized');
      }

      const { signInWithCustomToken } = await import('firebase/auth');
      const userCredential = await signInWithCustomToken(this.omega.firebaseAuth, token);
      return userCredential.user;
    } catch (error) {
      console.error('Sign in with custom token error:', error);
      throw error;
    }
  }

  // Sign in with email and password
  async signInWithEmailAndPassword(email, password) {
    try {
      if (!this.omega.firebaseAuth) {
        throw new Error('Firebase Auth is not initialized');
      }

      const { signInWithEmailAndPassword } = await import('firebase/auth');
      const userCredential = await signInWithEmailAndPassword(this.omega.firebaseAuth, email, password);
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
      await signOut(this.omega.firebaseAuth);
      return true;
    } catch (error) {
      console.error('Sign out error:', error);
      throw error;
    }
  }

  // Get the raw account document from Firestore: the stored data, `{}` when no
  // doc is written yet, null on a failure that degrades (resolution happens in
  // the User constructor)
  async _getAccountData(uid) {
    try {
      if (!this.omega.firebaseFirestore) {
        return null;
      }

      const { doc, getDoc } = await import('firebase/firestore');

      const accountDoc = doc(this.omega.firebaseFirestore, 'users', uid);
      const snapshot = await getDoc(accountDoc);

      if (snapshot.exists()) {
        return snapshot.data();
      }

      // No doc written yet: an empty document, which the User resolves to the
      // signed-in empty shape
      return {};
    } catch (error) {
      // Capture here — every failure passes through this catch, so monitoring
      // sees them all: the degrade-to-null path below never surfaces to callers,
      // and the permission-denied rethrow is captured before it throws.
      console.error('Get account data error:', error);
      this.omega.sentry.captureException(new Error('Failed to get account data', { cause: error }));

      // Rules refused the read: a REAL failure, and the caller has to be able to
      // tell it apart from a doc that simply is not written yet: that one
      // returns an empty document above and is normal
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
    this.omega.triggers.register('signout', async () => {
      try {
        // Show confirmation
        if (!confirm('Are you sure you want to sign out?')) {
          return;
        }

        // Sign out. An instance with its own `signOut()` signs out more than
        // this page (desktop: main, which then signs every window out), so it
        // wins over this page's session alone.
        await (this.omega.signOut ? this.omega.signOut() : this.signOut());

        // Show success notification
        this.omega.utilities.showNotification('Successfully signed out.', 'success');

      } catch (error) {
        console.error('Sign out error:', error);
        // Show error notification if utilities are available
        this.omega.utilities.showNotification('Failed to sign out. Please try again.', 'danger');
      }
    });
  }

}

export default Auth;
