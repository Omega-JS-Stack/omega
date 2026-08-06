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
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { servedUrl, findPermalinkCollisions } = require('../src/consumer-scan.js');
const { configureOmega } = require('../src/index.js');

const collisionsOf = (input) => findPermalinkCollisions(input).map((collision) => ({
  url: collision.url,
  claims: collision.claims.map((claim) => claim.label).sort(),
}));

test('servedUrl: the URL a permalink is actually served at', () => {
  assert.equal(servedUrl('/about'), '/about');
  assert.equal(servedUrl('/about.html'), '/about', 'the engine strips .html from every rendered URL');
  assert.equal(servedUrl('/about/'), '/about');
  assert.equal(servedUrl('/blog/index.html'), '/blog', 'an index output collapses to its directory');
  assert.equal(servedUrl('/'), '/');
  assert.equal(servedUrl('/index.html'), '/');
});

test('two consumer pages claiming one URL collide', () => {
  assert.deepEqual(collisionsOf({
    pages: [
      { label: 'pages/about.md', url: '/about' },
      { label: 'pages/company/about.md', url: '/about/' },
    ],
    framework: [],
  }), [{ url: '/about', claims: ['pages/about.md', 'pages/company/about.md'] }]);
});

test('consumer pages at distinct URLs never collide', () => {
  assert.deepEqual(collisionsOf({
    pages: [
      { label: 'pages/about.md', url: '/about' },
      { label: 'pages/contact.md', url: '/contact' },
    ],
    framework: [{ label: 'defaults/pages/pricing.md', url: '/pricing' }],
  }), []);
});

test('a consumer page overriding a default page at the same permalink is not a collision', () => {
  assert.deepEqual(collisionsOf({
    pages: [{ label: 'pages/about.md', url: '/about' }],
    framework: [{ label: 'defaults/pages/about.md', url: '/about' }],
  }), [], 'suppression IS the override mechanism — the default page never renders');
});

test('a consumer page landing on a default page URL by a different spelling collides', () => {
  assert.deepEqual(collisionsOf({
    pages: [{ label: 'pages/about.md', url: '/about' }],
    framework: [{ label: 'defaults/pages/about.md', url: '/about.html' }],
  }), [{ url: '/about', claims: ['defaults/pages/about.md', 'pages/about.md'] }],
  'the permalinks differ, so suppression never fires — both files ship the same page');
});

test('a suppressed default page is not re-reported against a second consumer claim', () => {
  assert.deepEqual(collisionsOf({
    pages: [
      { label: 'pages/about.md', url: '/about' },
      { label: 'pages/company/about.md', url: '/about.html' },
    ],
    framework: [{ label: 'defaults/pages/about.md', url: '/about' }],
  }), [{ url: '/about', claims: ['pages/about.md', 'pages/company/about.md'] }],
  'the default page is suppressed by the exact-match claim — the two consumer pages are the collision');
});

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
const stubConfig = () => ({
  addWatchTarget: noop, setLiquidOptions: noop, setIncludesDirectory: noop, amendLibrary: noop,
  addGlobalData: noop, addPreprocessor: noop, addFilter: noop, addUrlTransform: noop,
  addTransform: noop, addTemplate: noop, addCollection: noop, on: noop, ignores: new Set(),
});

const configure = (fixture, environment) => configureOmega(stubConfig(), {
  consumerDir: fixture.consumerDir,
  siteData: SITE_DATA,
  themesDir: fixture.themesDir,
  coreDir: fixture.coreDir,
  defaultsDir: fixture.defaultsDir,
  environment,
  assetManifest: { js: { pages: {} }, css: { pages: {}, themePages: {} } },
});

test('a production build dies on a collision the config scan found', (t) => {
  const fixture = app(t, {
    'pages/about.md': '---\npermalink: /about\n---\nabout',
    'pages/company/about.md': '---\npermalink: /about/\n---\nabout',
  });

  assert.throws(() => configure(fixture, 'production'), /Permalink collision at \/about/);
});

test('the same brand builds in dev — loud, not fatal', (t) => {
  const fixture = app(t, {
    'pages/about.md': '---\npermalink: /about\n---\nabout',
    'pages/company/about.md': '---\npermalink: /about/\n---\nabout',
  });

  assert.doesNotThrow(() => configure(fixture, 'development'),
    'a dev server keeps serving — the diagnostic is how the brand learns about it');
});

test('a clean brand never trips the check, and the default page it overrides is suppressed', (t) => {
  const fixture = app(t, { 'pages/about.md': '---\npermalink: /about.html\n---\nabout' });

  assert.deepEqual(configure(fixture, 'production').suppressed, ['/about.html'],
    'the exact permalink is the override — the default page steps aside, silently');
});
