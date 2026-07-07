/**
 * Asset-pipeline invariants over LAYER ROOTS (site → theme(s) → core): page
 * modules layered via esbuild boot stubs, the real UJM main bundle (core
 * runtime + dynamic theme import via __theme__), the real @omegajs/client
 * via the web-manager alias (subpaths included), layered sass through
 * omega:theme (per-theme main css + theme page css namespaces), and the
 * PurgeCSS pass stripping unused selectors.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { buildAssets, purgeCss } = require('../src/assets.js');

const PKG = path.resolve(__dirname, '..');
const ROOT = path.resolve(PKG, '..', '..');
const OUT = path.join(PKG, '.omega', 'assets-test-out');

/**
 * Run buildAssets for a theme layer chain.
 * @param {string[]} themeIds
 * @returns {Promise<object>} manifest
 */
function build(themeIds) {
  return buildAssets({
    layers: [
      path.join(__dirname, 'fixtures', 'site-assets'),
      ...themeIds.map((id) => path.join(PKG, 'themes', id)),
      path.join(PKG, 'core'),
    ],
    themesDir: path.join(PKG, 'themes'),
    coreDir: path.join(PKG, 'core'),
    outDir: OUT,
    clientEntry: path.join(ROOT, 'packages', 'client', 'src', 'index.js'),
  });
}

test('layered page modules: site layer wins, core fills the rest, all content-hashed', async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  const manifest = await build(['classy']);

  // Site layer's flat index.js + the real UJM core modules under dir-index keys
  for (const key of ['index', 'pricing/index', 'signin/index', 'signup/index', 'payment/checkout/index', 'blog/post']) {
    assert.ok(manifest.js.pages[key], `manifest has ${key}`);
    assert.match(manifest.js.pages[key], /^\/assets\/js\/pages\/.+-[A-Z0-9]+\.js$/, `${key} is content-hashed`);
  }
  assert.ok(!manifest.js.pages['payment/checkout/modules/api'], 'helper modules are NOT entries');
  assert.ok(!manifest.js.pages['account/sections/billing'], 'section helpers are NOT entries');

  const indexBundle = fs.readFileSync(path.join(OUT, manifest.js.pages.index.slice(1)), 'utf8');
  assert.ok(indexBundle.includes('consumer wins'), 'SITE layer index.js beat the core layer');
});

test('main bundle: real UJM runtime + theme via __theme__ + web-manager subpaths', async () => {
  const manifest = await build(['classy']);
  assert.ok(manifest.js.main, 'main bundle in manifest');

  const mainBundle = fs.readFileSync(path.join(OUT, manifest.js.main.slice(1)), 'utf8');
  assert.ok(mainBundle.includes('Global module loaded successfully'), 'core runtime module bundled');
  assert.ok(mainBundle.includes('Classy theme loaded successfully'), 'active theme _theme.js inlined via __theme__');
  assert.ok(mainBundle.length > 50000, `real runtime is IN the bundle (${mainBundle.length} bytes)`);
});

test('signin bundles the real @omegajs/client via the web-manager alias', async () => {
  const manifest = await build(['classy']);
  const signinBundle = fs.readFileSync(path.join(OUT, manifest.js.pages['signin/index'].slice(1)), 'utf8');
  assert.ok(signinBundle.length > 100000, `client is IN the bundle (${signinBundle.length} bytes)`);
  assert.ok(signinBundle.includes('Email is required'), 'real UJM auth page module code present');
});

test('layered sass: main css compiles per theme through omega:theme', async () => {
  const classy = await build(['classy']);
  const newsflash = await build(['newsflash', 'classy']);

  const classyCss = fs.readFileSync(path.join(OUT, classy.css.main.slice(1)), 'utf8');
  const newsflashCss = fs.readFileSync(path.join(OUT, newsflash.css.main.slice(1)), 'utf8');
  assert.ok(classyCss.includes('#5B47FB') || classyCss.includes('#5b47fb'), 'classy primary in classy build');
  assert.ok(newsflashCss.includes('#F03612') || newsflashCss.includes('#f03612'), 'newsflash primary in newsflash build');
  assert.ok(classyCss.includes('.btn'), 'bootstrap compiled in via the theme config');
  assert.notStrictEqual(classy.css.main, newsflash.css.main, 'content hash differs per theme');

  // Page css namespaces: base pages from core, theme pages from the theme
  assert.ok(classy.css.pages['blog/post'], 'core page css entry (blog/post)');
  assert.ok(newsflash.css.themePages['blog/post'], 'newsflash theme page css for blog/post');
  assert.ok(!classy.css.themePages['blog/post'], 'classy ships no page css');
});

test('PurgeCSS strips selectors unused by the rendered HTML', async () => {
  const manifest = await build(['classy']);
  fs.writeFileSync(
    path.join(OUT, 'index.html'),
    '<body class="omega-body"><div class="container"><a class="btn btn-primary">x</a></div></body>'
  );

  const sizes = await purgeCss({ outDir: OUT, manifest });
  const purged = fs.readFileSync(path.join(OUT, manifest.css.main.slice(1)), 'utf8');
  assert.ok(purged.includes('.btn-primary'), 'used selector kept');
  assert.ok(!purged.includes('.carousel-inner'), 'unused selector stripped');
  assert.ok(sizes.after < sizes.before, `size shrank (${sizes.before} → ${sizes.after})`);
});
