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
          js: {
            main: '/assets/js/main-TEST.js',
            // One key, every layer's bundle, in load order (#624)
            pages: {
              'signin/index': ['/assets/js/pages/signin/index-CORE.js', '/assets/js/pages/signin/index.classy-THEME.js', '/assets/js/pages/signin/index.site-TEST.js'],
              'blog/[slug]': ['/assets/js/pages/blog/[slug]-TEST.js'],
            },
            layouts: {},
          },
          css: {
            main: '/assets/css/main-TEST.css',
            pages: { 'signin/index': [{ href: '/assets/css/pages/signin/index-CORE.css' }, { href: '/assets/css/pages/signin/index.classy-THEME.css' }] },
            layouts: {},
          },
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

test('plain layout name resolves through the real chain (root → classy base)', () => {
  const html = pages.get('/');
  assert.ok(html.includes('data-theme-id="classy"'), 'core/root chrome present with active theme id');
  assert.ok(html.includes('<nav class="navbar'), 'classy nav include rendered');
  assert.ok(html.includes('Grow faster with MiniCo'), 'body Liquid rendered against site global');
  assert.ok(html.includes('<title>MiniCo - Home of Mini</title>'), 'frontmatter {{ site.meta.title }} rendered');
});

test('a bracket layout value no longer resolves — the build fails loudly (#148)', async () => {
  // The alias table that accepted `themes/[ site.theme.id ]/…` spellings is
  // gone: plain layout names are the one form, and the migrate codemod
  // (`omega migrate`, bracket-layout rule) is the sanctioned converter.
  const os = require('node:os');
  const legacy = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-bracket-site-'));
  try {
    fs.mkdirSync(path.join(legacy, 'pages'), { recursive: true });
    fs.writeFileSync(
      path.join(legacy, 'pages', 'index.html'),
      '---\nlayout: themes/[ site.theme.id ]/frontend/core/base\npermalink: /\n---\n<p>legacy</p>\n',
    );

    const Eleventy = require('@11ty/eleventy').default;
    const elev = new Eleventy(legacy, path.join(PKG, '.omega', 'test-out-bracket'), {
      quietMode: true,
      configPath: false,
      config: (eleventyConfig) => {
        eleventyConfig.setUseTemplateCache(false);
        return configureOmega(eleventyConfig, {
          consumerDir: legacy,
          siteData,
          farmDir: path.join(PKG, '.omega', 'layout-farm'),
          assetManifest: {
            js: { main: '/assets/js/main-TEST.js', pages: {} },
            css: { main: '/assets/css/main-TEST.css', pages: {}, layouts: {} },
          },
        });
      },
    });

    await assert.rejects(() => elev.toJSON(), /Problem creating an Eleventy Layout/);
  } finally {
    fs.rmSync(legacy, { recursive: true, force: true });
  }
});

test('meta-only page: layout voice renders, meta consumed (no content lane)', () => {
  const html = pages.get('/about');
  // The 2026-07-19 rule: page frontmatter carries NO content — the layout's
  // own composition voice renders (same hero as '/', which shares the
  // blueprint), and meta.title is the surviving frontmatter lane. The page
  // writes no body, because a body REPLACES that composition and #607 deleted
  // the `append:` flag that used to keep both (the guard test owns the
  // rejection side; customize.test.js owns the replace lane).
  assert.ok(html.includes('The platform for'), 'section-default hero.headline renders — no consumer override lane');
  assert.ok(html.includes('Site-wide directory-data override'), 'directory data (the surviving site-wide lane) still feeds the band');
  assert.ok(html.includes('<title>About - MiniCo</title>'), 'frontmatter Liquid in meta.title (the sanctioned lane)');
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
  // default leaked, both would target /about and the omega-about hero
  // would render.
  assert.ok(!html.includes('headline_accent">us<'), 'default about must not leak');
});

test('default pages render when the consumer has no same-URL file', () => {
  const signin = pages.get('/signin');
  assert.ok(signin.includes('id="auth-form"'), 'real classy signin form present');
  assert.ok(signin.includes('/assets/js/pages/signin/index.site-TEST.js'), 'pageAssets script from the manifest');
  assert.ok(pages.get('/signup').includes('id="auth-form"'), 'signup default');
  assert.ok(pages.get('/404').includes('id="page-url"'), '404 default (flat url, 404.html file)');
});

