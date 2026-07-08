/**
 * Metadata timestamp fix — moves legacy created/updated fields into
 * metadata.created/metadata.updated, falling back to the document's server
 * create/update times. The REST client surfaces those as ISO strings
 * (doc.createTime/doc.updateTime), not admin-SDK Timestamp objects.
 */
const { FieldValue } = require('./migration-runner.js');

const EPOCH = '1970-01-01T00:00:00.000Z';

/**
 * Convert a document server timestamp (ISO string from doc.createTime /
 * doc.updateTime) to our standard { timestamp, timestampUNIX } format.
 */
function serverTimestampToObject(isoString) {
  if (!isoString) {
    return null;
  }

  const date = new Date(isoString);

  return {
    timestamp: date.toISOString(),
    timestampUNIX: Math.round(date.getTime() / 1000),
  };
}

/**
 * Check if a metadata timestamp is missing or is the epoch default
 */
function isMissingOrEpoch(ts) {
  if (!ts) {
    return true;
  }

  if (typeof ts === 'object' && ts.timestamp === EPOCH && ts.timestampUNIX === 0) {
    return true;
  }

  return false;
}

/**
 * Creates a fix function that moves legacy fields into metadata.created/metadata.updated,
 * then falls back to the document's createTime/updateTime for any that are still missing.
 *
 * This should be added as the LAST metadata-related fix in any migration, after any legacy
 * field renames have already been applied.
 *
 * @param {Object} options
 * @param {Array<string>} options.legacyCreatedFields - Legacy field paths to check for created (e.g. ['created', 'dateAdded'])
 * @param {Array<string>} options.legacyUpdatedFields - Legacy field paths to check for updated (e.g. ['updated', 'edited'])
 * @returns {Function} Fix function: (data, doc) => updates or null
 */
function createMetadataFix(options = {}) {
  const legacyCreatedFields = options.legacyCreatedFields || ['created'];
  const legacyUpdatedFields = options.legacyUpdatedFields || ['updated'];

  return (data, doc) => {
    const updates = {};
    let hasUpdates = false;

    // Step 1: Move legacy created fields → metadata.created, and clean up all legacy fields
    for (const field of legacyCreatedFields) {
      const value = getNestedValue(data, field);
      if (!value) {
        continue;
      }

      // Use the first legacy value for metadata.created if not already set
      if (!data.metadata?.created && !updates['metadata.created']) {
        updates['metadata.created'] = value;
      }

      // Always delete the legacy field
      updates[field] = FieldValue.delete();
      hasUpdates = true;
    }

    // Step 2: Move legacy updated fields → metadata.updated, and clean up all legacy fields
    for (const field of legacyUpdatedFields) {
      const value = getNestedValue(data, field);
      if (!value) {
        continue;
      }

      // Use the first legacy value for metadata.updated if not already set
      if (!data.metadata?.updated && !updates['metadata.updated']) {
        updates['metadata.updated'] = value;
      }

      // Always delete the legacy field
      updates[field] = FieldValue.delete();
      hasUpdates = true;
    }

    // Step 3: Determine effective metadata after legacy migration
    const effectiveCreated = updates['metadata.created'] || data.metadata?.created;
    const effectiveUpdated = updates['metadata.updated'] || data.metadata?.updated;

    // Step 4: Fall back to document server timestamps for missing/epoch metadata
    const docCreated = serverTimestampToObject(doc.createTime);
    const docUpdated = serverTimestampToObject(doc.updateTime);

    if (isMissingOrEpoch(effectiveCreated)) {
      // Try doc.createTime, then doc.updateTime, then effectiveUpdated
      const fallback = docCreated || docUpdated || effectiveUpdated;

      if (fallback && !isMissingOrEpoch(fallback)) {
        updates['metadata.created'] = fallback;
        hasUpdates = true;
      }
    }

    if (isMissingOrEpoch(effectiveUpdated)) {
      // Try doc.updateTime, then the resolved created value
      const resolvedCreated = updates['metadata.created'] || effectiveCreated;
      const fallback = docUpdated || docCreated || resolvedCreated;

      if (fallback && !isMissingOrEpoch(fallback)) {
        updates['metadata.updated'] = fallback;
        hasUpdates = true;
      }
    }

    return hasUpdates ? updates : null;
  };
}

/**
 * Get a nested value from an object using dot-notation path
 */
function getNestedValue(obj, path) {
  const parts = path.split('.');
  let value = obj;

  for (const part of parts) {
    value = value?.[part];
  }

  return value;
}

module.exports = { createMetadataFix };
