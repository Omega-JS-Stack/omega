import authorizedFetch from '__main_assets__/js/libs/authorized-fetch.js';
import webManager from 'web-manager';

// Enforce page-load consent guard. When true, any authenticated user whose doc has
// consent.legal.status !== 'granted' is silently signed out. Keep FALSE until the
// legacy user migration runs (sets all existing docs to status='granted',
// source='imported'). Otherwise every existing user gets locked out on signin.
const ENFORCE_CONSENT_GUARD = true;

// Auth Module
export default function () {
  // Get auth policy
  const config = webManager.config.auth.config;
  const policy = config.policy;
  const requiredRoles = config.roles || null;

  // Skip auth module entirely if policy is disabled (e.g., vert iframes)
  if (policy === 'disabled') {
    return;
  }

  const authenticated = config.redirects.authenticated;
  const unauthenticated = config.redirects.unauthenticated;

  // Log policy
  console.log('[Auth] policy:', policy, {
    authenticated,
    unauthenticated,
    roles: requiredRoles,
  });

  // LEGACY: Handle desktop app auth params (e.g. ?destination=appscheme://page&source=app)
  // TODO: Remove this call AND the _legacyTranslateAppAuth function when legacy desktop app support is no longer needed
  _legacyTranslateAppAuth();

  // Track if we just signed out to avoid redirect loops
  let justSignedOut = false;

  // Setup Auth listener
  try {
    webManager.auth().listen({}, async (state) => {
      const user = state.user;
      const url = new URL(window.location.href);
      const authReturnUrlRaw = url.searchParams.get('authReturnUrl');
      const authReturnUrl = authReturnUrlRaw && webManager.isValidRedirectUrl(authReturnUrlRaw) ? authReturnUrlRaw : null;
      const authSignout = url.searchParams.get('authSignout');

      // Log
      console.log('[Auth] state changed:', state);

      // Short-circuit if a reverse-signup is in progress (libs/auth.js#reverseAccidentalSignup
      // sets this synchronously before .delete() + signOut()). Without this, the brief
      // window where Firebase shows user=<about-to-be-deleted-account> would trigger the
      // policy-based redirect to /account (or authReturnUrl) BEFORE the user sees the
      // inline error on /signin. Flag is cleared at the end of reverseAccidentalSignup.
      if (window.__UJM_REVERSING_SIGNUP) {
        console.warn('[Auth] Skipping state-change processing — reverse-signup in progress');
        return;
      }

      // Set user ID for analytics tracking
      setAnalyticsUserId(user);

      // Check if we're in the process of signing out
      if (authSignout === 'true' && user) {
        // Mark that we're about to sign out
        justSignedOut = true;
        return; // Let pages.js handle the signout
      }

      // Handle authentication state changes and page policies
      if (user) {
        // User is authenticated

        // Send user signup metadata if account is new.
        // MUST run BEFORE the consent guard — on a brand-new signup the user doc
        // exists with consent.legal.status: 'revoked' (the schema default written
        // by the on-create auth event). sendUserSignupMetadata is what flips it
        // to 'granted' with the captured consent payload. If we gate first, every
        // fresh signup would be signed out before consent ever lands.
        await sendUserSignupMetadata(state.account);

        // Consent guard: if the user is authenticated but their account doc shows
        // no legal consent on record, they're an orphan from a reversed Google signup
        // that failed to delete cleanly. Sign them out and surface a toast so the
        // user knows what happened.
        //
        // Gated by ENFORCE_CONSENT_GUARD (off until the legacy-user migration runs).
        // Only fires once signup has been processed — sendUserSignupMetadata above is what
        // writes consent, and it runs whenever flags.signupProcessed is false. If signup
        // hasn't been processed yet (or just failed and will retry next load), we must NOT
        // sign the user out; a processed doc with no legal consent is a genuine orphan
        // (e.g. a reversed Google signup that failed to delete cleanly).
        if (ENFORCE_CONSENT_GUARD) {
          const signupProcessed = state.account?.flags?.signupProcessed === true;
          const legalStatus = state.account?.consent?.legal?.status;
          if (signupProcessed && legalStatus && legalStatus !== 'granted') {
            console.warn('[Auth] Signing out user with no legal consent on record');
            await webManager.auth().signOut();
            webManager.utilities().showNotification(
              `This account hasn't completed setup. Please sign up first.`,
              { type: 'danger', timeout: 8000 }
            );
            return;
          }
        }

        // Prompt for push notification subscription (fire-and-forget)
        webManager.notifications().subscribe().catch((e) => {
          console.warn('[Auth] Notification subscribe failed:', e.message);
        });

        // Check if page requires user to be unauthenticated (e.g., signin page)
        if (policy === 'unauthenticated') {
          // Check for authReturnUrl first (takes precedence)
          if (authReturnUrl) {
            redirect(authReturnUrl);
            return;
          }

          // Otherwise redirect to default authenticated destination
          redirect(authenticated);
          return;
        }

        // Check if page requires specific roles (e.g., admin: true)
        if (requiredRoles && !hasRequiredRoles(state.account, requiredRoles)) {
          console.warn('[Auth] User missing required roles:', requiredRoles);
          redirect(authenticated);
          return;
        }
      } else {
        // User is not authenticated

        // If we just signed out and have authReturnUrl, stay on the page
        if (justSignedOut && authReturnUrl) {
          justSignedOut = false; // Reset flag
          return; // Stay on current page to allow re-authentication
        }

        // Check if page requires authentication (e.g., account page)
        if (policy === 'authenticated') {
          redirect(unauthenticated, window.location.href);
        }

        // Append authReturnUrl to all signup/signin links so users return here after auth
        updateAuthLinks();
      }
    });
  } catch (e) {
    console.warn('[Auth] Error setting up auth listener:', e);

    return;
  }
}

