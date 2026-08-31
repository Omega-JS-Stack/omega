// URL-parameter session behaviors: ?authSignout=true, ?authCustomToken=…,
// ?authPrivateKey=…, and authReturnUrl propagation into the page's auth links.

// Libraries
import omega from '@omega.js/client';
import { trackLogin } from '__main_assets__/js/libs/auth/tracking.js';
import { createLogger } from '__main_assets__/js/libs/logger.js';
import { siteUrl } from '__main_assets__/js/libs/path-prefix.js';

const logger = createLogger('auth:session-params');

/**
 * ?authSignout=true — sign out, then strip the param so reloads don't loop.
 */
export async function handleAuthSignout() {
  const url = new URL(window.location.href);
  const authSignout = url.searchParams.get('authSignout');

  if (authSignout !== 'true') {
    return;
  }

  try {
    logger.log('Signing out user due to authSignout=true parameter');

    // The core/auth.js listener also guards signout-in-progress by reading
    // ?authSignout from the URL, but that guard misses whenever a queued STALE
    // signed-in state-change is processed AFTER the param strip below (#196).
    // This flag survives the strip; the listener clears it on the signed-out
    // state-change it was waiting for. Same pattern as __OMEGA_CUSTOM_TOKEN_SIGNIN.
    //
    // ONLY when somebody is actually signed in: signing out with no user
    // produces no uid change, so Firebase fires no state change, so nothing
    // would ever clear the flag — and the next signed-in state change on this
    // page load (checkout's switch-account link, the legacy reset redirects)
    // would be swallowed, stranding the user on /signin.
    if (omega.auth().isAuthenticated()) {
      window.__OMEGA_SIGNOUT_IN_PROGRESS = true;
    }

    await omega.auth().signOut();

    // Remove the authSignout parameter from URL to prevent sign-out loop
    url.searchParams.delete('authSignout');
    window.history.replaceState({}, document.title, url.toString());
  } catch (error) {
    // Failed sign-out: no signed-out state-change is coming, so clear the flag
    // ourselves rather than wedge the listener on every later state change.
    window.__OMEGA_SIGNOUT_IN_PROGRESS = false;

    logger.error('Error signing out:', error);
  }
}

/**
 * ?authCustomToken=… — admin impersonation / `omega auth:token` sign-in.
 * Returns true when a token was handled (the page is navigating away).
 */
export async function handleCustomTokenSignin() {
  const url = new URL(window.location.href);
  const customToken = url.searchParams.get('authCustomToken');

  if (!customToken) {
    return false;
  }

  try {
    logger.log('Signing in with custom token');

    // This handler owns the post-signin navigation. Without the flag, the
    // core/auth.js listener races us on the same state-change and can win
    // with its authenticated-default redirect ('/' instead of authReturnUrl).
    // Same pattern as __OMEGA_REVERSING_SIGNUP; no clear needed on success —
    // the page navigates away.
    window.__OMEGA_CUSTOM_TOKEN_SIGNIN = true;

    const { getAuth, signInWithCustomToken } = await import('@firebase/auth');
    const auth = getAuth();

    const userCredential = await signInWithCustomToken(auth, customToken);
    logger.log('Custom token sign-in successful:', userCredential.user.email || userCredential.user.uid);

    trackLogin('custom-token', userCredential.user);

    const authReturnUrl = url.searchParams.get('authReturnUrl');
    const redirectTo = authReturnUrl && omega.isValidRedirectUrl(authReturnUrl)
      ? authReturnUrl
      : siteUrl('/dashboard/account');

    window.location.href = redirectTo;
    return true;
  } catch (error) {
    // Failed sign-in: hand navigation control back to the core listener
    window.__OMEGA_CUSTOM_TOKEN_SIGNIN = false;

    omega.sentry().captureException(new Error('Custom token sign-in error', { cause: error }));
    logger.error('Custom token sign-in failed:', error);

    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete('authCustomToken');
    window.history.replaceState({}, document.title, cleanUrl.toString());

    omega.utilities().showNotification(
      `Custom token sign-in failed: ${error.message || 'Invalid or expired token'}`,
      { type: 'danger', timeout: 8000 }
    );
    return false;
  }
}

/**
 * ?authPrivateKey=… — sign-in from a DURABLE url (an OBS dock, a kiosk, a
 * bookmark). The custom tokens above expire in an hour; an `api.privateKey`
 * does not, so this lane trades the key for a fresh custom token at
 * `POST /omega/user/token` on every load.
 * Returns true when a key was handled (the page is navigating away).
 */
