// OAuth provider flows: redirect-first sign-in (popup only for iframes and
// the ?authPopup=true override), the
// returning-redirect result processor, and the accidental-signup reversal
// (Google auto-creates accounts during signin attempts).

// Libraries
import omega from '@omega.js/client';
import { extractBlockingFunctionMessage, isUserError } from '__main_assets__/js/libs/auth/errors.js';
import { trackLogin, trackSignup } from '__main_assets__/js/libs/auth/tracking.js';
import { createLogger } from '__main_assets__/js/libs/logger.js';

const logger = createLogger('auth:oauth');

// The one-shot marker that says "this tab left for an OAuth redirect". Written
// before signInWithRedirect, read on the way back: a return with no redirect
// result means the credential never made it home, which is loud, not silent.
const REDIRECT_PENDING_KEY = 'omega:authRedirectPending';

/**
 * Popup or redirect? Redirect is the default (it survives strict popup
 * blockers and mobile webviews), with two cases that MUST use the popup:
 *
 *   - `?authPopup=true` — the manual override
 *   - inside an iframe — a top-level redirect is not ours to make
 *
 * Development is NOT one of them any more (#156). It used to be: the Firebase
 * emulator's OAuth handler hands the credential back through sessionStorage on
 * the origin it is served from, and on the emulator's own port that origin is a
 * third party to the site, so browser storage partitioning gave the SDK's
 * helper iframe an empty partition and getRedirectResult() resolved null
 * forever. `omega dev` now proxies the emulator under the SITE origin — the
 * same same-origin trick production gets from the self-hosted /__/auth/*
 * helpers — so the redirect leg comes home in dev too, and dev runs the flow
 * users actually run.
 */
export function shouldUseAuthPopup() {
  return new URL(window.location.href).searchParams.get('authPopup') === 'true'
    || window !== window.top;
}

// Storage denial (privacy modes, blocked third-party contexts) is an expected
// external condition, not our bug: the marker degrades to "no redirect was
// pending", which is exactly the pre-marker behavior.
function markPendingRedirect() {
  try {
    window.sessionStorage.setItem(REDIRECT_PENDING_KEY, String(Date.now()));
  } catch (e) {
    logger.warn('Could not mark the pending redirect:', e.message);
  }
}

function takePendingRedirect() {
  try {
    const pending = window.sessionStorage.getItem(REDIRECT_PENDING_KEY) !== null;
    window.sessionStorage.removeItem(REDIRECT_PENDING_KEY);

    return pending;
  } catch (e) {
    return false;
  }
}

/**
 * Google's signInWithPopup/Redirect auto-creates accounts. If a user lands on
 * /signin with a Google account that doesn't exist yet, Firebase creates one
 * before we can stop it. This reverses that: delete the auth user, sign out,
 * surface an inline error.
 */
export async function reverseAccidentalSignup(ctx, newUser) {
  logger.warn('Reversing accidental signup from /signin (new Google account created with no consent on record)');

  // SYNCHRONOUSLY flag the reversal so the auth-state-change listener in
  // core/auth.js short-circuits its policy-based redirect for this user.
  // Without this, Firebase's redirect-result-success path triggers an auth
  // state change with user=<the-about-to-be-deleted-account> BEFORE we
  // finish .delete() + signOut(), and the listener redirects to /account
  // (or authReturnUrl) before the user ever sees the inline error.
  // Cleared in the finally block after signOut() has fired the followup
  // auth-state-change with user=null.
  window.__OMEGA_REVERSING_SIGNUP = true;

  try {
    await newUser.delete();
  } catch (e) {
    // Best-effort. If delete fails (network/token issue), the page-load consent guard
    // is the backstop — the orphan account will be signed out on every future visit.
    logger.error('Failed to delete accidental account:', e);
    omega.sentry().captureException(new Error('Failed to reverse accidental signup', { cause: e }));
  }

  try {
    const { getAuth, signOut } = await import('@firebase/auth');
    await signOut(getAuth());
  } catch (e) {
    logger.error('Failed to sign out after accidental signup:', e);
  }

  // Strip authReturnUrl so the next attempt doesn't redirect them away from /signin
  const url = new URL(window.location.href);
  if (url.searchParams.has('authReturnUrl')) {
    url.searchParams.delete('authReturnUrl');
    window.history.replaceState({}, document.title, url.toString());
  }

  if (ctx.formManager) {
    ctx.formManager.showError(`This account doesn't exist. Try signing up first or use a different account.`);
    ctx.formManager.ready();
  }

  // Clear the flag now that signOut() has fired its auth-state-change
  // with user=null. Future state changes (e.g. user re-clicks Continue
  // with Google after seeing the error) get normal listener processing.
  window.__OMEGA_REVERSING_SIGNUP = false;
}

