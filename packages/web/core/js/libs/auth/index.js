// Auth pages orchestrator — required by /signin, /signup, and /reset (the
// logic is mostly shared). Boot order matters and is the whole job of this
// file; the flows live in focused modules:
//
//   forms.js           FormManager wiring, validation, consent UI
//   email.js           email/password signin, signup, reset
//   oauth.js           provider popup/redirect flows + accidental-signup reversal
//   session-params.js  ?authSignout / ?authCustomToken / authReturnUrl / subdomain policy
//   errors.js          Firebase error translation (pure)
//   tracking.js        GA4/FB/TikTok auth events
//
// The password eye is NOT wired here any more: it is a click trigger on the
// shared registry (#16), registered once by the global module.

// Libraries
import omega from '@omega.js/client';
import { initializeSigninForm, initializeSignupForm, initializeResetForm } from '__main_assets__/js/libs/auth/forms.js';
import { handleRedirectResult, shouldUseAuthPopup } from '__main_assets__/js/libs/auth/oauth.js';
import { handleAuthSignout, handleCustomTokenSignin, updateAuthReturnUrl, checkSubdomainAuth } from '__main_assets__/js/libs/auth/session-params.js';
import { createLogger } from '__main_assets__/js/libs/logger.js';

/* @dev-only:start */
// The auth pages' dev control lives in the dev palette (#234, #342). The import
// is inside the block, so production strips it with the section.
import { registerDevSection } from '__main_assets__/js/core/dev-sections.js';
/* @dev-only:end */

const logger = createLogger('auth:pages');

// Module
export default function () {
  // Shared flow context: the active FormManager (set by forms.js) and the
  // popup-vs-redirect choice, passed explicitly to every flow that needs it.
  const ctx = {
    formManager: null,
    useAuthPopup: shouldUseAuthPopup(),
  };

  // Handle DOM ready
  omega.dom().ready()
  .then(async () => {
    // Log
    logger.log('Initialized. useAuthPopup:', ctx.useAuthPopup);

    /* @dev-only:start */
    // Registered FIRST: every path below can return early, and the palette must
    // still offer the simulation on a page that bailed out.
    if (omega.isDevelopment()) {
      // Its own id, not the palette's built-in `auth` — that section is the
      // "Signed in as" readout, and a redirect simulator does not belong under it.
      registerDevSection('oauth', {
        title: 'OAuth',
        buildNode: buildOauthDevSection,
      });
    }
    /* @dev-only:end */

    // Check for authSignout parameter first
    await handleAuthSignout();

    // Check for authCustomToken parameter (admin impersonation / custom token sign-in)
    const customTokenHandled = await handleCustomTokenSignin();
    if (customTokenHandled) {
      return;
    }

    // Initialize the appropriate form based on the page (with autoReady: false)
    initializePageForm();

    // No form matched (warned above) — bail instead of crashing on null
    if (!ctx.formManager) {
      return;
    }

    // Disable form fields while checking for OAuth redirect result.
    // State stays 'initializing' so spinners remain visible during the check.
    // formManager.ready() transitions to 'ready' and re-enables if no redirect is found.
    ctx.formManager._setDisabled(true);

    // Check for redirect result from OAuth providers BEFORE enabling form
    // This prevents the form from appearing interactive while redirect is processing
    const hasRedirectResult = await handleRedirectResult(ctx);

    // Log
    logger.log('hasRedirectResult:', hasRedirectResult);

    // If redirect result was found, don't enable the form - user will be redirected
    if (hasRedirectResult) {
      return;
    }

    // Check subdomain auth restrictions and redirect if needed
    if (checkSubdomainAuth()) {
      return;
    }

    // No redirect pending - enable the form
    ctx.formManager.ready();

    // Update auth return URL in all auth-related links
    updateAuthReturnUrl();
  });

  /* @dev-only:start */
  /**
   * The palette's OAuth section: rehearse a returning provider redirect without
   * leaving for a provider. A URL param and a navigation to apply it, because
   * handleRedirectResult reads it once, on page init — the same reason the
   * checkout's controls navigate.
   */
  function buildOauthDevSection(doc) {
    const SIMULATE_PARAM = '_dev_simulateRedirect';

    const wrap = doc.createElement('div');
    wrap.className = 'omega-devbar__fields';

    const select = doc.createElement('select');
    select.className = 'omega-devbar__select';
    select.setAttribute('aria-label', 'Simulate an OAuth redirect');
    [
      ['', '(no simulation)'],
      ['signin', 'Returning user'],
      ['signup', 'New user'],
      ['error', 'Credential conflict'],
    ].forEach(([value, label]) => {
      const option = doc.createElement('option');
      option.value = value;
      option.textContent = label;
      select.appendChild(option);
    });
    select.value = new URLSearchParams(window.location.search).get(SIMULATE_PARAM) || '';

    const apply = doc.createElement('button');
    apply.type = 'button';
    apply.className = 'omega-devbar__btn';
    apply.textContent = 'Apply & reload';
    apply.addEventListener('click', () => {
      const next = new URLSearchParams(window.location.search);
      if (select.value) {
        next.set(SIMULATE_PARAM, select.value);
      } else {
        next.delete(SIMULATE_PARAM);
      }
      window.location.search = next.toString();
    });

    wrap.append(select, apply);

    return wrap;
  }
  /* @dev-only:end */

  // Initialize the form based on current page
  function initializePageForm() {
    // page.url carries a trailing slash ('/signin/') and may carry a locale
    // prefix ('/es/signin/') — match on the final segment. Safe because this
    // module is only ever imported by the auth pages themselves.
    const pagePath = (document.documentElement.getAttribute('data-page-path') || '').replace(/\/+$/, '');

    if (!pagePath) {
      logger.warn('No data-page-path attribute found on HTML element');
      return;
    }

    if (pagePath.endsWith('/signin')) {
      initializeSigninForm(ctx);
    } else if (pagePath.endsWith('/signup')) {
      initializeSignupForm(ctx);
    } else if (pagePath.endsWith('/reset')) {
      initializeResetForm(ctx);
    } else {
      logger.warn(`Unrecognized auth page path: ${pagePath}`);
    }
  }
}
