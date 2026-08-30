// Payment Checkout Page
import { FormManager } from '@omega.js/client/modules/form-manager.js';
import { getProviders, getProductById } from '__main_assets__/js/libs/payment-config.js';
import { fetchTrialEligibility, createPaymentIntent } from './modules/api.js';
import { state, buildBindingsState, resolveProvider, resolveFrequency, TRIAL_ELIGIBILITY_UNKNOWN } from './modules/state.js';
import { applyDiscountCode } from './modules/discount.js';
import { initializeRecaptcha } from '../../../libs/recaptcha.js';
import { trackBeginCheckout, trackAddPaymentInfo } from './modules/tracking.js';
import omega from '@omega.js/client';
import { WAKEUP_ROUTE } from '@omega.js/client/modules/request.js';
import { siteUrl } from '__main_assets__/js/libs/path-prefix.js';
import { createLogger } from '__main_assets__/js/libs/logger.js';

/* @dev-only:start */
// The page's dev controls live in the dev palette, not on the page (#234).
// Both imports are inside the block, so production strips them entirely.
import { registerDevSection } from '__main_assets__/js/core/dev-sections.js';
import { checkoutDevSection } from './modules/dev-section.js';
/* @dev-only:end */

const logger = createLogger('checkout');

// How long the trial spot may hold its skeleton before the page settles on the
// fallback answer. Past this the visitor is told something rather than watching
// a shimmer, and the money line still resolves exactly ONCE
// ([#637](https://github.com/Omega-JS-Stack/omega/issues/637)).
const ELIGIBILITY_TIMEOUT_MS = 8000;

// What the race hands back when the deadline beat the server
const TIMED_OUT = Symbol('trial-eligibility-timeout');

let formManager = null;

// Whether paintOrder() has run. Until it has, the order root has no honest
// value to publish (see updateUI).
let orderPainted = false;

// Module
export default () => {
  return new Promise(async function (resolve) {
    await omega.dom().ready();
    await initializeCheckout();
    return resolve();
  });
};

// Update UI via bindings (single source of truth).
//
// Before the order half has landed, this redraws the build-config half ALONE:
// a shopper switching cadence while eligibility is in flight would otherwise
// write "$10.00 due today" into the total and watch it flip to "$0.00" plus a
// trial note when the answer arrived — exactly the flip rule 3 forbids (#637).
function updateUI() {
  if (!orderPainted) {
    paintStatic();
    return;
  }

  omega.bindings().update(buildBindingsState());
}

// Everything the build config already knows — the product, the plan tiles and
// their prices, the frequency radios, the pay buttons. No user data goes into
// it, so it paints before anything is awaited (#637, rule 1).
function paintStatic() {
  const { checkout } = buildBindingsState();

  omega.bindings().update({ checkout });
}

// The half only the server can answer: the trial spot and the money line. Its
// own bindings root is what kept those skeletons up through the paint above,
// so this writes them ONCE, with the answer already in (#637, rule 3).
function paintOrder() {
  const { order, auth } = buildBindingsState();

  orderPainted = true;
  omega.bindings().update({ order, auth });
}

// Show fatal error and hide checkout content
function showError(message) {
  state.error = { show: true, message };
  updateUI();
}

// Create/reset abandoned cart tracker in Firestore (fire-and-forget)
function trackAbandonedCart(product, state) {
  const user = omega.auth().getUser();
  if (!user) {
    return;
  }

  const uid = user.uid;
  const now = Math.floor(Date.now() / 1000);
  const nowISO = new Date().toISOString();
  const FIRST_REMINDER_DELAY = 900; // 15 minutes

  omega.firestore().doc(`payments-carts/${uid}`).set({
    id: uid,
    owner: uid,
    status: 'pending',
    productId: product.id,
    type: product.type || 'subscription',
    frequency: state.frequency || null,
    reminderIndex: 0,
    nextReminderAt: now + FIRST_REMINDER_DELAY,
    metadata: {
      created: { timestamp: nowISO, timestampUNIX: now },
      updated: { timestamp: nowISO, timestampUNIX: now },
    },
  })
    .catch((e) => console.warn('Failed to track abandoned cart:', e));
}