// Check if account has all required roles
function hasRequiredRoles(account, requiredRoles) {
  const accountRoles = account?.roles || {};

  return Object.keys(requiredRoles).every((role) => {
    return accountRoles[role] === requiredRoles[role];
  });
}

// Redirect function
function redirect(url, returnUrl) {
  if (!url) {
    return;
  }

  // Set the authReturnUrl to the current URL
  const newURL = new URL(url, window.location.origin);

  // Attach return URL
  if (returnUrl) {
    newURL.searchParams.set('authReturnUrl', returnUrl);
  }

  // Log
  console.log('[Auth] Redirecting to:', newURL.href);

  // Quit on testing
  // return;

  // Redirect to the new URL
  window.location.href = newURL;
}

// Add authReturnUrl to all signup/signin links so users return to the current page after auth
// Uses click handler so the return URL always reflects the *current* location (e.g. after chat ID is added)
function updateAuthLinks() {
  const authPaths = ['/signin', '/signup'];

  document.querySelectorAll('a[href]').forEach(($link) => {
    try {
      const href = new URL($link.href, window.location.origin);

      if (!authPaths.includes(href.pathname)) { return; }

      $link.addEventListener('click', (e) => {
        const url = new URL($link.href, window.location.origin);
        const currentUrl = new URL(window.location.href);
        const existingReturnUrl = currentUrl.searchParams.get('authReturnUrl');

        if (existingReturnUrl) {
          url.searchParams.set('authReturnUrl', existingReturnUrl);
        } else if (!authPaths.includes(currentUrl.pathname)) {
          url.searchParams.set('authReturnUrl', window.location.href);
        }

        $link.href = url.toString();
      });
    } catch (e) {}
  });
}

function setAnalyticsUserId(user) {
  const userId = user?.uid;
  const email = user?.email;
  const metaPixelId = webManager.config.analytics?.meta;

  // Short-circuit if no user
  if (!userId) {
    // Clear user ID when logged out
    gtag('set', { user_id: null });

    // Facebook Pixel - Clear advanced matching
    fbq('init', metaPixelId, {});

    // TikTok Pixel - Clear user data
    ttq.identify({});

    // Return early
    return;
  }

  // Google Analytics 4 - Set user ID and user properties
  gtag('set', {
    user_id: userId,
    user_properties: {
      email_domain: email ? email.split('@')[1] : undefined
    }
  });

  // Facebook Pixel - Set advanced matching with user data
  fbq('init', metaPixelId, {
    external_id: userId,
    // em: email ? btoa(email.toLowerCase().trim()) : undefined,
    em: email,
    // ph: phone ? btoa(phone.trim()) : undefined
  });

  // TikTok Pixel - Identify user
  ttq.identify({
    external_id: userId,
    // email: email ? btoa(email.toLowerCase().trim()) : undefined,
    email: email,
    // phone_number: phone ? btoa(phone.trim()) : undefined
  });
}

