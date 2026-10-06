/**
 * Permalink collisions (#200 Lane B). Two files cannot own one URL — but the
 * framework SUPPRESSES a default page whose permalink a consumer page claims,
 * which is the intended override and must never read as a collision. What is
 * left is real: two consumer pages claiming one URL, and a consumer page that
 * lands on a default page's URL by a DIFFERENT spelling (`/about` vs
 * `/about.html`), where suppression never fires and both files ship the same
 * page.
 *
 * Detection is pure (this file); the diagnostic itself — loud in dev, a build
 * failure in production — is decisions.test.js.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');

const { servedUrl, findPermalinkCollisions } = require('../src/consumer-scan.js');
const { configureOmega } = require('../src/index.js');

const collisionsOf = (input) => findPermalinkCollisions(input).map((collision) => ({
  url: collision.url,
  claims: collision.claims.map((claim) => claim.label).sort(),
}));

// ---- Through the engine: a collision found at config time is a diagnostic in
// dev and a dead build in production.

const SITE_DATA = {
  url: 'http://localhost:4000',
  brand: { id: 'clash', name: 'ClashCo' },
  meta: { title: 'ClashCo', description: 'Collision test brand' },
};

// A consumer app whose pages collide, over a packaged tree with one default
// page — the whole collision surface, nothing else.
function app(t, pages) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-collide-')));
  const packaged = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-collide-pkg-')));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(packaged, { recursive: true, force: true });
  });

  for (const [relative, contents] of Object.entries(pages)) {
    const abs = path.join(root, 'src', relative);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents);
  }
  fs.mkdirSync(path.join(packaged, 'themes', 'classy'), { recursive: true });
  fs.mkdirSync(path.join(packaged, 'defaults', 'showcase'), { recursive: true });
  for (const set of ['sample-posts', 'sample-team', 'sample-updates']) {
    fs.mkdirSync(path.join(packaged, 'defaults', set), { recursive: true });
  }
  const defaultPage = path.join(packaged, 'defaults', 'pages', 'about.html');
  fs.mkdirSync(path.dirname(defaultPage), { recursive: true });
  fs.writeFileSync(defaultPage, '---\npermalink: /about.html\n---\n<p>default about</p>');

  return {
    consumerDir: path.join(root, 'src'),
    themesDir: path.join(packaged, 'themes'),
    coreDir: path.join(packaged, 'core'),
    defaultsDir: path.join(packaged, 'defaults'),
  };
}

const noop = () => {};
const stubConfig = () => {
  const config = {
    addWatchTarget: noop, setLiquidOptions: noop, setIncludesDirectory: noop, amendLibrary: noop,
    addGlobalData: noop, addPreprocessor: noop, addFilter: noop, addUrlTransform: noop,
    addTransform: noop, addTemplate: noop, addCollection: noop, on: noop, ignores: new Set(),
    // Eleventy hands a function plugin the config itself (#488's slugifier).
    addPlugin: (plugin, ...args) => plugin(config, ...args),
  };
  return config;
};

const configure = (fixture, environment) => configureOmega(stubConfig(), {
  consumerDir: fixture.consumerDir,
  siteData: SITE_DATA,
  themesDir: fixture.themesDir,
  coreDir: fixture.coreDir,
  defaultsDir: fixture.defaultsDir,
  environment,
  assetManifest: { js: { pages: {} }, css: { pages: {}, layouts: {} } },
});

module.exports = defineCases({
  type: 'group',
  description: 'permalink-collisions',
  tests: [
    {
      name: 'servedUrl: the URL a permalink is actually served at',
      run: (ctx) => {
        ctx.expect(servedUrl('/about')).toBe('/about');
        ctx.expect(servedUrl('/about.html'), 'the engine strips .html from every rendered URL').toBe('/about');
        ctx.expect(servedUrl('/about/')).toBe('/about');
        ctx.expect(servedUrl('/blog/index.html'), 'an index output collapses to its directory').toBe('/blog');
        ctx.expect(servedUrl('/')).toBe('/');
        ctx.expect(servedUrl('/index.html')).toBe('/');
      },
    },

    {
      name: 'two consumer pages claiming one URL collide',
      run: (ctx) => {
        ctx.expect(collisionsOf({
          pages: [
            { label: 'pages/about.md', url: '/about' },
            { label: 'pages/company/about.md', url: '/about/' },
          ],
          framework: [],
        })).toEqual([{ url: '/about', claims: ['pages/about.md', 'pages/company/about.md'] }]);
      },
    },

    {
      name: 'consumer pages at distinct URLs never collide',
      run: (ctx) => {
        ctx.expect(collisionsOf({
          pages: [
            { label: 'pages/about.md', url: '/about' },
            { label: 'pages/contact.md', url: '/contact' },
          ],
          framework: [{ label: 'defaults/pages/pricing.md', url: '/pricing' }],
        })).toEqual([]);
      },
    },

    {
      name: 'a consumer page overriding a default page at the same permalink is not a collision',
      run: (ctx) => {
        ctx.expect(collisionsOf({
          pages: [{ label: 'pages/about.md', url: '/about' }],
          framework: [{ label: 'defaults/pages/about.md', url: '/about' }],
        }), 'suppression IS the override mechanism — the default page never renders').toEqual([]);
      },
    },

    {
      name: 'a consumer page landing on a default page URL by a different spelling collides',
      run: (ctx) => {
        ctx.expect(collisionsOf({
          pages: [{ label: 'pages/about.md', url: '/about' }],
          framework: [{ label: 'defaults/pages/about.md', url: '/about.html' }],
        }), 'the permalinks differ, so suppression never fires — both files ship the same page').toEqual([{ url: '/about', claims: ['defaults/pages/about.md', 'pages/about.md'] }]);
      },
    },

    {
      name: 'a suppressed default page is not re-reported against a second consumer claim',
      run: (ctx) => {
        ctx.expect(collisionsOf({
          pages: [
            { label: 'pages/about.md', url: '/about' },
            { label: 'pages/company/about.md', url: '/about.html' },
          ],
          framework: [{ label: 'defaults/pages/about.md', url: '/about' }],
        }), 'the default page is suppressed by the exact-match claim — the two consumer pages are the collision').toEqual([{ url: '/about', claims: ['pages/about.md', 'pages/company/about.md'] }]);
      },
    },

    {
      name: 'a production build dies on a collision the config scan found',
      run: (ctx) => {
        const fixture = app(ctx, {
          'pages/about.md': '---\npermalink: /about\n---\nabout',
          'pages/company/about.md': '---\npermalink: /about/\n---\nabout',
        });

        ctx.expect(() => configure(fixture, 'production')).toThrow(/Permalink collision at \/about/);
      },
    },

    {
      name: 'the same brand builds in dev — loud, not fatal',
      run: (ctx) => {
        const fixture = app(ctx, {
          'pages/about.md': '---\npermalink: /about\n---\nabout',
          'pages/company/about.md': '---\npermalink: /about/\n---\nabout',
        });

        ctx.expect(() => configure(fixture, 'development'), 'a dev server keeps serving — the diagnostic is how the brand learns about it').not.toThrow();
      },
    },

    {
      name: 'a clean brand never trips the check, and the default page it overrides is suppressed',
      run: (ctx) => {
        const fixture = app(ctx, { 'pages/about.md': '---\npermalink: /about.html\n---\nabout' });

        ctx.expect(configure(fixture, 'production').suppressed, 'the exact permalink is the override — the default page steps aside, silently').toEqual(['/about.html']);
      },
    },
  ],
});
