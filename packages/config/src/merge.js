/**
 * Agnostic deep merge for omega.json5 config layers.
 *
 * One merge behavior at every level of the hierarchy:
 *
 *   framework defaults ← company ← brand shared ← brand targets.<type>
 *                      ← app shared ← app targets.<type>
 *
 * Semantics:
 *   - Plain objects merge recursively; every other value (string, number,
 *     boolean, array, null) REPLACES. A later payment.products array wins
 *     whole — it never concatenates with an earlier one.
 *   - `null` replaces: an app-level file can explicitly null-out a brand
 *     value.
 *   - `undefined` values are skipped — they never erase an earlier layer.
 *   - Falsy LAYERS are skipped, so callers can pass optional layers (missing
 *     brand file, absent target section) without guarding.
 *   - Inputs are never mutated; the result shares no references with them.
 */

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clone(value) {
  if (Array.isArray(value)) {
    return value.map(clone);
  }

  if (isPlainObject(value)) {
    const copy = {};
    Object.keys(value).forEach((key) => {
      copy[key] = clone(value[key]);
    });
    return copy;
  }

  return value;
}

function mergeInto(target, source) {
  Object.keys(source).forEach((key) => {
    const value = source[key];

    if (value === undefined) {
      return;
    }

    if (isPlainObject(value) && isPlainObject(target[key])) {
      mergeInto(target[key], value);
    } else {
      target[key] = clone(value);
    }
  });

  return target;
}

/**
 * Deep-merge config layers; later layers win.
 * @param {...(object|null|undefined)} layers - Config layers, lowest precedence first. Falsy layers are skipped.
 * @returns {object} A new object — inputs are never mutated.
 */
function deepMerge(...layers) {
  return layers.filter(Boolean).reduce((result, layer) => mergeInto(result, layer), {});
}

module.exports = { deepMerge, isPlainObject };