export async function handlePrivateKeySignin() {
  const url = new URL(window.location.href);
  const privateKey = url.searchParams.get('authPrivateKey');

  if (!privateKey) {
    return false;
  }

  try {
    // Never the key itself: it is a credential sitting in a url somebody saved,
    // and a console line is the easiest place for it to leak from.
    logger.log('Signing in with private key');

    // Same deal as the custom-token lane above, and the SAME flag: what this
    // handler ends up doing IS a custom-token sign-in, and the core/auth.js
    // listener must not race it with its authenticated-default redirect.
    window.__OMEGA_CUSTOM_TOKEN_SIGNIN = true;

    // `auth: false` because the key IS the credential — the default lane would
    // overwrite this header with the (absent) signed-in user's ID token.
    const response = await omega.request('/omega/user/token', {
      method: 'POST',
      auth: false,
      headers: { Authorization: `Bearer ${privateKey}` },
    });

    const customToken = response?.token;

    if (!customToken) {
      throw new Error('No token received from server');
    }

    const { getAuth, signInWithCustomToken } = await import('@firebase/auth');
    const auth = getAuth();

    const userCredential = await signInWithCustomToken(auth, customToken);
    logger.log('Private key sign-in successful:', userCredential.user.email || userCredential.user.uid);

    trackLogin('private-key', userCredential.user);

    // Stripped BEFORE the navigation, unlike the custom-token lane: this url is
    // durable by design, so the key must not ride along into history or a referer.
    stripPrivateKey();

    const authReturnUrl = url.searchParams.get('authReturnUrl');
    const redirectTo = authReturnUrl && omega.isValidRedirectUrl(authReturnUrl)
      ? authReturnUrl
      : siteUrl('/dashboard/account');

    window.location.href = redirectTo;
    return true;
  } catch (error) {
    // FIRST, before anything that reports: Sentry's httpContext integration
    // reads window.location.href at capture time, so a key still in the address
    // bar when captureException runs is a key inside the event (#661).
    stripPrivateKey();

    // Failed sign-in: hand navigation control back to the core listener
    window.__OMEGA_CUSTOM_TOKEN_SIGNIN = false;

    omega.sentry().captureException(new Error('Private key sign-in error', { cause: error }));
    logger.error('Private key sign-in failed:', error);

    omega.utilities().showNotification(
      `Private key sign-in failed: ${error.message || 'Invalid or expired key'}`,
      { type: 'danger', timeout: 8000 }
    );
    return false;
  }
}

/** Drop ?authPrivateKey from the address bar, without navigating. */
function stripPrivateKey() {
  const cleanUrl = new URL(window.location.href);
  cleanUrl.searchParams.delete('authPrivateKey');
  window.history.replaceState({}, document.title, cleanUrl.toString());
}

/**
 * Propagate ?authReturnUrl into every auth-related link on the page so the
 * signin ↔ signup ↔ reset hops keep the destination.
 */
export function updateAuthReturnUrl() {
  const url = new URL(window.location.href);
  const authReturnUrl = url.searchParams.get('authReturnUrl');

  // Quit if no authReturnUrl is provided
  if (!authReturnUrl) {
    logger.warn('No authReturnUrl provided in URL parameters.');
    return;
  }

  // Update all relevant URLs
  document.querySelectorAll('a[href]').forEach((link) => {
    // Only update auth-related links
    if (!link.href.includes('/signin') && !link.href.includes('/signup') && !link.href.includes('/reset')) {
      return;
    }

    // Update href to include authReturnUrl
    const href = new URL(link.href, window.location.origin);
    href.searchParams.set('authReturnUrl', authReturnUrl);
    link.href = href.toString();
  });
}

/**
 * Brands can pin auth to the apex domain (auth.config.allowSubdomainAuth:
 * false) — bounce subdomain visits there. Returns true when redirecting.
 */
export function checkSubdomainAuth() {
  // Get the allowSubdomainAuth config value (defaults to true if not set)
  const allowSubdomainAuth = omega.config.auth?.config?.allowSubdomainAuth ?? true;

  // Check if current hostname is a subdomain
  const hostname = window.location.hostname;
  const parts = hostname.split('.');

  // If hostname has 3 or more parts (e.g., subdomain.site.com), it's a subdomain
  // Skip localhost and IP addresses
  const isSubdomain = parts.length >= 3 && !hostname.includes('localhost') && !/^\d+\.\d+\.\d+\.\d+$/.test(hostname);

  // Log relevant info
  logger.log('checkSubdomainAuth - hostname:', hostname, 'parts:', parts, 'isSubdomain:', isSubdomain, 'allowSubdomainAuth:', allowSubdomainAuth);

  // If subdomain auth is allowed, no need to redirect regardless of current domain
  if (allowSubdomainAuth) {
    return false;
  }

  // If not a subdomain, no need to redirect
  if (!isSubdomain) {
    return false;
  }

  // Redirect to apex domain
  const apexDomain = parts.slice(-2).join('.');
  const currentUrl = new URL(window.location.href);
  currentUrl.hostname = apexDomain;

  // Log
  logger.log('Redirecting to apex domain for authentication:', currentUrl.href);

  // Perform the redirect
  window.location.href = currentUrl.href;

  // Stop further execution
  return true;
}
