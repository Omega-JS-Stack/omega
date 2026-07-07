/**
 * Asset-pipeline invariants: 3-layer page-module resolution via esbuild
 * (site > theme > core), the real @omegajs/client bundling into signin,
 * layered sass variables (dusk restyles via loadPaths order), and the
 * PurgeCSS pass stripping unused selectors.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { buildAssets, purgeCss } = require('../src/assets.js');

const SPIKE = path.resolve(__dirname, '..');
const ROOT = path.resolve(SPIKE, '..', '..');
const OUT = path.join(SPIKE, '.omega', 'assets-test-out');

/**
 * Run buildAssets for a theme layer chain.
 * @param {string[]} themeIds
 * @returns {Promise<object>} manifest
 */
function build(themeIds) {
  const themeDirs = themeIds.map((id) => path.join(SPIKE, 'themes', id));
  return buildAssets({
    jsLayers: [
      path.join(SPIKE, 'site-assets', 'js'),
      ...themeDirs.map((dir) => path.join(dir, 'js')),
      path.join(SPIKE, 'core', 'js'),
    ],
    cssLayers: [...themeDirs.map((dir) => path.join(dir, 'css')), path.join(SPIKE, 'core', 'css')],
    outDir: OUT,
    clientEntry: path.join(ROOT, 'packages', 'client', 'src', 'index.js'),
  });
}

test('3-layer page modules: site wins index, theme wins pricing, core fills signin/signup', async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  const manifest = await build(['classy']);

  for (const key of ['index', 'pricing', 'signin', 'signup']) {
    assert.ok(manifest.js[key], `manifest has ${key}`);
    assert.match(manifest.js[key], /^\/assets\/js\/pages\/.+-[A-Z0-9]+\.js$/, `${key} is content-hashed`);
  }

  const indexBundle = fs.readFileSync(path.join(OUT, manifest.js.index.slice(1)), 'utf8');
  assert.ok(indexBundle.includes('consumer wins'), 'SITE layer index.js beat the core layer');

  const pricingBundle = fs.readFileSync(path.join(OUT, manifest.js.pricing.slice(1)), 'utf8');
  assert.ok(pricingBundle.includes('plan selected'), 'THEME layer pricing.js bundled');
});

test('signin bundles the real @omegajs/client via the web-manager alias', async () => {
  const manifest = await build(['classy']);
  const signinBundle = fs.readFileSync(path.join(OUT, manifest.js.signin.slice(1)), 'utf8');
  assert.ok(signinBundle.length > 100000, `client is IN the bundle (${signinBundle.length} bytes)`);
  assert.ok(signinBundle.includes('omega:signin'), 'page module code present');
});

test('layered sass: dusk _variables.scss restyles through loadPaths order', async () => {
  const classy = await build(['classy']);
  const dusk = await build(['dusk', 'classy']);

  const classyCss = fs.readFileSync(path.join(OUT, classy.css.theme.slice(1)), 'utf8');
  const duskCss = fs.readFileSync(path.join(OUT, dusk.css.theme.slice(1)), 'utf8');
  assert.ok(classyCss.includes('#0d6efd'), 'classy accent');
  assert.ok(duskCss.includes('#7b5cff'), 'dusk accent overrides');
  assert.ok(duskCss.includes('.plan-card'), 'classy theme.scss body reused by dusk (no theme.scss of its own)');
  assert.notStrictEqual(classy.css.theme, dusk.css.theme, 'content hash differs');
});

test('PurgeCSS strips selectors unused by the rendered HTML', async () => {
  const manifest = await build(['classy']);
  fs.writeFileSync(
    path.join(OUT, 'index.html'),
    '<body class="omega-body"><div class="container"><a class="btn btn-primary">x</a></div></body>'
  );

  const sizes = await purgeCss({ outDir: OUT, manifest });
  const purged = fs.readFileSync(path.join(OUT, manifest.css.theme.slice(1)), 'utf8');
  assert.ok(purged.includes('.btn-primary'), 'used selector kept');
  assert.ok(!purged.includes('.carousel-inner'), 'unused selector stripped');
  assert.ok(sizes.after < sizes.before, `size shrank (${sizes.before} → ${sizes.after})`);
});
