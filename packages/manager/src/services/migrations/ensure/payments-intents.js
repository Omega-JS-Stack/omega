/**
 * Payments-intents collection migration — converges `payments-intents`
 * documents to the current attribution shape.
 *
 * The intent is where the browser's attribution lands at checkout (the
 * webhook reads it back onto the order), so intents written before #384 hold
 * the legacy `attribution.utm` blob and are the upstream copy of the same
 * degradation the orders migration cures.
 *
 * Fixes:
 * - Folds legacy `attribution.utm` → `attribution.first` + `attribution.last`
 *
 * No schema validation: the intent's shape is owned by the payments intent
 * route — this migration touches attribution only.
 */
const { runMigration } = require('../lib/migration-runner.js');
const { createAttributionFoldFix } = require('../lib/attribution-touch.js');

/**
 * Payments-intents collection migration handler.
 *
 * @param {Object} context - Handler context
 * @returns {Object} Migration results
 */
module.exports = async function ensurePaymentsIntents(context) {
  return runMigration(context, {
    collection: 'payments-intents',

    fixes: [
      // Fix: legacy attribution blob → first/last touches
      createAttributionFoldFix(),
    ],
  });
};
