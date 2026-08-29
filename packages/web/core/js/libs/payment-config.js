/**
 * Payment Config Library
 *
 * Reads payment configuration (products, providers, prices, limits) from
 * omega.config.payment — which is populated from _config.yml at build time.
 * This eliminates the need to fetch /omega/brand at runtime.
 */

import omega from '@omega.js/client';

// The route every payment surface warms on load: checkout's first call is the
// intent POST, and every plan button on /pricing leads there. ONE home, because
// two pages fire the same ping
// ([#637](https://github.com/Omega-JS-Stack/omega/issues/637)). Any route would
// warm the same function — @omega.js/backend answers a wakeup before it loads a
// route — so the one the buyer is about to need is the honest choice.
export const PAYMENT_WARMUP_ROUTE = '/omega/payments/intent';

// Get the full payment config object
export function getPaymentConfig() {
  return omega.config?.payment || {};
}

// Get payment providers
export function getProviders() {
  return getPaymentConfig().providers || {};
}

// Get all products
export function getProducts() {
  return getPaymentConfig().products || [];
}

// Find a product by ID
export function getProductById(productId) {
  return getProducts().find(p => p.id === productId) || null;
}

// Get a product's limits
export function getProductLimits(productId) {
  return getProductById(productId)?.limits || {};
}

// Get a product's prices
export function getProductPrices(productId) {
  return getProductById(productId)?.prices || {};
}

// Get payment currency
export function getCurrency() {
  return getPaymentConfig().currency || 'USD';
}
