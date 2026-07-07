// This file is required by /signin, /signup, and /reset pages since the logic is mostly the same
import { FormManager } from '__main_assets__/js/libs/form-manager.js';
import webManager from 'web-manager';

// Module
export default function () {
  let formManager = null;

  // Check query string for popup parameter
  const url = new URL(window.location.href);
  const useAuthPopup = url.searchParams.get('authPopup') === 'true' || window !== window.top;

  // Fire wakeup call immediately to prevent cold start on signup API call (fire-and-forget)
  // wakeupServer();

  // Handle DOM ready
  webManager.dom().ready()
  .then(async () => {
    // Log
    console.log('[Auth] Initialized. useAuthPopup:', useAuthPopup);

    // Check for authSignout parameter first
    await handleAuthSignout();

    // Check for authCustomToken parameter (admin impersonation / custom token sign-in)
    const customTokenHandled = await handleCustomTokenSignin();
    if (customTokenHandled) {
      return;
    }

    // Initialize the appropriate form based on the page (with autoReady: false)
    initializePageForm();

    // Disable form fields while checking for OAuth redirect result.
    // State stays 'initializing' so spinners remain visible during the check.
    // formManager.ready() transitions to 'ready' and re-enables if no redirect is found.
    formManager._setDisabled(true);

    // Check for redirect result from OAuth providers BEFORE enabling form
    // This prevents the form from appearing interactive while redirect is processing
    const hasRedirectResult = await handleRedirectResult();

    // Log
    console.log('[Auth] hasRedirectResult:', hasRedirectResult);

    // If redirect result was found, don't enable the form - user will be redirected
    if (hasRedirectResult) {
      return;
    }

    // Check subdomain auth restrictions and redirect if needed
    if (checkSubdomainAuth()) {
      return;
    }

    // No redirect pending - enable the form
    formManager.ready();

    // Update auth return URL in all auth-related links
    updateAuthReturnUrl();

    // Setup password visibility toggle
    setupPasswordToggle();
  });

  // Initialize the form based on current page
  function initializePageForm() {
    const pagePath = document.documentElement.getAttribute('data-page-path');

    if (!pagePath) {
      console.warn('[Auth] No data-page-path attribute found on HTML element');
      return;
    }

    if (pagePath === '/signin') {
      initializeSigninForm();
    } else if (pagePath === '/signup') {
      initializeSignupForm();
    } else if (pagePath === '/reset') {
      initializeResetForm();
    }
  }

  function stateChangeHandler({ state }) {
    // Hide initializing spinners and show hidden elements when state changes from initializing
    if (state !== 'initializing') {
      formManager.$form.querySelectorAll('.form-initializing-spinner').forEach(($el) => {
        $el.classList.add('d-none');
      });
    }
  }

  // Shared validation for signin/signup forms - only validate when email provider is selected
  function validateEmailProvider({ data, setError, $submitButton }) {
    const provider = $submitButton?.getAttribute('data-provider');

    if (provider === 'email') {
      if (!data.email?.trim()) {
        setError('email', 'Email is required');
      }
      if (!data.password) {
        setError('password', 'Password is required');
      }
    }
  }

  // Shared submit handler factory for signin/signup forms
  function createAuthSubmitHandler(action, emailHandler) {
    return async ({ data, $submitButton }) => {
      const provider = $submitButton?.getAttribute('data-provider');

      // Capture consent BEFORE any Firebase call. On signup pages the checkbox state
      // must survive any post-auth redirect so BEM's /user/signup can write it to the doc.
      // Read from FormManager-collected data on signup; ignored on signin (no checkboxes there).
      if (action === 'signup') {
        captureSignupConsent(data);
      }

      if (provider === 'email') {
        await emailHandler(data);
      } else if (provider) {
        await signInWithProvider(provider, action);
      }
    };
  }

  // Google's signInWithPopup/Redirect auto-creates accounts. If a user lands on /signin
  // with a Google account that doesn't exist yet, Firebase creates one before we can stop it.
  // This reverses that: delete the auth user, sign out, surface an inline error.
  async function reverseAccidentalSignup(newUser) {
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
      webManager.sentry().captureException(new Error('Failed to reverse accidental signup', { cause: e }));
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

    if (formManager) {
      formManager.showError(`This account doesn't exist. Try signing up first or use a different account.`);
      formManager.ready();
    }

    // Clear the flag now that signOut() has fired its auth-state-change
    // with user=null. Future state changes (e.g. user re-clicks Continue
    // with Google after seeing the error) get normal listener processing.
    window.__UJM_REVERSING_SIGNUP = false;
  }

  // Validate that the user has agreed to the legal terms. Instead of highlighting the
  // single legal checkbox in red (which subtly frames it as "the one that matters"),
  // we surround BOTH checkboxes with a red outline and surface a top-level banner.
  // This frames consent as a unit the user is confirming, not a hurdle to clear.
  function validateConsent({ data, setError }) {
    if (data?.consentLegal === true) {
      return;
    }

    // Phantom field name — blocks submit (FormManager checks errorCount > 0) but
    // skips rendering since no DOM field matches '__consent'. The visual treatment
    // is the wrapper outline + inline error message below.
    setError('__consent', 'Agreement to Terms required');

    const $group = document.getElementById('consent-group');
    if ($group) {
      // Match the same border color the email/password fields show when invalid.
      // The HTML baseline is 'border: 1px solid transparent' so we only swap the color.
      $group.style.borderColor = 'var(--bs-form-invalid-border-color, var(--bs-danger, #dc3545))';
    }

    const $err = document.getElementById('consent-error');
    if ($err) {
      $err.textContent = `Please select "I agree" to the Terms of Service and Privacy Policy.`;
      $err.classList.remove('d-none');
    }
  }

  // Clear the consent error styling once the user starts interacting with the boxes.
  // Runs on every change to either checkbox. We only restore borderColor since the
  // HTML baseline keeps 'border: 1px solid transparent' to reserve the layout space.
  function clearConsentError() {
    const $group = document.getElementById('consent-group');
    if ($group) {
      $group.style.borderColor = 'transparent';
    }
    const $err = document.getElementById('consent-error');
    if ($err) {
      $err.classList.add('d-none');
    }
  }

  // Read the consent checkboxes and stash to storage. Survives the post-signup redirect
  // the same way attribution does. BEM's /user/signup route picks it up via sendUserSignupMetadata.
  function captureSignupConsent(data) {
    const legalLabel = document.querySelector('label[for="consent-legal"]')?.innerText?.trim() || null;
    const marketingLabel = document.querySelector('label[for="consent-marketing"]')?.innerText?.trim() || null;

    webManager.storage().set('consent', {
      legal: {
        granted: data?.consentLegal === true || data?.consentLegal === 'on',
        text: legalLabel,
      },
      marketing: {
        granted: data?.consentMarketing === true || data?.consentMarketing === 'on',
        text: marketingLabel,
      },
    });
  }

  // Initialize signin form
  function initializeSigninForm() {
    formManager = new FormManager('#auth-form', {
      autoReady: false, // We'll call ready() after checking redirect result
      allowResubmit: false,
      warnOnUnsavedChanges: false,
      submittingText: 'Signing in...',
      submittedText: 'Signed In!',
    });

    formManager.on('statechange', stateChangeHandler);
    formManager.on('validation', validateEmailProvider);
    formManager.on('submit', createAuthSubmitHandler('signin', handleEmailSignin));
  }

  // Initialize signup form
  function initializeSignupForm() {
    formManager = new FormManager('#auth-form', {
      autoReady: false, // We'll call ready() after checking redirect result
      allowResubmit: false,
      warnOnUnsavedChanges: false,
      submittingText: 'Creating account...',
      submittedText: 'Account Created!',
    });

    formManager.on('statechange', stateChangeHandler);
    formManager.on('validation', validateEmailProvider);
    formManager.on('validation', validateConsent);
    formManager.on('submit', createAuthSubmitHandler('signup', handleEmailSignup));

    // Clear consent error styling when either checkbox is toggled
    document.getElementById('consent-legal')?.addEventListener('change', clearConsentError);
    document.getElementById('consent-marketing')?.addEventListener('change', clearConsentError);
  }

  // Initialize reset form
  function initializeResetForm() {
    formManager = new FormManager('#auth-form', {
      autoReady: false, // We'll call ready() after checking redirect result
      allowResubmit: false,
      warnOnUnsavedChanges: false,
      submittingText: 'Sending...',
      submittedText: 'Email Sent!',
    });

    formManager.on('statechange', stateChangeHandler);
    formManager.on('submit', ({ data }) => handlePasswordReset(data));
  }

  async function handleRedirectResult() {
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
        await reverseAccidentalSignup(result.user);
        return true;
      }

      if (isNewUser || isSignupPage) {
        trackSignup(providerId, result.user);
        formManager.showSuccess('Account created successfully!');
      } else {
        trackLogin(providerId, result.user);
        formManager.showSuccess('Successfully signed in!');
      }

      // In simulation mode, handle the redirect ourselves since the auth
      // state listener won't fire (no real Firebase login happened).
      if (simulateRedirect) {
        const authReturnUrl = url.searchParams.get('authReturnUrl');
        const redirectTo = authReturnUrl && webManager.isValidRedirectUrl(authReturnUrl)
          ? authReturnUrl
          : '/dashboard';
        console.log('[Auth] Simulated redirect to:', redirectTo);
        await new Promise(resolve => setTimeout(resolve, 1500));
        window.location.href = redirectTo;
      }

      // Return true to indicate redirect was successfully processed
      return true;
    } catch (error) {
      // Only capture unexpected errors to Sentry
      if (!isUserError(error.code)) {
        webManager.sentry().captureException(new Error('Error handling redirect result', { cause: error }));
      }

      // Handle specific OAuth errors. Check blocking-function rejections FIRST —
      // those carry a custom message from BEM (rate limit, disposable email, etc.)
      // that the user actually needs to see, hidden behind a generic Firebase code.
      const blockingMessage = extractBlockingFunctionMessage(error);
      if (blockingMessage) {
        formManager.showError(blockingMessage);
      } else if (error.code === 'auth/account-exists-with-different-credential') {
        formManager.showError('An account already exists with the same email address but different sign-in credentials. Try signing in with a different provider.');
      } else if (error.code === 'auth/popup-blocked') {
        formManager.showError('Popup was blocked. Please allow popups for this site and try again.');
      } else if (error.code === 'auth/operation-not-allowed') {
        formManager.showError('This sign-in method is not enabled.');
      } else if (error.code && error.code !== 'auth/cancelled-popup-request') {
        formManager.showError(`Authentication error: ${error.message}`);
      }

      // Return false on error so form becomes interactive for user to try again
      return false;
    }
  }

  async function handleCustomTokenSignin() {
    const url = new URL(window.location.href);
    const customToken = url.searchParams.get('authCustomToken');

    if (!customToken) {
      return false;
    }

    try {
      console.log('[Auth] Signing in with custom token');

      const { getAuth, signInWithCustomToken } = await import('@firebase/auth');
      const auth = getAuth();

      const userCredential = await signInWithCustomToken(auth, customToken);
      console.log('[Auth] Custom token sign-in successful:', userCredential.user.email || userCredential.user.uid);

      trackLogin('custom-token', userCredential.user);

      const authReturnUrl = url.searchParams.get('authReturnUrl');
      const redirectTo = authReturnUrl && webManager.isValidRedirectUrl(authReturnUrl)
        ? authReturnUrl
        : '/dashboard';

      window.location.href = redirectTo;
      return true;
    } catch (error) {
      webManager.sentry().captureException(new Error('Custom token sign-in error', { cause: error }));
      console.error('[Auth] Custom token sign-in failed:', error);

      const url = new URL(window.location.href);
      url.searchParams.delete('authCustomToken');
      window.history.replaceState({}, document.title, url.toString());

      webManager.utilities().showNotification(
        `Custom token sign-in failed: ${error.message || 'Invalid or expired token'}`,
        { type: 'danger', timeout: 8000 }
      );
      return false;
    }
  }

  async function handleAuthSignout() {
    const url = new URL(window.location.href);
    const authSignout = url.searchParams.get('authSignout');

    if (authSignout !== 'true') {
      return;
    }

    try {
      // Log
      console.log('[Auth] Signing out user due to authSignout=true parameter');

      // Sign out the user using webManager
      await webManager.auth().signOut();

      // Remove the authSignout parameter from URL to prevent sign-out loop
      url.searchParams.delete('authSignout');
      window.history.replaceState({}, document.title, url.toString());
    } catch (error) {
      console.error('[Auth] Error signing out:', error);
    }
  }

  function checkSubdomainAuth() {
    // Get the allowSubdomainAuth config value (defaults to true if not set)
    const allowSubdomainAuth = webManager.config.auth?.config?.allowSubdomainAuth ?? true;

    // Check if current hostname is a subdomain
    const hostname = window.location.hostname;
    const parts = hostname.split('.');

    // If hostname has 3 or more parts (e.g., subdomain.site.com), it's a subdomain
    // Skip localhost and IP addresses
    const isSubdomain = parts.length >= 3 && !hostname.includes('localhost') && !/^\d+\.\d+\.\d+\.\d+$/.test(hostname);

    // Log relevant info
    console.log('[Auth] checkSubdomainAuth - hostname:', hostname, 'parts:', parts, 'isSubdomain:', isSubdomain, 'allowSubdomainAuth:', allowSubdomainAuth);

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
    console.log('[Auth] Redirecting to apex domain for authentication:', currentUrl.href);

    // Perform the redirect
    window.location.href = currentUrl.href;

    // Stop further execution
    return true;
  }

  function updateAuthReturnUrl() {
    const url = new URL(window.location.href);
    const authReturnUrl = url.searchParams.get('authReturnUrl');

    // Quit if no authReturnUrl is provided
    if (!authReturnUrl) {
      console.warn('[Auth] No authReturnUrl provided in URL parameters.');
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

  async function attemptEmailSignIn(email, password) {
    const { getAuth, signInWithEmailAndPassword } = await import('@firebase/auth');
    const auth = getAuth();
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    return userCredential;
  }

  async function handleEmailSignup(formData) {
    // Use the form data passed from the submit event (already validated)

    // Sanitize email by trimming
    const email = formData.email?.trim() || '';
    const password = formData.password || '';

    // Import Firebase auth functions
    const { getAuth, createUserWithEmailAndPassword } = await import('@firebase/auth');

    // Get auth instance and create user
    const auth = getAuth();

    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);

      // Track signup
      trackSignup('email', userCredential.user);

      // Show success message
      formManager.showSuccess('Account created successfully!');
    } catch (error) {
      // Handle Firebase-specific errors
      if (error.code === 'auth/email-already-in-use') {
        // Try to sign in with the same credentials
        try {
          console.log('[Auth] Email already in use, attempting to sign in instead:', email);

          const userCredential = await attemptEmailSignIn(email, password);

          // Track this as a login instead of signup
          trackLogin('email', userCredential.user);

          // Show success message
          formManager.showSuccess('Successfully signed in!');
          return;
        } catch (signInError) {
          // Couldn't auto-sign-them-in — surface inline on the email field so
          // the user sees exactly which input is the problem.
          formManager.throwFieldErrors({ email: 'An account with this email already exists' });
        }
      }

      // Blocking-function rejections from BEM (rate limit, disposable email, etc.)
      // — surface the BEM-side message instead of the opaque auth/internal-error.
      const blockingMessage = extractBlockingFunctionMessage(error);
      if (blockingMessage) {
        throw new Error(blockingMessage);
      }

      // Password-specific Firebase errors should land on the password field, not
      // the form-level banner — gives the user a clear "fix this input" signal.
      if (isPasswordError(error.code)) {
        formManager.throwFieldErrors({ password: passwordErrorMessage(error) });
      }

      // Re-throw the error to be handled by the form handler
      throw error;
    }
  }

  async function handleEmailSignin(formData) {
    // Use the form data passed from the submit event (already validated)

    // Sanitize email by trimming
    const email = formData.email?.trim() || '';
    const password = formData.password || '';

    // Log
    console.log('[Auth] Attempting email sign-in for:', email);

    try {
      // Sign in with email and password
      const userCredential = await attemptEmailSignIn(email, password);

      // Track login
      trackLogin('email', userCredential.user);

      // Show success message
      formManager.showSuccess('Successfully signed in!');
    } catch (error) {
      // Blocking-function rejections from BEM's before-signin (rate limit, etc.)
      // — surface the BEM-side message instead of the opaque auth/internal-error.
      const blockingMessage = extractBlockingFunctionMessage(error);
      if (blockingMessage) {
        throw new Error(blockingMessage);
      }

      // Firebase intentionally collapses wrong-email and wrong-password into a
      // single `auth/invalid-credential` to prevent email enumeration. Since we
      // don't know which field is wrong, highlight both with a shared message.
      if (error.code === 'auth/invalid-credential' || error.code === 'auth/wrong-password' || error.code === 'auth/user-not-found') {
        formManager.throwFieldErrors({
          email: 'Incorrect email or password',
          password: 'Incorrect email or password',
        });
      }

      // Password-format errors on the password field (e.g. missing).
      if (isPasswordError(error.code)) {
        formManager.throwFieldErrors({ password: passwordErrorMessage(error) });
      }

      // Bad email format → email field.
      if (error.code === 'auth/invalid-email') {
        formManager.throwFieldErrors({ email: 'Please enter a valid email address' });
      }

      throw error;
    }
  }

  async function handlePasswordReset(formData) {
    // Use the form data passed from the submit event (already validated)

    // Sanitize email by trimming
    const email = formData.email?.trim() || '';

    // Import Firebase auth functions
    const { getAuth, sendPasswordResetEmail } = await import('@firebase/auth');

    // Get auth instance
    const auth = getAuth();

    try {
      // Send password reset email
      await sendPasswordResetEmail(auth, email);

      // Track password reset
      trackPasswordReset();

      // Show success message
      formManager.showSuccess(`Password reset email sent to ${email}. Please check your inbox.`);
    } catch (error) {
      // Handle Firebase-specific errors
      if (error.code === 'auth/user-not-found') {
        // For security, we don't reveal if the user exists
        // Still show success to prevent email enumeration
        trackPasswordReset(email); // Track as success for security
        formManager.showSuccess(`If an account exists for ${email}, a password reset email has been sent.`);
        return;
      }

      // Re-throw the error to be handled by the form handler
      throw error;
    }
  }

  async function signInWithProvider(providerName, action = 'signin') {
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
        GithubAuthProvider
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
        // // Add device_id and device_name for private IP addresses (required by Firebase)
        // const deviceId = webManager.storage().get('devDeviceId') || crypto.randomUUID();
        // webManager.storage().set('devDeviceId', deviceId);

        // provider.setCustomParameters({
        //   device_id: deviceId,
        //   device_name: navigator.userAgent.substring(0, 100),
        // });

        // Show warning in dev mode when using redirect
        if (!useAuthPopup) {
          webManager.utilities().showNotification(
            'OAuth redirect may fail in development. Use localhost:4000 or add ?authPopup=true to the URL',
            {
              type: 'warning',
              timeout: 10000 // Show for 10 seconds
            }
          );

          // Wait
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
      /* @dev-only:end */

      // Use popup if query parameter is set, otherwise use redirect
      if (useAuthPopup) {
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
            await reverseAccidentalSignup(result.user);
            return;
          }

          if (isNewUser || action === 'signup') {
            trackSignup(providerName, result.user);
            // Show success message
            formManager.showSuccess('Account created successfully!');
          } else {
            trackLogin(providerName, result.user);
            // Show success message
            formManager.showSuccess('Successfully signed in!');
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
        webManager.sentry().captureException(new Error('OAuth provider sign-in error', { cause: error }));
      }

      // Handle specific errors. Blocking-function rejections from BEM carry a
      // custom message (rate limit, disposable email, etc.) that the user needs
      // to see — check those FIRST before generic Firebase codes.
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

  function setupPasswordToggle() {
    const $toggleButtons = document.querySelectorAll('.uj-password-toggle');

    $toggleButtons.forEach($button => {
      $button.addEventListener('click', () => {
        // Find the password input in the same input group
        const $inputGroup = $button.closest('.input-group');
        const $passwordInput = $inputGroup.querySelector('input');

        if (!$passwordInput) {
          return;
        }

        // Toggle the input type
        const currentType = $passwordInput.type;
        const newType = currentType === 'password' ? 'text' : 'password';
        $passwordInput.type = newType;

        // Toggle icon visibility
        const $showIcon = $button.querySelector('.uj-password-show');
        const $hideIcon = $button.querySelector('.uj-password-hide');

        if (!$showIcon || !$hideIcon) {
          return;
        }

        if (newType === 'text') {
          $showIcon.classList.add('d-none');
          $hideIcon.classList.remove('d-none');
        } else {
          $showIcon.classList.remove('d-none');
          $hideIcon.classList.add('d-none');
        }
      });
    });
  }

  // Firebase password-related auth error codes — these belong on the password
  // field, not the form-level error banner.
  function isPasswordError(errorCode) {
    return [
      'auth/weak-password',
      'auth/missing-password',
      'auth/wrong-password',
      'auth/password-does-not-meet-requirements',
    ].includes(errorCode);
  }

  // Map a Firebase password error to a short, field-appropriate message.
  function passwordErrorMessage(error) {
    if (error?.code === 'auth/weak-password') {
      return 'Password is too weak. Use at least 6 characters.';
    }
    if (error?.code === 'auth/missing-password') {
      return 'Password is required';
    }
    if (error?.code === 'auth/wrong-password') {
      return 'Incorrect password';
    }
    if (error?.code === 'auth/password-does-not-meet-requirements') {
      // Firebase message looks like: "Firebase: Missing password requirements:
      // [Password must contain at least 8 characters] (auth/...)."  Pull the
      // bracketed list so the user sees the actual rule(s) they missed.
      const match = error?.message?.match(/\[([^\]]+)\]/);
      return match ? match[1] : 'Password does not meet the requirements';
    }
    return error?.message || 'Invalid password';
  }

  // Helper function to determine if an error is a user error
  function isUserError(errorCode) {
    const userErrors = [
      'auth/user-not-found',
      'auth/wrong-password',
      'auth/invalid-credential',
      'auth/invalid-email',
      'auth/weak-password',
      'auth/email-already-in-use',
      'auth/user-disabled',
      'auth/too-many-requests',
      'auth/popup-closed-by-user',
      'auth/cancelled-popup-request'
    ];
    return userErrors.includes(errorCode);
  }

  // Extract the readable message from a Firebase Auth blocking-function error.
  //
  // When a BEM blocking function (before-create / before-signin) throws
  // HttpsError('resource-exhausted', 'Too many signups...'), Firebase surfaces
  // it as `auth/internal-error` (sometimes also `auth/error-code:-47`) and
  // stashes the actual server response on `error.customData.serverResponse`.
  // The blob looks like:
  //
  //   {
  //     "error": {
  //       "code": 400,
  //       "message": "BLOCKING_FUNCTION_ERROR_RESPONSE : ((error : (message : \"Too many signups...\")))",
  //       ...
  //     }
  //   }
  //
  // Returns just the inner message string, or null if nothing useful was found.
  function extractBlockingFunctionMessage(error) {
    // Diagnostic: dump the full shape of every error that lands here so we can
    // see exactly what Firebase delivers when BEM's beforeCreate throws. The
    // 503 path (Identity Toolkit returns 503 with code -47, no BLOCKING_FUNCTION
    // wrapper) needs different handling than the 400 path.
    console.warn('[Auth] extractBlockingFunctionMessage: error shape', {
      code: error?.code,
      message: error?.message,
      name: error?.name,
      hasCustomData: !!error?.customData,
      hasServerResponse: !!error?.customData?.serverResponse,
      serverResponse: error?.customData?.serverResponse,
      fullError: error,
    });

    // The OAuth redirect path (signInWithIdp → 503) delivers the rejection as
    // `auth/error-code:-47` with NO `customData.serverResponse` blob — Firebase
    // strips the BEM-side message before it reaches the client. The code is
    // 1:1 with "blocking-function rejected this signup," so surface a generic-
    // but-helpful message that covers all three BEM beforeCreate reasons
    // (rate limit, disposable email, custom hook reject).
    if (error?.code === 'auth/error-code:-47') {
      return 'Account creation is temporarily restricted. This can happen if you\'ve recently created too many accounts, or your email is on our blocked list. Please try again later or contact support.';
    }

    const raw = error?.customData?.serverResponse;
    if (!raw) {
      return null;
    }

    let parsed;
    try {
      parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (e) {
      return null;
    }

    const message = parsed?.error?.message || '';
    if (!message) {
      return null;
    }

    // Unwrap "BLOCKING_FUNCTION_ERROR_RESPONSE : ((error : (message : \"...\")))"
    const match = message.match(/message\s*:\s*"([^"]+)"/);
    if (match) {
      return match[1];
    }

    // Fall back to the raw message if it's not the BLOCKING_FUNCTION wrapper format
    if (!message.startsWith('BLOCKING_FUNCTION')) {
      return message;
    }

    return null;
  }

  function trackLogin(method, user) {
    const userId = user.uid;
    const methodName = method.charAt(0).toUpperCase() + method.slice(1);

    // Google Analytics 4
    gtag('event', 'login', {
      method: method,
      user_id: userId
    });

    // Facebook Pixel
    fbq('trackCustom', 'Login', {
      content_name: `Account Login ${methodName}`,
      method: method,
    });

    // TikTok Pixel
    ttq.track('Login', {
      content_id: `account-login-${method}`,
      content_type: 'product',
      content_name: `Account Login ${methodName}`
    });
  }

  // Analytics tracking functions
  function trackSignup(method, user) {
    const userId = user.uid;
    const methodName = method.charAt(0).toUpperCase() + method.slice(1);

    // Google Analytics 4
    gtag('event', 'sign_up', {
      method: method,
      user_id: userId
    });

    // Facebook Pixel
    fbq('track', 'CompleteRegistration', {
      content_name: `Account Registration ${methodName}`,
      method: method,
    });

    // TikTok Pixel
    ttq.track('CompleteRegistration', {
      content_id: `account-registration-${method}`,
      content_type: 'product',
      content_name: `Account Registration ${methodName}`
    });
  }

  // Password reset tracking function
  function trackPasswordReset() {
    // Google Analytics 4
    gtag('event', 'password_reset', {
      method: 'email',
      status: 'success'
    });

    // Facebook Pixel
    fbq('trackCustom', 'PasswordReset', {
      method: 'email',
      status: 'success'
    });

    // TikTok Pixel
    ttq.track('SubmitForm', {
      content_id: 'password-reset',
      content_type: 'product',
      content_name: 'Password Reset'
    });
  }

  // Wakeup server to prevent cold start on signup API call
  function wakeupServer() {
    const serverApiURL = `${webManager.getApiUrl()}/backend-manager/user/signup?wakeup=true`;

    fetch(serverApiURL, { method: 'POST' })
      .then(() => console.log('[Auth] Server wakeup sent'))
      .catch(() => {}); // Silently ignore errors
  }
}
