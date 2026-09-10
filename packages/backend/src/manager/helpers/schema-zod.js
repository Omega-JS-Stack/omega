/**
 * schema-zod.js — zod route-schema support with powertools-parity semantics.
 *
 * A `schemas/<route>/<method>.js` module may export a zod schema instead of a
 * declarative node object; Settings.resolve() detects it (isZodSchema) and runs
 * resolveZodSchema() in place of the declarative walk. Wire shapes are preserved:
 * schemas built with the `fields` builders run the SAME field pipeline as the
 * declarative engine (shared in schema-engine.js — coerce-never-reject,
 * clamp/truncate, required fires on undefined/'') — see
 * _attic/plans/archive/zod-route-schemas-design.md for the full preservation checklist.
 *
 * Builders (mirror the declarative node options one-to-one):
 *   const { z, fields: f } = require('../../helpers/schema-zod.js');
 *   module.exports = (context) => f.object({
 *     name: f.string({ default: undefined, required: true }),
 *     amount: f.number({ default: 1, min: 1, max: 100 }),
 *     tags: f.array({ default: [] }),
 *     config: f.passthrough({ default: {} }),          // types: ['object'] — nested content passes through
 *     version: f.multi(['string', 'number'], { default: '5' }),
 *     nested: f.object({ level1: f.string({ default: 'x' }) }),
 *   });
 *
 * Every field is a z.preprocess() pipe — zod 4 runs preprocess for ABSENT object
 * keys (transforms are skipped), which is what lets defaults apply to missing input.
 *
 * A module may also export raw zod (no builders). That opts into zod-native
 * semantics: invalid input REJECTS with 400 instead of coercing, and there is no
 * `required` metadata (use zod's own optional/refine machinery).
 *
 * The field pipeline (and its deliberate powertools bug fixes: no default-object
 * pollution, defaults cloned per request) lives in schema-engine.js — shared with
 * the declarative engine and asserted in test/helpers/schema-zod.js.
 */

const { z } = require('zod');
const _ = require('lodash');
const { FIELD_OPTIONS, resolveFieldValue, enforceEnums, enforceMins } = require('./schema-engine.js');

/**
 * Detect a zod schema (any version with the zod 4 internal marker).
 * Duck-typed instead of instanceof so consumer projects with their own zod copy work.
 * @param {*} x
 * @returns {boolean}
 */
function isZodSchema(x) {
  return !!x && typeof x === 'object' && typeof x.safeParse === 'function' && !!x._zod;
}

/**
 * Resolve settings against a zod schema — the zod counterpart of the declarative
 * walk in Settings.resolve().
 * Required semantics (fires on undefined/'', function support, checkRequired
 * opt-out), enum enforcement (sent values checked post-coercion; absent fields
 * pass) and the min length floor (short strings/arrays refuse) run from the
 * ._omegaMeta registry that fields.object() builds; the error messages and codes
 * match the declarative engine exactly.
 * @param {object} ctx - RouteContext (report)
 * @param {import('zod').ZodType} schema - Zod schema (usually from fields.object())
 * @param {object} settings - Raw request data
 * @param {object} options - Resolve options (checkRequired, user, ...)
 * @returns {object} Resolved settings
 */
function resolveZodSchema(ctx, schema, settings, options) {
  const meta = schema._omegaMeta;

  // Required check — same rule as the declarative engine: fires when the raw value
  // is undefined or '' (null, 0, false pass), honoring checkRequired and
  // function-valued required(ctx, settings, options).
  if (options.checkRequired && meta) {
    for (const [path, node] of Object.entries(meta.paths)) {
      const isRequired = typeof node.required === 'function'
        ? node.required(ctx, settings, options)
        : node.required === true;

      const raw = _.get(settings, path);

      if (isRequired && (typeof raw === 'undefined' || raw === '')) {
        throw ctx.report(`Required key {${path}} is missing in settings`, {code: 400});
      }
    }
  }

  // Parse (parity builders never fail here — everything coerces; raw zod schemas can)
  const result = schema.safeParse(settings);
  if (!result.success) {
    const first = result.error.issues[0];
    const where = first && first.path.length ? ` {${first.path.join('.')}}` : '';

    throw ctx.report(`Invalid settings${where}: ${first ? first.message : 'validation failed'}`, {code: 400});
  }

  // Enum + min enforcement — post-resolution, same layer as the declarative engine
  if (meta) {
    const enumPaths = Object.entries(meta.paths)
      .filter(([, node]) => Array.isArray(node.enum))
      .map(([path, node]) => ({ path: path, allowed: node.enum }));

    enforceEnums(ctx, settings, result.data, enumPaths);

    const minPaths = Object.entries(meta.paths)
      .filter(([, node]) => typeof node.min !== 'undefined')
      .map(([path, node]) => ({ path: path, min: node.min }));

    enforceMins(ctx, result.data, minPaths);
  }

  return result.data;
}

