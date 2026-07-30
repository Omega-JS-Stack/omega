// Auth helpers for cross-context auth sync in browser extensions
// Used by popup.js, options.js, sidepanel.js, page.js
//
// Architecture:
// - Background.js is the SOURCE OF TRUTH for authentication
// - On context load, contexts wait for @omega.js/client auth to settle, then ask background if in sync
// - If out of sync, background provides a fresh custom token (fetched from server)
// - No BXM-specific storage - Web Manager handles auth state internally

import { registerTrigger } from '@omega.js/client/modules/triggers.js';
import LoggerLite from './logger-lite.js';

// The auth sub-modules of the identity tag — these lines are about auth, not
// about whichever surface (popup/options/sidepanel/page) called in.
const syncLogger = new LoggerLite('auth:sync');
const broadcastLogger = new LoggerLite('auth:broadcast');

/**
 * Sync auth state with background.js on context load
 * Waits for @omega.js/client auth to settle, then asks background if in sync
 * @param {Object} context - The manager instance (must have extension, omega)
 */
export async function syncWithBackground(context) {
  const { extension, omega } = context;

  try {
    // Wait for @omega.js/client auth state to settle FIRST (prevents race conditions)
    const localState = await new Promise(resolve => {
      omega.auth().listen({ once: true }, resolve);
    });

    const localUid = localState.user?.uid || null;
    syncLogger.log('Local auth state settled, UID:', localUid);

    // Ask background for auth state comparison
    const response = await new Promise((resolve) => {
      extension.runtime.sendMessage(
        { command: 'omega:syncAuth', contextUid: localUid },
        (res) => {
          if (extension.runtime.lastError) {
            syncLogger.log('Background not ready:', extension.runtime.lastError.message);
            resolve({ needsSync: false });
            return;
          }
          resolve(res || { needsSync: false });
        }
      );
    });

    // Already in sync
    if (!response.needsSync) {
      syncLogger.log('Already in sync with background');
      return;
    }

    // Need to sign out (background is signed out, context is signed in)
    if (response.signOut) {
      syncLogger.log('Background signed out, signing out context...');
      await omega.auth().signOut();
      return;
    }

    // Need to sign in with token
    if (response.customToken) {
      syncLogger.log('Syncing with background...', response.user?.email);
      await omega.auth().signInWithCustomToken(response.customToken);
      syncLogger.log('Synced successfully');
    }

  } catch (error) {
    syncLogger.error('Error syncing with background:', error.message);
  }
}

/**
 * Set up listener for auth token broadcasts from background.js
 * Handles both sign-in broadcasts and sign-out broadcasts
 * @param {Object} context - The manager instance (must have extension, omega)
 */
export function setupAuthBroadcastListener(context) {
  const { omega } = context;

  // Listen for messages from service worker (background.js)
  navigator.serviceWorker?.addEventListener('message', async (event) => {
    const { command, token } = event.data || {};

    // Handle sign-in broadcast
    if (command === 'omega:signInWithToken' && token) {
      broadcastLogger.log('Received sign-in broadcast');
      try {
        await omega.auth().signInWithCustomToken(token);
        broadcastLogger.log('Signed in via broadcast');
      } catch (error) {
        broadcastLogger.error('Error signing in:', error.message);
      }
      return;
    }

    // Handle sign-out broadcast
    if (command === 'omega:signOut') {
      // Skip if already signed out (prevents loops)
      if (!omega.auth().getUser()) {
        broadcastLogger.log('Already signed out, ignoring broadcast');
        return;
      }
      broadcastLogger.log('Received sign-out broadcast');
      try {
        await omega.auth().signOut();
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
 * @param {Object} context - The manager instance (must have extension, omega)
 */
export function setupSignOutListener(context) {
  const { extension, omega } = context;

  // Track previous user to detect sign-out
  let previousUid = null;

  omega.auth().listen((state) => {
    const currentUid = state.user?.uid || null;

    // Detect sign-out (had user, now don't)
    if (previousUid && !currentUid) {
      syncLogger.log('Detected sign-out, notifying background...');
      extension.runtime.sendMessage({ command: 'omega:signOut' });
    }

    previousUid = currentUid;
  });

  syncLogger.log('Sign-out listener set up');
}

/**
 * Open auth page in new tab (for signing in via website)
 * @param {Object} context - The manager instance (must have extension, omega, logger)
 * @param {Object} options - Options object
 * @param {string} options.path - Path to open (default: '/token')
 * @param {string} options.authReturnUrl - Return URL for electron/deep links
 */
export function openAuthPage(context, options = {}) {
  const { extension, omega, logger } = context;

  // The /token page lives on the BRAND site (wave-5 F9) — background.js
  // watches the same brand.url host for the redirect. Never authDomain:
  // it is an auth concern that must stay free to change independently.
  const brandUrl = omega.config?.brand?.url;

  if (!brandUrl) {
    logger.error('No brand.url configured');
    return;
  }

  // Build the URL
  const path = options.path || '/token';
  const authUrl = new URL(path, brandUrl);

  // Add return URL if provided (for electron/deep links)
  if (options.authReturnUrl) {
    authUrl.searchParams.set('authReturnUrl', options.authReturnUrl);
  }

  // Log
  logger.log('Opening auth page:', authUrl.toString());

  // Get current active tab so we can restore it after auth
  extension.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const authSourceTabId = tabs[0]?.id;

    // Add source tab ID to URL so background can restore it
    if (authSourceTabId) {
      authUrl.searchParams.set('authSourceTabId', authSourceTabId);
    }

    // Open in new tab
    extension.tabs.create({ url: authUrl.toString() });
  });
}

/**
 * Register the extension's own auth triggers on the shared click-trigger
 * registry (#16). `omega-signin` is surface-specific — only an extension opens
 * the website's /token page in a new tab — so the extension owns it here;
 * `omega-signout` comes from @omega.js/client (setupSignOutListener detects the
 * sign-out and notifies background).
 * @param {Object} context - The manager instance (must have extension, omega, logger)
 */
export function setupAuthEventListeners(context) {
  registerTrigger('signin', () => openAuthPage(context));

  // Log
  context.logger.log('Auth event listeners set up');
}
