/**
 * @omegajs/backend's marketing SSOT — the FIELDS + SEGMENTS dictionaries that
 * define every custom field and segment @omegajs/backend expects in the marketing
 * providers (SendGrid, Beehiiv). Required straight from the @omegajs/backend
 * workspace package so the definitions can never drift from the code that
 * consumes them at runtime (omega-manager climbed the filesystem into the
 * sibling repo for the same reason — this is the same SSOT, resolved
 * properly through the workspace).
 *
 * omega-manager also carried an OMEGA-owned `import_batch` field here; its
 * only writer is the legacy-contact import script, which hasn't ported —
 * the field rides that port.
 */
const { FIELDS, SEGMENTS } = require('@omegajs/backend/src/manager/libraries/email/constants.js');

// Array shapes for handlers that iterate
const BEM_FIELDS = Object.entries(FIELDS).map(([name, field]) => ({
  name,
  display: field.display,
  type: field.type,
  skip: field.skip || [],
}));

const BEM_SEGMENTS = Object.entries(SEGMENTS).map(([name, segment]) => ({
  name,
  display: segment.display,
  conditions: segment.conditions,
  logic: segment.logic || 'and',
  skip: segment.skip || [],
}));

/** Fields a given provider should provision (honors each field's skip list). */
function fieldsFor(provider) {
  return BEM_FIELDS.filter((field) => !field.skip.includes(provider));
}

/** Segments a given provider should provision (honors each segment's skip list). */
function segmentsFor(provider) {
  return BEM_SEGMENTS.filter((segment) => !segment.skip.includes(provider));
}

module.exports = { BACKEND_FIELDS_MAP: FIELDS, BEM_FIELDS, BEM_SEGMENTS, fieldsFor, segmentsFor };
