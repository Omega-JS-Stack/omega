/**
 * A1 slice invariants against the mini-site fixture — every checklist item
 * that doesn't need the full corpus or a benchmark: layered layouts (virtual
 * AND farm), layout chaining, default pages + consumer suppression, resolved
 * deep-merge, frontmatter Liquid, Jekyll conventions, blog + taxonomy,
 * pricing math, template-kit tags inside Eleventy.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test, before } = require('node:test');
const { configureOmega } = require('../src/omega-web.js');

const SPIKE = path.resolve(__dirname, '..');
const MINI = path.resolve(__dirname, '..', '..', 'bakeoff-shared', 'fixtures', 'mini-site');
const siteData = JSON.parse(fs.readFileSync(path.join(MINI, 'site-data.json'), 'utf8'));

/**
 * Run Eleventy programmatically over the mini site and index results by URL.
 * @param {object} [overrides] - configureOmega option overrides
 * @returns {Promise<Map<string, string>>} url → rendered content
 */
async function buildMini(overrides = {}) {
  const Eleventy = require('@11ty/eleventy').default;
  const elev = new Eleventy(MINI, path.join(SPIKE, '.omega', 'test-out'), {
    quietMode: true,
    configPath: false,
    config: (eleventyConfig) => {
      // Multiple builds share one process here — Eleventy's module-level
      // layout cache is keyed by inputDir+layout and would leak the first
      // theme's compiled layouts into later builds
      eleventyConfig.setUseTemplateCache(false);
      return configureOmega(eleventyConfig, {
        consumerDir: MINI,
        siteData,
        themesDir: path.join(SPIKE, 'themes'),
        coreDir: path.join(SPIKE, 'core'),
        defaultsDir: path.join(SPIKE, 'defaults'),
        farmDir: path.join(SPIKE, '.omega', 'layout-farm'),
        assetManifest: { js: { signin: '/assets/js/pages/signin-TEST.js' }, css: { theme: '/assets/css/theme-TEST.css' } },
        ...overrides,
      });
    },
  });

  const results = await elev.toJSON();
  return new Map(results.map((r) => [r.url, r.content]));
}

let pages;
before(async () => {
  pages = await buildMini();
});

test('theme-base bracket layout normalizes and renders the full chrome chain', () => {
  const html = pages.get('/');
  assert.ok(html.includes('data-theme="classy"'), 'core/base chrome present');
  assert.ok(html.includes('class="site-header'), 'header include rendered');
  assert.ok(html.includes('Grow faster with MiniCo'), 'body Liquid rendered against site global');
  assert.ok(html.includes('<title>MiniCo - Home of Mini</title>'), 'frontmatter {{ site.meta.title }} rendered');
});

test('frontmatter-only override page: consumer data over layout defaults (deep merge)', () => {
  const html = pages.get('/about/');
  assert.ok(html.includes('MiniCo</p>') || html.includes('>MiniCo<'), 'consumer hero.tagline ({{ site.brand.name }}) rendered');
  assert.ok(html.includes('The consumer about page'), 'consumer hero.headline wins');
  assert.ok(html.includes('Get started'), 'layout-only hero.cta survives the deep merge');
  assert.ok(html.includes('<title>About - MiniCo</title>'), 'frontmatter Liquid in meta.title');
  assert.ok(html.includes('Consumer body content'), 'markdown body rendered');
});

test('consumer about.md SUPPRESSES the framework default about page', () => {
  const html = pages.get('/about/');
  assert.ok(!html.includes('DEFAULT ABOUT PAGE'), 'default about must not leak');
});

test('default pages render when the consumer has no same-URL file', () => {
  const signin = pages.get('/signin/');
  assert.ok(signin.includes('data-form-manager="signin"'), 'signin form present');
  assert.ok(signin.includes('<title>Sign in - MiniCo</title>'), 'default page frontmatter Liquid rendered');
  assert.ok(signin.includes('/assets/js/pages/signin-TEST.js'), 'pageModule script from asset manifest');
  assert.ok(pages.get('/signup/').includes('data-form-manager="signup"'), 'signup default');
  assert.ok(pages.get('/404.html').includes('classy-404'), '404 default at literal /404.html');
});

