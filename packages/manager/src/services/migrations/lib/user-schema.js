/**
 * The `users` migration's record, derived from @omega.js/account's USER_SCHEMA
 * (the one home of its shape): backfill defaults, validation shape, nullable
 * string fields. A field the schema gains reaches the migration with no edit.
 */
const { USER_SCHEMA } = require('@omega.js/account');
const { resolve, expandTimestamp } = require('@omega.js/account/engine');

const EPOCH = new Date(0).toISOString();

// A backfill never invents a time, so '$timestamp:now' resolves to epoch too. No
// generators: the dynamic fields resolve to null and the migration mints them per doc.
const BACKFILL_CONTEXT = { generators: {}, now: EPOCH, nowUNIX: 0, oldDate: EPOCH, oldDateUNIX: 0 };

/** A schema node that is a branch (object), not a leaf field or a string shorthand. */
function isBranch(node) {
  return typeof node === 'object' && typeof node.type !== 'string';
}

/** A passthrough map that declares no fields of its own (`connections`, a touch's `tags`). */
function isOpenMap(node) {
  return node.$passthrough === true && Object.keys(node).every((key) => key.startsWith('$'));
}

/** The declared (non-meta) entries of a schema branch. */
function fields(branch) {
  return Object.entries(branch).filter(([key]) => !key.startsWith('$'));
}

// An open map below the top level (a touch's tags/clickIds, usage.overrides) exists
// only once something fills it, so the backfill never writes its empty husk.
function pruneNestedOpenMaps(branch, record) {
  for (const [key, node] of fields(branch)) {
    if (!isBranch(node)) {
      continue;
    }
    if (isOpenMap(node)) {
      delete record[key];
    } else {
      pruneNestedOpenMaps(node, record[key]);
    }
  }
}

/** The validator node for one schema node; `top` marks a top-level branch. */
function validationNode(node, top) {
  if (typeof node === 'string') {
    if (!node.startsWith('$timestamp')) {
      throw new Error(`user-schema: no validation shape for the schema shorthand '${node}'`);
    }
    return validationNode(expandTimestamp(node), false);
  }

  if (!isBranch(node)) {
    return { type: node.type, required: true, nullable: node.nullable === true };
  }

  if (isOpenMap(node)) {
    return { type: 'object', required: top };
  }

  const properties = Object.fromEntries(fields(node).map(([key, child]) => [key, validationNode(child, false)]));
  return { type: 'object', required: true, properties };
}

/** Every leaf field under a schema branch as `{ path, node, timestamp }`, shorthands expanded. */
function leafFields(branch, prefix) {
  return fields(branch).flatMap(([key, node]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof node === 'string') {
      return leafFields(expandTimestamp(node), path).map((leaf) => ({ ...leaf, timestamp: true }));
    }
    return isBranch(node) ? leafFields(node, path) : [{ path, node }];
  });
}

/** Dotted paths of every nullable string field under `prefix`'s schema branch. */
function nullableStringFields(prefix) {
  return leafFields(USER_SCHEMA[prefix], prefix)
    .filter(({ node }) => node.type === 'string' && node.nullable === true)
    .map(({ path }) => path);
}

const DEFAULT_USER = resolve(USER_SCHEMA, {}, BACKFILL_CONTEXT);

for (const [key, node] of fields(USER_SCHEMA)) {
  if (isBranch(node) && !isOpenMap(node)) {
    pruneNestedOpenMaps(node, DEFAULT_USER[key]);
  }
}

// The value a stored null resets to: non-nullable numbers, booleans and timestamps
// only. A null string or array (a status, a plan id) is reported, never guessed at.
const RESET_DEFAULTS = Object.fromEntries(leafFields(USER_SCHEMA)
  .filter(({ node, timestamp }) => node.nullable !== true
    && (timestamp || node.type === 'number' || node.type === 'boolean'))
  .map(({ path }) => [path, path.split('.').reduce((value, key) => value[key], DEFAULT_USER)]));

const USER_VALIDATION = Object.fromEntries(fields(USER_SCHEMA).map(([key, node]) => [key, validationNode(node, true)]));

module.exports = { DEFAULT_USER, USER_VALIDATION, RESET_DEFAULTS, nullableStringFields };