// #624 — the ONE rule reaches the markup: the page links every layer's asset
// for its URL, in LOAD order, which for module scripts IS execution order and
// for stylesheets IS the cascade.
test('#624: every layer\'s page asset is emitted, in layer order', () => {
  const signin = pages.get('/signin');

  const at = (url) => {
    const index = signin.indexOf(url);
    assert.notStrictEqual(index, -1, `${url} is on the page`);
    return index;
  };

  const main = at('/assets/js/main-TEST.js');
  const core = at('/assets/js/pages/signin/index-CORE.js');
  const theme = at('/assets/js/pages/signin/index.classy-THEME.js');
  const consumer = at('/assets/js/pages/signin/index.site-TEST.js');
  assert.ok(main < core && core < theme && theme < consumer, 'main, then core, then the theme, then the consumer');

  const mainCss = at('/assets/css/main-TEST.css');
  const coreCss = at('/assets/css/pages/signin/index-CORE.css');
  const themeCss = at('/assets/css/pages/signin/index.classy-THEME.css');
  assert.ok(mainCss < coreCss && coreCss < themeCss, 'the sheets follow the same order — the theme wins the cascade by loading last');
});

test('wildcard page modules emit for every URL in the family (spec §7, asset_path is dead)', () => {
  // Every sample post URL rides the ONE blog/[slug] manifest entry — resolved
  // from the URL alone at render time, emitted verbatim (brackets included).
  // (`[^/.]+` keeps the blog's machine file, /blog/index.json, out of the family)
  const posts = [...pages.keys()].filter((url) => /^\/blog\/[^/.]+$/.test(url) && !url.includes('page'));
  assert.ok(posts.length >= 3, `sample posts rendered (${posts.length})`);
  for (const url of posts) {
    assert.ok(pages.get(url).includes('/assets/js/pages/blog/[slug]-TEST.js'), `${url} links the wildcard module`);
  }
  // …and the family boundary holds: the blog LIST page never matches [slug]
  assert.ok(!pages.get('/blog').includes('[slug]-TEST.js'), 'the list page does not match the wildcard');
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
            css: { main: '/assets/css/main-TEST.css', pages: {}, layouts: {} },
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
  assert.ok(html.includes('captcha: null'), 'absent sections emit null (valid JS), not empty');
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
  assert.ok(/[1-9]\d* min read/.test(html), 'omega_readtime');
  assert.ok(html.includes('/blog/tags/growth-hacks'), 'tag link slugified (real /tags/ URLs)');
});

test('blog index: paginator compat over Eleventy pagination', () => {
  const html = pages.get('/blog');
  assert.ok(html.includes('First post') && html.includes('Second post'), 'both posts listed via paginator.posts');
});

test('#598: the blog hub featured card reads the post\'s REAL read time', () => {
  // The featured slot does not go through post-card.html, and the flattened
  // Jekyll doc it renders from carried no `content` — so the hub printed
  // "1 min read" for a long post while the post's own page printed the truth.
  const hub = pages.get('/blog');
  const start = hub.indexOf('<article class="omega-featured-post');
  assert.ok(start > -1, 'page 1 leads with the featured card');
  const card = hub.slice(start, hub.indexOf('</article>', start));

  assert.ok(card.includes('Second post'), 'the newest post is the feature');
  const onCard = (card.match(/(\d+) min read/) || [])[1];
  const onPost = (pages.get('/blog/second-post').match(/(\d+) min read/) || [])[1];

  assert.strictEqual(onPost, '4', 'the fixture post is a 1,012-word read');
  assert.strictEqual(onCard, onPost, 'the hub card agrees with the post page');
});

test('taxonomy pages generated from post.categories / post.tags', () => {
  const growth = pages.get('/blog/categories/growth');
  assert.ok(growth.includes('First post') && growth.includes('Second post'), 'category aggregates');
  const marketing = pages.get('/blog/categories/marketing');
  assert.ok(marketing.includes('Second post') && !marketing.includes('First post'), 'category filters');
  assert.ok(pages.get('/blog/tags/automation').includes('Second post'), 'tag page');
});

