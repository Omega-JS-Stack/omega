// Firebase Auth error translation — pure helpers shared by the email and
// OAuth flows. No DOM, no form state.

/**
 * Firebase password-related auth error codes — these belong on the password
 * field, not the form-level error banner.
 */
export function isPasswordError(errorCode) {
  return [
    'auth/weak-password',
    'auth/missing-password',
    'auth/wrong-password',
    'auth/password-does-not-meet-requirements',
  ].includes(errorCode);
}

/**
 * Map a Firebase password error to a short, field-appropriate message.
 */
export function passwordErrorMessage(error) {
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

/**
 * User-caused errors (bad password, closed popup, …) — never worth a Sentry
 * capture.
 */
export function isUserError(errorCode) {
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
    'auth/cancelled-popup-request',
  ];
  return userErrors.includes(errorCode);
}

/**
 * Extract the readable message from a Firebase Auth blocking-function error.
 *
 * When a @omega.js/backend blocking function (before-create / before-signin)
 * throws HttpsError('resource-exhausted', 'Too many signups...'), Firebase
 * surfaces it as `auth/internal-error` (sometimes also `auth/error-code:-47`)
 * and stashes the actual server response on `error.customData.serverResponse`.
 * The blob looks like:
 *
 *   {
 *     "error": {
 *       "code": 400,
 *       "message": "BLOCKING_FUNCTION_ERROR_RESPONSE : ((error : (message : \"Too many signups...\")))",
 *       ...
 *     }
 *   }
 *
 * Returns just the inner message string, or null if nothing useful was found.
 */
export function extractBlockingFunctionMessage(error) {
  // The OAuth redirect path (signInWithIdp → 503) delivers the rejection as
  // `auth/error-code:-47` with NO `customData.serverResponse` blob — Firebase
  // strips the @omega.js/backend-side message before it reaches the client.
  // The code is 1:1 with "blocking-function rejected this signup," so surface
  // a generic-but-helpful message that covers all three @omega.js/backend
  // beforeCreate reasons (rate limit, disposable email, custom hook reject).
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
