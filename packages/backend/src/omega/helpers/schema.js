/**
 * The ONE request-schema adapter: a route's schema file returns a plain field
 * declaration, and this turns it into a zod schema and validates with it.
 *
 * A declaration maps each input key to a field:
 *
 *   {
 *     name:    { type: 'string', required: true, clean: /[<>]/g, max: 80 },
 *     limit:   { type: 'number', default: 10, min: 1, max: 100 },
 *     tags:    { type: 'array', of: { type: 'string', max: 20 }, default: [], max: 5 },
 *     address: { type: 'object', fields: { zip: { type: 'string', pattern: /^\d{5}$/ } } },
 *     mode:    { type: 'string', enum: ['quick', 'full'], default: 'quick' },
 *     id:      { type: 'string', path: true },
 *     total:   { type: 'number', value: 0 },
 *   }
 *
 * The declaration stays a plain object until it gets here, so a schema function
 * can split it on any request fact (`fields.limit.max = 200`) before zod sees it.
 *
 * Each field is a z.preprocess() pipe. The preprocess RESOLVES the value, and
 * defaults coerce and never reject: the sent value (or the default) is forced
 * to a single `type`, a value matching none of a type LIST takes the default,
 * numbers clamp to min/max, strings and arrays truncate at max, a forced
 * `value` wins, then `clean` runs. The preprocess also raises the refusals
 * (a missing `required` field; an out-of-list `enum` or a `pattern` miss on a
 * SENT value; a string or array shorter than `min`), and zod validates the
 * resolved shape underneath: its type, nested `fields` (unknown keys strip),
 * array items through `of`.
 */
const { z } = require('zod');
const _ = require('lodash');
const powertools = require('node-powertools');

// The base types a field declares, alone or as a list
const TYPES = ['string', 'number', 'boolean', 'array', 'object', 'any'];

// Every key a field may carry; anything else is a typo and throws
const FIELD_KEYS = ['type', 'required', 'default', 'min', 'max', 'enum', 'pattern', 'clean', 'of', 'fields', 'path', 'value', 'sanitize'];

/**
 * Turn a declaration into the zod schema that validates it.
 * @param {object} declaration - Map of input key to field.
 * @returns {import('zod').ZodType} A z.object() that strips unknown keys.
 * @throws {Error} When a field is malformed, naming its dot-path.
 */
function toZod(declaration) {
  return objectSchema(declaration, '', true);
}

/**
 * Validate an input against a declaration.
 * @param {object} declaration - Map of input key to field.
 * @param {object} input - The raw input (a non-object validates as {}).
 * @param {object} [options] - { pathParams }: the request path's trailing
 *   segments, filled into the top-level `path: true` fields in declaration
 *   order; a path field reads ONLY the path, never the input.
 * @returns {{data: object}|{error: string}} The validated data, or the first
 *   refusal as a message (`Required key {x} is missing in settings`,
 *   `Invalid settings {x}: <why>`).
 * @throws {Error} When the declaration is malformed.
 */
function validate(declaration, input, { pathParams: params = [] } = {}) {
  const schema = toZod(declaration);
  const raw = isPlainObject(input) ? { ...input } : {};

  Object.keys(declaration)
    .filter((key) => declaration[key].path === true)
    .forEach((key, index) => {
      raw[key] = params[index];
    });

  const result = schema.safeParse(raw);

  if (result.success) {
    return { data: result.data };
  }

  return { error: describe(result.error.issues[0]) };
}

/**
 * The segments of a request path that follow its route path: the ids a
 * `path: true` field reads. `/items/abc` under the route `items` gives
 * ['abc'], and so does `/omega/items/abc`. A request path that does not carry
 * the route path at all (a Cloud Function called at its own root) is ALL
 * params.
 * @param {string} requestPath - The request's path (e.g. '/items/abc').
 * @param {string} routePath - The route's path (e.g. 'items').
 * @returns {string[]} The trailing segments.
 */
function pathParams(requestPath, routePath) {
  const segments = String(requestPath || '').split('/').filter(Boolean);
  const route = String(routePath || '').split('/').filter(Boolean);

  for (let start = segments.length - route.length; start >= 0; start--) {
    if (route.every((segment, index) => segments[start + index] === segment)) {
      return segments.slice(start + route.length);
    }
  }

  return segments;
}

// A group of fields as a z.object(), which strips unknown keys
function objectSchema(fields, where, top) {
  if (!isPlainObject(fields)) {
    throw new Error(`Invalid schema at "${where || '(root)'}": a declaration is a plain object of fields`);
  }

  const shape = {};

  for (const [key, field] of Object.entries(fields)) {
    shape[key] = fieldSchema(field, where ? `${where}.${key}` : key, top);
  }

  return z.object(shape);
}

// One field: the preprocess resolves the value and raises the refusals, the
// inner schema validates the resolved shape
function fieldSchema(field, where, top) {
  assertField(field, where, top);

  return z.preprocess((raw, zctx) => resolveField(raw, field, zctx), shapeOf(field, where));
}

// The zod shape a resolved value must have. A single string, boolean or array
// always resolves to its type, and an object with `fields` to an object. A
// number, an open object and a type list can resolve to the author's default
// as written (the fallback for a non-finite number, a non-object, a list
// miss), so they also admit null and undefined. A key-absent optional would
// silence the preprocess refusals, hence a union and never .optional().
function shapeOf(field, where) {
  const types = [].concat(field.type);
  const bases = types.map((type) => baseSchema(type, field, where));
  const exact = types.length === 1 && (field.fields || !['number', 'object'].includes(types[0]));

  return exact ? bases[0] : z.union([...bases, z.null(), z.undefined()]);
}

