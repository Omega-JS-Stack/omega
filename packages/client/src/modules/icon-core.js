/**
 * icon-core — the ONE place Font Awesome icon semantics live (C4 cp108).
 *
 * Pure functions, zero runtime assumptions: no DOM, no fs, no transport.
 * Web's build-time `uj_icon` tag (@omega.js/template-kit) and
 * @omega.js/desktop's main-process icon server both consume THIS module, so
 * lookup rules and rendered SVG markup can never drift between surfaces
 * again. File reading stays with each consumer (build tags read at build
 * time, desktop main reads at runtime) — this module owns every decision
 * ABOUT the files: valid names/styles, candidate lookup order, the inline
 * root attributes, and alias mapping from the @fortawesome/fontawesome-free
 * metadata ('search' → 'magnifying-glass').
 *
 * CJS on purpose: template-kit and Electron main require() it directly (via
 * the package's dist exports); browser modules import it with standard
 * interop.
 */

// Valid icon styles (the @fortawesome/fontawesome-free svgs/ directories).
const STYLES = ['solid', 'regular', 'brands'];

// Lowercase slug names only — lookups build file paths, so this whitelist
// is also what keeps callers (like desktop's IPC channel) from ever reading
// outside the icon directories.
const NAME_REGEX = /^[a-z0-9-]+$/;

// Attributes injected on the <svg> root at serve time: icons size to the
// surrounding font and inherit its color. overflow="visible" mirrors FA's
// own kit CSS (.svg-inline--fa { overflow: visible }) — FA 7 glyphs may
// draw OUTSIDE their viewBox (fa-lock's shackle peaks at y=-32 in a
// 0 0 384 512 box) and the SVG-root default of overflow:hidden clips them.
const SVG_ATTRIBUTES = [
  ['width', 'width="1em"'],
  ['height', 'height="1em"'],
  ['fill', 'fill="currentColor"'],
  ['aria-hidden', 'aria-hidden="true"'],
  ['focusable', 'focusable="false"'],
  ['overflow', 'overflow="visible"'],
];

/**
 * Whether a value is a valid icon slug ('magnifying-glass').
 *
 * @param {*} name - Candidate icon name.
 * @returns {boolean} True for lowercase slug strings.
 */
function isValidIconName(name) {
  return typeof name === 'string' && NAME_REGEX.test(name);
}

/**
 * Whether a value is a known icon style.
 *
 * @param {*} style - Candidate style ('solid').
 * @returns {boolean} True when the style directory exists in the set.
 */
function isValidStyle(style) {
  return STYLES.includes(style);
}

/**
 * Inject the shared root attributes into a raw icon SVG string — each one
 * only when the root doesn't already carry it, so hand-authored SVGs keep
 * their own sizing/fill.
 *
 * @param {string} svg - Raw SVG source.
 * @returns {string} SVG with the inline-icon root attributes.
 */
function injectSvgAttributes(svg) {
  if (typeof svg !== 'string' || !svg.includes('<svg')) return svg;

  return svg.replace(/<svg([^>]*)>/, (match, existingAttrs) => {
    const toAdd = SVG_ATTRIBUTES
      .filter(([attr]) => !existingAttrs.includes(`${attr}=`))
      .map(([, pair]) => pair);

    return toAdd.length ? `<svg${existingAttrs} ${toAdd.join(' ')}>` : match;
  }).trim();
}

/**
 * Relative candidate paths for an icon, in lookup order: the requested
 * style first, then the brands fallback — so logos like 'apple' resolve
 * without callers knowing which side of the set they live on.
 *
 * @param {string} name - Icon slug.
 * @param {string} style - Requested style.
 * @returns {string[]} Relative paths to try against each icon root.
 */
function candidateRelPaths(name, style) {
  const candidates = [`${style}/${name}.svg`];
  if (style !== 'brands') {
    candidates.push(`brands/${name}.svg`);
  }
  return candidates;
}

/**
 * Build the alias → canonical name map from fontawesome-free's
 * metadata/icon-families.json ('search' → 'magnifying-glass').
 *
 * @param {object} iconFamilies - Parsed icon-families.json content.
 * @returns {Map<string, string>} Alias slug → canonical slug.
 */
function buildAliasMap(iconFamilies) {
  const map = new Map();
  for (const [canonical, entry] of Object.entries(iconFamilies || {})) {
    for (const alias of entry?.aliases?.names || []) {
      map.set(alias, canonical);
    }
  }
  return map;
}

module.exports = {
  STYLES,
  NAME_REGEX,
  SVG_ATTRIBUTES,
  isValidIconName,
  isValidStyle,
  injectSvgAttributes,
  candidateRelPaths,
  buildAliasMap,
};