// Send user metadata to server (affiliate, UTM params, etc.)
async function sendUserSignupMetadata(account) {
  try {
    // Skip on auth pages to avoid blocking redirect (metadata will be sent on destination page)
    const pagePath = document.documentElement.getAttribute('data-page-path');
    const authPages = ['/signin', '/signup', '/reset'];
    if (authPages.includes(pagePath)) {
      return;
    }

    // The user doc's flags.signupProcessed is the single source of truth. We have the full
    // account doc on every page load, so gate on it directly — no account-age window, no
    // client-only localStorage flag. Fire whenever the doc shows signup is unprocessed; the
    // server is idempotent and rejects if it was already processed.
    const signupProcessed = account?.flags?.signupProcessed === true;

    /* @dev-only:start */
    console.log('[Auth] signupProcessed:', signupProcessed);
    /* @dev-only:end */

    if (signupProcessed) {
      return;
    }

    // Get attribution data from storage
    const attribution = webManager.storage().get('attribution', {});
    const consent = webManager.storage().get('consent', {});

    // Build the payload
    const payload = {
      // New structure
      attribution: attribution,
      context: webManager.utilities().getContext(),
      consent: consent,
    };

    // Get server API URL
    const serverApiURL = `${webManager.getApiUrl()}/backend-manager/user/signup`;

    // Log
    console.log('[Auth] Sending user metadata:', payload);

    // Make API call to send signup metadata
    const response = await authorizedFetch(serverApiURL, {
      method: 'POST',
      response: 'json',
      tries: 3,
      body: payload,
    });

    // Log — the server set flags.signupProcessed on the doc, so the next page load's
    // state.account reflects it and this won't fire again. No client-side flag needed.
    console.log('[Auth] User metadata sent successfully:', response);
  } catch (error) {
    console.error('[Auth] Error sending user metadata:', error);
    // Don't throw - we don't want to block the signup flow. The doc still shows
    // signupProcessed=false, so a refresh / next page load retries automatically.

    /* @dev-only:start */
    webManager.utilities().showNotification(
      `[DEV] Failed to send signup metadata. Will retry on next page load (flags.signupProcessed is still false).`,
      { type: 'warning', timeout: 1000 }
    );
    /* @dev-only:end */
  }
}

// LEGACY: Translate desktop app auth params to UJM format
// Legacy apps send: ?destination=appscheme://page&source=app&signout=true&cb=timestamp
// UJM expects: ?authReturnUrl=...&authSignout=true
// TODO: Remove this function AND its call above when legacy desktop app support is no longer needed
function _legacyTranslateAppAuth() {
  const url = new URL(window.location.href);
  const destination = url.searchParams.get('destination');
  const source = url.searchParams.get('source');

  if (source !== 'app' || !destination) {
    return;
  }

  // Chain through /token page to generate a custom token before redirecting to the app
  const tokenPageUrl = new URL('/token', window.location.origin);
  tokenPageUrl.searchParams.set('authReturnUrl', destination);
  url.searchParams.set('authReturnUrl', tokenPageUrl.toString());

  // Translate signout param
  if (url.searchParams.get('signout') === 'true') {
    url.searchParams.set('authSignout', 'true');
  }

  // Clean up legacy params and update URL
  url.searchParams.delete('destination');
  url.searchParams.delete('source');
  url.searchParams.delete('signout');
  url.searchParams.delete('cb');
  window.history.replaceState({}, '', url.toString());

  console.log('[Auth] Translated legacy app params:', url.toString());
}