/**
 * Process a returning OAuth redirect (or a `_dev_simulateRedirect`
 * simulation). Returns true when a redirect result was handled — the caller
 * leaves the form disabled because navigation is imminent.
 */
export async function handleRedirectResult(ctx) {
  const url = new URL(window.location.href);

  // Read the marker first: this page load either follows a redirect we started
  // or it doesn't, and every path below consumes the answer exactly once.
  const hadPendingRedirect = takePendingRedirect();

  // Resolve the redirect result — either from Firebase or a dev simulation
  let result, additionalUserInfo;
  const simulateRedirect = url.searchParams.get('_dev_simulateRedirect');

  if (simulateRedirect) {
    logger.log('Simulating OAuth redirect result:', simulateRedirect);
    await new Promise(resolve => setTimeout(resolve, 2000));

    if (simulateRedirect !== 'error') {
      result = {
        user: { uid: 'dev-sim-uid', email: 'dev@test.local', providerData: [{ providerId: 'google.com' }] },
        providerId: 'google.com',
      };
      additionalUserInfo = { isNewUser: simulateRedirect === 'signup' };
    }
  } else {
    const { getAuth, getRedirectResult, getAdditionalUserInfo } = await import('@firebase/auth');
    const auth = getAuth();
    result = await getRedirectResult(auth);
    if (result?.user) {
      additionalUserInfo = getAdditionalUserInfo(result);
    }
  }

  try {
    if (simulateRedirect === 'error') {
      const fakeError = new Error('Simulated: An account already exists with different credentials');
      fakeError.code = 'auth/account-exists-with-different-credential';
      throw fakeError;
    }

    // Log results for debugging
    logger.log('Redirect result:', result);

    // If no result, return false to indicate no redirect was processed.
    // A tab that LEFT for an OAuth redirect must come back with a credential:
    // nothing means the provider handler never handed the event back, and the
    // page must say so instead of quietly presenting an empty form again.
    if (!result || !result.user) {
      if (hadPendingRedirect) {
        logger.error('Returned from an OAuth redirect with no result');
        omega.sentry().captureException(new Error('OAuth redirect returned no result'));
        ctx.formManager.showError('Sign-in did not complete. Please try again.');
      }

      return false;
    }

    logger.log('Successfully authenticated via redirect:', result.user.email);

    // Determine the provider from the result
    const providerId = result.providerId || result.user.providerData?.[0]?.providerId || 'unknown';

    const isNewUser = additionalUserInfo?.isNewUser;
    const pagePath = document.documentElement.getAttribute('data-page-path');
    const isSignupPage = pagePath === '/signup';
    logger.warn('redirect additionalUserInfo:', additionalUserInfo, 'isNewUser:', isNewUser, 'pagePath:', pagePath, 'isSignupPage:', isSignupPage, 'operationType:', result.operationType);

    // Google quirk: if a new account was auto-created during a signin attempt
    // (user came back from OAuth via the redirect path on /signin, not /signup),
    // reverse it — they have no consent on record.
    if (isNewUser && !isSignupPage) {
      await reverseAccidentalSignup(ctx, result.user);
      return true;
    }

    if (isNewUser || isSignupPage) {
      trackSignup(providerId, result.user);
      ctx.formManager.showSuccess('Account created successfully!');
    } else {
      trackLogin(providerId, result.user);
      ctx.formManager.showSuccess('Successfully signed in!');
    }

    // In simulation mode, handle the redirect ourselves since the auth
    // state listener won't fire (no real Firebase login happened).
    if (simulateRedirect) {
      const authReturnUrl = url.searchParams.get('authReturnUrl');
      const redirectTo = authReturnUrl && omega.isValidRedirectUrl(authReturnUrl)
        ? authReturnUrl
        : '/dashboard/account';
      logger.log('Simulated redirect to:', redirectTo);
      await new Promise(resolve => setTimeout(resolve, 1500));
      window.location.href = redirectTo;
    }

    // Return true to indicate redirect was successfully processed
    return true;
  } catch (error) {
    // Only capture unexpected errors to Sentry
    if (!isUserError(error.code)) {
      omega.sentry().captureException(new Error('Error handling redirect result', { cause: error }));
    }

    // Handle specific OAuth errors. Check blocking-function rejections FIRST —
    // those carry a custom message from @omega.js/backend (rate limit, disposable
    // email, etc.) that the user actually needs to see, hidden behind a generic
    // Firebase code.
    const blockingMessage = extractBlockingFunctionMessage(error);
    if (blockingMessage) {
      ctx.formManager.showError(blockingMessage);
    } else if (error.code === 'auth/account-exists-with-different-credential') {
      ctx.formManager.showError('An account already exists with the same email address but different sign-in credentials. Try signing in with a different provider.');
    } else if (error.code === 'auth/popup-blocked') {
      ctx.formManager.showError('Popup was blocked. Please allow popups for this site and try again.');
    } else if (error.code === 'auth/operation-not-allowed') {
      ctx.formManager.showError('This sign-in method is not enabled.');
    } else if (error.code && error.code !== 'auth/cancelled-popup-request') {
      ctx.formManager.showError(`Authentication error: ${error.message}`);
    }

    // Return false on error so form becomes interactive for user to try again
    return false;
  }
}