// Initialize checkout
async function initializeCheckout() {
  try {
    // Parse URL params
    const urlParams = new URLSearchParams(window.location.search);
    const productId = urlParams.get('product');
    const frequencyParam = urlParams.get('frequency');

    if (!productId) {
      throw new Error('Product ID is missing from URL.');
    }

    // Read payment config from _config.yml (available instantly via omega.config)
    state.providers = getProviders();

    // Find product
    const product = getProductById(productId);
    if (!product) {
      throw new Error(`Product "${productId}" not found.`);
    }
    state.product = product;

    // Resolve frequency: `once` for a one-time buy, otherwise the URL param if
    // valid and the longest available term if not (#668)
    state.frequency = resolveFrequency(product, frequencyParam);

    // Check payment methods are available
    const hasPaymentMethods = !!(
      state.providers?.stripe?.publishableKey
      || state.providers?.chargebee?.site
      || state.providers?.paypal?.clientId
    );

    if (!hasPaymentMethods) {
      showError('No payment methods are currently available. Please contact support for assistance.');
      return;
    }

    // Paint everything the build config knows, before a single wait (#637).
    // Nothing below this line is allowed to hold the page's copy hostage.
    paintStatic();

    // Setup form and events — gated, so the pay buttons stay disabled until
    // both async answers are in (#637, rule 5)
    setupForm();

    // Sync radio button to match URL frequency
    formManager.setData({ frequency: state.frequency });

    // Fire-and-forget server warmup. No auth: the backend's middleware answers
    // a wakeup before it authenticates, so this costs nothing on either end
    // (docs/client/index.md § the wakeup ping).
    omega.request(WAKEUP_ROUTE, { wakeup: true });

    // reCAPTCHA loads on its own clock; the page never waits on it
    initializeRecaptcha(omega.config?.captcha?.providers?.recaptcha?.siteKey)
      .catch((error) => console.warn('reCAPTCHA initialization failed:', error))
      .then(() => formManager.resolveGate('recaptcha'));

    // The money line. A subscription that SELLS a trial must ask the server
    // whether this visitor may take it, which is the ONE thing here that still
    // waits for auth (the route is asked about a specific user). Everything
    // else — a one-time buy, and a plan whose `trial.days` is missing or 0 —
    // has no trial to be eligible for, so there is no question, no request and
    // no wait: its total is build config like everything else and it paints now
    // (#637, [#666](https://github.com/Omega-JS-Stack/omega/issues/666)).
    const answered = product.type === 'subscription' && product.trial?.days > 0
      ? resolveTrialEligibility(urlParams, product)
      : noTrialToAsk();

    // Two-argument then, deliberately: the rejection handler sees a failed
    // ANSWER only, never a failure inside settleOrder — which has already armed
    // the form by the time it can throw, so the gate is never resolved twice.
    answered.then(() => settleOrder(), (error) => failOrder(error));

    // The load-time tracking wants the signed-in user, which is its own wait —
    // never the money line's.
    authSettled().then(() => {
      // Track begin_checkout
      trackBeginCheckout(state);

      // Create/reset abandoned cart tracker (fire-and-forget, authenticated only)
      trackAbandonedCart(product, state);
    });

  } catch (error) {
    console.error('Checkout initialization failed:', error);
    showError(error.message || 'Failed to load checkout. Please refresh the page and try again.');
  }
}

// Finish the order half now that its answer is in. The form arms FIRST, on
// purpose: a paint that throws must never leave a visitor looking at a pay
// button that can no longer arm (#637, rule 5). Both run in the same tick, so
// nothing renders between them.
function settleOrder() {
  formManager.resolveGate('eligibility');
  paintOrder();
}

// The order half never landed at all. Arm the form anyway, then say what
// happened — an error a visitor can act on beats a dead button.
function failOrder(error) {
  formManager.resolveGate('eligibility');
  console.error('Checkout could not price the order:', error);
  showError(error.message || 'Failed to load checkout. Please refresh the page and try again.');
}

// A one-time buy has no trial to be eligible for, so the answer is a known no
// — nothing is asked and nothing waits.
async function noTrialToAsk() {
  state.trialEligibility = false;
  state.trialEligible = false;
}

// Auth settle, as a promise. Two things want the signed-in user: the
// eligibility route, and the load-time tracking. Neither waits on the other.
function authSettled() {
  return new Promise((resolve) => omega.auth().listen({ once: true }, resolve));
}

// Ask the server whether this visitor may trial, bounded by ELIGIBILITY_TIMEOUT_MS
// (#637, rule 4). A deadline that wins leaves the answer UNKNOWN, which is not
// the same as "not eligible": the display below quotes no trial, and api.js's
// trialForPayload() still asks the intent route for one.
async function resolveTrialEligibility(urlParams, product) {
  let deadline;
  const answer = await Promise.race([
    askTrialEligibility(urlParams),
    new Promise((resolve) => { deadline = setTimeout(() => resolve(TIMED_OUT), ELIGIBILITY_TIMEOUT_MS); }),
  ]);
  clearTimeout(deadline);

  let trialEligibility = answer;

  if (answer === TIMED_OUT) {
    logger.warn(`Trial eligibility did not answer within ${ELIGIBILITY_TIMEOUT_MS}ms — the answer is unknown: no trial is quoted, the intent still asks for one`);
    trialEligibility = TRIAL_ELIGIBILITY_UNKNOWN;
  }

  /* @dev-only:start */
  {
    // The dev palette's trial-eligibility override, a URL param like every
    // other checkout dev control. The read lives INSIDE the block, so
    // production never looks and the literal never reaches a real bundle
    // (#245) — the last triple-gate violation on this page.
    if (omega.isDevelopment()) {
      const _dev_trialEligible = urlParams.get('_dev_trialEligible');
      if (_dev_trialEligible) {
        trialEligibility = _dev_trialEligible === 'true';
      }
    }
  }
  /* @dev-only:end */

  state.trialEligibility = trialEligibility;

  // Only a CONFIRMED yes is displayed, and only if the product sells a trial:
  // an unknown answer quotes the full amount due today, because rule 3 never
  // shows a price the server has not confirmed.
  state.trialEligible = trialEligibility === true && (product.trial?.days > 0);
}

