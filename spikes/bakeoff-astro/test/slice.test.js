/**
 * A1 slice invariants against the shared mini-site fixture — the same
 * checklist the Eleventy candidate proves: layered layouts, layout chaining,
 * default pages + consumer suppression, resolved deep-merge, frontmatter
 * Liquid, Jekyll conventions, blog + taxonomy, pricing math, template-kit
 * (direct imports) inside .astro components.
 *
 * Each build is a REAL `astro build` (programmatic) — slower than Eleventy's
 * toJSON harness; that difference is itself bake-off data.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test, before } = require('node:test');

const SPIKE = path.resolve(__dirname, '..');
const MINI = path.resolve(SPIKE, '..', 'bakeoff-shared', 'fixtures', 'mini-site');

const TEST_MANIFEST = {
  js: { signin: '/assets/js/pages/signin-TEST.js' },
  css: { theme: '/assets/css/theme-TEST.css' },
};

/**
 * Run astro build over the mini site and index the output by URL.
 * @param {string} name - unique out-dir name per build
 * @param {object} [env] - extra env (OMEGA_THEME, …)
 * @returns {Promise<Map<string, string>>} url → rendered HTML
 */
async function buildMini(name, env = {}) {
  const outDir = path.join(SPIKE, '.omega', `test-out-${name}`);

  // Fresh content-layer store: the persisted store is keyed by project, not
  // by consumer dir — stale corpus entries would leak into the fixture build
  fs.rmSync(path.join(SPIKE, '.astro'), { recursive: true, force: true });
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(SPIKE, '.omega'), { recursive: true });
  fs.writeFileSync(path.join(SPIKE, '.omega', 'asset-manifest.json'), JSON.stringify(TEST_MANIFEST));

  process.env.ASTRO_TELEMETRY_DISABLED = '1';
  process.env.OMEGA_CONSUMER = MINI;
  delete process.env.OMEGA_THEME;
  Object.assign(process.env, env);

  const { build } = require('astro');
  await build({ root: SPIKE, outDir, logLevel: 'error' });

  const pages = new Map();
  for (const entry of fs.readdirSync(outDir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.html')) continue;
    const rel = path.relative(outDir, path.join(entry.parentPath, entry.name));
    const url = rel === '404.html' ? '/404.html' : `/${rel.replace(/index\.html$/, '')}`;
    pages.set(url, fs.readFileSync(path.join(outDir, rel), 'utf8'));
  }
  return pages;
}

let pages;
before(async () => {
  pages = await buildMini('classy');
});

test('theme-base bracket layout normalizes and renders the full chrome chain', () => {
  const html = pages.get('/');
  assert.ok(html.includes('data-theme="classy"'), 'core/base chrome present');
  assert.ok(html.includes('class="site-header'), 'header component rendered');
  assert.ok(html.includes('Grow faster with MiniCo'), 'body Liquid rendered against site global');
  assert.ok(html.includes('<title>MiniCo - Home of Mini</title>'), 'frontmatter {{ site.meta.title }} rendered');
});

test('frontmatter-only override page: consumer data over layout defaults (deep merge)', () => {
  const html = pages.get('/about/');
  assert.ok(html.includes('>MiniCo</p>'), 'consumer hero.tagline ({{ site.brand.name }}) rendered');
  assert.ok(html.includes('The consumer about page'), 'consumer hero.headline wins');
  assert.ok(html.includes('Get started'), 'layout-only hero.cta survives the deep merge');
  assert.ok(html.includes('<title>About - MiniCo</title>'), 'frontmatter Liquid in meta.title');
  assert.ok(html.includes('Consumer body content'), 'markdown body rendered');
});

test('consumer about.md SUPPRESSES the framework default about page', () => {
  assert.ok(!pages.get('/about/').includes('DEFAULT ABOUT PAGE'), 'default about must not leak');
});

test('default pages render when the consumer has no same-URL file', () => {
  const signin = pages.get('/signin/');
  assert.ok(signin.includes('data-form-manager="signin"'), 'signin form present');
  assert.ok(signin.includes('<title>Sign in - MiniCo</title>'), 'default page frontmatter Liquid rendered');
  assert.ok(signin.includes('/assets/js/pages/signin-TEST.js'), 'pageModule script from asset manifest');
  assert.ok(pages.get('/signup/').includes('data-form-manager="signup"'), 'signup default');
  assert.ok(pages.get('/404.html').includes('classy-404'), '404 default at literal /404.html');
});

test('pricing: layout plan defaults + resolve-plan math', () => {
  const html = pages.get('/pricing/');
  assert.ok(html.includes('data-plan="basic"') && html.includes('data-plan="enterprise"'), 'plans from LAYOUT defaults');
  assert.ok(html.includes('$8/mo billed annually'), 'annual per-month math (96/12)');
  assert.ok(html.includes('save 33%'), 'savings percent math ((144-96)/144)');
  assert.ok(html.includes('Basic'), 'ujTitleCase on plan name');
});

test('posts: Jekyll filename convention, readtime, taxonomy links', () => {
  const html = pages.get('/blog/first-post/');
  assert.ok(html, 'date stripped from URL (filename slug)');
  assert.ok(html.includes('First post'), 'post.title');
  assert.ok(html.includes('By Jane Doe'), 'ujTitleCase on author');
  assert.ok(html.includes('January 15, 2024'), 'date parsed from filename');
  assert.ok(/[1-9]\d* min read/.test(html), 'uj_readtime over rendered content');
  assert.ok(html.includes('href="/blog/category/growth/"'), 'category link slugified');
  assert.ok(html.includes('href="/blog/tag/growth-hacks/"'), 'tag link');
});

test('blog index (injected route): pagination + ujCommaify post count', () => {
  const html = pages.get('/blog/');
  assert.ok(html.includes('First post') && html.includes('Second post'), 'both posts listed');
  assert.ok(html.includes('(2 posts)'), 'ujCommaify count');
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

test('template-kit media tags render via direct import (uj_icon)', () => {
  assert.ok(pages.get('/').includes('data-icon="rocket"'), 'header brand icon');
});

test('asset manifest wiring: theme css + page-module script in head', () => {
  assert.ok(pages.get('/').includes('/assets/css/theme-TEST.css'), 'theme css from manifest');
  assert.ok(!pages.get('/').includes('signin-TEST.js'), 'no page module without pageModule key');
});

test('dusk theme: layered overrides win, classy fills the gaps', async () => {
  const dusk = await buildMini('dusk', { OMEGA_THEME: 'dusk' });
  assert.ok(dusk.get('/404.html').includes('dusk-404'), 'dusk layout override wins');
  assert.ok(dusk.get('/').includes('omega-theme') && dusk.get('/').includes('content="dusk"'), 'dusk head component wins');
  assert.ok(dusk.get('/pricing/').includes('data-plan="basic"'), 'classy pricing layout fills the gap');
  assert.ok(dusk.get('/').includes('data-theme="dusk"'), 'site.theme.id reflects active theme');
});
