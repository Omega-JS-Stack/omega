/**
 * Engine invariants against the mini-site fixture, rendered through the REAL
 * packaged content (B2): layered layouts (virtual AND farm), the blueprint →
 * theme dispatch chain, default pages + consumer suppression, resolved
 * deep-merge (site seed + layout chain + page), frontmatter Liquid, Jekyll
 * conventions, blog + taxonomy generators, and template-kit tags inside
 * Eleventy.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test, before } = require('node:test');
const { configureOmega } = require('../src/index.js');

const PKG = path.resolve(__dirname, '..');
const MINI = path.join(__dirname, 'fixtures', 'mini-site');
const siteData = JSON.parse(fs.readFileSync(path.join(MINI, 'site-data.json'), 'utf8'));

/**
 * Run Eleventy programmatically over the mini site and index results by URL.
 * @param {object} [overrides] - configureOmega option overrides
 * @returns {Promise<Map<string, string>>} url → rendered content
 */
async function buildMini(overrides = {}) {
  const Eleventy = require('@11ty/eleventy').default;
  const elev = new Eleventy(MINI, path.join(PKG, '.omega', 'test-out'), {
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
        farmDir: path.join(PKG, '.omega', 'layout-farm'),
        assetManifest: {
          js: { main: '/assets/js/main-TEST.js', pages: { 'signin/index': '/assets/js/pages/signin/index-TEST.js' } },
          css: { main: '/assets/css/main-TEST.css', pages: {}, themePages: {} },
          favicons: true,
        },
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

test('theme-base bracket layout aliases into the real chain (root → classy base)', () => {
  const html = pages.get('/');
  assert.ok(html.includes('data-theme-id="classy"'), 'core/root chrome present with active theme id');
  assert.ok(html.includes('<nav class="navbar'), 'classy nav include rendered');
  assert.ok(html.includes('Grow faster with MiniCo'), 'body Liquid rendered against site global');
  assert.ok(html.includes('<title>MiniCo - Home of Mini</title>'), 'frontmatter {{ site.meta.title }} rendered');
});

test('frontmatter-only override page: consumer data over layout defaults (deep merge)', () => {
  const html = pages.get('/about');
  assert.ok(html.includes('The consumer about page'), 'consumer hero.headline wins');
  assert.ok(html.includes('success'), 'layout-only hero.headline_accent survives the deep merge');
  assert.ok(html.includes('<title>About - MiniCo</title>'), 'frontmatter Liquid in meta.title');
  assert.ok(html.includes('Consumer body content'), 'markdown body rendered');
});

test('site-wide defaults layer: root directory data beats layout frontmatter, loses to page frontmatter', () => {
  // mini-site.11tydata.json — Eleventy's root directory data file is the
  // consumer's ONE-PLACE site-wide override for layout sample content: it sits
  // ABOVE layout frontmatter and BELOW each page's own frontmatter — the same
  // layer jekyll-uj-powertools 1.8.1 gave Jekyll sites via _config.yml
  // `defaults:` (the N4 parked verify this test closes).
  const html = pages.get('/about');
  assert.ok(html.includes('Site-wide directory-data override'), 'directory data replaces layout hero.description site-wide');
  assert.ok(!html.includes('AI automation for modern businesses'), 'layout sample content loses');
  assert.ok(html.includes('<title>About - MiniCo</title>'), 'page frontmatter still beats directory data (meta.title)');
  assert.ok(html.includes('success'), 'sibling layout keys survive the deep merge (hero.headline_accent)');
});

test('consumer about.md SUPPRESSES the framework default about page', () => {
  const html = pages.get('/about');
  // The default about page dispatches blueprint/about → classy about layout
  // (hero "About us"); the consumer page uses blueprint/index — if the
  // default leaked, both would target /about and the classy-about hero
  // would render.
  assert.ok(!html.includes('headline_accent">us<'), 'default about must not leak');
});

test('default pages render when the consumer has no same-URL file', () => {
  const signin = pages.get('/signin');
  assert.ok(signin.includes('id="auth-form"'), 'real classy signin form present');
  assert.ok(signin.includes('/assets/js/pages/signin/index-TEST.js'), 'pageAssets script from the manifest');
  assert.ok(pages.get('/signup').includes('id="auth-form"'), 'signup default');
  assert.ok(pages.get('/404').includes('id="page-url"'), '404 default (flat url, 404.html file)');
});

test('zero-page consumer still gets a homepage at / (cp194 wizard-rehearsal catch)', async () => {
  // A wizard-born brand has NO consumer pages at all — the first thing its
  // owner sees must be the branded default homepage, not a 404. (The mini
  // fixture owns /, so the suite's first test doubles as the suppression pin.)
  const os = require('node:os');
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-bare-site-'));
  try {
    const Eleventy = require('@11ty/eleventy').default;
    const elev = new Eleventy(bare, path.join(PKG, '.omega', 'test-out-bare'), {
      quietMode: true,
      configPath: false,
      config: (eleventyConfig) => {
        eleventyConfig.setUseTemplateCache(false);
        return configureOmega(eleventyConfig, {
          consumerDir: bare,
          siteData,
          farmDir: path.join(PKG, '.omega', 'layout-farm'),
          assetManifest: {
            js: { main: '/assets/js/main-TEST.js', pages: {} },
            css: { main: '/assets/css/main-TEST.css', pages: {}, themePages: {} },
          },
        });
      },
    });
    const results = await elev.toJSON();
    const home = results.find((r) => r.url === '/');
    assert.ok(home, 'default homepage exists at /');
    assert.ok(home.content.includes('MiniCo'), 'homepage branded from site config');
    assert.ok(home.content.includes('data-theme-id="classy"'), 'rides the active theme');
    // No minted favicon set → the head renders zero dangling favicon links
    assert.ok(!home.content.includes('site.webmanifest'), 'no manifest link without a favicon set');
    assert.ok(!home.content.includes('favicon-32x32'), 'no icon links without a favicon set');
    // …while the mini build (favicons: true) carries the full set
    assert.ok(pages.get('/').includes('site.webmanifest'), 'minted set renders the manifest link');
    assert.ok(pages.get('/').includes('favicon-32x32'), 'minted set renders the icon links');
  } finally {
    fs.rmSync(bare, { recursive: true, force: true });
  }
});

test('resolved site seed: site sections surface as resolved.* (Configuration block)', () => {
  const html = pages.get('/');
  assert.ok(html.includes('brand: {"id":"mini","name":"MiniCo"'), 'resolved.brand jsonified from site seed');
  assert.ok(html.includes('recaptcha: null'), 'absent sections emit null (valid JS), not empty');
  assert.ok(html.includes('src="/assets/js/main-TEST.js"'), 'main bundle from the manifest');
});

test('pricing: template-default hero copy renders (layout frontmatter knobs are gone)', () => {
  const html = pages.get('/pricing');
  assert.ok(html.includes('The right plans,'), 'classy pricing hero default');
  assert.ok(html.includes('for the right price'), 'hero accent');
});

test('posts: Jekyll filename convention, readtime, taxonomy links', () => {
  const html = pages.get('/blog/first-post');
  assert.ok(html, 'date stripped from URL (fileSlug)');
  assert.ok(html.includes('First post'), 'post.title');
  assert.ok(/[1-9]\d* min read/.test(html), 'uj_readtime');
  assert.ok(html.includes('/blog/tags/growth-hacks'), 'tag link slugified (real /tags/ URLs)');
});

test('blog index: paginator compat over Eleventy pagination', () => {
  const html = pages.get('/blog');
  assert.ok(html.includes('First post') && html.includes('Second post'), 'both posts listed via paginator.posts');
});

test('taxonomy pages generated from post.categories / post.tags', () => {
  const growth = pages.get('/blog/categories/growth');
  assert.ok(growth.includes('First post') && growth.includes('Second post'), 'category aggregates');
  const marketing = pages.get('/blog/categories/marketing');
  assert.ok(marketing.includes('Second post') && !marketing.includes('First post'), 'category filters');
  assert.ok(pages.get('/blog/tags/automation').includes('Second post'), 'tag page');
});

test('alternatives collection: permalink convention + comparison content', () => {
  const html = pages.get('/alternatives/acme-growth');
  assert.ok(html.includes('MiniCo vs'), 'site brand in the layout-default hero headline');
  assert.ok(html.includes('Acme Growth'), 'competitor name via resolved-templated layout defaults');
  assert.ok(html.includes('Automation depth'), 'comparison rows');
  // resolved refs in layout FRONTMATTER VALUES are per-page: the hero accent
  // is `{{ resolved.alternative.competitor.name }}` in alternative.html's
  // frontmatter — it must render THIS page's competitor, not empty/cached.
  assert.ok(html.includes('<em>Acme Growth</em>'), 'resolved-ref frontmatter value renders per page (hero accent)');
  assert.ok(html.includes('Looking for a Acme Growth alternative'), 'resolved-ref inside a longer frontmatter value');
});

test('cover layout: page-level theme.main.align templates into main via resolved', () => {
  // checkout asks for top alignment (theme.main.align: start); the cover
  // layout's class template `align-items-{{ resolved.theme.main.align |
  // default: 'center' }}` must see the page's merged value…
  assert.ok(/<main[^>]*align-items-start/.test(pages.get('/payment/checkout')), 'checkout main is top-aligned');
  // …while pages that set no align keep the cover default.
  assert.ok(/<main[^>]*align-items-center/.test(pages.get('/signin')), 'signin main stays centered');
});

test('signed-in URL scheme: user app under /dashboard, staff app rooted at /admin', () => {
  // the account page is a page IN the user app: app shell + its rail contract
  const account = pages.get('/dashboard/account');
  assert.ok(account, 'account serves at /dashboard/account');
  assert.ok(account.includes('omega-shell'), 'account wears the app shell');
  assert.ok(account.includes('id="account-nav"'), 'section rail contract intact');
  // cp183: the account interior speaks the admin dialect — the rail reuses
  // the shell sidebar recipe, sections open with the page-header anatomy,
  // cards wear admin caps, and the marketing serif voice is gone.
  assert.ok(account.includes('classy-side__item'), 'rail speaks the shell sidebar dialect');
  assert.ok(account.includes('page-title'), 'sections open with the admin page-header anatomy');
  assert.ok(account.includes('card-header'), 'cards wear admin caps');
  assert.ok(!account.includes('classy-display--section'), 'marketing display voice does not leak into the app');
  // cp185: one skeleton on every section — the rail/content row fills the
  // panel and the rail column draws its full-height lane divider (the rail
  // box must not track whichever column happens to be tallest).
  assert.ok(account.includes('row flex-grow-1'), 'the rail/content row fills the panel');
  assert.ok(/col-lg-3[^"]*hairline-end/.test(account), 'the rail draws its full-height lane divider');
  // the staff overview serves AT its root
  const admin = pages.get('/admin');
  assert.ok(admin && admin.includes('omega-shell'), 'admin overview serves at /admin');
  assert.ok(admin.includes('id="stat-total-users"'), 'overview content present (stat cards)');
  // permanent redirects keep every old link alive (module reads data-url)
  assert.ok(pages.get('/account').includes('data-url="/dashboard/account"'), '/account redirects to the new home');
  assert.ok(pages.get('/dashboard').includes('data-url="/dashboard/account"'), 'default /dashboard forwards to account (brand homepage suppresses)');
  assert.ok(pages.get('/admin/dashboard').includes('data-url="/admin"'), '/admin/dashboard redirects to the root overview');
});

test('template-kit tags render inside Eleventy (uj_icon, urlmatches nav)', () => {
  assert.ok(pages.get('/').includes('data-icon='), 'uj_icon SVGs render');
  assert.ok(pages.get('/').includes('navbar'), 'nav include renders from the packaged nav.json data');
});

test('neobrutalism theme: layered overrides win, classy fills the gaps', async () => {
  const neo = await buildMini({ activeTheme: 'neobrutalism' });
  assert.ok(neo.get('/').includes('data-theme-id="neobrutalism"'), 'site.theme.id reflects active theme');
  assert.ok(neo.get('/pricing').includes('pricing-title'), 'neobrutalism pricing layout override wins (neo-only markup)');
  assert.ok(neo.get('/signin').includes('id="auth-form"'), 'classy signin fills the gap');
});

test('farm mode (symlinks, dev): identical output to virtual mode', async () => {
  const farm = await buildMini({ layoutMode: 'farm' });
  assert.strictEqual(farm.get('/404.html'), pages.get('/404.html'), '404 byte-identical');
  assert.strictEqual(farm.get('/pricing'), pages.get('/pricing'), 'pricing byte-identical');
  const link = path.join(PKG, '.omega', 'layout-farm', 'frontend', 'core', 'base.html');
  assert.ok(fs.lstatSync(link).isSymbolicLink(), 'farm is symlinks, not copies');
});

test('dev chrome (N7): jekyll.dev is null by default, the resolved ports map when omega dev injects it', async () => {
  assert.ok(pages.get('/').includes('dev: null,'), 'default builds carry no dev map (client falls back to classics)');

  const dev = await buildMini({ environment: 'development', dev: { ports: { website: 4001, hosting: 5003 } } });
  const html = dev.get('/');
  assert.ok(html.includes('environment: "development"'), 'dev environment in the chrome');
  assert.ok(html.includes('"website":4001'), 'resolved website port baked into the Configuration chrome');
  assert.ok(html.includes('"hosting":5003'), 'sibling emulator ports ride along');
});
