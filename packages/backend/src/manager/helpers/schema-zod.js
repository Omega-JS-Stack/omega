/**
 * schema-zod.js — zod route-schema support with powertools-parity semantics.
 *
 * A `schemas/<route>/<method>.js` module may export a zod schema instead of a
 * declarative node object; Settings.resolve() detects it (isZodSchema) and runs
 * resolveZodSchema() in place of powertools.defaults(). Wire shapes are preserved:
 * schemas built with the `fields` builders replicate node-powertools' resolution
 * semantics exactly (coerce-never-reject, clamp/truncate, undefined-only required)
 * — see plans/zod-route-schemas-design.md for the full preservation checklist.
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
 * Deliberate divergences from powertools.defaults() (bug fixes, asserted in
 * test/helpers/schema-zod.js):
 *   - Non-empty object/array defaults are NOT polluted with injected types/min/max/
 *     value/default keys (powertools mutates the schema's default object and returns
 *     it by reference; we return a clean clone per request).
 *   - No `default: undefined` own-property noise on object-typed values.
 *   Both are JSON-invisible except the pollution case, which only fired on
 *   admin/notification's non-empty defaults — reviewed in that cohort's conversion.
 */

const { z } = require('zod');
const powertools = require('node-powertools');
const _ = require('lodash');

// Node options accepted by fields.field() — one-to-one with declarative schema nodes.
// `sanitize` is carried for the middleware sanitize pass contract; `available` is not
// (no schema declares it and nothing reads it). `enum` is accepted and stored but NOT
// enforced — it was always decorative in the declarative engine (user/oauth2 declares
// it, nothing validates it); enforcement is a post-parity tightening decision.
const FIELD_OPTIONS = ['types', 'default', 'value', 'min', 'max', 'required', 'clean', 'sanitize', 'enum'];

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
 * Resolve settings against a zod schema — the zod counterpart of the
 * powertools.defaults() + required/clean loop in Settings.resolve().
 * Required semantics (undefined-only, function support, checkRequired opt-out) run
 * from the ._omegaMeta registry that fields.object() builds; the error message and
 * code match the declarative engine exactly.
 * @param {object} assistant - Assistant (errorify)
 * @param {import('zod').ZodType} schema - Zod schema (usually from fields.object())
 * @param {object} settings - Raw request data
 * @param {object} options - Resolve options (checkRequired, user, ...)
 * @returns {object} Resolved settings
 */
function resolveZodSchema(assistant, schema, settings, options) {
  const meta = schema._omegaMeta;

  // Required check — same rule as the declarative engine: fires ONLY when the raw
  // value is undefined ('', null, 0, false all pass), honoring checkRequired and
  // function-valued required(assistant, settings, options).
  if (options.checkRequired && meta) {
    for (const [path, node] of Object.entries(meta.paths)) {
      const isRequired = typeof node.required === 'function'
        ? node.required(assistant, settings, options)
        : node.required === true;

      if (isRequired && typeof _.get(settings, path) === 'undefined') {
        throw assistant.errorify(`Required key {${path}} is missing in settings`, {code: 400});
      }
    }
  }

  // Parse (parity builders never fail here — everything coerces; raw zod schemas can)
  const result = schema.safeParse(settings);
  if (!result.success) {
    const first = result.error.issues[0];
    const where = first && first.path.length ? ` {${first.path.join('.')}}` : '';

    throw assistant.errorify(`Invalid settings${where}: ${first ? first.message : 'validation failed'}`, {code: 400});
  }

  return result.data;
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

  // Clean — same order as Settings.resolve(): applied to the fully-resolved value
  if (opts.clean) {
    if (opts.clean instanceof RegExp) {
      working = working.replace(opts.clean, '');
    } else if (typeof opts.clean === 'function') {
      working = opts.clean(working);
    }
  }

  return working;
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

module.exports = { z, fields, isZodSchema, resolveZodSchema };