function baseSchema(type, field, where) {
  if (type === 'string') {
    return z.string();
  } else if (type === 'number') {
    return z.number();
  } else if (type === 'boolean') {
    return z.boolean();
  } else if (type === 'array') {
    return z.array(field.of ? fieldSchema(field.of, `${where}[]`, false) : z.any());
  } else if (type === 'object') {
    // Open (no `fields`): any object passes through whole, and like typeof, an array is an object
    return field.fields
      ? objectSchema(field.fields, where, false)
      : z.union([z.looseObject({}), z.array(z.any())]);
  }

  return z.any();
}

// Resolve one field's raw input: required, default, coercion, bounds, forced value, clean, refusals
function resolveField(raw, field, zctx) {
  // Required reads the RAW input, before any default: missing is undefined or ''
  if (field.required === true && (typeof raw === 'undefined' || raw === '')) {
    zctx.addIssue({ code: 'custom', message: 'missing', params: { required: true } });

    return raw;
  }

  const def = typeof field.default === 'function' ? field.default() : _.cloneDeep(field.default);

  let value = coerce(typeof raw === 'undefined' ? def : raw, field, def);
  value = bound(value, field);

  if (typeof field.value !== 'undefined') {
    value = _.cloneDeep(field.value);
  }

  if (field.clean instanceof RegExp) {
    value = value.replace(field.clean, '');
  } else if (typeof field.clean === 'function') {
    value = field.clean(value);
  }

  refuse(raw, value, field, zctx);

  return value;
}

// Coerce-never-reject: a single type forces the value to it, a type list keeps
// a matching value and otherwise takes the default. A non-finite number is
// never usable (it poisons every later comparison) and takes the default too.
function coerce(value, field, def) {
  const types = [].concat(field.type);
  let out;

  if (field.fields) {
    out = isPlainObject(value) ? value : {};
  } else if (types.some((type) => matches(value, type))) {
    out = value;
  } else if (types.length > 1) {
    out = def;
  } else if (types[0] === 'object') {
    out = undefined;
  } else {
    out = powertools.force(value, types[0]);
  }

  return typeof out === 'number' && !Number.isFinite(out) ? def : out;
}

// typeof semantics: null and arrays are objects
function matches(value, type) {
  return type === 'any' || typeof value === type || (type === 'array' && Array.isArray(value));
}

// Numbers clamp to [min, max]; strings and arrays truncate at max. A string or
// array shorter than min is refused (refuse()), never padded.
function bound(value, field) {
  const { min, max } = field;

  if (typeof value === 'number') {
    if (typeof min !== 'undefined' && value < min) {
      return min;
    }

    if (typeof max !== 'undefined' && value > max) {
      return max;
    }
  } else if (typeof max !== 'undefined' && (typeof value === 'string' || Array.isArray(value)) && value.length > max) {
    return value.slice(0, max);
  }

  return value;
}

// The refusals on the resolved value. enum and pattern judge only what the
// caller SENT (the author's default is presumed valid); min judges every
// string or array, sent or defaulted.
function refuse(raw, value, field, zctx) {
  const sent = typeof raw !== 'undefined';

  if (sent && Array.isArray(field.enum) && !field.enum.includes(value)) {
    zctx.addIssue({ code: 'custom', message: `must be one of [${field.enum.join(', ')}]` });
  }

  if (sent && field.pattern && (typeof value !== 'string' || value.search(field.pattern) === -1)) {
    zctx.addIssue({ code: 'custom', message: `must match ${field.pattern}` });
  }

  const isString = typeof value === 'string';

  if (typeof field.min !== 'undefined' && (isString || Array.isArray(value)) && value.length < field.min) {
    const plural = field.min === 1 ? '' : 's';

    zctx.addIssue({
      code: 'custom',
      message: isString ? `must be at least ${field.min} character${plural}` : `must have at least ${field.min} item${plural}`,
    });
  }
}

// A schema is author-written code: a malformed field throws, naming its path,
// instead of resolving into something nobody declared
function assertField(field, where, top) {
  const fail = (why) => {
    throw new Error(`Invalid schema at "${where}": ${why}`);
  };

  if (!isPlainObject(field)) {
    fail('a field is a plain object ({ type, ... })');
  }

  const unknown = Object.keys(field).filter((key) => !FIELD_KEYS.includes(key));
  if (unknown.length) {
    fail(`unknown key(s) ${unknown.join(', ')} (allowed: ${FIELD_KEYS.join(', ')})`);
  }

  const types = [].concat(field.type);
  if (!types.length || !types.every((type) => TYPES.includes(type))) {
    fail(`\`type\` must be one of ${TYPES.join(', ')}, or a list of them, received ${JSON.stringify(field.type)}`);
  }

  if (typeof field.required !== 'undefined' && typeof field.required !== 'boolean') {
    fail('`required` is a boolean: compute it in the schema function');
  }

  // Required is checked against the raw input, so a default could never apply
  if (field.required === true && Object.prototype.hasOwnProperty.call(field, 'default')) {
    fail('`required` never pairs with `default` (a required field has nothing to fall back to); use `min: 1` to refuse an empty defaulted value');
  }

  if (field.of && field.type !== 'array') {
    fail('`of` belongs to `type: \'array\'`');
  }

  if (field.fields && field.type !== 'object') {
    fail('`fields` belongs to `type: \'object\'`');
  }

  if (typeof field.path !== 'undefined' && (field.path !== true || !top)) {
    fail('`path` is `true` on a top-level field');
  }
}

// The one message a refusal answers with
function describe(issue) {
  const where = issue.path.join('.');

  if (issue.params && issue.params.required) {
    return `Required key {${where}} is missing in settings`;
  }

  return `Invalid settings {${where}}: ${issue.message}`;
}

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]';
}

module.exports = { toZod, validate, pathParams };