/**
 * Build the nested per-field map Settings.resolve exposes as self.schema for the
 * middleware sanitize pass ({ sanitize } per leaf, mirroring the settings
 * structure). Raw zod schemas have no registry → {} (every field sanitizes).
 * @param {import('zod').ZodType} schema - Zod schema
 * @returns {object} Nested map of leaf path → { sanitize }
 */
function buildSchemaMap(schema) {
  const map = {};
  const meta = schema._omegaMeta;

  if (!meta) {
    return map;
  }

  for (const [path, node] of Object.entries(meta.paths)) {
    _.set(map, path, { sanitize: node.sanitize });
  }

  return map;
}

/**
 * Generic field builder — accepts the exact declarative node options.
 * @param {object} opts - { types, default, value, min, max, required, clean, sanitize }
 * @returns {import('zod').ZodType} Preprocess pipe with ._omega metadata attached
 */
function field(opts) {
  opts = opts || {};

  // Catch migration typos (e.g. `defualt`) — declarative schemas silently ignored
  // unknown node props; the builders are the one place strictness is free
  const unknown = Object.keys(opts).filter((key) => !FIELD_OPTIONS.includes(key));
  if (unknown.length) {
    throw new Error(`schema-zod field(): unknown option(s) ${unknown.join(', ')} (allowed: ${FIELD_OPTIONS.join(', ')})`);
  }

  const type = z.preprocess((raw) => resolveFieldValue(raw, opts), z.any());

  type._omega = {
    required: opts.required || false,
    sanitize: opts.sanitize !== false,
    enum: opts.enum,
    min: opts.min,
  };

  return type;
}

/**
 * Structural group — wraps z.object() so absent/invalid parents still resolve leaf
 * defaults (powertools resolves each leaf path independently). Builds the
 * ._omegaMeta registry of dot-paths → {required, sanitize} that resolveZodSchema()
 * uses for required checks, bubbling nested groups up with prefixed paths.
 * Unknown keys are stripped (zod object default), matching powertools.
 * @param {object} shape - Map of key → fields.* builder (or raw zod type)
 * @returns {import('zod').ZodType}
 */
function object(shape) {
  const paths = {};

  for (const [key, type] of Object.entries(shape)) {
    if (type._omega) {
      paths[key] = type._omega;
    } else if (type._omegaMeta) {
      for (const [subPath, node] of Object.entries(type._omegaMeta.paths)) {
        paths[`${key}.${subPath}`] = node;
      }
    }
  }

  const wrapped = z.preprocess((raw) => {
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  }, z.object(shape));

  wrapped._omegaMeta = { paths };

  return wrapped;
}

// Sugar builders — one per declarative `types` shape
const fields = {
  object: object,
  field: field,
  string: (opts) => field({ ...opts, types: ['string'] }),
  number: (opts) => field({ ...opts, types: ['number'] }),
  boolean: (opts) => field({ ...opts, types: ['boolean'] }),
  array: (opts) => field({ ...opts, types: ['array'] }),
  any: (opts) => field({ ...opts, types: ['any'] }),
  passthrough: (opts) => field({ ...opts, types: ['object'] }),
  multi: (types, opts) => field({ ...opts, types: types }),
};

module.exports = { z, fields, isZodSchema, resolveZodSchema, buildSchemaMap };
