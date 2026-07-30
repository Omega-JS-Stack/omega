// @dev-only block stripping (cp268, UJM strip-dev-blocks loader parity) — the
// integration proof that a PRODUCTION buildAssets run drops the block from the
// emitted bundle while a dev build keeps it. The markers and the cut itself are
// @omega.js/devkit's, one home (#18) — their unit coverage lives there.
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const shared = require('@omega.js/devkit/strip-dev-blocks');
const { stripDevBlocks, START_MARKER, END_MARKER } = require('../src/strip-dev-blocks.js');
const { buildAssets } = require('../src/assets.js');

const PKG = path.resolve(__dirname, '..');
const ROOT = path.resolve(PKG, '..', '..');

test('web strips through the one home rather than its own copy of the contract', () => {
  assert.equal(stripDevBlocks, shared.stripDevBlocks);
  assert.equal(START_MARKER, shared.START_MARKER);
  assert.equal(END_MARKER, shared.END_MARKER);
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
