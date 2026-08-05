/**
 * `omega customize <url>` mechanics (spec §8) — materialize a default page
 * into the consumer tree so it can diverge, without owning anything it
 * didn't change.
 *
 * Two lanes, decided by the resolved theme layout chain:
 *
 * - composition — the page's theme layout wraps its default composition in
 *   {% composition %}…{% endcomposition %} (a pure section composition).
 *   The materialized page = the default page's frontmatter + that inner
 *   body verbatim: clean one-liners, no copy inlined. The layout chain
 *   stays intact, so shared-band words keep flowing from the theme's
 *   frontmatter through `resolved.*`; the consumer owns only the
 *   composition order and whatever args they add.
 *
 * - shell — the theme layout still carries one-off markup (not yet a pure
 *   composition). The materialized page is a verbatim copy of the thin
 *   default page (layout pointer + permalink): everything keeps flowing;
 *   customization happens through frontmatter args over `resolved.*`.
 *
 * Both lanes prepend a YAML comment header (frontmatter comments never
 * reach the output), never overwrite, and are idempotent.
 */
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const { collectLayered, resolveThemeLayers } = require('./layers.js');
const { permalinkOf } = require('./consumer-scan.js');
const { PATHS } = require('./paths.js');

// Marker + inner-extraction for composition-wrapped layouts (sections.js
// registers the tag; this module only ever reads the raw template text).
const COMPOSITION_OPEN = /\{%-?\s*composition\s*-?%\}/;
const COMPOSITION_INNER = /\{%-?\s*composition\s*-?%\}([\s\S]*?)\{%-?\s*endcomposition\s*-?%\}/;

// How far a layout chain may nest before the walk gives up (cycles/typos).
const MAX_LAYOUT_DEPTH = 10;

/**
 * Split a template into frontmatter + body without rendering anything.
 * @param {string} raw
 * @returns {{ data: object, frontmatterRaw: string|null, body: string }}
 */
function parseFrontmatter(raw) {
  const match = raw.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return { data: {}, frontmatterRaw: null, body: raw };

  let data = {};
  try {
    data = yaml.load(match[1]) || {};
  } catch {
    // A default page/layout with unparseable frontmatter still shell-copies.
  }
  return { data, frontmatterRaw: match[1], body: raw.slice(match[0].length) };
}

/**
 * The ordered `_layouts` dirs for a consumer + active theme — mirrors the
 * engine's layout layer order (consumer → active theme → base → core).
 * @param {object} options
 * @param {string} options.consumerDir
 * @param {object} [options.siteData] - resolved config (theme.id names the active theme)
 * @returns {string[]}
 */
function layoutDirsFor({ consumerDir, siteData }) {
  const themeLayers = resolveThemeLayers({
    activeTheme: siteData?.theme?.id,
    consumerDir,
    themesDir: PATHS.themes,
  });
  return [
    path.join(consumerDir, '_layouts'),
    ...themeLayers.map((layer) => path.join(layer, '_layouts')),
    path.join(PATHS.core, '_layouts'),
  ];
}

/**
 * Resolve a Jekyll-style layout name (`blueprint/index`) to its winning
 * file across the layer dirs.
 * @param {string} name
 * @param {string[]} layoutDirs
 * @returns {string|null} absolute path
 */
function resolveLayoutFile(name, layoutDirs) {
  for (const dir of layoutDirs) {
    for (const candidate of [`${name}.html`, `${name}.md`, name]) {
      const file = path.join(dir, candidate);
      if (fs.existsSync(file) && fs.statSync(file).isFile()) return file;
    }
  }
  return null;
}

/**
 * Walk a page's layout chain looking for the nearest {% composition %} wrap.
 * @param {string} layoutName - the page's `layout:` value
 * @param {string[]} layoutDirs
 * @returns {{ file: string, inner: string }|null}
 */
function findComposition(layoutName, layoutDirs) {
  let name = layoutName;
  for (let depth = 0; name && depth < MAX_LAYOUT_DEPTH; depth++) {
    const file = resolveLayoutFile(name, layoutDirs);
    if (!file) return null;

    const { data, body } = parseFrontmatter(fs.readFileSync(file, 'utf8'));
    if (COMPOSITION_OPEN.test(body)) {
      const inner = body.match(COMPOSITION_INNER);
      if (inner) return { file, inner: inner[1] };
      return null; // opened but never closed — the build will throw loudly
    }
    name = data.layout;
  }
  return null;
}

/**
 * Normalize a user-supplied URL to the canonical permalink shape.
 * @param {string} url
 * @returns {string}
 */
function normalizeUrl(url) {
  let out = String(url || '').trim();
  if (!out.startsWith('/')) out = `/${out}`;
  if (out.length > 1) out = out.replace(/\/+$/, '');
  return out;
}

/**
 * Index the packaged default pages by their static permalinks. Generator
 * pages (Liquid in the permalink) are not URL-addressable and are skipped.
 * @returns {Map<string, { rel: string, abs: string, raw: string }>}
 */
function defaultPagesByUrl() {
  const map = new Map();
  for (const [rel, abs] of collectLayered([path.join(PATHS.defaults, 'pages')])) {
    const raw = fs.readFileSync(abs, 'utf8');
    const url = permalinkOf(raw);
    if (!url || url.includes('{')) continue;
    map.set(url, { rel, abs, raw });
  }
  return map;
}

/**
 * The consumer's already-owned page URLs, mapped to their files.
 * @param {string} consumerDir
 * @returns {Map<string, string>} url → absolute file
 */
