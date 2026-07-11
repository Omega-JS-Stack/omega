/**
 * Layer-aware seeding tests — the brand-app targets-only seed (friction #1)
 * and the seed-mode resolution the four framework setups branch on.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const JSON5 = require('json5');

const { renderBrandAppSeed, resolveSeedMode, loadConfig } = require('../src/index.js');

const TEMP_ROOT = path.join(__dirname, '..', '.temp');

function makeFixture(name, files) {
  const root = path.join(TEMP_ROOT, `${name}-${process.pid}`);
  fs.rmSync(root, { recursive: true, force: true });
  for (const [relative, contents] of Object.entries(files)) {
    const abs = path.join(root, relative);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents);
  }
  return root;
}

test('renderBrandAppSeed: parseable JSON5, exactly one targets key, nothing shared', () => {
  for (const target of ['web', 'backend', 'desktop', 'extension']) {
    const seed = renderBrandAppSeed(target);
    const parsed = JSON5.parse(seed);
    assert.deepStrictEqual(parsed, { targets: { [target]: {} } }, `${target}: targets-only`);
    assert.match(seed, /brand root/, 'the pointer comment names where shared sections live');
  }
});

test('renderBrandAppSeed merged under a brand config leaves brand identity untouched', (t) => {
  const root = makeFixture('seed-merge', {
    'brand/config/omega.json5': `{ brand: { id: 'acme', name: 'Acme' }, targets: { web: {} } }`,
    'brand/apps/site/config/omega.json5': renderBrandAppSeed('web'),
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const { config } = loadConfig(path.join(root, 'brand', 'apps', 'site'));
  assert.strictEqual(config.brand.id, 'acme', 'the app seed must not shadow the brand id');
  assert.strictEqual(config.brand.name, 'Acme');
});

test('resolveSeedMode: brand app → brand mode; standalone dir → standalone; functions/ normalizes', (t) => {
  const root = makeFixture('seed-mode', {
    'brand/config/omega.json5': `{ brand: { id: 'acme' } }`,
    'brand/apps/site/package.json': '{}',
    'brand/apps/backend/functions/package.json': '{}',
    'standalone/package.json': '{}',
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const brandRoot = path.join(root, 'brand');

  const inBrand = resolveSeedMode(path.join(brandRoot, 'apps', 'site'));
  assert.deepStrictEqual(inBrand, { standalone: false, brandRoot });

  const fromFunctions = resolveSeedMode(path.join(brandRoot, 'apps', 'backend', 'functions'));
  assert.deepStrictEqual(fromFunctions, { standalone: false, brandRoot });

  const standalone = resolveSeedMode(path.join(root, 'standalone'));
  assert.deepStrictEqual(standalone, { standalone: true, brandRoot: null });
});
