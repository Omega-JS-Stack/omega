/**
 * The dev loop treats the whole `.env` chain as a watch input
 * ([#681](https://github.com/Omega-JS-Stack/omega/issues/681)).
 *
 * The backend's stage watch already did — an edit to the brand root's .env
 * re-stages and the running emulator sees it — while web read the cascade once
 * at CLI boot and never noticed an edit. This pins the PATH RESOLUTION the dev
 * lane wires up (the same level the backend's stage-watch test pins): every
 * layer of the chain, and each layer's `.env.<environment>` overlay (#586).
 *
 * Run: npx omega test web:dev-env-watch
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const dev = require('../src/commands/dev.js');

/**
 * A website target inside a brand monorepo, with a company root above it:
 * <root>/company/.env, <root>/brand/.env, <root>/brand/targets/website/.
 */
function brandFixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-web-env-watch-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const companyRoot = path.join(root, 'company');
  const brandRoot = path.join(root, 'brand');
  const targetDir = path.join(brandRoot, 'targets', 'website');

  fs.mkdirSync(companyRoot, { recursive: true });
  fs.mkdirSync(path.join(brandRoot, '.omega'), { recursive: true });
  fs.mkdirSync(path.join(brandRoot, 'config'), { recursive: true });
  fs.mkdirSync(targetDir, { recursive: true });

  fs.writeFileSync(path.join(companyRoot, '.env'), '');
  fs.writeFileSync(path.join(brandRoot, '.omega', 'company.json'), JSON.stringify({ root: companyRoot }));
  fs.writeFileSync(path.join(brandRoot, 'config', 'omega.json5'), '{ brand: { id: "fixture" }, targets: { web: {} } }');

  return { companyRoot, brandRoot, targetDir };
}

test('the dev watcher lists every layer of the .env chain, overlays included', (t) => {
  const { companyRoot, brandRoot, targetDir } = brandFixture(t);

  const watcher = dev.watchEnvSources(targetDir, { environment: 'development' });
  t.after(() => watcher.close());

  assert.deepEqual(watcher.inputs.map((input) => input.path), [
    path.join(companyRoot, '.env'),
    path.join(companyRoot, '.env.development'),
    path.join(brandRoot, '.env'),
    path.join(brandRoot, '.env.development'),
    path.join(targetDir, '.env'),
    path.join(targetDir, '.env.development'),
  ], 'company, brand and target — each layer with the overlay that wins over it, resolved through the chain');

  assert.deepEqual(watcher.inputs.map((input) => input.layer), [
    'company', 'company', 'brand', 'brand', 'target', 'target',
  ]);
});

test('a standalone target watches only its own .env layer', (t) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-web-env-solo-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const watcher = dev.watchEnvSources(root, { environment: 'development' });
  t.after(() => watcher.close());

  assert.deepEqual(watcher.inputs.map((input) => input.path), [
    path.join(root, '.env'),
    path.join(root, '.env.development'),
  ], 'nothing above a standalone target — nothing extra to watch');
});
