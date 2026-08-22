// API calls for checkout
import fetch from 'wonderful-fetch';
import { getRecaptchaToken } from '../../../../libs/recaptcha.js';
import { readPlatformCookies } from '__main_assets__/js/libs/analytics.js';
import omega from '@omega.js/client';

// Check trial eligibility via backend endpoint
export async function fetchTrialEligibility() {
  try {
    const response = await omega.request(`/omega/payments/trial-eligibility`, {
      method: 'GET',
    });

    console.log('Trial eligibility:', response);
    return response.eligible || false;
  } catch (e) {
    console.warn('Trial eligibility check failed, assuming eligible:', e);
    return true;
  }
}

// Validate a discount code via backend
// `response: 'json'` is load-bearing: wonderful-fetch defaults to 'raw', and a
// raw Response has no `.valid`/`.percent`, so every code read as invalid.
export async function validateDiscountCode(code) {
  const response = await fetch(`${omega.getApiUrl()}/omega/payments/discount`, {
    query: { code },
    response: 'json',
  });

  return response;
}

// Fire-and-forget server warmup
export function warmupServer() {
  fetch(`${omega.getApiUrl()}/omega/payments/intent`, {
    method: 'GET',
    query: { wakeup: 'true' },
  }).catch(() => {});
}

// Create payment intent and return { url }
export async function createPaymentIntent({ state, provider, formData }) {
  // Get reCAPTCHA token
  const recaptchaToken = await getRecaptchaToken('payment_intent');

  // Discount code from form data (validated server-side)
  const discountCode = state.discountCode || '';

  // Supplemental form data (everything except fields we handle explicitly)
  const supplemental = { ...formData };
  delete supplemental.frequency;
  delete supplemental.discount;

  // The stored attribution plus the platform cookies as they stand right now.
  // Spread, never mutated: the stored object is the client storage module's own.
  const storedAttribution = omega.storage().get('attribution', {});
  const cookies = readPlatformCookies();
  const attribution = Object.keys(cookies).length
    ? { ...storedAttribution, cookies }
    : storedAttribution;

  // Build payload
  const payload = {
    provider,
    productId: state.product.id,
    frequency: state.frequency,
    trial: state.trialEligible,
    attribution: attribution,
    // The tracking-consent snapshot rides along verbatim — the intent doc stores it
    // beside attribution and the order fold copies it, so a conversion knows what
    // the user agreed to. Its own key, distinct from the legal/marketing consent
    // the signup form captures; read as a key, never interpreted here.
    trackingConsent: omega.storage().get('trackingConsent', null),
    verification: {
      'g-recaptcha-response': recaptchaToken || '',
    },
  };

  // Optional fields
  if (discountCode) {
    payload.discount = discountCode;
  }

  if (Object.keys(supplemental).length > 0) {
    payload.supplemental = supplemental;
  }

  /* @dev-only:start */
  {
    // The dev palette's "Decline next checkout" arm, a URL param like every
    // other checkout dev control — presence is the arm, and it lasts until the
    // palette applies it away. The read lives INSIDE the block, so production
    // never looks and the literal never reaches a real bundle.
    if (omega.isDevelopment() && new URLSearchParams(window.location.search).has('_dev_decline')) {
      payload.simulate = 'decline';
    }
  }
  /* @dev-only:end */

  console.log('Sending payment intent:', { provider, productId: state.product.id, payload });

  // POST to backend (authorized — attaches Firebase ID token)
  const response = await omega.request(`/omega/payments/intent`, {
    method: 'POST',
    tries: 1,
    body: payload,
  });

  if (!response.url) {
    throw new Error('No checkout URL returned from server');
  }

  console.log('Payment intent created:', response);
  return response;
}
