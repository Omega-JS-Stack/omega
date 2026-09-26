// Auth helpers for cross-context auth sync in browser extensions
// Used by the page contexts (src/page-context.js): popup, options, sidepanel, page
//
// Architecture:
// - Background.js is the SOURCE OF TRUTH for authentication
// - On context load, contexts wait for @omega.js/client auth to settle, then ask background if in sync
// - If out of sync, background provides a fresh custom token (fetched from server)
// - Every auth message rides the context's messenger (lib/messaging.js), the one lane between contexts

import { WAKEUP_ROUTE } from '@omega.js/client/modules/request.js';
import LoggerLite from './logger-lite.js';

// The auth sub-modules of the identity tag: these lines are about auth, not
// about whichever surface (popup/options/sidepanel/page) called in.
const syncLogger = new LoggerLite('auth:sync');
const broadcastLogger = new LoggerLite('auth:broadcast');

/**
 * What a page pushes to background: the sign-in identity plus the WHOLE stored
 * account document, so background builds the same `User` this page holds.
 * @param {object} user - the page's `User` (`omega.auth.user`)
 * @returns {{ uid: string|null, email: string|null, displayName: string|null, photoURL: string|null, emailVerified: boolean, document: object }}
 */
function syncPayload(user) {
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.profile.displayName,
    photoURL: user.profile.photoURL,
    emailVerified: user.profile.emailVerified,
    document: user.toJSON(),
  };
}

/**
 * Sync auth state with background.js on context load
 * Waits for @omega.js/client auth to settle, then asks background if in sync
 * @param {Object} omega - the page context's Omega instance
 */
export async function syncWithBackground(omega) {
  // Warm the backend before the auth wait below. When this sync needs a token,
  // background answers it by POSTing `/omega/user/token`, the extension's
  // first backend call, on a function that is cold on the first surface a user
  // opens. Fire-and-forget and unauthenticated: the backend answers a wakeup
  // before it loads a route or authenticates
  // ([#644](https://github.com/Omega-JS-Stack/omega/issues/644)).
  omega.request(WAKEUP_ROUTE, { wakeup: true });

  try {
    // Wait for @omega.js/client auth state to settle FIRST (prevents race conditions)
    const localState = await new Promise(resolve => {
      omega.auth.listen({ once: true }, resolve);
    });

    syncLogger.log('Local auth state settled, UID:', localState.user.uid);

    // Ask background for auth state comparison. No answer (background not
    // up yet) reads as in sync: the next context boot asks again.
    const response = (await omega.messenger.send({
      destination: 'background',
      command: 'omega:syncAuth',
      payload: syncPayload(localState.user),
    })) || { needsSync: false };

    // Already in sync
    if (!response.needsSync) {
      syncLogger.log('Already in sync with background');
      return;
    }

    // Need to sign out (background is signed out, context is signed in)
    if (response.signOut) {
      syncLogger.log('Background signed out, signing out context...');
      await omega.auth.signOut();
      return;
    }

    // Need to sign in with token
    if (response.customToken) {
      syncLogger.log('Syncing with background...', response.user?.email);
      await omega.auth.signInWithCustomToken(response.customToken);
      syncLogger.log('Synced successfully');
    }

  } catch (error) {
    syncLogger.error('Error syncing with background:', error.message);
  }
}

/**
 * Set up listener for auth broadcasts from background.js
 * Handles both sign-in broadcasts and sign-out broadcasts
 * @param {Object} omega - the page context's Omega instance
 */
export function setupAuthBroadcastListener(omega) {
  omega.messenger.onMessage(async (message) => {
    const { command, payload } = message || {};

    // Handle sign-in broadcast
    if (command === 'omega:signInWithToken' && payload?.token) {
      broadcastLogger.log('Received sign-in broadcast');
      try {
        await omega.auth.signInWithCustomToken(payload.token);
        broadcastLogger.log('Signed in via broadcast');
      } catch (error) {
        broadcastLogger.error('Error signing in:', error.message);
      }
      return;
    }

    // Handle sign-out broadcast
    if (command === 'omega:signOut') {
      // Skip if already signed out (prevents loops)
      if (!omega.auth.user.authenticated) {
        broadcastLogger.log('Already signed out, ignoring broadcast');
        return;
      }
      broadcastLogger.log('Received sign-out broadcast');
      try {
        await omega.auth.signOut();
        broadcastLogger.log('Signed out via broadcast');
      } catch (error) {
        broadcastLogger.error('Error signing out:', error.message);
      }
    }
  });

  broadcastLogger.log('Broadcast listener set up');
}

/**
 * Set up listener to notify background when user signs out from this context
 * @param {Object} omega - the page context's Omega instance
 */
export function setupSignOutListener(omega) {
  // Track previous user to detect sign-out
  let previousUid = null;

  omega.auth.listen((state) => {
    const currentUid = state.user.uid;

    // Detect sign-out (had user, now don't)
    if (previousUid && !currentUid) {
      syncLogger.log('Detected sign-out, notifying background...');
      omega.messenger.send({ destination: 'background', command: 'omega:signOut' });
    }

    previousUid = currentUid;
  });

  syncLogger.log('Sign-out listener set up');
}

/**
 * Register the extension's own auth triggers on the shared click-trigger
 * registry (#16). `omega-signin` and `omega-account` are surface-specific (only
 * an extension opens a brand page in a new tab), so the extension owns them
 * here; `omega-signout` comes from @omega.js/client (setupSignOutListener
 * detects the sign-out and notifies background).
 * @param {Object} omega - the page context's Omega instance
 */
export function setupAuthEventListeners(omega) {
  omega.triggers.register('signin', () => omega.auth.openPage());
  omega.triggers.register('account', () => omega.auth.openPage({ path: '/account' }));

  // Log
  omega.logger.log('Auth event listeners set up');
}
