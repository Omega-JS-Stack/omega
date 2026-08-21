/**
 * Attribution fold fix — converts the pre-#384 attribution blob
 * (`attribution.utm`, last-tagged-wins) into the touch model
 * (`attribution.first` + `attribution.last`) every current reader expects.
 *
 * The same fold runs on every surface that stores attribution: user docs,
 * payments-orders, payments-intents. The client already ships the identical
 * fold for its localStorage copy (@omega.js/web core/js/core/query-strings.js
 * migrateLegacyAttribution) — this is its server-side mirror, so a browser and
 * its documents converge on the same shape.
 *
 * What the old blob cannot answer stays unanswered: the true first touch is
 * unrecoverable (the blob only ever held the newest tagged visit), so both
 * slots take the same touch; `clickIds` and `referrer` were never captured, so
 * they are omitted/null rather than invented as empty husks — the capture
 * convention writes a key only when the visit carried one.
 */
const { FieldValue } = require('./migration-runner.js');

/**
 * Create a migration fix that folds a legacy `attribution.utm` blob into
 * `attribution.first` / `attribution.last` and deletes the blob.
 *
 * Idempotent: a document already carrying a touch keeps it (only a leftover
 * blob is dropped), and a document with no blob is a strict no-op — nothing,
 * including `attribution` itself, is ever synthesized.
 *
 * @returns {Function} Fix function for runMigration: (data) => updates or null
 */
function createAttributionFoldFix() {
  return (data) => {
    const attribution = data.attribution;
    if (!attribution || typeof attribution !== 'object') {
      return null;
    }

    const legacy = attribution.utm;
    if (!legacy || typeof legacy !== 'object') {
      return null;
    }

    // Already folded (by an earlier run, or by the client writing through) —
    // the touches are newer than this blob, so only the blob goes.
    if (attribution.first || attribution.last) {
      return { 'attribution.utm': FieldValue.delete() };
    }

    const touch = {
      ...(legacy.tags && Object.keys(legacy.tags).length > 0 ? { tags: legacy.tags } : {}),
      referrer: null,
      url: legacy.url || null,
      page: legacy.page || null,
      timestamp: legacy.timestamp || null,
    };

    return {
      'attribution.first': touch,
      'attribution.last': { ...touch },
      'attribution.utm': FieldValue.delete(),
    };
  };
}

module.exports = { createAttributionFoldFix };
