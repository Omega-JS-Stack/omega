/**
 * Schema resolution engine — extracted verbatim from @omega.js/backend's
 * src/manager/helpers/user.js, with ONE change: the '$uuid'/'$randomId'/'$apiKey'
 * value generators are injected via ctx.generators instead of being required
 * in-module. Hosts that can generate them (@omega.js/backend, Node) inject real generators;
 * hosts that can't (@omega.js/client, browser) pass none and the fields resolve to
 * null — the doc's real values always come from the backend.
 *
 * The engine is environment-agnostic: no dependencies, no Node APIs.
 */

/**
 * Check if a schema node is a leaf field definition (has 'type' and 'default')
 */
function isLeaf(node) {
  return node !== null
    && typeof node === 'object'
    && typeof node.type === 'string'
    && 'default' in node;
}

/**
 * Coerce a value to the expected type. Returns the coerced value or undefined if coercion fails.
 */
function coerce(value, type) {
  if (typeof value === type) {
    return value;
  }

  switch (type) {
    case 'number': {
      const n = Number(value);
      return Number.isNaN(n) ? undefined : n;
    }
    case 'boolean': {
      if (value === 'true' || value === 1) return true;
      if (value === 'false' || value === 0) return false;
      return Boolean(value);
    }
    case 'string': {
      return String(value);
    }
    default: {
      return undefined;
    }
  }
}

/**
 * Resolve a single leaf field value
 */
function resolveLeaf(leaf, value, ctx) {
  // Null handling
  if (value === null) {
    return leaf.nullable ? null : resolveDefault(leaf.default, ctx);
  }

  // Undefined → apply default
  if (value === undefined) {
    return resolveDefault(leaf.default, ctx);
  }

  // Array type — just check it's an array, don't coerce
  if (leaf.type === 'array') {
    return Array.isArray(value) ? value : resolveDefault(leaf.default, ctx);
  }

  // Type coercion
  if (typeof value !== leaf.type) {
    const coerced = coerce(value, leaf.type);
    return coerced !== undefined ? coerced : resolveDefault(leaf.default, ctx);
  }

  return value;
}

/**
 * Resolve a default value, handling special tokens
 */
function resolveDefault(def, ctx) {
  if (typeof def !== 'string' || !def.startsWith('$')) {
    // For arrays, return a fresh copy to avoid shared references
    if (Array.isArray(def)) {
      return [...def];
    }
    return def;
  }

  switch (def) {
    case '$uuid':
      return ctx.generators.uuid ? ctx.generators.uuid() : null;
    case '$randomId':
      return ctx.generators.randomId ? ctx.generators.randomId() : null;
    case '$apiKey':
      return ctx.generators.apiKey ? ctx.generators.apiKey() : null;
    case '$oldDate':
      return ctx.oldDate;
    case '$oldDateUNIX':
      return ctx.oldDateUNIX;
    case '$now':
      return ctx.now;
    case '$nowUNIX':
      return ctx.nowUNIX;
    default:
      return def;
  }
}

/**
 * Expand $timestamp shorthand into a schema branch
 */
function expandTimestamp(variant) {
  const useNow = variant === '$timestamp:now';

  return {
    timestamp: { type: 'string', default: useNow ? '$now' : '$oldDate' },
    timestampUNIX: { type: 'number', default: useNow ? '$nowUNIX' : 0 },
  };
}

/**
 * Recursively resolve a schema node against input data
 */
function resolve(schema, data, ctx) {
  data = data || {};
  const result = {};

  // If $passthrough, start by copying all existing keys from data
  const isPassthrough = schema.$passthrough === true;
  const template = schema.$template || null;

  if (isPassthrough) {
    // Copy all data keys first (they'll be overwritten by defined schema fields below)
    for (const key of Object.keys(data)) {
      if (template && !key.startsWith('$') && !(key in schema)) {
        // Dynamic key — resolve against template
        result[key] = resolve(template, data[key], ctx);
      } else if (!(key in schema) || key.startsWith('$')) {
        // Unknown key not in schema — passthrough as-is
        result[key] = data[key];
      }
    }
  }

  // Now resolve each defined schema field
  for (const [key, node] of Object.entries(schema)) {
    // Skip meta keys
    if (key.startsWith('$')) {
      continue;
    }

    // Handle string shorthands
    if (typeof node === 'string') {
      if (node === '$template') {
        // Resolve against parent's $template
        result[key] = resolve(template, data[key], ctx);
        continue;
      }
      if (node.startsWith('$timestamp')) {
        // Expand timestamp shorthand and recurse
        result[key] = resolve(expandTimestamp(node), data[key], ctx);
        continue;
      }
    }

    // Leaf field
    if (isLeaf(node)) {
      result[key] = resolveLeaf(node, data[key], ctx);
      continue;
    }

    // Nested branch (plain object)
    if (node !== null && typeof node === 'object') {
      result[key] = resolve(node, data[key], ctx);
      continue;
    }
  }

  return result;
}

module.exports = { resolve };
