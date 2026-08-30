/**
 * Payment-provider rename migration ([#428](https://github.com/Omega-JS-Stack/omega/issues/428))
 * — the DATA half of the word change. #425 renamed the config block
 * (`payment.processors` → `payment.providers`) and #428 finished the job: the
 * singular word is `provider` in code, on the API, and on every document the
 * payment pipeline writes. Documents written BEFORE the cutover still carry
 * the old key, and nothing dual-reads it, so this sweep moves them.
 *
 * Five collections carry the field, each at its own path:
 * - `users`             — `subscription.payment.processor`
 * - `payments-orders`   — `processor`
 * - `payments-intents`  — `processor`
 * - `payments-webhooks` — `processor`
 * - `payments-disputes` — `alert.processor`
 *
 * Idempotent by construction: a document with no legacy key is a strict no-op,
 * and one that somehow carries BOTH keeps `provider` (written by the current
 * code, so it is the newer of the two) and drops only the leftover. A null
 * value still moves — `null` is what the schema stores for an account that
 * never paid, and leaving the retired key behind is the thing this exists to
 * stop.
 *
 * No schema validation: the payment collections' shapes are owned by the
 * webhook pipeline, and this migration touches ONE field.
 *
 * Like every migration, a run is an AUDIT until `--execute`:
 *   npx omega manage --migration=payment-provider            # counts, writes nothing
 *   npx omega manage --migration=payment-provider --execute  # performs it
 */
const { runMigration, FieldValue } = require('../lib/migration-runner.js');

// Every collection the payment pipeline stamps the provider onto, with the
// path the field sits at in that collection's documents.
const TARGETS = [
  { collection: 'users', legacy: 'subscription.payment.processor', current: 'subscription.payment.provider' },
  { collection: 'payments-orders', legacy: 'processor', current: 'provider' },
  { collection: 'payments-intents', legacy: 'processor', current: 'provider' },
  { collection: 'payments-webhooks', legacy: 'processor', current: 'provider' },
  { collection: 'payments-disputes', legacy: 'alert.processor', current: 'alert.provider' },
];

/**
 * Read a dot-notation path off a document, distinguishing "absent" from a
 * stored null.
 *
 * @param {Object} data - The document object
 * @param {string} path - Dot-notation field path
 * @returns {*} The value, or undefined when any segment is missing
 */
function readPath(data, path) {
  let target = data;

  for (const part of path.split('.')) {
    if (target === null || typeof target !== 'object' || !(part in target)) {
      return undefined;
    }
    target = target[part];
  }

  return target;
}

/**
 * Create the rename fix for one collection's field path.
 *
 * @param {string} legacy - The retired dot-notation path (`…processor`)
 * @param {string} current - The path it moves to (`…provider`)
 * @returns {Function} Fix function for runMigration: (data) => updates or null
 */
function createProviderRenameFix(legacy, current) {
  return (data) => {
    const legacyValue = readPath(data, legacy);
    if (legacyValue === undefined) {
      return null;
    }

    // Already renamed (by the current code, or by an earlier run) — the new
    // field is the newer of the two, so only the leftover goes.
    if (readPath(data, current) !== undefined) {
      return { [legacy]: FieldValue.delete() };
    }

    return {
      [current]: legacyValue,
      [legacy]: FieldValue.delete(),
    };
  };
}

/**
 * Payment-provider rename migration handler.
 *
 * @param {Object} context - Handler context
 * @returns {Object} Migration results, one stats block per collection
 */
module.exports = async function ensurePaymentProvider(context) {
  const output = {};
  let status;
  const warnings = [];

  for (const target of TARGETS) {
    const result = await runMigration(context, {
      collection: target.collection,
      fixes: [createProviderRenameFix(target.legacy, target.current)],
    });

    // Namespaced: three of these collections are ALSO migrated by another
    // handler in the same walk, and the service runner merges every
    // operation's output into one flat map — a bare `users` key would
    // silently overwrite the users migration's stats.
    for (const [collection, stats] of Object.entries(result.output || {})) {
      output[`payment-provider:${collection}`] = stats;
    }

    // A REST failure is credentials or permissions, which every remaining
    // collection would hit identically — stop and report rather than five
    // copies of the same error.
    if (result.status === 'error') {
      return { ...result, output };
    }

    if (result.status === 'warned') {
      status = 'warned';
      warnings.push(`${target.collection}: ${result.reason}`);
    }
  }

  return status ? { output, status, reason: warnings.join('; ') } : { output };
};

module.exports.TARGETS = TARGETS;
module.exports.createProviderRenameFix = createProviderRenameFix;
