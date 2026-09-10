/**
 * `omega customize <url>` (cp220, spec §8) — pins the two materialize lanes
 * and the {% composition %} guard:
 *
 * - resolver lanes: composition for pages whose theme layout wraps a pure
 *   composition (classy home), verbatim shell for everything else, honest
 *   under theme resolution (newsflash's own home shadows the classy wrap).
 * - materialize-then-build identity: a bare consumer builds the SAME site
 *   before and after materializing (no copy inlined — the theme's words
 *   keep flowing through `resolved.*` even though the consumer file never
 *   carried them).
 * - divergence: consumer frontmatter args land; deleting a one-liner drops
 *   exactly that band; nothing else moves.
 * - the guard itself: page body content REPLACES the default composition.
 *
 * HTML comparisons normalize per-build stamps (buildTime/cachebreaker/feed
 * dates), the build-global SVG logo uniq counters (render-order dependent —
 * the parked nondeterminism family), and meta-file ordering. Everything
 * else is byte-strict.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const { configureOmega } = require('../src/index.js');
const { resolveCustomization, materialize, listCustomizable } = require('../src/customize.js');
const { miniData, PKG } = require('./lib/build.js');

const nfData = { ...miniData, theme: { id: 'newsflash' } };
const SCRATCH = path.join(PKG, '.omega', 'customize-consumer');

/**
 * Build an arbitrary consumer dir through the full engine (lib/build.js
 * shape, but with a caller-owned consumer dir).
 */
async function buildConsumer(consumerDir, name, siteData = miniData) {
  const Eleventy = require('@11ty/eleventy').default;
  const elev = new Eleventy(consumerDir, path.join(PKG, '.omega', `${name}-out`), {
    quietMode: true,
    configPath: false,
    config: (eleventyConfig) => {
      eleventyConfig.setUseTemplateCache(false);
      return configureOmega(eleventyConfig, {
        consumerDir,
        siteData,
        farmDir: path.join(PKG, '.omega', `${name}-farm`),
        assetManifest: {
          js: { main: '/assets/js/main-TEST.js', pages: {} },
          css: { main: '/assets/css/main-TEST.css', pages: {}, layouts: {} },
        },
      });
    },
  });
  const results = await elev.toJSON();
  // Only the pages that SHIP: a framework page the consumer took over is
  // registered and gated at render time (#200 Lane B), which Eleventy reports
  // as `url: false` — it writes no file.
  return new Map(results.filter((r) => typeof r.url === 'string').map((r) => [r.url, r.content]));
}

/**
 * Normalize the known per-build noise so identity assertions bite on
 * content only (see the file header).
 */
