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

const { recordBrand } = require('@omega.js/config');

const dev = require('../src/commands/dev.js');

/**
 * A web target inside a brand monorepo whose brand names a company
 * ([#677](https://github.com/Omega-JS-Stack/omega/issues/677)): the company's
 * shared `.env` lives in the company brand's own `company/` tree, and WHERE
 * that brand is comes from the machine registry: pointed at this fixture's
 * own home so the developer's `~/.omega` never sees a line.
 *
 * <root>/parent/company/.env, <root>/brand/.env, <root>/brand/targets/web/.
 */
function brandFixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-web-env-watch-')));
  const previousHome = process.env.OMEGA_HOME;
  process.env.OMEGA_HOME = path.join(root, 'home');
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    if (previousHome === undefined) delete process.env.OMEGA_HOME;
    else process.env.OMEGA_HOME = previousHome;
  });

  const companyDir = path.join(root, 'parent', 'company');
  const brandRoot = path.join(root, 'brand');
  const targetDir = path.join(brandRoot, 'targets', 'web');

  fs.mkdirSync(companyDir, { recursive: true });
  fs.mkdirSync(path.join(brandRoot, 'config'), { recursive: true });
  fs.mkdirSync(targetDir, { recursive: true });

  fs.writeFileSync(path.join(companyDir, '.env'), '');
  fs.writeFileSync(path.join(brandRoot, 'config', 'omega.json5'), '{ brand: { id: "fixture" }, company: { id: "fixture-co" }, targets: { web: { type: "web" } } }');
  recordBrand({ id: 'fixture-co', root: path.join(root, 'parent'), name: 'Fixture Co' });

  return { companyDir, brandRoot, targetDir };
}

test('the dev watcher lists every layer of the .env chain, overlays included', (t) => {
  const { companyDir, brandRoot, targetDir } = brandFixture(t);

  const watcher = dev.watchEnvSources(targetDir, { environment: 'development' });
  t.after(() => watcher.close());

  assert.deepEqual(watcher.inputs.map((input) => input.path), [
    path.join(companyDir, '.env'),
    path.join(companyDir, '.env.development'),
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
