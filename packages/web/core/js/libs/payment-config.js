/**
 * Payment Config Library
 *
 * Reads payment configuration (products, providers, prices, feature values)
 * from omega.config.payment, and the FEATURES CATALOG from omega.config.features
 * — both populated by the build. This eliminates the need to fetch
 * /omega/brand at runtime.
 *
 * A feature is DEFINED once, in the catalog (name, icon, definition, and a
 * `usage` block on the metered ones); a product names only its VALUE
 * ([#647](https://github.com/Omega-JS-Stack/omega/issues/647)).
 */

import omega from '@omega.js/client';
import { isCountedFeature } from '@omega.js/client/modules/features.js';

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

// The feature catalog: feature id → { name, icon, definition, usage? }
export function getFeatureCatalog() {
  return omega.config?.features || {};
}

// One catalog entry, or null when the catalog does not define it
export function getFeature(featureId) {
  return getFeatureCatalog()[featureId] || null;
}

// A product's values map: feature id → number (counted) / true / a string (perk)
export function getProductFeatures(productId) {
  return getProductById(productId)?.features || {};
}

// A product's LIMITS: only the counted features it names a number for. The
// catalog is what decides which those are, so a perk can never be read as one.
export function getProductLimits(productId) {
  const catalog = getFeatureCatalog();
  const values = getProductFeatures(productId);
  const limits = {};

  for (const id of Object.keys(values)) {
    if (isCountedFeature(catalog[id]) && typeof values[id] === 'number') {
      limits[id] = values[id];
    }
  }

  return limits;
}

// Get a product's prices
export function getProductPrices(productId) {
  return getProductById(productId)?.prices || {};
}

// Get payment currency
export function getCurrency() {
  return getPaymentConfig().currency || 'USD';
}