// The request half of the answer above: the auth wait plus the route call.
async function askTrialEligibility(urlParams) {
  /* @dev-only:start */
  {
    // The slow-backend rehearsal (#342), applied to the ONE wait the page still
    // has: the trial spot and the money line hold their skeletons this long, and
    // a delay past ELIGIBILITY_TIMEOUT_MS rehearses the fallback too.
    const _dev_preDelay = urlParams.get('_dev_preDelay');
    if (_dev_preDelay) {
      const delayMs = parseInt(_dev_preDelay, 10) || 5000;
      logger.warn(`Artificial pre-delay: ${delayMs}ms`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
      logger.warn('Pre-delay complete');
    }
  }
  /* @dev-only:end */

  // Wait for auth state to settle before any authorized calls
  await authSettled();

  return fetchTrialEligibility();
}

// Setup FormManager and event listeners
function setupForm() {
  formManager = new FormManager('#checkout-form', {
    autoReady: false,
    allowResubmit: false,
    submittingText: 'Processing...',
    submittedText: 'Redirecting...',
  });

  // Nothing may be paid for until the page knows what it is charging: the
  // trial answer prices the order, and reCAPTCHA is what the intent route
  // verifies. ready() below is held until both land (#637, rule 5).
  formManager.addGate('eligibility');
  formManager.addGate('recaptcha');

  // Frequency changes
  formManager.on('change', ({ name, value }) => {
    if (name !== 'frequency') return;
    if (!value || value === state.frequency) return;

    state.frequency = value;
    updateUI();
  });

  // Form submission (payment)
  formManager.on('submit', async ({ $submitButton }) => {
    // Fall back to first visible payment button if Enter was pressed without clicking one
    const $btn = $submitButton
      || document.querySelector('#checkout-form button[data-payment-method]:not([hidden])');
    const paymentMethod = $btn?.getAttribute('data-payment-method');
    if (!paymentMethod) {
      throw new Error('Please choose a payment method.');
    }

    // Track payment info
    trackAddPaymentInfo(state, paymentMethod);

    // Resolve provider (card -> stripe/chargebee, paypal -> paypal, etc.)
    const provider = resolveProvider(paymentMethod);

    // Create payment intent and redirect
    const response = await createPaymentIntent({
      state,
      provider,
      formData: formManager.getData(),
    });

    // Clear dirty state so FormManager doesn't trigger "leave site" prompt
    formManager.setDirty(false);

    // Redirect to provider checkout
    window.location.href = response.url;

    // Never resolves -- we're navigating away
    return new Promise(() => {});
  });

  // Discount button
  const $applyDiscountBtn = document.querySelector('[data-action="apply-discount"]');
  const $discountInput = document.getElementById('discount-code');
  if ($applyDiscountBtn) {
    $applyDiscountBtn.addEventListener('click', () => {
      const data = formManager.getData();
      applyDiscountCode(data.discount, updateUI);
    });
  }
  if ($discountInput) {
    $discountInput.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') {
        return;
      }
      e.preventDefault();
      $applyDiscountBtn?.click();
    });
  }

  // Switch account link
  const $switchAccountLink = document.getElementById('switch-account');
  if ($switchAccountLink) {
    const currentUrl = encodeURIComponent(window.location.href);
    $switchAccountLink.href = siteUrl(`/signin?authSignout=true&authReturnUrl=${currentUrl}`);
  }

  // Help button — the pay-stack capture renders once per viewport (#374), so
  // the id appears twice and getElementById would leave the phone copy dead.
  document.querySelectorAll('#checkout-help-button').forEach(($helpButton) => {
    $helpButton.addEventListener('click', (e) => {
      e.preventDefault();
      omega._chatsy?.open();
    });
  });

  // Set form ready
  formManager.ready();

  /* @dev-only:start */
  // Dev mode: expose debug helpers + hand the palette this page's controls
  if (omega.isDevelopment()) {
    window._checkout = {
      get state() { return JSON.parse(JSON.stringify(state)); },
      get formData() { return formManager.getData(); },
      get bindings() { return buildBindingsState(); },
      resolveProvider: (method) => resolveProvider(method || 'card'),
    };
    // The tag rides INSIDE the format string here — %c styles only what follows
    // it in the first argument, so a separate tag arg would print a literal %c.
    console.log(`%c${logger.tag} window._checkout available`, 'color: #2563EB');

    // The palette renders this when the panel opens, so registering after it
    // booted is fine — it renders as its own section in the panel's extras.
    registerDevSection('checkout', checkoutDevSection);
  }
  /* @dev-only:end */
}
