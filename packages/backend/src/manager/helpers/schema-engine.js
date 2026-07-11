/**
 * schema-engine.js — in-house declarative schema resolution (replaces powertools.defaults()
 * for settings; node-powertools stays a dependency for its other utilities).
 *
 * The shared field pipeline BOTH engines run on:
 *   - Declarative node schemas: Settings.resolve() → resolveSchema() walks the schema
 *     and resolves each leaf through resolveFieldValue().
 *   - Zod schemas: the fields.* builders (schema-zod.js) wrap the same
 *     resolveFieldValue() in z.preprocess pipes.
 *
 * Semantics are powertools.defaults() parity, proven differentially in
 * test/helpers/schema-zod.js, with two deliberate bug fixes:
 *   - No default-object pollution: powertools mutated non-empty object/array defaults
 *     in place (injecting types/min/max/value/default keys) and returned them by
 *     reference; this engine clones defaults per request and returns them clean.
 *   - Sound leaf detection: a node is a field when it carries any field option —
 *     powertools' walk only terminated on no-default nodes because its own pollution
 *     added `default`/`value` to them first.
 *
 * Preserved quirks (wire-visible, kept for parity):
 *   - min defaults to 0 / max to Infinity via `||` — negative numbers clamp to 0
 *     unless the schema declares a negative min; min: 0 / max: 0 behave as unset.
 *   - Coerce-never-reject: single-typed fields force(), multi-typed replace with default.
 *   - Empty-object schema nodes ({}) contribute nothing to output; unknown keys strip.
 */

const powertools = require('node-powertools');
const _ = require('lodash');

// Node options accepted by the zod fields builders — one-to-one with declarative
// schema nodes. `sanitize` is carried for the middleware sanitize pass; `enum` is
// accepted and stored but NOT enforced (it was always decorative in the declarative
// engine; enforcement is a pending tightening decision).
const FIELD_OPTIONS = ['types', 'default', 'value', 'min', 'max', 'required', 'clean', 'sanitize', 'enum'];

// Keys that mark a declarative node as a FIELD (leaf) rather than a nested group.
// Superset of FIELD_OPTIONS: legacy declarative schemas may also carry `available`.
const LEAF_KEYS = [...FIELD_OPTIONS, 'available'];

/**
 * Whether a declarative schema node is a field (leaf) rather than a nested group.
 * @param {*} node - Schema node
 * @returns {boolean}
 */
function isFieldNode(node) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    return false;
  }

  return LEAF_KEYS.some((key) => Object.prototype.hasOwnProperty.call(node, key));
}

/**
 * Depth-first walk of a declarative schema, calling fn(dotPath, node) for each field
 * node. Plain objects without field options are groups (recursed); empty objects and
 * non-object values contribute nothing (powertools enumerated no paths for them).
 * @param {object} schema - Declarative schema (map of key → field node or group)
 * @param {function} fn - (path, node) called per field node, in schema key order
 * @param {string} [path] - Internal recursion prefix
 */
function iterateSchema(schema, fn, path) {
  path = path || '';

  if (isFieldNode(schema)) {
    fn(path, schema);
    return;
  }

  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return;
  }

  Object.keys(schema).forEach((key) => {
    iterateSchema(schema[key], fn, path ? `${path}.${key}` : key);
  });
}

/**
 * Resolve settings against a declarative schema — drop-in replacement for
 * powertools.defaults(settings, schema). Returns a NEW object containing ONLY
 * schema-declared paths (unknown keys stripped at every level), each leaf resolved
 * through the shared pipeline. Mutates neither settings nor schema.
 * @param {object} settings - Raw input data
 * @param {object} schema - Declarative schema
 * @returns {object} Resolved settings
 */
function resolveSchema(settings, schema) {
  const output = {};

  iterateSchema(schema, (path, node) => {
    // A field node at the schema root has no key to set — nothing to resolve onto
    if (!path) {
      return;
    }

    _.set(output, path, resolveFieldValue(_.get(settings, path), node));
  });

  return output;
}

/**
 * Replicate powertools' enforceValidTypes() (node-powertools src/lib/object.js):
 * single-typed fields coerce via force(), multi-typed fields replace with the
 * default on mismatch, 'any' accepts everything. null and arrays pass as 'object'
 * (typeof semantics), matching the original.
 */
function enforceValidTypes(value, types, def) {
  const isValidType = types.some((type) => {
    if (type === 'any') return true;
    return typeof value === type || (type === 'array' && Array.isArray(value));
  });

  if (types.length === 1 && types[0] !== 'any') {
    return isValidType ? value : powertools.force(value, types[0]);
  }

  return isValidType ? value : def;
}

/**
 * Replicate powertools' enforceMinMax(): numbers clamp to [min, max]; strings and
 * arrays truncate to max (min is ignored for them). Note powertools defaults
 * min to 0 and max to Infinity via `||`, so negative numbers clamp to 0 unless the
 * schema declares a negative min, and min: 0 / max: 0 behave as unset.
 */
function enforceMinMax(value, min, max) {
  const isNumber = typeof value === 'number';
  const isString = typeof value === 'string';

  if (min !== undefined && isNumber && value < min) {
    return min;
  }

  if (max !== undefined) {
    if (isNumber && value > max) {
      return max;
    } else if (isString && value.length > max) {
      return value.slice(0, max);
    } else if (Array.isArray(value) && value.length > max) {
      return value.slice(0, max);
    }
  }

  return value;
}

/**
 * Resolve one field's raw input through the powertools node pipeline:
 * default-or-user → enforceValidTypes → enforceMinMax → forced value → clean.
 */
function resolveFieldValue(raw, opts) {
  const types = opts.types || ['any'];

  // powertools skips executing function defaults/values for 'any'/'function' types
  // (the function itself becomes the value)
  const shouldExecute = !types.includes('any') && !types.includes('function');

  let value = opts.value;
  if (typeof value === 'function' && shouldExecute) {
    value = value();
  }

  let def = opts.default;
  if (typeof def === 'function' && shouldExecute) {
    def = def();
  }

  // Clone object/array defaults so a request can't mutate schema state and the
  // pollution divergence documented in the header stays fixed
  if (def && typeof def === 'object') {
    def = _.cloneDeep(def);
  }

  let working = typeof raw === 'undefined' ? def : raw;
  working = enforceValidTypes(working, types, def);
  working = enforceMinMax(working, opts.min || 0, opts.max || Infinity);

  if (typeof value !== 'undefined') {
    working = value;
  }

  // Clean — applied to the fully-resolved value
  if (opts.clean) {
    if (opts.clean instanceof RegExp) {
      working = working.replace(opts.clean, '');
    } else if (typeof opts.clean === 'function') {
      working = opts.clean(working);
    }
  }

  return working;
}

module.exports = { FIELD_OPTIONS, isFieldNode, iterateSchema, resolveSchema, resolveFieldValue };
