/**
 * Orders collection migration — converges `payments-orders` documents to the
 * current attribution shape.
 *
 * An order copies the checkout context off its payments-intents doc verbatim,
 * so orders written before #384 still carry the legacy `attribution.utm` blob
 * and resolve to no campaign data at all on a server conversion send.
 *
 * Fixes:
 * - Folds legacy `attribution.utm` → `attribution.first` + `attribution.last`
 *
 * No schema validation: an order's shape is owned by the payments webhook
 * pipeline (processor payloads, refunds, discounts) — this migration touches
 * attribution only and has no business declaring the rest.
 */
const { runMigration } = require('../lib/migration-runner.js');
const { createAttributionFoldFix } = require('../lib/attribution-touch.js');

/**
 * Orders collection migration handler.
 *
 * @param {Object} context - Handler context
 * @returns {Object} Migration results
 */
module.exports = async function ensureOrders(context) {
  return runMigration(context, {
    collection: 'payments-orders',

    fixes: [
      // Fix: legacy attribution blob → first/last touches
      createAttributionFoldFix(),
    ],
  });
};
