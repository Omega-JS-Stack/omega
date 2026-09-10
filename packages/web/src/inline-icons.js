/**
 * Build-time icon inlining — the build half of the ONE icon system
 * ([#619](https://github.com/Omega-JS-Stack/omega/issues/619)).
 *
 * Authoring is native Font Awesome markup, everywhere, with nothing to learn:
 *
 *   <i class="fa-solid fa-rocket"></i>
 *   <i class="fa-brands fa-github fa-2xl"></i>
 *   <i class="omega-flag omega-flag-us"></i>     — the flags namespace
 *
 * This pass runs over the RENDERED page (an Eleventy transform, like
 * cachebreak-html.js) and fills every empty `<i>` whose classes name an icon
 * with that icon's SVG. Static chrome therefore costs zero runtime fetches
 * and never flashes; anything JS creates after the build is upgraded by the
 * runtime watcher instead (runtime/icons.js), out of the same emitted set.
 *
 * The markup emitted here is BYTE-IDENTICAL to what @omega.js/client's
 * icon-renderer produces in the browser — same `data-omega-fa` stamp, same
 * icon-core root attributes — so the two halves can never render one icon two
 * ways, and the stamp is also what tells the watcher this element is already
 * done.
 *
 * A name the icon set has no file for is left EMPTY and marked
 * `data-omega-icon-missing` (the dev audit turns those into console errors):
 * a missing icon is a content problem, never a crash and never a wrong-glyph
 * fallback.
 */

const { parseIconClasses, isValidIconName, isValidStyle, injectSvgAttributes } = require('@omega.js/client/modules/icon-core.js');

// Only EMPTY <i> elements are icons. An `<i>` with content is emphasis (or an
// icon a previous pass already filled), and neither is this pass's business.
const EMPTY_I_PATTERN = /<i\b([^>]*)><\/i>/gi;
const CLASS_ATTR_PATTERN = /(?:^|\s)class="([^"]*)"/i;

/**
 * Inline every icon a rendered page names.
 *
 * @param {string} html - the rendered page
 * @param {function(string, string): (string|null)} load - (name, style) → raw SVG
 * @param {function(string)} [onMissing] - called with `<style>/<name>` per unresolved icon
 * @returns {string} the page with its icons inlined
 */
function inlineIcons(html, load, onMissing) {
  return String(html).replace(EMPTY_I_PATTERN, (tag, attrs) => {
    if (attrs.includes('data-omega-fa=')) return tag;

    const classAttr = CLASS_ATTR_PATTERN.exec(attrs);
    if (!classAttr) return tag;

    const parsed = parseIconClasses(classAttr[1].split(/\s+/).filter(Boolean));
    if (!parsed || !isValidIconName(parsed.name) || !isValidStyle(parsed.style)) return tag;

    const key = `${parsed.style}/${parsed.name}`;
    const svg = load(parsed.name, parsed.style);
    if (!svg) {
      if (onMissing) onMissing(key);
      return `<i${attrs} data-omega-fa="${key}" data-omega-icon-missing="${key}"></i>`;
    }

    return `<i${attrs} data-omega-fa="${key}">${injectSvgAttributes(svg)}</i>`;
  });
}

module.exports = { inlineIcons };
