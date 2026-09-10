/**
 * @omega.js/backend's marketing SSOT — the FIELDS + SEGMENTS dictionaries that
 * define every custom field and segment @omega.js/backend expects in the marketing
 * providers (SendGrid, Beehiiv), plus GROUP_KEYS, the unsubscribe groups its
 * send path names. Required straight from the @omega.js/backend
 * workspace package so the definitions can never drift from the code that
 * consumes them at runtime (omega-manager climbed the filesystem into the
 * sibling repo for the same reason — this is the same SSOT, resolved
 * properly through the workspace).
 *
 * omega-manager also carried an OMEGA-owned `import_batch` field here; its
 * only writer is the legacy-contact import script, which hasn't ported —
 * the field rides that port.
 */
const { FIELDS, SEGMENTS, GROUP_KEYS, fieldsForProvider } = require('@omega.js/backend/dist/manager/libraries/email/constants.js');

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

const BEM_FIELDS_BY_NAME = Object.fromEntries(BEM_FIELDS.map((field) => [field.name, field]));

/**
 * Fields a given provider should provision — @omega.js/backend's OWN view of its
 * catalog (#695), so what OMEGA creates and what the backend's contact sync
 * writes can never be two different lists.
 */
function fieldsFor(provider) {
  return fieldsForProvider(provider).map((name) => BEM_FIELDS_BY_NAME[name]);
}

/** Segments a given provider should provision (honors each segment's skip list). */
function segmentsFor(provider) {
  return BEM_SEGMENTS.filter((segment) => !segment.skip.includes(provider));
}

module.exports = { BACKEND_FIELDS_MAP: FIELDS, BEM_FIELDS, BEM_SEGMENTS, BEM_GROUP_KEYS: GROUP_KEYS, fieldsFor, segmentsFor };
