/**
 * lint.js — the liquid-lint scanner: checks the codemod cannot express as a
 * safe rewrite. Runs over the SAME file set as the codemod (post-rewrite in
 * a real migration, pre-flight in --check).
 *
 * Known filter/tag names are derived at runtime from the REAL engine
 * registration path (a LiquidJS instance + template-kit's registerLiquid +
 * the framework's own section/component tags) — the same SSOT the build uses,
 * so the lists can't drift.
 */
const { Liquid } = require('liquidjs');
const { registerLiquid } = require('@omega.js/template-kit');
const { registerSectionTags } = require('../sections.js');

// Jekyll-only tags with no LiquidJS/engine equivalent — hard findings
const JEKYLL_ONLY_TAGS = {
  post_url: 'link to the post URL directly (e.g. /blog/<slug>/)',
  link: 'use the file\'s output URL directly',
  highlight: 'use fenced code blocks (markdown-it)',
  endhighlight: 'use fenced code blocks (markdown-it)',
  include_relative: 'move the include into _includes and use {% include %}',
  feed_meta: 'the engine renders feeds — remove the tag',
  seo: 'the core head include owns SEO tags — remove',
};

// Names Eleventy adds on top of LiquidJS + template-kit
const ELEVENTY_NAMES = ['log', 'slugify', 'url', 'getCollectionItem', 'getPreviousCollectionItem', 'getNextCollectionItem', 'renderFile', 'inputPathToUrl'];

let registry = null;

/**
 * Build (once) the known filter/tag name sets from the real registration path.
 * @returns {{ filters: Set<string>, tags: Set<string> }}
 */
function knownNames() {
  if (registry) return registry;
  const engine = new Liquid({ jekyllInclude: true });
  registerLiquid(engine, {});
  // The target shape the lane converts INTO (#489): `{% section %}` and its
  // siblings are registered by the framework, not template-kit, so without
  // them a fully converted tree could never lint clean. No resolution roots —
  // the lint asks which NAMES the engine knows, never what they render.
  registerSectionTags(engine, { baseDirs: [], warn: () => {} });
  const filters = new Set([...Object.keys(engine.filters), ...ELEVENTY_NAMES]);
  const tags = new Set(Object.keys(engine.tags));
  // Block tags close with end<name>; Liquid's own end tags are parser-internal
  for (const tag of [...tags]) tags.add(`end${tag}`);
  ['else', 'elsif', 'when', 'endif', 'endfor', 'endunless', 'endcase', 'endcapture', 'endcomment', 'endraw', 'endtablerow'].forEach((tag) => tags.add(tag));
  registry = { filters, tags };
  return registry;
}

/**
 * Strip {% raw %}…{% endraw %} spans and {% comment %}…{% endcomment %}
 * spans so their contents don't produce findings.
 */
function stripInertSpans(text) {
  return text
    .replace(/\{%-?\s*raw\s*-?%\}[\s\S]*?\{%-?\s*endraw\s*-?%\}/g, (span) => span.replace(/\S/g, ' '))
    .replace(/\{%-?\s*comment\s*-?%\}[\s\S]*?\{%-?\s*endcomment\s*-?%\}/g, (span) => span.replace(/\S/g, ' '));
}

/**
 * Lint one file's text.
 * @param {string} text
 * @param {string} filePath
 * @returns {object[]} findings ({ file, line, check, severity, message })
 */
function lintText(text, filePath) {
  const { filters, tags } = knownNames();
  const findings = [];
  const lines = stripInertSpans(text).split('\n');

  lines.forEach((line, index) => {
    // Unknown tags: {% name … %}
    for (const [, name] of line.matchAll(/\{%-?\s*([a-z_][\w]*)/g)) {
      if (tags.has(name)) continue;
      if (JEKYLL_ONLY_TAGS[name]) {
        findings.push({
          file: filePath, line: index + 1, check: 'jekyll-only-tag', severity: 'error',
          message: `Jekyll-only tag \`{% ${name} %}\` — ${JEKYLL_ONLY_TAGS[name]}`,
        });
      } else {
        findings.push({
          file: filePath, line: index + 1, check: 'unknown-tag', severity: 'warning',
          message: `unknown tag \`{% ${name} %}\` — not registered by the engine; verify`,
        });
      }
    }

    // Unknown filters: | name inside {{ }} or {% %} spans (quoted strings
    // stripped first — a literal "|" inside an arg is not a filter pipe)
    for (const span of line.matchAll(/\{\{.*?\}\}|\{%.*?%\}/g)) {
      const unquoted = span[0].replace(/"[^"]*"|'[^']*'/g, '""');
      for (const [, name] of unquoted.matchAll(/\|\s*([a-z_][\w]*)/g)) {
        if (filters.has(name)) continue;
        findings.push({
          file: filePath, line: index + 1, check: 'unknown-filter', severity: 'warning',
          message: `unknown filter \`| ${name}\` — not registered by the engine; verify`,
        });
      }
    }
  });

  return findings;
}

module.exports = { lintText, knownNames, JEKYLL_ONLY_TAGS };
