// OAuth provider flows: popup-first sign-in with redirect fallback, the
// returning-redirect result processor, and the accidental-signup reversal
// (Google auto-creates accounts during signin attempts).

// Libraries
import omega from '@omega.js/client';
import { extractBlockingFunctionMessage, isUserError } from '__main_assets__/js/libs/auth/errors.js';
import { trackLogin, trackSignup } from '__main_assets__/js/libs/auth/tracking.js';

/**
 * Google's signInWithPopup/Redirect auto-creates accounts. If a user lands on
 * /signin with a Google account that doesn't exist yet, Firebase creates one
 * before we can stop it. This reverses that: delete the auth user, sign out,
 * surface an inline error.
 */
export async function reverseAccidentalSignup(ctx, newUser) {
  console.warn('[Auth] Reversing accidental signup from /signin (new Google account created with no consent on record)');

  // SYNCHRONOUSLY flag the reversal so the auth-state-change listener in
  // core/auth.js short-circuits its policy-based redirect for this user.
  // Without this, Firebase's redirect-result-success path triggers an auth
  // state change with user=<the-about-to-be-deleted-account> BEFORE we
  // finish .delete() + signOut(), and the listener redirects to /account
  // (or authReturnUrl) before the user ever sees the inline error.
  // Cleared in the finally block after signOut() has fired the followup
  // auth-state-change with user=null.
  window.__UJM_REVERSING_SIGNUP = true;

  try {
    await newUser.delete();
  } catch (e) {
    // Best-effort. If delete fails (network/token issue), the page-load consent guard
    // is the backstop — the orphan account will be signed out on every future visit.
    console.error('[Auth] Failed to delete accidental account:', e);
    omega.sentry().captureException(new Error('Failed to reverse accidental signup', { cause: e }));
  }

  try {
    const { getAuth, signOut } = await import('@firebase/auth');
    await signOut(getAuth());
  } catch (e) {
    console.error('[Auth] Failed to sign out after accidental signup:', e);
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
  window.__UJM_REVERSING_SIGNUP = false;
}

/**
 * Process a returning OAuth redirect (or a `_dev_simulateRedirect`
 * simulation). Returns true when a redirect result was handled — the caller
 * leaves the form disabled because navigation is imminent.
 */
export async function handleRedirectResult(ctx) {
  const url = new URL(window.location.href);

  // Resolve the redirect result — either from Firebase or a dev simulation
  let result, additionalUserInfo;
  const simulateRedirect = url.searchParams.get('_dev_simulateRedirect');

  if (simulateRedirect) {
    console.log('[Auth] Simulating OAuth redirect result:', simulateRedirect);
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
    console.log('[Auth] Redirect result:', result);

    // If no result, return false to indicate no redirect was processed
    if (!result || !result.user) {
      return false;
    }

    console.log('[Auth] Successfully authenticated via redirect:', result.user.email);

    // Determine the provider from the result
    const providerId = result.providerId || result.user.providerData?.[0]?.providerId || 'unknown';

    const isNewUser = additionalUserInfo?.isNewUser;
    const pagePath = document.documentElement.getAttribute('data-page-path');
    const isSignupPage = pagePath === '/signup';
    console.warn('[Auth] redirect additionalUserInfo:', additionalUserInfo, 'isNewUser:', isNewUser, 'pagePath:', pagePath, 'isSignupPage:', isSignupPage, 'operationType:', result.operationType);

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
      console.log('[Auth] Simulated redirect to:', redirectTo);
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

    /* @dev-only:start */
    {
      // Show warning in dev mode when using redirect
      if (!ctx.useAuthPopup) {
        omega.utilities().showNotification(
          'OAuth redirect may fail in development. Use localhost:4000 or add ?authPopup=true to the URL',
          {
            type: 'warning',
            timeout: 10000, // Show for 10 seconds
          }
        );

        // Wait
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    /* @dev-only:end */

    // Use popup if query parameter is set, otherwise use redirect
    if (ctx.useAuthPopup) {
      try {
        // Try popup
        const result = await signInWithPopup(auth, provider);
        console.log('[Auth] Successfully authenticated via popup:', result.user.email);

        // Track based on whether this is a new user. v9 modular SDK requires
        // getAdditionalUserInfo(result) — the legacy `result.additionalUserInfo`
        // direct property does NOT exist on UserCredential in v9+.
        const additionalUserInfoPopup = getAdditionalUserInfo(result);
        const isNewUser = additionalUserInfoPopup?.isNewUser;
        console.warn('[Auth] popup additionalUserInfo:', additionalUserInfoPopup, 'isNewUser:', isNewUser, 'action:', action);

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

          console.log('[Auth] Popup failed, falling back to redirect:', popupError.code);

          // Fallback to redirect
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
      console.log('[Auth] Using redirect for authentication');
      await signInWithRedirect(auth, provider);
      // Note: This will redirect the user away from the page
      // The handleRedirectResult function will handle the result when they return
    }
  } catch (error) {
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
