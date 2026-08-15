// The dev palette's page-scoped section registry (#234) — the seam a page
// module uses to hand the palette controls that only make sense on that page,
// so a page stops growing its own dev chrome (the checkout's gear dropdown was
// the last one) and the palette stays the ONE place dev affordances live.
//
// Deliberately window-free and dependency-free: esbuild's `splitting: true`
// puts a module reached from two entry points into the shared chunk, so the
// palette (a dynamic import off main.js) and a page bundle both see the SAME
// registry instance — the same guarantee that keeps @omega.js/client a
// singleton across bundles (src/assets.js).
//
// Registration order does not matter. The palette renders on OPEN, so a page
// module that loads after the palette booted still gets its section.
//
// Development only: every caller registers from inside a `@dev-only` block, so
// a production build strips the import and this module never ships.

// id → definition. A Map because re-registering an id must REPLACE, not stack.
const sections = new Map();

/**
 * Register one page-scoped palette section.
 *
 * @param {string} id - Stable id. Reusing the id of a palette built-in (e.g.
 *   `personas`) merges into that section rather than repeating its heading.
 * @param {object} definition
 * @param {string} definition.title - Heading, used only when the id is new.
 * @param {() => boolean} [definition.appliesTo] - Page condition, evaluated
 *   when the panel opens. Omitted means "everywhere".
 * @param {(doc: Document) => Node} definition.buildNode - Builds the controls.
 */
export function registerDevSection(id, definition) {
  // A section with no id cannot merge and a section with no builder renders
  // nothing — both are typos in a caller, not states a running page reaches.
  if (!id || typeof definition?.buildNode !== 'function') {
    throw new Error('[@omega.js/web:dev-sections] a section needs an id and a buildNode(doc)');
  }

  sections.set(id, {
    id,
    title: definition.title || id,
    appliesTo: definition.appliesTo || (() => true),
    buildNode: definition.buildNode,
  });
}

/**
 * Every registered section whose page condition passes, in registration order.
 * @returns {Array<object>}
 */
export function getDevSections() {
  return [...sections.values()].filter((entry) => entry.appliesTo());
}