function normalize(url, text) {
  let out = String(text)
    .replace(/buildTime: \d+/g, 'buildTime: X')
    .replace(/\?cb=\d+/g, '?cb=X')
    .replace(/<lastBuildDate>[^<]+<\/lastBuildDate>/g, '<lastBuildDate>X</lastBuildDate>')
    .replace(/<pubDate>[^<]+<\/pubDate>/g, '<pubDate>X</pubDate>')
    .replace(/<lastmod>[^<]+<\/lastmod>/g, '<lastmod>X</lastmod>')
    // The build stamp both modified-date surfaces read (#613): `site.time` is
    // set per build, so two builds seconds apart legitimately differ here.
    .replace(/(article:modified_time" content=")[^"]*/g, '$1X')
    .replace(/("dateModified":\s*")[^"]*/g, '$1X')
    // omega_logo instance ids are `name-<build-global counter>-<original id>` in
    // id=/url(#/href="# homes — the counter value depends on page render
    // order, which legitimately shifts when a URL moves from virtual default
    // to consumer file. Ids stay internally consistent per page.
    .replace(/(id="|url\(#|href="#)([a-z0-9-]+?)-\d+-/g, '$1$2-N-')
    // A materialized page's body passes through the blueprint's
    // `{{ content | omega_content_format }}` wrap, which frames it with one
    // extra newline each side vs the in-layout render. Blank-line runs are
    // the ONLY sanctioned delta — anything beyond whitespace still fails.
    .replace(/\n[\t ]*(?:\n[\t ]*)+/g, '\n');
  if (url === '/pages.json') {
    out = JSON.stringify(JSON.parse(out).sort((a, b) => a.url.localeCompare(b.url)));
  }
  if (url === '/sitemap.xml') {
    out = (out.match(/<url>[\s\S]*?<\/url>/g) || []).sort().join('\n');
  }
  return out;
}

test('cp220: resolver lanes — composition where the theme wraps one, shell elsewhere, theme-honest', () => {
  const empty = path.join(PKG, '.omega', 'customize-empty');
  fs.rmSync(empty, { recursive: true, force: true });
  fs.mkdirSync(empty, { recursive: true });

  const home = resolveCustomization({ url: '/', consumerDir: empty, siteData: miniData });
  assert.strictEqual(home.status, 'ok');
  assert.strictEqual(home.lane, 'composition');
  assert.ok(home.inner.includes('{% section "marketing/hero", data: resolved.hero %}'), 'inner is the one-liner composition');
  assert.ok(home.inner.includes('{% iftruthy resolved.testimonials.items %}'), 'guards ride along verbatim');
  assert.ok(!home.inner.includes('Sarah Johnson'), 'NO copy inlined — the words stay in the theme');
  assert.ok(home.target.endsWith(path.join('pages', 'index.html')), 'composition lane lands .html (never markdown-processed)');

  assert.strictEqual(resolveCustomization({ url: '/pricing', consumerDir: empty, siteData: miniData }).lane, 'shell');
  assert.strictEqual(resolveCustomization({ url: 'pricing.html', consumerDir: empty, siteData: miniData }).url, '/pricing', 'inputs normalize');

  // Under newsflash, its own (not-pure) home layout shadows the classy wrap —
  // the lane is honest about what the ACTIVE theme would materialize.
  assert.strictEqual(resolveCustomization({ url: '/', consumerDir: empty, siteData: nfData }).lane, 'shell');

  const unknown = resolveCustomization({ url: '/nope', consumerDir: empty, siteData: miniData });
  assert.strictEqual(unknown.status, 'unknown');
  assert.ok(unknown.known.includes('/pricing'), 'unknown carries the known list for suggestions');

  const list = listCustomizable({ consumerDir: empty, siteData: miniData });
  assert.ok(list.length >= 60, `every static default URL lists (${list.length})`);
  assert.strictEqual(list.find((entry) => entry.url === '/').lane, 'composition');
  assert.strictEqual(list.find((entry) => entry.url === '/about').lane, 'composition');
  assert.ok(list.every((entry) => !entry.url.includes('{')), 'generator permalinks never list');
});

test('#458: a PAGINATING default page materializes — addressed by its logical URL, permalink byte-identical, default suppressed', async () => {
  const consumer = path.join(PKG, '.omega', 'customize-paginating');
  fs.rmSync(consumer, { recursive: true, force: true });
  fs.mkdirSync(consumer, { recursive: true });

  // The blog hub's permalink is a pagination TEMPLATE, so no URL can equal it
  // — the index skipped it and `omega customize /blog` reported "unknown".
  const plan = resolveCustomization({ url: '/blog', consumerDir: consumer, siteData: miniData });
  assert.strictEqual(plan.status, 'ok', 'the blog hub is addressable by the URL its page 1 serves');
  assert.strictEqual(plan.lane, 'shell');
  assert.ok(plan.target.endsWith(path.join('pages', 'blog.md')), `lands at the default's own path: ${plan.target}`);

  const before = await buildConsumer(consumer, 'customize-blog-a');
  assert.ok(before.has('/blog'), 'the packaged default ships the hub before customizing');

  // (a) materialized with the permalink copied BYTE-IDENTICAL — the only
  // thing the build-time suppression lane keys on (consumer-scan.js).
  const created = materialize({ url: '/blog', consumerDir: consumer, siteData: miniData });
  assert.strictEqual(created.status, 'created');
  const written = fs.readFileSync(created.target, 'utf8');
  const permalinkLine = (raw) => (raw.match(/^permalink:.*$/m) || [])[0];
  assert.strictEqual(
    permalinkLine(written),
    'permalink: "/blog{% if pagination.pageNumber > 0 %}/page/{{ pagination.pageNumber | plus: 1 }}{% endif %}.html"',
  );
  assert.strictEqual(permalinkLine(written), permalinkLine(created.defaultPage.raw), 'byte-identical to the packaged default');
  assert.ok(written.includes('# Verbatim copy'), 'shell explains itself in frontmatter comments');

  // (b) the build suppresses the default: the same page set, one /blog.
  const after = await buildConsumer(consumer, 'customize-blog-b');
  assert.deepStrictEqual([...after.keys()].sort(), [...before.keys()].sort(), 'same page set — no duplicate hub');
  for (const [url, content] of before) {
    assert.strictEqual(normalize(url, after.get(url)), normalize(url, content), `${url} unchanged by materializing the hub`);
  }

  // Idempotent, like every other lane.
  const again = materialize({ url: '/blog', consumerDir: consumer, siteData: miniData });
  assert.ok(again.status === 'owned' || again.status === 'exists', `no-op on rerun (${again.status})`);
  assert.strictEqual(fs.readFileSync(created.target, 'utf8'), written, 'rerun never rewrites the file');

  // (c) non-paginating customize is untouched, and no Liquid ever LISTS as a URL.
  const empty = path.join(PKG, '.omega', 'customize-paginating-empty');
  fs.rmSync(empty, { recursive: true, force: true });
  fs.mkdirSync(empty, { recursive: true });
  const pricing = resolveCustomization({ url: '/pricing', consumerDir: empty, siteData: miniData });
  assert.strictEqual(pricing.lane, 'shell');
  assert.ok(pricing.target.endsWith(path.join('pages', 'pricing.md')));
  assert.strictEqual(resolveCustomization({ url: '/', consumerDir: empty, siteData: miniData }).lane, 'composition');

  const list = listCustomizable({ consumerDir: empty, siteData: miniData });
  assert.ok(list.every((entry) => !entry.url.includes('{')), 'a pagination template never lists as a URL');
  assert.deepStrictEqual(
    list.filter((entry) => /^\/blog(\/|$)/.test(entry.url)).map((entry) => entry.url).sort(),
    ['/blog', '/blog/categories', '/blog/categories/category', '/blog/index.json', '/blog/tags', '/blog/tags/tag'],
    'every blog default is addressable, generators included',
  );
});

test('cp220: the {% composition %} guard — a body REPLACES the composition, and `append` is gone (#607)', async () => {
  const consumer = path.join(PKG, '.omega', 'customize-replace');
  fs.rmSync(consumer, { recursive: true, force: true });
  fs.mkdirSync(path.join(consumer, 'pages'), { recursive: true });

  // Default (Ian 2026-07-19): a body REPLACES the composition — no flag
  fs.writeFileSync(
    path.join(consumer, 'pages', 'index.md'),
    '---\nlayout: blueprint/index\npermalink: /\n---\n\n## My replacement home\n',
  );
  const replaced = (await buildConsumer(consumer, 'customize-replace')).get('/');
  assert.ok(replaced.includes('My replacement home'), 'the page body renders');
  assert.ok(replaced.includes('<h2'), 'markdown content formats (parity branch)');
  assert.ok(!replaced.includes('omega-hero'), 'the default composition is REPLACED by default');

  // The legacy UJM add-below flag is DELETED (#607, Ian 2026-08-26): it is an
  // unknown frontmatter key now, stripped with the content-key warning, and
  // the body replaces the composition like any other body. A page that wants
  // the default bands writes them — `omega customize <url>` materializes them.
  fs.writeFileSync(
    path.join(consumer, 'pages', 'index.md'),
    '---\nlayout: blueprint/index\npermalink: /\nappend: true\n---\n\n## My appended prose\n',
  );
  const appended = (await buildConsumer(consumer, 'customize-append')).get('/');
  assert.ok(!appended.includes('omega-hero'), '`append: true` no longer keeps the default composition');
  assert.ok(appended.includes('My appended prose'), 'the body still renders — it replaced the composition');
});

test('cp220: materialize-then-build identity, then divergence — args land, bands drop, words keep flowing', async () => {
  fs.rmSync(SCRATCH, { recursive: true, force: true });
  fs.mkdirSync(SCRATCH, { recursive: true });

  // A: the bare consumer — full default site
  const before = await buildConsumer(SCRATCH, 'customize-a');

  // Materialize both lanes
  const home = materialize({ url: '/', consumerDir: SCRATCH, siteData: miniData });
  assert.strictEqual(home.status, 'created');
  assert.strictEqual(home.lane, 'composition');
  const homeFile = fs.readFileSync(home.target, 'utf8');
  assert.ok(!homeFile.includes('Sarah Johnson'), 'materialized file carries no theme copy');
  assert.ok(!homeFile.includes('composition: true'), 'no flag needed — a body replaces the composition by default');

  const pricing = materialize({ url: '/pricing', consumerDir: SCRATCH, siteData: miniData });
  assert.strictEqual(pricing.status, 'created');
  assert.strictEqual(pricing.lane, 'shell');
  const pricingFile = fs.readFileSync(pricing.target, 'utf8');
  assert.ok(pricingFile.includes('layout: blueprint/pricing'), 'shell keeps the thin default verbatim');
  assert.ok(pricingFile.includes('# Verbatim copy'), 'shell explains itself in frontmatter comments');

  // Idempotent: the URL is now consumer-owned — nothing overwrites
  const again = materialize({ url: '/', consumerDir: SCRATCH, siteData: miniData });
  assert.ok(again.status === 'owned' || again.status === 'exists', `no-op on rerun (${again.status})`);
  assert.strictEqual(fs.readFileSync(home.target, 'utf8'), homeFile, 'rerun never rewrites the file');

  // B: materialized but untouched — the SAME site
  const after = await buildConsumer(SCRATCH, 'customize-b');
  assert.deepStrictEqual([...after.keys()].sort(), [...before.keys()].sort(), 'same page set');
  for (const [url, content] of before) {
    assert.strictEqual(normalize(url, after.get(url)), normalize(url, content), `${url} unchanged by materializing`);
  }
  assert.ok(after.get('/').includes('omega-hero'), 'the composition renders from the page body now');
  assert.ok(after.get('/').includes('Sarah Johnson'), 'theme words flow through resolved.* — never inlined');

  // Diverge the new-world way (frontmatter is meta-only): an arg override on
  // the section CALL (args beat data in the section merge chain) + one band
  // deleted from the body.
  const diverged = homeFile
    .replace('{% section "marketing/cta", data: resolved.cta %}', '{% section "marketing/cta", data: resolved.cta, headline: "MiniCo custom close" %}')
    .replace('{% section "marketing/stats", items: resolved.stats %}\n', '');
  assert.notStrictEqual(diverged, homeFile);
  fs.writeFileSync(home.target, diverged);

  const custom = await buildConsumer(SCRATCH, 'customize-c');
  const customHome = custom.get('/');
  assert.ok(customHome.includes('MiniCo custom close'), 'the call-site arg override lands');
  assert.ok(!customHome.includes('omega-stats'), 'the deleted one-liner drops exactly that band');
  assert.ok(customHome.includes('Sarah Johnson'), 'untouched bands keep their theme words');
  for (const [url, content] of after) {
    if (url === '/') continue;
    assert.strictEqual(normalize(url, custom.get(url)), normalize(url, content), `${url} untouched by the home divergence`);
  }
});
