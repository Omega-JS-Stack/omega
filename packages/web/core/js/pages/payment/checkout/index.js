// Payment Checkout Page
import { FormManager } from '__main_assets__/js/libs/form-manager.js';
import { getPaymentConfig, getProcessors, getProductById } from '__main_assets__/js/libs/payment-config.js';
import { fetchTrialEligibility, warmupServer, createPaymentIntent } from './modules/api.js';
import { state, buildBindingsState, resolveProcessor, FREQUENCIES, getAvailableFrequencies } from './modules/state.js';
import { applyDiscountCode } from './modules/discount.js';
import { initializeRecaptcha } from './modules/recaptcha.js';
import { trackBeginCheckout, trackAddPaymentInfo } from './modules/tracking.js';
import webManager from 'web-manager';

let formManager = null;

// Module
export default () => {
  return new Promise(async function (resolve) {
    await webManager.dom().ready();
    await initializeCheckout();
    return resolve();
  });
};

// Update UI via bindings (single source of truth)
function updateUI() {
  webManager.bindings().update(buildBindingsState());
}

// Show fatal error and hide checkout content
function showError(message) {
  state.error = { show: true, message };
  updateUI();
}

// Create/reset abandoned cart tracker in Firestore (fire-and-forget)
function trackAbandonedCart(product, state) {
  const user = webManager.auth().getUser();
  if (!user) {
    return;
  }

  const uid = user.uid;
  const now = Math.floor(Date.now() / 1000);
  const nowISO = new Date().toISOString();
  const FIRST_REMINDER_DELAY = 900; // 15 minutes

  webManager.firestore().doc(`payments-carts/${uid}`).set({
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
    const _dev_trialEligible = urlParams.get('_dev_trialEligible');

    if (!productId) {
      throw new Error('Product ID is missing from URL.');
    }

    // Read payment config from _config.yml (available instantly via webManager.config)
    state.processors = getProcessors();

    // Find product
    const product = getProductById(productId);
    if (!product) {
      throw new Error(`Product "${productId}" not found.`);
    }
    state.product = product;

    // Wait for auth state to settle before any authorized calls
    await new Promise((resolve) => webManager.auth().listen({ once: true }, resolve));

    // Fire-and-forget server warmup
    warmupServer();

    // Parallel fetch: trial eligibility + reCAPTCHA
    const [trialResult, recaptchaResult] = await Promise.allSettled([
      fetchTrialEligibility(),
      initializeRecaptcha(webManager.config?.recaptcha?.['site-key']),
    ]);

    /* @dev-only:start */
    {
      const _dev_preDelay = urlParams.get('_dev_preDelay');
      if (_dev_preDelay) {
        const delayMs = parseInt(_dev_preDelay, 10) || 5000;
        console.warn(`[Checkout Dev] Artificial pre-delay: ${delayMs}ms`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        console.warn('[Checkout Dev] Pre-delay complete');
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

    // Dev override for trial
    if (_dev_trialEligible && webManager.isDevelopment()) {
      trialEligible = _dev_trialEligible === 'true';
    }

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
      webManager._chatsy?.open();
    });
  }

  // Set form ready
  formManager.ready();

  /* @dev-only:start */
  // Dev mode: expose debug helpers + dev tools panel
  {
    window._checkout = {
      get state() { return JSON.parse(JSON.stringify(state)); },
      get formData() { return formManager.getData(); },
      get bindings() { return buildBindingsState(); },
      resolveProcessor: (method) => resolveProcessor(method || 'card'),
    };
    console.log('%c[Checkout Dev] window._checkout available', 'color: #8B5CF6');

    initDevPanel();
  }
  /* @dev-only:end */
}

/* @dev-only:start */
// Dev tools panel (dev mode only)
function initDevPanel() {
  const $panel = document.getElementById('checkout-dev-panel');
  if (!$panel) return;

  // Show the panel
  $panel.hidden = false;

  const products = getPaymentConfig().products || [];
  const params = new URLSearchParams(window.location.search);

  // Populate product dropdown
  const $productSelect = $panel.querySelector('[data-dev-param="product"]');
  products.forEach(p => {
    const $option = document.createElement('option');
    $option.value = p.id;
    $option.textContent = `${p.name} (${p.type})`;
    $productSelect.appendChild($option);
  });

  // Set current values from URL
  $panel.querySelectorAll('[data-dev-param]').forEach($el => {
    const val = params.get($el.getAttribute('data-dev-param'));
    if (val !== null) $el.value = val;
  });

  // Apply & reload
  document.getElementById('checkout-dev-apply').addEventListener('click', () => {
    const newParams = new URLSearchParams();
    $panel.querySelectorAll('[data-dev-param]').forEach($el => {
      const val = $el.value.trim();
      if (val) newParams.set($el.getAttribute('data-dev-param'), val);
    });
    window.location.search = newParams.toString();
  });
}
/* @dev-only:end */