/**
 * Sign in (or up) with an OAuth provider — popup when ctx.useAuthPopup,
 * redirect otherwise, with popup→redirect fallback on blockers.
 */
export async function signInWithProvider(ctx, providerName, action = 'signin') {
  try {
    // Import Firebase auth functions and providers
    const {
      getAuth,
      signInWithPopup,
      signInWithRedirect,
      getAdditionalUserInfo,
      GoogleAuthProvider,
      FacebookAuthProvider,
      TwitterAuthProvider,
      GithubAuthProvider,
    } = await import('@firebase/auth');

    const auth = getAuth();

    let provider;

    // Create provider based on provider name
    switch (providerName) {
      case 'google.com':
        provider = new GoogleAuthProvider();
        break;
      case 'facebook.com':
        provider = new FacebookAuthProvider();
        break;
      case 'twitter.com':
        provider = new TwitterAuthProvider();
        break;
      case 'github.com':
        provider = new GithubAuthProvider();
        break;
      default:
        throw new Error(`Unsupported provider: ${providerName}`);
    }

    // Use popup if query parameter is set, otherwise use redirect
    if (ctx.useAuthPopup) {
      try {
        // Try popup
        const result = await signInWithPopup(auth, provider);
        logger.log('Successfully authenticated via popup:', result.user.email);

        // Track based on whether this is a new user. v9 modular SDK requires
        // getAdditionalUserInfo(result) — the legacy `result.additionalUserInfo`
        // direct property does NOT exist on UserCredential in v9+.
        const additionalUserInfoPopup = getAdditionalUserInfo(result);
        const isNewUser = additionalUserInfoPopup?.isNewUser;
        logger.warn('popup additionalUserInfo:', additionalUserInfoPopup, 'isNewUser:', isNewUser, 'action:', action);

        // Google quirk: signInWithPopup auto-creates accounts. If a brand-new visitor
        // clicks "Sign in with Google" on the SIGNIN page (not signup), reverse the
        // auto-creation — they have no consent on record and never asked to create one.
        if (isNewUser && action === 'signin') {
          await reverseAccidentalSignup(ctx, result.user);
          return;
        }

        if (isNewUser || action === 'signup') {
          trackSignup(providerName, result.user);
          ctx.formManager.showSuccess('Account created successfully!');
        } else {
          trackLogin(providerName, result.user);
          ctx.formManager.showSuccess('Successfully signed in!');
        }
      } catch (popupError) {
        // Check if popup was blocked or failed
        if (popupError.code === 'auth/popup-blocked' ||
            popupError.code === 'auth/popup-closed-by-user' ||
            popupError.code === 'auth/cancelled-popup-request') {

          logger.log('Popup failed, falling back to redirect:', popupError.code);

          // Fallback to redirect
          markPendingRedirect();
          await signInWithRedirect(auth, provider);
          // Note: This will redirect the user away from the page
          // The handleRedirectResult function will handle the result when they return
        } else {
          // Re-throw other errors
          throw popupError;
        }
      }
    } else {
      // Use redirect by default
      logger.log('Using redirect for authentication');
      markPendingRedirect();
      await signInWithRedirect(auth, provider);
      // Note: This will redirect the user away from the page
      // The handleRedirectResult function will handle the result when they return
    }
  } catch (error) {
    // A rejected signInWithRedirect never left the page — clear the pending
    // marker so the next plain load does not report a redirect that was
    // never in flight
    takePendingRedirect();

    // Only capture unexpected errors to Sentry
    if (!isUserError(error.code)) {
      omega.sentry().captureException(new Error('OAuth provider sign-in error', { cause: error }));
    }

    // Handle specific errors. Blocking-function rejections from @omega.js/backend
    // carry a custom message (rate limit, disposable email, etc.) that the user
    // needs to see — check those FIRST before generic Firebase codes.
    const blockingMessage = extractBlockingFunctionMessage(error);
    if (blockingMessage) {
      throw new Error(blockingMessage);
    } else if (error.code === 'auth/account-exists-with-different-credential') {
      throw new Error('An account already exists with the same email address but different sign-in credentials. Try signing in with a different provider.');
    } else if (error.code === 'auth/invalid-credential') {
      throw new Error('Invalid credentials. Please try again.');
    } else if (error.code === 'auth/operation-not-allowed') {
      throw new Error('This sign-in method is not enabled. Please contact support.');
    } else if (error.code === 'auth/user-disabled') {
      throw new Error('This account has been disabled. Please contact support.');
    }

    throw error;
  }
}
