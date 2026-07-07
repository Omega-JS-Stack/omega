/**
 * Payment Config Library
 *
 * Reads payment configuration (products, processors, prices, limits) from
 * webManager.config.payment — which is populated from _config.yml at build time.
 * This eliminates the need to fetch /backend-manager/brand at runtime.
 */

import webManager from 'web-manager';

// Get the full payment config object
export function getPaymentConfig() {
  return webManager.config?.payment || {};
}

// Get payment processors
export function getProcessors() {
  return getPaymentConfig().processors || {};
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
