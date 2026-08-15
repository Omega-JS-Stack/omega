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

// An entry bundle plus every chunk it transitively imports — what the browser
// actually evaluates for that page (same read as assets.test.js).
function readGraph(outDir, manifestUrl) {
  const seen = new Map();
  const visit = (file) => {
    if (seen.has(file)) return;
    const content = fs.readFileSync(file, 'utf8');
    seen.set(file, content);
    for (const m of content.matchAll(/["']([^"']*chunks\/[\w.-]+-[A-Z0-9]+\.js)["']/g)) {
      visit(path.resolve(path.dirname(file), m[1]));
    }
  };
  visit(path.join(outDir, manifestUrl.slice(1)));
  return [...seen.values()].join('\n');
}

test('the checkout page ships no `_dev_decline` to production (#226)', async () => {
  // The decline arm is a URL param now, so the ONLY thing keeping it out of a
  // real checkout is the @dev-only block around the read (modules/api.js) and
  // around the section import (index.js). #235 is the standing proof that a
  // dev param read OUTSIDE a block survives the strip, so this asserts on the
  // real production build rather than on the source.
  const themeRoots = [path.join(PKG, 'themes', 'classy'), path.join(PKG, 'themes', 'base')];

  const build = async (dev, name) => {
    const outDir = path.join(PKG, '.omega', `${name}-${process.pid}`);
    fs.rmSync(outDir, { recursive: true, force: true });
    const manifest = await buildAssets({
      layers: [...themeRoots, path.join(PKG, 'core')],
      themeRoots,
      sectionRoots: themeRoots,
      themesDir: path.join(PKG, 'themes'),
      coreDir: path.join(PKG, 'core'),
      outDir,
      clientEntry: path.join(ROOT, 'packages', 'client', 'src', 'index.js'),
      dev,
      only: 'js',
    });
    const graph = readGraph(outDir, manifest.js.pages['payment/checkout/index']);
    fs.rmSync(outDir, { recursive: true, force: true });
    return graph;
  };

  const devGraph = await build(true, 'strip-checkout-dev-out');
  assert.ok(devGraph.includes('_dev_decline'), 'the dev build carries the param — otherwise this proves nothing');
  assert.ok(devGraph.includes('Decline next checkout'), 'and the palette control that applies it');

  const prodGraph = await build(false, 'strip-checkout-prod-out');
  assert.ok(!prodGraph.includes('_dev_decline'), 'production never reads the decline param');
  assert.ok(!prodGraph.includes('Decline next checkout'), 'and carries none of the control that sets it');
});
