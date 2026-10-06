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
const fs = require('node:fs');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');

// The lane NAMES the environment
// ([#817](https://github.com/Omega-JS-Stack/omega/issues/817)): the engine reads
// that ONE input instead of a loose `options.environment`, and a fixture build
// with no verb above it is a development build, which is what it always was.
const { setEnvironment } = require('@omega.js/config/environment');
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
  setEnvironment('development');
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

module.exports = defineCases({
  type: 'group',
  description: 'customize',
  tests: [
    {
      name: 'cp220: resolver lanes — composition where the theme wraps one, shell elsewhere, theme-honest',
      run: (ctx) => {
        const empty = path.join(PKG, '.omega', 'customize-empty');
        fs.rmSync(empty, { recursive: true, force: true });
        fs.mkdirSync(empty, { recursive: true });

        const home = resolveCustomization({ url: '/', consumerDir: empty, siteData: miniData });
        ctx.expect(home.status).toBe('ok');
        ctx.expect(home.lane).toBe('composition');
        ctx.expect(home.inner.includes('{% section "marketing/hero", data: resolved.hero %}'), 'inner is the one-liner composition').toBeTruthy();
        ctx.expect(home.inner.includes('{% iftruthy resolved.testimonials.items %}'), 'guards ride along verbatim').toBeTruthy();
        ctx.expect(!home.inner.includes('Sarah Johnson'), 'NO copy inlined — the words stay in the theme').toBeTruthy();
        ctx.expect(home.target.endsWith(path.join('pages', 'index.html')), 'composition lane lands .html (never markdown-processed)').toBeTruthy();

        ctx.expect(resolveCustomization({ url: '/pricing', consumerDir: empty, siteData: miniData }).lane).toBe('shell');
        ctx.expect(resolveCustomization({ url: 'pricing.html', consumerDir: empty, siteData: miniData }).url, 'inputs normalize').toBe('/pricing');

        // Under newsflash, its own (not-pure) home layout shadows the classy wrap —
        // the lane is honest about what the ACTIVE theme would materialize.
        ctx.expect(resolveCustomization({ url: '/', consumerDir: empty, siteData: nfData }).lane).toBe('shell');

        const unknown = resolveCustomization({ url: '/nope', consumerDir: empty, siteData: miniData });
        ctx.expect(unknown.status).toBe('unknown');
        ctx.expect(unknown.known.includes('/pricing'), 'unknown carries the known list for suggestions').toBeTruthy();

        const list = listCustomizable({ consumerDir: empty, siteData: miniData });
        ctx.expect(list.length >= 60, `every static default URL lists (${list.length})`).toBeTruthy();
        ctx.expect(list.find((entry) => entry.url === '/').lane).toBe('composition');
        ctx.expect(list.find((entry) => entry.url === '/about').lane).toBe('composition');
        ctx.expect(list.every((entry) => !entry.url.includes('{')), 'generator permalinks never list').toBeTruthy();
      },
    },

    {
      name: '#458: a PAGINATING default page materializes — addressed by its logical URL, permalink byte-identical, default suppressed',
      run: async (ctx) => {
        const consumer = path.join(PKG, '.omega', 'customize-paginating');
        fs.rmSync(consumer, { recursive: true, force: true });
        fs.mkdirSync(consumer, { recursive: true });

        // The blog hub's permalink is a pagination TEMPLATE, so no URL can equal it
        // — the index skipped it and `omega customize /blog` reported "unknown".
        const plan = resolveCustomization({ url: '/blog', consumerDir: consumer, siteData: miniData });
        ctx.expect(plan.status, 'the blog hub is addressable by the URL its page 1 serves').toBe('ok');
        ctx.expect(plan.lane).toBe('shell');
        ctx.expect(plan.target.endsWith(path.join('pages', 'blog.md')), `lands at the default's own path: ${plan.target}`).toBeTruthy();

        const before = await buildConsumer(consumer, 'customize-blog-a');
        ctx.expect(before.has('/blog'), 'the packaged default ships the hub before customizing').toBeTruthy();

        // (a) materialized with the permalink copied BYTE-IDENTICAL — the only
        // thing the build-time suppression lane keys on (consumer-scan.js).
        const created = materialize({ url: '/blog', consumerDir: consumer, siteData: miniData });
        ctx.expect(created.status).toBe('created');
        const written = fs.readFileSync(created.target, 'utf8');
        const permalinkLine = (raw) => (raw.match(/^permalink:.*$/m) || [])[0];
        ctx.expect(permalinkLine(written)).toBe('permalink: "/blog{% if pagination.pageNumber > 0 %}/page/{{ pagination.pageNumber | plus: 1 }}{% endif %}.html"');
        ctx.expect(permalinkLine(written), 'byte-identical to the packaged default').toBe(permalinkLine(created.defaultPage.raw));
        ctx.expect(written.includes('# Verbatim copy'), 'shell explains itself in frontmatter comments').toBeTruthy();

        // (b) the build suppresses the default: the same page set, one /blog.
        const after = await buildConsumer(consumer, 'customize-blog-b');
        ctx.expect([...after.keys()].sort(), 'same page set — no duplicate hub').toEqual([...before.keys()].sort());
        for (const [url, content] of before) {
          ctx.expect(normalize(url, after.get(url)), `${url} unchanged by materializing the hub`).toBe(normalize(url, content));
        }

        // Idempotent, like every other lane.
        const again = materialize({ url: '/blog', consumerDir: consumer, siteData: miniData });
        ctx.expect(again.status === 'owned' || again.status === 'exists', `no-op on rerun (${again.status})`).toBeTruthy();
        ctx.expect(fs.readFileSync(created.target, 'utf8'), 'rerun never rewrites the file').toBe(written);

        // (c) non-paginating customize is untouched, and no Liquid ever LISTS as a URL.
        const empty = path.join(PKG, '.omega', 'customize-paginating-empty');
        fs.rmSync(empty, { recursive: true, force: true });
        fs.mkdirSync(empty, { recursive: true });
        const pricing = resolveCustomization({ url: '/pricing', consumerDir: empty, siteData: miniData });
        ctx.expect(pricing.lane).toBe('shell');
        ctx.expect(pricing.target.endsWith(path.join('pages', 'pricing.md'))).toBeTruthy();
        ctx.expect(resolveCustomization({ url: '/', consumerDir: empty, siteData: miniData }).lane).toBe('composition');

        const list = listCustomizable({ consumerDir: empty, siteData: miniData });
        ctx.expect(list.every((entry) => !entry.url.includes('{')), 'a pagination template never lists as a URL').toBeTruthy();
        ctx.expect(list.filter((entry) => /^\/blog(\/|$)/.test(entry.url)).map((entry) => entry.url).sort(), 'every blog default is addressable, generators included').toEqual(['/blog', '/blog/categories', '/blog/categories/category', '/blog/index.json', '/blog/tags', '/blog/tags/tag']);
      },
    },

    {
      name: 'cp220: the {% composition %} guard — a body REPLACES the composition, and `append` is gone (#607)',
      run: async (ctx) => {
        const consumer = path.join(PKG, '.omega', 'customize-replace');
        fs.rmSync(consumer, { recursive: true, force: true });
        fs.mkdirSync(path.join(consumer, 'pages'), { recursive: true });

        // Default (Ian 2026-07-19): a body REPLACES the composition — no flag
        fs.writeFileSync(
          path.join(consumer, 'pages', 'index.md'),
          '---\nlayout: blueprint/index\npermalink: /\n---\n\n## My replacement home\n',
        );
        const replaced = (await buildConsumer(consumer, 'customize-replace')).get('/');
        ctx.expect(replaced.includes('My replacement home'), 'the page body renders').toBeTruthy();
        ctx.expect(replaced.includes('<h2'), 'markdown content formats (parity branch)').toBeTruthy();
        ctx.expect(!replaced.includes('omega-hero'), 'the default composition is REPLACED by default').toBeTruthy();

        // The legacy UJM add-below flag is DELETED (#607, Ian 2026-08-26): it is an
        // unknown frontmatter key now, stripped with the content-key warning, and
        // the body replaces the composition like any other body. A page that wants
        // the default bands writes them — `omega customize <url>` materializes them.
        fs.writeFileSync(
          path.join(consumer, 'pages', 'index.md'),
          '---\nlayout: blueprint/index\npermalink: /\nappend: true\n---\n\n## My appended prose\n',
        );
        const appended = (await buildConsumer(consumer, 'customize-append')).get('/');
        ctx.expect(!appended.includes('omega-hero'), '`append: true` no longer keeps the default composition').toBeTruthy();
        ctx.expect(appended.includes('My appended prose'), 'the body still renders — it replaced the composition').toBeTruthy();
      },
    },

    {
      name: 'cp220: materialize-then-build identity, then divergence — args land, bands drop, words keep flowing',
      run: async (ctx) => {
        fs.rmSync(SCRATCH, { recursive: true, force: true });
        fs.mkdirSync(SCRATCH, { recursive: true });

        // A: the bare consumer — full default site
        const before = await buildConsumer(SCRATCH, 'customize-a');

        // Materialize both lanes
        const home = materialize({ url: '/', consumerDir: SCRATCH, siteData: miniData });
        ctx.expect(home.status).toBe('created');
        ctx.expect(home.lane).toBe('composition');
        const homeFile = fs.readFileSync(home.target, 'utf8');
        ctx.expect(!homeFile.includes('Sarah Johnson'), 'materialized file carries no theme copy').toBeTruthy();
        ctx.expect(!homeFile.includes('composition: true'), 'no flag needed — a body replaces the composition by default').toBeTruthy();

        const pricing = materialize({ url: '/pricing', consumerDir: SCRATCH, siteData: miniData });
        ctx.expect(pricing.status).toBe('created');
        ctx.expect(pricing.lane).toBe('shell');
        const pricingFile = fs.readFileSync(pricing.target, 'utf8');
        ctx.expect(pricingFile.includes('layout: blueprint/pricing'), 'shell keeps the thin default verbatim').toBeTruthy();
        ctx.expect(pricingFile.includes('# Verbatim copy'), 'shell explains itself in frontmatter comments').toBeTruthy();

        // Idempotent: the URL is now consumer-owned — nothing overwrites
        const again = materialize({ url: '/', consumerDir: SCRATCH, siteData: miniData });
        ctx.expect(again.status === 'owned' || again.status === 'exists', `no-op on rerun (${again.status})`).toBeTruthy();
        ctx.expect(fs.readFileSync(home.target, 'utf8'), 'rerun never rewrites the file').toBe(homeFile);

        // B: materialized but untouched — the SAME site
        const after = await buildConsumer(SCRATCH, 'customize-b');
        ctx.expect([...after.keys()].sort(), 'same page set').toEqual([...before.keys()].sort());
        for (const [url, content] of before) {
          ctx.expect(normalize(url, after.get(url)), `${url} unchanged by materializing`).toBe(normalize(url, content));
        }
        ctx.expect(after.get('/').includes('omega-hero'), 'the composition renders from the page body now').toBeTruthy();
        ctx.expect(after.get('/').includes('Sarah Johnson'), 'theme words flow through resolved.* — never inlined').toBeTruthy();

        // Diverge the new-world way (frontmatter is meta-only): an arg override on
        // the section CALL (args beat data in the section merge chain) + one band
        // deleted from the body.
        const diverged = homeFile
          .replace('{% section "marketing/cta", data: resolved.cta %}', '{% section "marketing/cta", data: resolved.cta, headline: "MiniCo custom close" %}')
          .replace('{% section "marketing/stats", items: resolved.stats %}\n', '');
        ctx.expect(diverged).not.toBe(homeFile);
        fs.writeFileSync(home.target, diverged);

        const custom = await buildConsumer(SCRATCH, 'customize-c');
        const customHome = custom.get('/');
        ctx.expect(customHome.includes('MiniCo custom close'), 'the call-site arg override lands').toBeTruthy();
        ctx.expect(!customHome.includes('omega-stats'), 'the deleted one-liner drops exactly that band').toBeTruthy();
        ctx.expect(customHome.includes('Sarah Johnson'), 'untouched bands keep their theme words').toBeTruthy();
        for (const [url, content] of after) {
          if (url === '/') continue;
          ctx.expect(normalize(url, custom.get(url)), `${url} untouched by the home divergence`).toBe(normalize(url, content));
        }
      },
    },
  ],
});
