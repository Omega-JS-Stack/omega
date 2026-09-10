// @dev-only block stripping (cp268, UJM strip-dev-blocks loader parity) — the
// integration proof that a PRODUCTION buildAssets run drops the block from the
// emitted bundle while a dev build keeps it. The markers, the cut and the
// esbuild plugin that applies it are all @omega.js/devkit's, one home (#18,
// #736) — their unit coverage lives there.
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { stripDevBlocks, START_MARKER, END_MARKER } = require('@omega.js/devkit/strip-dev-blocks');
const { stripDevBlocksPlugin } = require('@omega.js/devkit/strip-dev-blocks-plugin');
const { buildAssets } = require('../src/assets.js');

const PKG = path.resolve(__dirname, '..');
const ROOT = path.resolve(PKG, '..', '..');

test('web strips through the one home rather than its own copy of the contract', () => {
  // The plugin web's bundles carry is devkit's, not a web-side rebuild of it.
  assert.equal(stripDevBlocksPlugin.name, 'omega-strip-dev-blocks');
  assert.equal(typeof stripDevBlocks, 'function');
  assert.equal(START_MARKER, '/* @dev-only:start */');
  assert.equal(END_MARKER, '/* @dev-only:end */');
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

// A real page's bundle graph, built the way a brand builds it.
async function buildPageGraph(dev, name, page) {
  const themeRoots = [path.join(PKG, 'themes', 'classy'), path.join(PKG, 'themes', 'base')];
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
  // Every layer's module for the page (#624) — the graph the browser evaluates
  // is all of them.
  const graph = manifest.js.pages[page].map((url) => readGraph(outDir, url)).join('\n');
  fs.rmSync(outDir, { recursive: true, force: true });
  return graph;
}

test('the checkout page ships no `_dev_decline` to production (#226)', async () => {
  // The decline arm is a URL param now, so the ONLY thing keeping it out of a
  // real checkout is the @dev-only block around the read (modules/api.js) and
  // around the section import (index.js). #235 is the standing proof that a
  // dev param read OUTSIDE a block survives the strip, so this asserts on the
  // real production build rather than on the source.
  const devGraph = await buildPageGraph(true, 'strip-checkout-dev-out', 'payment/checkout/index');
  assert.ok(devGraph.includes('_dev_decline'), 'the dev build carries the param — otherwise this proves nothing');
  assert.ok(devGraph.includes('Decline next checkout'), 'and the palette control that applies it');

  const prodGraph = await buildPageGraph(false, 'strip-checkout-prod-out', 'payment/checkout/index');
  assert.ok(!prodGraph.includes('_dev_decline'), 'production never reads the decline param');
  assert.ok(!prodGraph.includes('Decline next checkout'), 'and carries none of the control that sets it');
});

test('the checkout page ships no `_dev_cardProvider` to production (#235)', async () => {
  // resolveProvider() honoured the param outside any block, so a production
  // checkout let a visitor point their own payment at another provider. The
  // read belongs behind the same triple gate as the decline arm — this asserts
  // on the real production build, not on the source.
  const devGraph = await buildPageGraph(true, 'strip-provider-dev-out', 'payment/checkout/index');
  assert.ok(devGraph.includes('_dev_cardProvider'), 'the dev build carries the param — otherwise this proves nothing');

  const prodGraph = await buildPageGraph(false, 'strip-provider-prod-out', 'payment/checkout/index');
  assert.ok(!prodGraph.includes('_dev_cardProvider'), 'production never reads the card-provider override');
});

test('the checkout page ships no `_dev_trialEligible` to production (#245)', async () => {
  // initializeCheckout() read the param outside any block, so the literal rode
  // into the production graph while every other checkout dev param stayed out.
  // Never exploitable — the apply site was always behind omega.isDevelopment()
  // — but the read belongs behind the same triple gate as the rest (#235/#226).
  const devGraph = await buildPageGraph(true, 'strip-trial-dev-out', 'payment/checkout/index');
  assert.ok(devGraph.includes('_dev_trialEligible'), 'the dev build carries the param — otherwise this proves nothing');

  const prodGraph = await buildPageGraph(false, 'strip-trial-prod-out', 'payment/checkout/index');
  assert.ok(!prodGraph.includes('_dev_trialEligible'), 'production never reads the trial-eligibility override');
});

test('the auth pages ship no `_dev_simulateRedirect` to production (#342)', async () => {
  // The sweep moved the OAuth returning-redirect rehearsal onto a palette
  // section (libs/auth/index.js). dev-hooks-guard.test.js proves the read sits
  // inside a block; only a real production build proves the strip actually
  // took, which is the gap #226/#235/#245 each fell through.
  const devGraph = await buildPageGraph(true, 'strip-auth-dev-out', 'signin/index');
  assert.ok(devGraph.includes('_dev_simulateRedirect'), 'the dev build carries the param, otherwise this proves nothing');
  assert.ok(devGraph.includes('Simulate an OAuth redirect'), 'and the palette control that applies it');

  const prodGraph = await buildPageGraph(false, 'strip-auth-prod-out', 'signin/index');
  assert.ok(!prodGraph.includes('_dev_simulateRedirect'), 'production never reads the redirect-simulation param');
  assert.ok(!prodGraph.includes('Simulate an OAuth redirect'), 'and carries none of the control that sets it');
});
