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
 * root attributes, the package preference order (Pro when the brand
 * supplies it, free floor), and alias mapping from the icon set's own
 * metadata ('search' → 'magnifying-glass').
 *
 * CJS on purpose: template-kit and Electron main require() it directly (via
 * the package's dist exports); browser modules import it with standard
 * interop.
 */

// Icon asset packages, best-first (cp111): a brand that supplies Font
// Awesome Pro gets it automatically; the free set is the always-present
// floor (a declared dependency of web + desktop). Pro is NEVER a dependency
// of any omega package — redistribution is a license violation — each brand
// brings its own licensed copy (npm token install, or a fontawesome.com
// download dir via OMEGA_FONTAWESOME_ROOT).
const PACKAGES = ['@fortawesome/fontawesome-pro', '@fortawesome/fontawesome-free'];

// The free set's svgs/ directories. Pro supplies more (light, thin,
// duotone, sharp-*, …) — validation is by shape, not this list, so new
// Pro families work without this module tracking Font Awesome's catalog.
const STYLES = ['solid', 'regular', 'brands'];

// Style dirs are path segments too — same traversal rule as names, so an
// unknown style can only ever be a file-not-found, never an escape.
const STYLE_REGEX = /^[a-z][a-z-]*$/;

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
 * Whether a value is a plausible icon style ('solid', 'duotone',
 * 'sharp-light'). Shape-validated (path-safe slug), not whitelist-validated:
 * whether the style actually exists in the supplied icon set is decided by
 * the file lookup — a bogus style is a missing icon, never a crash or an
 * escape from the icon directories.
 *
 * @param {*} style - Candidate style.
 * @returns {boolean} True for lowercase path-safe style slugs.
 */
function isValidStyle(style) {
  return typeof style === 'string' && STYLE_REGEX.test(style);
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

// Font Awesome's class model: a base WEIGHT class, an optional FAMILY
// prefix class, and everything else is a modifier or the icon name.
const BASE_STYLE_CLASSES = {
  'fa-solid': 'solid', fas: 'solid',
  'fa-regular': 'regular', far: 'regular',
  'fa-light': 'light', fal: 'light',
  'fa-thin': 'thin', fat: 'thin',
  'fa-brands': 'brands', fab: 'brands',
};
const FAMILY_CLASSES = { 'fa-sharp': 'sharp', 'fa-duotone': 'duotone', fad: 'duotone', 'fa-sharp-duotone': 'sharp-duotone' };

// fa-* classes that are modifiers (style/size/animation/layout), not icon names.
const MODIFIER_REGEX = /^fa-(?:solid|brands|regular|light|thin|duotone|sharp-duotone|sharp|fw|xs|sm|lg|xl|2xl|[0-9]+x|spin|spin-pulse|spin-reverse|pulse|beat|fade|beat-fade|bounce|shake|flip(?:-horizontal|-vertical|-both)?|rotate-(?:90|180|270|by)|inverse|border|pull-left|pull-right|stack(?:-1x|-2x)?|li|ul|sr-only)$/;

/**
 * Parse an element's class list the way Font Awesome does:
 * `fa-sharp fa-light fa-play me-2` → { name: 'play', style: 'sharp-light' }.
 * Weight defaults to solid; a family class prefixes it (duotone-solid lives
 * in the bare `duotone` dir). Null when no icon name is present.
 *
 * @param {Iterable<string>} classList - Element class names.
 * @returns {{ name: string, style: string }|null} Parsed lookup, or null.
 */
function parseIconClasses(classList) {
  let base = 'solid';
  let family = '';
  let name = null;

  for (const cls of classList) {
    if (BASE_STYLE_CLASSES[cls]) {
      base = BASE_STYLE_CLASSES[cls];
    } else if (FAMILY_CLASSES[cls]) {
      family = FAMILY_CLASSES[cls];
    } else if (!name && cls.startsWith('fa-') && !MODIFIER_REGEX.test(cls)) {
      name = cls.slice(3);
    }
  }
  if (!name) {
    return null;
  }

  const style = (base === 'brands' || !family) ? base
    : (family === 'duotone' && base === 'solid') ? 'duotone'
      : `${family}-${base}`;
  return { name, style };
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
  PACKAGES,
  STYLES,
  STYLE_REGEX,
  NAME_REGEX,
  SVG_ATTRIBUTES,
  isValidIconName,
  isValidStyle,
  injectSvgAttributes,
  candidateRelPaths,
  parseIconClasses,
  buildAliasMap,
};
