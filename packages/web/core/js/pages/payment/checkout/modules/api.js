// API calls for checkout
import fetch from 'wonderful-fetch';
import authorizedFetch from '__main_assets__/js/libs/authorized-fetch.js';
import { getRecaptchaToken } from './recaptcha.js';
import webManager from 'web-manager';

// Check trial eligibility via backend endpoint
export async function fetchTrialEligibility() {
  try {
    const response = await authorizedFetch(`${webManager.getApiUrl()}/backend-manager/payments/trial-eligibility`, {
      method: 'GET',
      response: 'json',
    });

    console.log('Trial eligibility:', response);
    return response.eligible || false;
  } catch (e) {
    console.warn('Trial eligibility check failed, assuming eligible:', e);
    return true;
  }
}

// Validate a discount code via backend
export async function validateDiscountCode(code) {
  const response = await fetch(`${webManager.getApiUrl()}/backend-manager/payments/discount`, {
    response: 'json',
    query: { code },
  });

  return response;
}

// Fire-and-forget server warmup
export function warmupServer() {
  fetch(`${webManager.getApiUrl()}/backend-manager/payments/intent`, {
    method: 'GET',
    query: { wakeup: 'true' },
  }).catch(() => {});
}

// Create payment intent and return { url }
export async function createPaymentIntent({ state, processor, formData }) {
  // Get reCAPTCHA token
  const recaptchaToken = await getRecaptchaToken('payment_intent');

  // Discount code from form data (validated server-side)
  const discountCode = state.discountCode || '';

  // Supplemental form data (everything except fields we handle explicitly)
  const supplemental = { ...formData };
  delete supplemental.frequency;
  delete supplemental.discount;

  // Build payload
  const payload = {
    processor,
    productId: state.product.id,
    frequency: state.frequency,
    trial: state.trialEligible,
    attribution: webManager.storage().get('attribution', {}),
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

  console.log('Sending payment intent:', { processor, productId: state.product.id, payload });

  // POST to backend (authorized — attaches Firebase ID token)
  const response = await authorizedFetch(`${webManager.getApiUrl()}/backend-manager/payments/intent`, {
    method: 'POST',
    response: 'json',
    tries: 1,
    body: payload,
  });

  if (!response.url) {
    throw new Error('No checkout URL returned from server');
  }

  console.log('Payment intent created:', response);
  return response;
}
