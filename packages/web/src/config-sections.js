/**
 * config-sections.js — the three namespaces a template reads from, named once
 * ([#607](https://github.com/Omega-JS-Stack/omega/issues/607)).
 *
 * A page overrides omega.json5 under a `config:` parent, so the engine, the
 * `omega migrate` rule that rewrites legacy pages, and the template guard lane
 * all need the SAME answer to "is this key a config section?". That answer
 * lives here:
 *
 *   resolved.config.*  — the brand config with this page's `config:` merged on
 *                        top. Every config key a template reads lives here.
 *   resolved.meta.*    — the meta walk (page `meta:` → layout defaults → the
 *                        config `meta` section). `meta` is the ONE section the
 *                        schema marks `pageBare`, so it keeps its bare
 *                        frontmatter spelling as well as its `config.meta` home.
 *   site.*             — BUILD FACTS only: the collections the build indexed,
 *                        the build stamp, the curated targets view. Never config.
 *
 * CONFIG_SECTIONS is the schema's own list (`configSections('web')`) plus the
 * web presentation sections that ride `targets.web` without a schema rule yet
 * — the keys docs/shared/config.md's UJM mapping table sends there.
 */
const { configSections, PAGE_BARE_SECTIONS } = require('@omega.js/config/schema');

// Config sections @omega.js/web owns that carry no schema rule yet: the legacy
// UJM presentation blocks the config converter still writes under
// `targets.web` (docs/shared/config.md's mapping table).
const WEB_ONLY_SECTIONS = ['favicon', 'manifest', 'icons', 'currency'];

// Every top-level key a web build's resolved config can hold.
const CONFIG_SECTIONS = new Set([...configSections('web'), ...WEB_ONLY_SECTIONS]);

// The BUILD FACTS the `site` global carries — the engine composes exactly
// these, and the guard lane fails any other `site.<key>` read in a template.
// Each one is something the BUILD knows and the config cannot say.
const SITE_FACT_KEYS = [
  'targets',      // the curated per-target display view (#85)
  'posts',        // the indexed collections, Jekyll doc shape
  'team',
  'updates',
  'alternatives',
  'data',         // site.data._includes — the json-in-_includes data system
  'omega',        // the build stamp: cache_breaker, version, date, redirects map
  'time',         // Jekyll's build timestamp (the JSON-LD/og dateModified reads it)
  'characters',   // the literal-character set templates interpolate
  'pricing',      // the payment view-model composePricing built
  'brandTokens',  // the --omega-accent-* ramp composeBrandTokens built
  'fontPreloads', // the active theme's first-paint faces, read off disk
];

// ---------------------------------------------------------------------------
// The census — what counts as a READ (#611)
//
// Three consumers need the SAME answer or a build fails where a migration
// cannot help: the `omega migrate` rule that rewrites the old spellings, the
// engine's build guard that stops on one it missed, and the static guard lane
// over the framework's own templates. So the answer lives here, once.
//
// A read is `<root>.<key><dotted tail>` for root ∈ { site, resolved } — and
// only when it is REALLY a read. The blind-verifier walk (2026-08-25) found
// three shapes that are not, each of which had been failing a build:
//   - LIQUID CONTEXT is required. A Liquid read exists only inside `{{ … }}`
//     or `{% … %}`; `https://site.company.com/x` and `subdomain.site.com` are
//     hostnames, and `/site.webmanifest` is a filename.
//   - DISPLAY regions are excluded: a fenced code block or a `{% raw %}` body
//     showing the old spelling is documentation of it, not a call to it (the
//     #521 doctrine — code display is not markup). Rewriting inside a fence
//     would make a page's own documentation describe a file that no longer
//     looks like that.
//   - NOT_A_READ names the two tokens that survive both filters: a filename
//     and a hostname CAN appear inside a Liquid string argument.
// ---------------------------------------------------------------------------
const TEMPLATE_READ = /\b(site|resolved)\.([a-zA-Z_][a-zA-Z0-9_]*)((?:\.[a-zA-Z_][a-zA-Z0-9_]*)*)/g;
const NOT_A_READ = new Set(['webmanifest', 'com']);

// Liquid's two delimiter pairs. Non-greedy and multi-line: a tag's args wrap.
const LIQUID_REGION = /\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}/g;
// The escape hatch, whole — its body is display even though it looks like Liquid.
const RAW_REGION = /\{%-?\s*raw\s*-?%\}[\s\S]*?\{%-?\s*endraw\s*-?%\}/g;

/**
 * The [start, end) offsets of every DISPLAY region: markdown fenced code
 * blocks (``` and ~~~, the fence lines included) and `{% raw %}` blocks.
 * @param {string} source
 * @returns {Array<[number, number]>}
 */
function displayRegions(source) {
  const regions = [];

  // Fences are a LINE state machine: a fence opens on a line whose first
  // non-space run is ``` or ~~~, and closes on the next one of the same kind.
  // An unclosed fence runs to the end of the file, which is what a markdown
  // renderer does with it too.
  let offset = 0;
  let open = null;
  for (const line of source.split('\n')) {
    const fence = line.match(/^[ \t]*(`{3,}|~{3,})/);
    if (fence) {
      if (!open) {
        open = { marker: fence[1][0], start: offset };
      } else if (fence[1][0] === open.marker) {
        regions.push([open.start, offset + line.length + 1]);
        open = null;
      }
    }
    offset += line.length + 1;
  }
  if (open) regions.push([open.start, source.length]);

  RAW_REGION.lastIndex = 0;
  let raw;
  while ((raw = RAW_REGION.exec(source)) !== null) regions.push([raw.index, raw.index + raw[0].length]);

  return regions;
}

/**
 * The [start, end) offsets of every Liquid output/tag region OUTSIDE a display
 * region — the only places a read can live.
 * @param {string} source
 * @returns {Array<[number, number]>}
 */
function liquidRegions(source) {
  const display = displayRegions(source);
  const regions = [];
  LIQUID_REGION.lastIndex = 0;
  let match;
  while ((match = LIQUID_REGION.exec(source)) !== null) {
    if (display.some(([start, end]) => match.index >= start && match.index < end)) continue;
    regions.push([match.index, match.index + match[0].length]);
  }
  return regions;
}

/**
 * Every `site.*` / `resolved.*` READ in a template's source, in source order.
 * @param {string} source
 * @returns {Array<{ root: string, key: string, expression: string, index: number, line: number }>}
 *   `expression` is the whole dotted path (what a diagnostic prints and what a
 *   rewrite replaces); `index` is its offset; `line` its 1-based line.
 */
function templateReads(source) {
  const regions = liquidRegions(source);
  if (!regions.length) return [];

  const found = [];
  TEMPLATE_READ.lastIndex = 0;
  let match;
  while ((match = TEMPLATE_READ.exec(source)) !== null) {
    if (NOT_A_READ.has(match[2])) continue;
    if (!regions.some(([start, end]) => match.index >= start && match.index < end)) continue;
    found.push({
      root: match[1],
      key: match[2],
      expression: match[0],
      index: match.index,
      line: source.slice(0, match.index).split('\n').length,
    });
  }
  return found;
}

module.exports = {
  CONFIG_SECTIONS,
  PAGE_BARE_SECTIONS,
  SITE_FACT_KEYS,
  WEB_ONLY_SECTIONS,
  NOT_A_READ,
  displayRegions,
  liquidRegions,
  templateReads,
};
