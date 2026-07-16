// Email/password flows: signin, signup (with the already-in-use auto-signin
// courtesy), and password reset. Every handler reports through ctx.formManager.

// Libraries
import { extractBlockingFunctionMessage, isPasswordError, passwordErrorMessage } from '__main_assets__/js/libs/auth/errors.js';
import { trackLogin, trackSignup, trackPasswordReset } from '__main_assets__/js/libs/auth/tracking.js';

async function attemptEmailSignIn(email, password) {
  const { getAuth, signInWithEmailAndPassword } = await import('@firebase/auth');
  const auth = getAuth();
  const userCredential = await signInWithEmailAndPassword(auth, email, password);
  return userCredential;
}

export async function handleEmailSignin(ctx, formData) {
  // Use the form data passed from the submit event (already validated)
  const email = formData.email?.trim() || '';
  const password = formData.password || '';

  console.log('[Auth] Attempting email sign-in for:', email);

  try {
    const userCredential = await attemptEmailSignIn(email, password);

    trackLogin('email', userCredential.user);

    ctx.formManager.showSuccess('Successfully signed in!');
  } catch (error) {
    // Blocking-function rejections from @omega.js/backend's before-signin
    // (rate limit, etc.) — surface the @omega.js/backend-side message instead
    // of the opaque auth/internal-error.
    const blockingMessage = extractBlockingFunctionMessage(error);
    if (blockingMessage) {
      throw new Error(blockingMessage);
    }

    // Firebase intentionally collapses wrong-email and wrong-password into a
    // single `auth/invalid-credential` to prevent email enumeration. Since we
    // don't know which field is wrong, highlight both with a shared message.
    if (error.code === 'auth/invalid-credential' || error.code === 'auth/wrong-password' || error.code === 'auth/user-not-found') {
      ctx.formManager.throwFieldErrors({
        email: 'Incorrect email or password',
        password: 'Incorrect email or password',
      });
    }

    // Password-format errors on the password field (e.g. missing).
    if (isPasswordError(error.code)) {
      ctx.formManager.throwFieldErrors({ password: passwordErrorMessage(error) });
    }

    // Bad email format → email field.
    if (error.code === 'auth/invalid-email') {
      ctx.formManager.throwFieldErrors({ email: 'Please enter a valid email address' });
    }

    throw error;
  }
}

export async function handleEmailSignup(ctx, formData) {
  // Use the form data passed from the submit event (already validated)
  const email = formData.email?.trim() || '';
  const password = formData.password || '';

  const { getAuth, createUserWithEmailAndPassword } = await import('@firebase/auth');
  const auth = getAuth();

  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);

    trackSignup('email', userCredential.user);

    ctx.formManager.showSuccess('Account created successfully!');
  } catch (error) {
    // Handle Firebase-specific errors
    if (error.code === 'auth/email-already-in-use') {
      // Try to sign in with the same credentials
      try {
        console.log('[Auth] Email already in use, attempting to sign in instead:', email);

        const userCredential = await attemptEmailSignIn(email, password);

        // Track this as a login instead of signup
        trackLogin('email', userCredential.user);

        ctx.formManager.showSuccess('Successfully signed in!');
        return;
      } catch (signInError) {
        // Couldn't auto-sign-them-in — surface inline on the email field so
        // the user sees exactly which input is the problem.
        ctx.formManager.throwFieldErrors({ email: 'An account with this email already exists' });
      }
    }

    // Blocking-function rejections from @omega.js/backend (rate limit,
    // disposable email, etc.) — surface the @omega.js/backend-side message
    // instead of the opaque auth/internal-error.
    const blockingMessage = extractBlockingFunctionMessage(error);
    if (blockingMessage) {
      throw new Error(blockingMessage);
    }

    // Password-specific Firebase errors should land on the password field, not
    // the form-level banner — gives the user a clear "fix this input" signal.
    if (isPasswordError(error.code)) {
      ctx.formManager.throwFieldErrors({ password: passwordErrorMessage(error) });
    }

    // Re-throw the error to be handled by the form handler
    throw error;
  }
}

export async function handlePasswordReset(ctx, formData) {
  // Use the form data passed from the submit event (already validated)
  const email = formData.email?.trim() || '';

  const { getAuth, sendPasswordResetEmail } = await import('@firebase/auth');
  const auth = getAuth();

  try {
    await sendPasswordResetEmail(auth, email);

    trackPasswordReset();

    ctx.formManager.showSuccess(`Password reset email sent to ${email}. Please check your inbox.`);
  } catch (error) {
    // Handle Firebase-specific errors
    if (error.code === 'auth/user-not-found') {
      // For security, we don't reveal if the user exists
      // Still show success to prevent email enumeration
      trackPasswordReset(email); // Track as success for security
      ctx.formManager.showSuccess(`If an account exists for ${email}, a password reset email has been sent.`);
      return;
    }

    // Re-throw the error to be handled by the form handler
    throw error;
  }
}
