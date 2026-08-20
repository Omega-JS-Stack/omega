// Form wiring for the three auth pages: FormManager setup, shared validation,
// the provider-aware submit handler, and the signup consent UI.

// Libraries
import { FormManager } from '@omega.js/client/modules/form-manager.js';
import omega from '@omega.js/client';
import { event } from '__main_assets__/js/libs/analytics.js';
import { handleEmailSignin, handleEmailSignup, handlePasswordReset } from '__main_assets__/js/libs/auth/email.js';
import { signInWithProvider } from '__main_assets__/js/libs/auth/oauth.js';

function stateChangeHandler(ctx, { state }) {
  // Hide initializing spinners and show hidden elements when state changes from initializing
  if (state !== 'initializing') {
    ctx.formManager.$form.querySelectorAll('.form-initializing-spinner').forEach(($el) => {
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
function createAuthSubmitHandler(ctx, action, emailHandler) {
  return async ({ data, $submitButton }) => {
    const provider = $submitButton?.getAttribute('data-provider');

    // Capture consent BEFORE any Firebase call. On signup pages the checkbox state
    // must survive any post-auth redirect so @omega.js/backend's /user/signup can write it to the doc.
    // Read from FormManager-collected data on signup; ignored on signin (no checkboxes there).
    if (action === 'signup') {
      captureSignupConsent(data);
    }

    if (provider === 'email') {
      await emailHandler(ctx, data);
    } else if (provider) {
      await signInWithProvider(ctx, provider, action);
    }
  };
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
    $group.classList.add('is-invalid');
  }

  const $err = document.getElementById('consent-error');
  if ($err) {
    $err.textContent = `Please select "I agree" to the Terms of Service and Privacy Policy.`;
    $err.classList.remove('d-none');
  }
}

// Clear the consent error styling once the user starts interacting with the boxes.
// Runs on every change to either checkbox.
function clearConsentError() {
  const $group = document.getElementById('consent-group');
  if ($group) {
    $group.classList.remove('is-invalid');
  }
  const $err = document.getElementById('consent-error');
  if ($err) {
    $err.classList.add('d-none');
  }
}

// Read the consent checkboxes and stash to storage. Survives the post-signup redirect
// the same way attribution does. @omega.js/backend's /user/signup route picks it up via sendUserSignupMetadata.
function captureSignupConsent(data) {
  const legalLabel = document.querySelector('label[for="consent-legal"]')?.innerText?.trim() || null;
  const marketingLabel = document.querySelector('label[for="consent-marketing"]')?.innerText?.trim() || null;

  omega.storage().set('consent', {
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

function buildFormManager(ctx, { submittingText, submittedText }) {
  const formManager = new FormManager('#auth-form', {
    autoReady: false, // The boot sequence calls ready() after checking redirect result
    allowResubmit: false,
    warnOnUnsavedChanges: false,
    submittingText,
    submittedText,
  });
  ctx.formManager = formManager;
  formManager.on('statechange', (event) => stateChangeHandler(ctx, event));
  return formManager;
}

export function initializeSigninForm(ctx) {
  const formManager = buildFormManager(ctx, {
    submittingText: 'Signing in...',
    submittedText: 'Signed In!',
  });

  formManager.on('validation', validateEmailProvider);
  formManager.on('submit', createAuthSubmitHandler(ctx, 'signin', handleEmailSignin));
}

export function initializeSignupForm(ctx) {
  const formManager = buildFormManager(ctx, {
    submittingText: 'Creating account...',
    submittedText: 'Account Created!',
  });

  formManager.on('validation', validateEmailProvider);
  formManager.on('validation', validateConsent);
  formManager.on('submit', createAuthSubmitHandler(ctx, 'signup', handleEmailSignup));

  // Clear consent error styling when either checkbox is toggled
  document.getElementById('consent-legal')?.addEventListener('change', clearConsentError);
  document.getElementById('consent-marketing')?.addEventListener('change', clearConsentError);

  trackSignupStarted(formManager);
}

/**
 * The funnel ENTRY (#328 inventory gap 1: only completed signups fired, so the
 * drop-off between reaching the form and finishing it was invisible).
 *
 * The honest entry is the first real ENGAGEMENT with the form — the first
 * keystroke in a field, or the press of a provider button — not the page view
 * (a bounce is not a started signup) and not every keystroke. One fire per page
 * view: the flag is what makes it one, since two listeners each carrying
 * `{ once: true }` would fire twice for a visitor who types and then clicks.
 *
 * @param {object} formManager - the signup form's FormManager
 */
function trackSignupStarted(formManager) {
  const $form = formManager.$form;

  if (!$form) {
    return;
  }

  let started = false;

  const start = (domEvent) => {
    if (started) {
      return;
    }

    started = true;

    // The provider button carries the method; typing in the form is the email one.
    const provider = domEvent?.target?.closest?.('[data-provider]')?.getAttribute('data-provider');

    event('sign_up_started', {
      method: provider || 'email',
    });
  };

  $form.addEventListener('input', start);
  $form.addEventListener('click', start);
}

export function initializeResetForm(ctx) {
  const formManager = buildFormManager(ctx, {
    submittingText: 'Sending...',
    submittedText: 'Email Sent!',
  });

  formManager.on('submit', ({ data }) => handlePasswordReset(ctx, data));
}
