// Payment Checkout Page
import { FormManager } from '@omega.js/client/modules/form-manager.js';
import { getProcessors, getProductById } from '__main_assets__/js/libs/payment-config.js';
import { fetchTrialEligibility, warmupServer, createPaymentIntent } from './modules/api.js';
import { state, buildBindingsState, resolveProcessor, FREQUENCIES, getAvailableFrequencies } from './modules/state.js';
import { applyDiscountCode } from './modules/discount.js';
import { initializeRecaptcha } from '../../../libs/recaptcha.js';
import { trackBeginCheckout, trackAddPaymentInfo } from './modules/tracking.js';
import omega from '@omega.js/client';
import { createLogger } from '__main_assets__/js/libs/logger.js';

/* @dev-only:start */
// The page's dev controls live in the dev palette, not on the page (#234).
// Both imports are inside the block, so production strips them entirely.
import { registerDevSection } from '__main_assets__/js/core/dev-sections.js';
import { checkoutDevSection } from './modules/dev-section.js';
/* @dev-only:end */

const logger = createLogger('checkout');

let formManager = null;

// Module
export default () => {
  return new Promise(async function (resolve) {
    await omega.dom().ready();
    await initializeCheckout();
    return resolve();
  });
};

// Update UI via bindings (single source of truth)
function updateUI() {
  omega.bindings().update(buildBindingsState());
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
    state.processors = getProcessors();

    // Find product
    const product = getProductById(productId);
    if (!product) {
      throw new Error(`Product "${productId}" not found.`);
    }
    state.product = product;

    // Wait for auth state to settle before any authorized calls
    await new Promise((resolve) => omega.auth().listen({ once: true }, resolve));

    // Fire-and-forget server warmup
    warmupServer();

    // Parallel fetch: trial eligibility + reCAPTCHA
    const [trialResult, recaptchaResult] = await Promise.allSettled([
      fetchTrialEligibility(),
      initializeRecaptcha(omega.config?.captcha?.providers?.recaptcha?.siteKey),
    ]);

    /* @dev-only:start */
    {
      const _dev_preDelay = urlParams.get('_dev_preDelay');
      if (_dev_preDelay) {
        const delayMs = parseInt(_dev_preDelay, 10) || 5000;
        logger.warn(`Artificial pre-delay: ${delayMs}ms`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        logger.warn('Pre-delay complete');
      }
    }
    /* @dev-only:end */

    // Resolve frequency: URL param if valid, otherwise longest available term
    const available = getAvailableFrequencies(product);
    if (frequencyParam && FREQUENCIES.includes(frequencyParam) && available.includes(frequencyParam)) {
      state.frequency = frequencyParam;
    } else {
      // Pick longest term (last in FREQUENCIES order: daily < weekly < monthly < annually)
      state.frequency = available[available.length - 1] || 'annually';
    }

    // Trial eligibility
    let trialEligible = trialResult.status === 'fulfilled' ? trialResult.value : false;

    /* @dev-only:start */
    {
      // The dev palette's trial-eligibility override, a URL param like every
      // other checkout dev control. The read lives INSIDE the block, so
      // production never looks and the literal never reaches a real bundle
      // (#245) — the last triple-gate violation on this page.
      if (omega.isDevelopment()) {
        const _dev_trialEligible = urlParams.get('_dev_trialEligible');
        if (_dev_trialEligible) {
          trialEligible = _dev_trialEligible === 'true';
        }
      }
    }
    /* @dev-only:end */

    // Only eligible if product also supports trials
    state.trialEligible = trialEligible && (product.trial?.days > 0);

    // Check payment methods are available
    const hasPaymentMethods = !!(
      state.processors?.stripe?.publishableKey
      || state.processors?.chargebee?.site
      || state.processors?.paypal?.clientId
      || state.processors?.coinbase?.enabled
    );

    if (!hasPaymentMethods) {
      showError('No payment methods are currently available. Please contact support for assistance.');
      return;
    }

    // Log reCAPTCHA status
    if (recaptchaResult.status === 'rejected') {
      console.warn('reCAPTCHA initialization failed:', recaptchaResult.reason);
    }

    // Update UI with loaded data
    updateUI();

    // Setup form and events
    setupForm();

    // Sync radio button to match URL frequency
    formManager.setData({ frequency: state.frequency });

    // Track begin_checkout
    trackBeginCheckout(state);

    // Create/reset abandoned cart tracker (fire-and-forget, authenticated only)
    trackAbandonedCart(product, state);

  } catch (error) {
    console.error('Checkout initialization failed:', error);
    showError(error.message || 'Failed to load checkout. Please refresh the page and try again.');
  }
}

// Setup FormManager and event listeners
function setupForm() {
  formManager = new FormManager('#checkout-form', {
    autoReady: false,
    allowResubmit: false,
    submittingText: 'Processing...',
    submittedText: 'Redirecting...',
  });

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

    // Resolve processor (card -> stripe/chargebee, paypal -> paypal, etc.)
    const processor = resolveProcessor(paymentMethod);

    // Create payment intent and redirect
    const response = await createPaymentIntent({
      state,
      processor,
      formData: formManager.getData(),
    });

    // Clear dirty state so FormManager doesn't trigger "leave site" prompt
    formManager.setDirty(false);

    // Redirect to processor checkout
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
    $switchAccountLink.href = `/signin?authSignout=true&authReturnUrl=${currentUrl}`;
  }

  // Help button
  const $helpButton = document.getElementById('checkout-help-button');
  if ($helpButton) {
    $helpButton.addEventListener('click', (e) => {
      e.preventDefault();
      omega._chatsy?.open();
    });
  }

  // Set form ready
  formManager.ready();

  /* @dev-only:start */
  // Dev mode: expose debug helpers + hand the palette this page's controls
  if (omega.isDevelopment()) {
    window._checkout = {
      get state() { return JSON.parse(JSON.stringify(state)); },
      get formData() { return formManager.getData(); },
      get bindings() { return buildBindingsState(); },
      resolveProcessor: (method) => resolveProcessor(method || 'card'),
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
