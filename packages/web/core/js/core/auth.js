import omega from '@omega.js/client';
import { createLogger } from '__main_assets__/js/libs/logger.js';
import { identify, readPlatformCookies } from '__main_assets__/js/libs/analytics.js';
import { retryOrphanCleanup } from '__main_assets__/js/libs/auth/orphan.js';
import { siteUrl } from '__main_assets__/js/libs/path-prefix.js';

const logger = createLogger('auth');

// Auth Module
export default function () {
  // Get auth policy
  const config = omega.config.auth.config;
  const policy = config.policy;
  const requiredRoles = config.roles || null;

  // Skip auth module entirely if policy is disabled (e.g., vert iframes)
  if (policy === 'disabled') {
    return;
  }

  const authenticated = config.redirects.authenticated;
  const unauthenticated = config.redirects.unauthenticated;

  // Log policy
  logger.log('policy:', policy, {
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
    omega.auth().listen({}, async (state) => {
      const user = state.user;
      const url = new URL(window.location.href);
      const authReturnUrlRaw = url.searchParams.get('authReturnUrl');
      const authReturnUrl = authReturnUrlRaw && omega.isValidRedirectUrl(authReturnUrlRaw) ? authReturnUrlRaw : null;
      const authSignout = url.searchParams.get('authSignout');

      // Log
      logger.log('state changed:', state);

      // Short-circuit if a reverse-signup is in progress (libs/auth/oauth.js#reverseAccidentalSignup
      // sets this synchronously before .delete() + signOut()). Without this, the brief
      // window where Firebase shows user=<about-to-be-deleted-account> would trigger the
      // policy-based redirect to /account (or authReturnUrl) BEFORE the user sees the
      // inline error on /signin. Flag is cleared at the end of reverseAccidentalSignup.
      if (window.__OMEGA_REVERSING_SIGNUP) {
        logger.warn('Skipping state-change processing — reverse-signup in progress');
        return;
      }

      // Same courtesy for custom-token sign-ins (libs/auth/session-params.js):
      // that handler owns the post-signin navigation (authReturnUrl), and this
      // listener's authenticated-default redirect must not race it.
      if (window.__OMEGA_CUSTOM_TOKEN_SIGNIN) {
        logger.warn('Skipping state-change processing — custom-token sign-in owns navigation');
        return;
      }

      // Attach (or clear) the analytics identity for everything counted after
      identify(user);

      // Check if we're in the process of signing out
      if (authSignout === 'true' && user) {
        // Mark that we're about to sign out
        justSignedOut = true;
        return; // Let pages.js handle the signout
      }

      // The URL check above is not enough: handleAuthSignout (libs/auth/session-params.js)
      // strips ?authSignout as soon as signOut() resolves, and under load a STALE
      // signed-in state-change can be processed AFTER that strip — the guard misses,
      // the policy: 'unauthenticated' branch below sees a user and redirects off the
      // page (#196). The flag survives the strip, so it decides instead.
      if (window.__OMEGA_SIGNOUT_IN_PROGRESS) {
        if (user) {
          // Stale signed-in event, signout still propagating — same deal as above.
          logger.warn('Skipping state-change processing — signout in progress');
          justSignedOut = true;
          return;
        }

        // The signed-out event we were waiting for: clear the flag and fall through
        // to the normal unauthenticated handling (justSignedOut + authReturnUrl).
        window.__OMEGA_SIGNOUT_IN_PROGRESS = false;
      }

      // Handle authentication state changes and page policies
      if (user) {
        // User is authenticated

        // Rules refused the account read: a REAL failure, and nothing on this
        // page can trust the account, so sign the user out and say so. It fires
        // on the explicit denied signal from @omega.js/client and on nothing
        // else — the deleted consent guard's defect was collapsing "the doc is
        // not written yet" (the normal state for the seconds after a signup)
        // into this one ([#700](https://github.com/Omega-JS-Stack/omega/issues/700)).
        if (state.accountDenied) {
          logger.warn('Signing out user whose account read was denied');
          await omega.auth().signOut();
          omega.utilities().showNotification(
            `Couldn't load your account. Please sign in again.`,
            { type: 'danger', timeout: 8000 }
          );
          return;
        }

        // The failed-delete backstop (libs/auth/orphan.js): a reversed accidental
        // signup whose .delete() never landed left a live consent-less account,
        // and the browser that failed the delete is the only thing that knows —
        // so the retry runs here, at auth-ready, on the marked uid and nothing
        // else ([#703](https://github.com/Omega-JS-Stack/omega/issues/703)). It
        // returns true once it has handled the user (deleted, or signed out on a
        // second failure), and a user this page no longer has is not the policy's
        // business — nor the signup post's.
        if (await retryOrphanCleanup(state)) {
          return;
        }

        // Send user signup metadata if account is new. Fire and forget: the
        // redirect below must not sit behind a server round trip, and an
        // unwritten doc is the normal state here, not something to wait for
        // ([#700](https://github.com/Omega-JS-Stack/omega/issues/700)). It never
        // throws — it catches internally — and its in-flight marker is the
        // failure path: a post that never landed retries on the next page load.
        sendUserSignupMetadata(state.account);

        // Prompt for push notification subscription (fire-and-forget)
        omega.notifications().subscribe().catch((e) => {
          logger.warn('Notification subscribe failed:', e.message);
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
          logger.warn('User missing required roles:', requiredRoles);
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
    logger.warn('Error setting up auth listener:', e);

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
  // The policy's routes are site-relative ('/signin'), so they resolve against
  // the path the site is mounted under, not the domain root (#355)
  const newURL = new URL(siteUrl(url), window.location.origin);

  // Attach return URL
  if (returnUrl) {
    newURL.searchParams.set('authReturnUrl', returnUrl);
  }

  // Log
  logger.log('Redirecting to:', newURL.href);

  // Quit on testing
  // return;

  // Redirect to the new URL
  window.location.href = newURL;
}

// Add authReturnUrl to all signup/signin links so users return to the current page after auth
// Uses click handler so the return URL always reflects the *current* location (e.g. after chat ID is added)
function updateAuthLinks() {
  // Mounted: a link's pathname carries the site's base path, so the routes
  // compared against it carry it too (#355)
  const authPaths = ['/signin', '/signup'].map(siteUrl);

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

// The in-flight marker for the post-auth signup request
// ([#633](https://github.com/Omega-JS-Stack/omega/issues/633)). The account doc's
// flag cannot hold the gate alone: the route polls for the user doc and infers the
// contact before it writes the flag, so every page load inside that window reads an
// unprocessed doc and posts again. It only ever gates a post that IS in flight: a
// send that failed clears it on the spot (below), and a marker that outlived its
// window expires (see the TTL). It is held through the client's storage module —
// under the `temporary.` prefix, because it is transient state and not a
// preference — which wraps every browser access itself, so private mode needs no
// guard here.
const SIGNUP_METADATA_MARKER = 'temporary.signupMetadata';

// A marker older than this counts as absent. The storage module is backed by
// localStorage, which outlives the tab that wrote it: without an expiry, a crash
// between marking the post in flight and hearing back would gate this account for
// good. Ten minutes is far longer than the route's poll-and-infer window and far
// shorter than the user is willing to wait for the account it feeds.
const SIGNUP_MARKER_TTL_MS = 10 * 60 * 1000;

// The marker is per uid — a shared browser must not let one account's in-flight post
// silence the next account's. No uid (an account doc read that produced no auth.uid,
// and no signed-in user to ask) means no marker, which is the behaviour that shipped
// before this gate existed.
function signupMetadataMarkerKey(account) {
  const uid = account?.auth?.uid || omega.auth?.().getUser?.()?.uid;

  return uid ? `${SIGNUP_METADATA_MARKER}.${uid}` : null;
}

// A marker gates only while it is FRESH: an expired one is dropped on read and
// reads as absent, so the post it was holding back goes out.
function readSignupMetadataMarker(key) {
  const marked = omega.storage().get(key, 0);

  if (!marked) {
    return false;
  }

  if (Date.now() - marked > SIGNUP_MARKER_TTL_MS) {
    omega.storage().remove(key);

    return false;
  }

  return true;
}

/**
 * Send user metadata to server (affiliate, UTM params, etc.)
 *
 * This is also the request the SERVER half of `sign_up` fires from
 * ([#577](https://github.com/Omega-JS-Stack/omega/issues/577)): it is the only
 * moment the backend hears from the browser that just registered, so its IP, its
 * user agent and the platform cookies below are the entire match quality of
 * every registration the brand reports. Meta scored it around 4/10 while this
 * payload carried no cookies and the fire came off the auth trigger instead.
 *
 * Exported for testing — the payload is a contract with `routes/user/signup`.
 *
 * @param {object} account - The signed-in account doc (its `flags.signupProcessed` gates the post).
 * @returns {Promise<void>}
 */
export async function sendUserSignupMetadata(account) {
  // Declared out here so the catch below can clear it: a post that never landed
  // must not leave the gate closed behind it.
  let markerKey = null;

  try {
    // Skip on auth pages — the redirect off them fires immediately and would
    // abort this fire-and-forget request; the destination page sends it instead.
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
    markerKey = signupMetadataMarkerKey(account);

    /* @dev-only:start */
    logger.log('signupProcessed:', signupProcessed);
    /* @dev-only:end */

    // The doc caught up: the marker did its job and is done. A marker that
    // outlives the flag would silence a retry the doc still needs (the other
    // place it is cleared is a failed post, in the catch below).
    if (signupProcessed) {
      if (markerKey) {
        omega.storage().remove(markerKey);
      }

      return;
    }

    // A post for this uid is already in flight (or landed and the doc has not caught
    // up yet). Every page load in that window used to re-post and collect a
    // "Signup has already been processed" 400.
    if (markerKey && readSignupMetadataMarker(markerKey)) {
      logger.log('Skipping user metadata — a signup post is already in flight for this account');

      return;
    }

    // Get attribution data from storage, plus the platform cookies as they
    // stand right now. Read FRESH through the ONE reader the checkout intent
    // uses and never persisted — a stale `_fbc` would match the wrong click —
    // and carried under `attribution.cookies`, the shape the intent already
    // sends and `match-data.js` already reads.
    const storedAttribution = omega.storage().get('attribution', {});
    const cookies = readPlatformCookies();
    const attribution = Object.keys(cookies).length
      ? { ...storedAttribution, cookies }
      : storedAttribution;
    const consent = omega.storage().get('consent', {});
    // The tracking-consent snapshot: its own key and its own payload field, stored
    // verbatim beside attribution. Distinct from `consent` above, which is the
    // legal/marketing decision the signup form captures and the route interprets.
    const trackingConsent = omega.storage().get('trackingConsent', null);

    // Build the payload
    const payload = {
      // New structure
      attribution: attribution,
      context: omega.utilities().getContext(),
      consent: consent,
      trackingConsent: trackingConsent,
    };

    // Log
    logger.log('Sending user metadata:', payload);

    // Mark the post in flight BEFORE it goes out: the doc's flag lands seconds
    // later, and a navigation in between is exactly what re-fired this request.
    if (markerKey) {
      omega.storage().set(markerKey, Date.now());
    }

    // Make API call to send signup metadata (route resolves via getApiUrl;
    // usage from the omega-properties header syncs into bindings automatically)
    const response = await omega.request('/omega/user/signup', {
      method: 'POST',
      tries: 3,
      body: payload,
    });

    // Log — the server set flags.signupProcessed on the doc, so the next page load
    // that reads it clears the marker above and this never fires again.
    logger.log('User metadata sent successfully:', response);
  } catch (error) {
    logger.error('Error sending user metadata:', error);
    // Don't throw - we don't want to block the signup flow. The marker only holds
    // the gate for a post that DID its work: the server's "already processed" 400
    // means the doc's flag is landing right behind it, so the marker stays and the
    // next page load that reads the flag clears it. Every other failure (a dead
    // network, a 5xx) never processed anything, so the marker is cleared here and
    // the next page load retries ([#633](https://github.com/Omega-JS-Stack/omega/issues/633)).
    const alreadyProcessed = error?.code === 400 && `${error.message}`.includes('already been processed');
    if (markerKey && !alreadyProcessed) {
      omega.storage().remove(markerKey);
    }

    /* @dev-only:start */
    omega.utilities().showNotification(
      alreadyProcessed
        ? `[DEV] Signup metadata was already processed. The marker holds until flags.signupProcessed lands.`
        : `[DEV] Failed to send signup metadata. The in-flight marker was cleared — the next page load retries.`,
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
  const tokenPageUrl = new URL(siteUrl('/token'), window.location.origin);
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

  logger.log('Translated legacy app params:', url.toString());
}