test('#504: the root chrome stamps no attribute from a key the schema never had', () => {
  // `data-theme-target` interpolated `resolved.theme.target` — a legacy UJM
  // key the omega schema does not know, read by no CSS selector and no JS. A
  // brand that correctly drops it rendered the attribute empty.
  for (const url of ['/', '/pricing', '/blog/first-post']) {
    assert.ok(!pages.get(url).includes('data-theme-target'), `${url}: the dead attribute is gone`);
  }
  assert.ok(pages.get('/').includes('data-theme-id="classy"'), 'the LIVE theme stamps stay');
});

test('#488: a term with `&` links the slug its own page is generated at', () => {
  // Two slugifiers used to answer this term: Eleventy's universal `slugify`
  // filter (`&` → "and") where posts and the tag cloud LINK it, template-kit's
  // where the taxonomy page is GENERATED. Every term containing `&` shipped a
  // guaranteed dead link, and `omega test`'s own link check failed the build on
  // framework output. ONE slugifier answers both sides now.
  const post = pages.get('/blog/first-post');
  const linked = [...post.matchAll(/href="(\/blog\/tags\/[^"]+)"/g)].map((m) => m[1]);

  assert.ok(linked.includes('/blog/tags/a-r'), `the post links the term at ${linked.join(', ')}`);
  assert.ok(!linked.includes('/blog/tags/a-and-r'), 'no "and" spelling survives on the link side');
  assert.ok(pages.has('/blog/tags/a-r'), 'and that is the page the build wrote');
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
  assert.ok(account.includes('omega-side__item'), 'rail speaks the shell sidebar dialect');
  assert.ok(account.includes('page-title'), 'sections open with the admin page-header anatomy');
  assert.ok(account.includes('card-header'), 'cards wear admin caps');
  assert.ok(!account.includes('omega-display--section'), 'marketing display voice does not leak into the app');
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

test('admin verts card serves at /admin/verts (docs/web/ads-system.md phase 3)', () => {
  const verts = pages.get('/admin/verts');
  assert.ok(verts, 'verts card serves at /admin/verts');
  assert.ok(verts.includes('omega-shell'), 'verts card wears the app shell (admin/core/minimal gate)');
  assert.ok(verts.includes('id="verts-table"'), 'inventory table present');
  assert.ok(verts.includes('id="vert-editor-modal"'), 'create/edit modal present');
  // The editor form covers the verts collection shape (backend docs/verts.md)
  for (const field of ['vert.enabled', 'vert.title', 'vert.description', 'vert.button', 'vert.link', 'vert.image', 'vert.footer', 'vert.weight', 'vert.targeting.sites', 'vert.targeting.categories', 'vert.targeting.keywords', 'vert.whitelist', 'vert.blacklist']) {
    assert.ok(verts.includes(`name="${field}"`), `editor form field ${field}`);
  }
  // Image rides the posts-editor convention: a plain URL field, no upload lane
  assert.ok(/<input type="url"[^>]*name="vert\.image"/.test(verts), 'image is a URL field');
});

test('icons inline and template-kit tags render inside Eleventy (urlmatches nav)', () => {
  assert.ok(pages.get('/').includes('data-omega-fa='), 'native fa-* markup is inlined at build');
  assert.ok(pages.get('/').includes('navbar'), 'nav include renders from the packaged nav.json data');
});

test('neobrutalism theme: layered overrides win, base fills the gaps', async () => {
  const neo = await buildMini({ activeTheme: 'neobrutalism' });
  assert.ok(neo.get('/').includes('data-theme-id="neobrutalism"'), 'site.theme.id reflects active theme');
  // #177 phase 3: the pricing fork is gone. The base page serves (no
  // catalog in the mini fixture → the honest empty state).
  assert.ok(neo.get('/pricing').includes('id="pricing-empty"'), 'neobrutalism pricing falls through to the base page');
  assert.ok(!neo.get('/pricing').includes('pricing-title'), 'no trace of the deleted fork vocabulary');
  assert.ok(neo.get('/signin').includes('id="auth-form"'), 'base signin fills the gap');
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
