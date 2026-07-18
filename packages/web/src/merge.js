/**
 * Plain-object deep merge (b wins) — fresh containers, never mutates either
 * side. Deliberately NOT @omega.js/config's deepMerge: the resolved-data
 * cascade and the section-args merge combine VALUES pairwise
 * (deepMerge(out[key], data[key])), so an explicit null in later data must
 * REPLACE — config's variadic merge would skip it as a falsy layer.
 * One home (SSOT): the engine's resolved cascade and the section tag's
 * defaults ← data ← args chain must merge with IDENTICAL semantics, or a
 * consumer override would behave differently across the two lanes.
 */
function deepMerge(a, b) {
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const out = { ...a };
    for (const key of Object.keys(b)) out[key] = deepMerge(a[key], b[key]);
    return out;
  }
  return b === undefined ? a : b;
}

module.exports = { deepMerge };