function consumerPagesByUrl(consumerDir) {
  const map = new Map();
  const pagesDir = path.join(consumerDir, 'pages');
  if (!fs.existsSync(pagesDir)) return map;

  for (const entry of fs.readdirSync(pagesDir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/\.(md|html)$/.test(entry.name)) continue;
    const file = path.join(entry.parentPath, entry.name);
    const url = permalinkOf(fs.readFileSync(file, 'utf8'));
    if (url && !map.has(url)) map.set(url, file);
  }
  return map;
}

/**
 * Resolve what `omega customize <url>` would do, without writing anything.
 * @param {object} options
 * @param {string} options.url
 * @param {string} options.consumerDir - the consumer's src dir (contains pages/)
 * @param {object} [options.siteData]
 * @returns {object} plan — { status: 'ok'|'owned'|'unknown', url, ... }
 */
function resolveCustomization({ url, consumerDir, siteData }) {
  const normalized = normalizeUrl(url);
  const defaults = defaultPagesByUrl();

  let entry = defaults.get(normalized);
  let finalUrl = normalized;
  if (!entry && normalized.endsWith('.html')) {
    finalUrl = normalized.slice(0, -'.html'.length) || '/';
    entry = defaults.get(finalUrl);
  }
  if (!entry) return { status: 'unknown', url: normalized, known: [...defaults.keys()].sort() };

  const owned = consumerPagesByUrl(consumerDir).get(finalUrl);
  if (owned) return { status: 'owned', url: finalUrl, ownedFile: owned };

  const page = parseFrontmatter(entry.raw);
  const composition = page.data.layout
    ? findComposition(page.data.layout, layoutDirsFor({ consumerDir, siteData }))
    : null;

  if (composition) {
    // Section output must never pass through markdown — the copy lands .html.
    const rel = entry.rel.replace(/\.md$/, '.html');
    return {
      status: 'ok',
      lane: 'composition',
      url: finalUrl,
      defaultPage: entry,
      compositionFile: composition.file,
      inner: composition.inner,
      target: path.join(consumerDir, 'pages', rel),
    };
  }

  return {
    status: 'ok',
    lane: 'shell',
    url: finalUrl,
    defaultPage: entry,
    target: path.join(consumerDir, 'pages', entry.rel),
  };
}

/**
 * The YAML comment header both lanes prepend — comments never render.
 * @param {string} url
 * @param {string} lane
 * @returns {string}
 */
function headerFor(url, lane) {
  const shared = [
    `# Materialized by \`omega customize ${url}\` (spec §8).`,
  ];
  if (lane === 'composition') {
    shared.push(
      '# The default composition as one-liners — no copy inlined: section',
      '# markup, styles, and default words keep flowing from the theme. The',
      '# composition order and any args you add here are yours. Delete this',
      '# file to return to the packaged default.',
    );
  } else {
    shared.push(
      '# Verbatim copy of the packaged default page (its theme layout is not a',
      '# pure section composition yet, so there is no composition to prefill).',
      '# Customize via frontmatter args — everything keeps flowing from the',
      '# theme. Delete this file to return to the packaged default.',
    );
  }
  return shared.join('\n');
}

/**
 * Materialize a default page into the consumer tree. Idempotent: an existing
 * consumer page at the URL (or target path) is never overwritten.
 * @param {object} options - { url, consumerDir, siteData }
 * @returns {object} { status: 'created'|'exists'|'owned'|'unknown', ... }
 */
function materialize({ url, consumerDir, siteData }) {
  const plan = resolveCustomization({ url, consumerDir, siteData });
  if (plan.status !== 'ok') return plan;
  if (fs.existsSync(plan.target)) return { ...plan, status: 'exists' };

  const page = parseFrontmatter(plan.defaultPage.raw);
  const header = headerFor(plan.url, plan.lane);
  let content;

  if (plan.lane === 'composition') {
    const body = plan.inner.replace(/^\n+/, '').replace(/\n+$/, '');
    // Body content REPLACES the {% composition %} wrap by default (Ian
    // 2026-07-19) — no flag needed; `append: true` is the legacy
    // add-below escape hatch.
    content = `---\n${header}\n${page.frontmatterRaw}\n---\n\n${body}\n`;
  } else {
    content = `---\n${header}\n${page.frontmatterRaw}\n---\n${page.body}`;
  }

  fs.mkdirSync(path.dirname(plan.target), { recursive: true });
  fs.writeFileSync(plan.target, content);
  return { ...plan, status: 'created' };
}

/**
 * Every customizable default URL with its lane and ownership state.
 * @param {object} options - { consumerDir, siteData }
 * @returns {Array<{ url: string, lane: string, owned: string|null, source: string }>}
 */
function listCustomizable({ consumerDir, siteData }) {
  const layoutDirs = layoutDirsFor({ consumerDir, siteData });
  const owned = consumerPagesByUrl(consumerDir);
  const compositionCache = new Map(); // layout name → boolean

  const out = [];
  for (const [url, entry] of defaultPagesByUrl()) {
    const { data } = parseFrontmatter(entry.raw);
    let lane = 'shell';
    if (data.layout) {
      if (!compositionCache.has(data.layout)) {
        compositionCache.set(data.layout, Boolean(findComposition(data.layout, layoutDirs)));
      }
      if (compositionCache.get(data.layout)) lane = 'composition';
    }
    out.push({ url, lane, owned: owned.get(url) || null, source: entry.rel });
  }
  return out.sort((a, b) => a.url.localeCompare(b.url));
}

module.exports = { resolveCustomization, materialize, listCustomizable, normalizeUrl };