test('pricing: layout plan defaults + resolve-plan Liquid math', () => {
  const html = pages.get('/pricing/');
  assert.ok(html.includes('data-plan="basic"') && html.includes('data-plan="enterprise"'), 'plans from LAYOUT frontmatter');
  assert.ok(html.includes('$8/mo billed annually'), 'annual per-month math (96/12)');
  assert.ok(html.includes('save 33%'), 'savings percent math ((144-96)/144)');
  assert.ok(html.includes('Basic'), 'uj_title_case on plan name');
});

test('posts: Jekyll filename convention, readtime, taxonomy links', () => {
  const html = pages.get('/blog/first-post/');
  assert.ok(html, 'date stripped from URL (fileSlug)');
  assert.ok(html.includes('First post'), 'post.title');
  assert.ok(html.includes('By Jane Doe'), 'uj_title_case on author');
  assert.ok(html.includes('January 15, 2024'), 'date parsed from filename');
  assert.ok(/[1-9]\d* min read/.test(html), 'uj_readtime');
  assert.ok(html.includes('href="/blog/category/growth/"'), 'category link slugified');
  assert.ok(html.includes('href="/blog/tag/growth-hacks/"'), 'tag link');
});

test('blog index: pagination + uj_commaify post count', () => {
  const html = pages.get('/blog/');
  assert.ok(html.includes('First post') && html.includes('Second post'), 'both posts listed');
  assert.ok(html.includes('(2 posts)'), 'uj_commaify count');
  assert.ok(html.includes('Page 1 of 1'), 'pagination data');
});

test('taxonomy pages generated from post.categories / post.tags', () => {
  const growth = pages.get('/blog/category/growth/');
  assert.ok(growth.includes('First post') && growth.includes('Second post'), 'category aggregates');
  const marketing = pages.get('/blog/category/marketing/');
  assert.ok(marketing.includes('Second post') && !marketing.includes('First post'), 'category filters');
  assert.ok(pages.get('/blog/tag/automation/').includes('Second post'), 'tag page');
});

test('alternatives collection: permalink convention + comparison table', () => {
  const html = pages.get('/alternatives/acme-growth/');
  assert.ok(html.includes('MiniCo vs Acme Growth'), 'site + competitor');
  assert.ok(html.includes('Automation depth'), 'comparison rows');
});

test('urlmatches marks the active nav item', () => {
  assert.ok(pages.get('/pricing/').match(/nav-link active[^>]*href="\/pricing\/"/), 'pricing nav active on pricing page');
  assert.ok(!pages.get('/about/').match(/nav-link active[^>]*href="\/pricing\/"/), 'not active elsewhere');
});

test('template-kit media tags render (uj_icon from the core icon dir)', () => {
  assert.ok(pages.get('/').includes('data-icon="rocket"'), 'header brand icon');
});

test('dusk theme: layered overrides win, classy fills the gaps', async () => {
  const dusk = await buildMini({ activeTheme: 'dusk' });
  assert.ok(dusk.get('/404.html').includes('dusk-404'), 'dusk layout override wins');
  assert.ok(dusk.get('/').includes('omega-theme') && dusk.get('/').includes('content="dusk"'), 'dusk head include wins');
  assert.ok(dusk.get('/pricing/').includes('data-plan="basic"'), 'classy pricing layout fills the gap');
  assert.ok(dusk.get('/').includes('data-theme="dusk"'), 'site.theme.id reflects active theme');
});

test('farm mode (symlinks, dev): identical output to virtual mode', async () => {
  const farm = await buildMini({ layoutMode: 'farm' });
  assert.strictEqual(farm.get('/404.html'), pages.get('/404.html'), '404 byte-identical');
  assert.strictEqual(farm.get('/pricing/'), pages.get('/pricing/'), 'pricing byte-identical');
  const link = path.join(SPIKE, '.omega', 'layout-farm', 'core', 'base.html');
  assert.ok(fs.lstatSync(link).isSymbolicLink(), 'farm is symlinks, not copies');
});
