/**
 * payment-cadences.js: the billing cadences a subscription product prices, in
 * the order the checkout lists them. A one-time product prices `once` instead.
 * The config validator and the backend's Chargebee library read this list.
 */

const SUBSCRIPTION_CADENCES = Object.freeze(['daily', 'weekly', 'monthly', 'annually']);

module.exports = { SUBSCRIPTION_CADENCES };
