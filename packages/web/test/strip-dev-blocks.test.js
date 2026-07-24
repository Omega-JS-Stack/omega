// @dev-only block stripping (cp268, UJM strip-dev-blocks loader parity) —
// unit coverage for the marker regex plus the integration proof that a
// PRODUCTION buildAssets run drops the block from the emitted bundle while a
// dev build keeps it.
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { stripDevBlocks } = require('../src/strip-dev-blocks.js');
const { buildAssets } = require('../src/assets.js');

const PKG = path.resolve(__dirname, '..');
const ROOT = path.resolve(PKG, '..', '..');

test('stripDevBlocks: removes every marked block, leaves the rest', () => {
  const source = [
    'const keep = 1;',
    '/* @dev-only:start */',
    'const devWarningOne = "DEV_ONLY_SENTINEL_A";',
    '/* @dev-only:end */',
    'const alsoKeep = 2;',
    '/* @dev-only:start */ const devTwo = "DEV_ONLY_SENTINEL_B"; /* @dev-only:end */',
  ].join('\n');

  const out = stripDevBlocks(source);
  assert.ok(out.includes('const keep = 1;'));
  assert.ok(out.includes('const alsoKeep = 2;'));
  assert.ok(!out.includes('DEV_ONLY_SENTINEL_A'));
  assert.ok(!out.includes('DEV_ONLY_SENTINEL_B'));
});

test('stripDevBlocks: source without markers is returned unchanged', () => {
  const source = 'const untouched = true;\n';
  assert.equal(stripDevBlocks(source), source);
});

test('build integration: production bundle drops dev-only blocks, dev bundle keeps them', async () => {
  const layer = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-strip-layer-'));
  fs.mkdirSync(path.join(layer, 'js'), { recursive: true });
  fs.writeFileSync(path.join(layer, 'js', 'main.js'), [
    '/* @dev-only:start */',
    'console.log("DEV_ONLY_SENTINEL");',
    '/* @dev-only:end */',
    'export default { alwaysShips: "PROD_SENTINEL" };',
    '',
  ].join('\n'));

  const build = async (dev, name) => {
    const outDir = path.join(PKG, '.omega', name);
    fs.rmSync(outDir, { recursive: true, force: true });
    const manifest = await buildAssets({
      layers: [layer],
      themeRoots: [],
      sectionRoots: [],
      themesDir: path.join(PKG, 'themes'),
      coreDir: path.join(PKG, 'core'),
      outDir,
      clientEntry: path.join(ROOT, 'packages', 'client', 'src', 'index.js'),
      dev,
      only: 'js',
    });
    return fs.readFileSync(path.join(outDir, manifest.js.main.slice(1)), 'utf8');
  };

  const prodBundle = await build(false, 'strip-prod-out');
  assert.ok(prodBundle.includes('PROD_SENTINEL'), 'production bundle carries the real code');
  assert.ok(!prodBundle.includes('DEV_ONLY_SENTINEL'), 'production bundle dropped the dev-only block');

  const devBundle = await build(true, 'strip-dev-out');
  assert.ok(devBundle.includes('DEV_ONLY_SENTINEL'), 'dev bundle keeps the dev-only block');
});
