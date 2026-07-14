/**
 * @omega.js/config/order — canonical top-level key ordering: comments travel
 * with their keys, unknown keys keep relative order after known ones, data
 * never changes, and writeConfigValues normalizes order on every writeback.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const JSON5 = require('json5');

const { applyCanonicalOrder, CANONICAL_TOP_LEVEL_ORDER } = require('../src/order.js');
const { writeConfigValues } = require('../src/edit.js');

const SCRAMBLED = `// File header — stays at the very top.
{
  marketing: {
    campaigns: { listId: "lst_1" },
  },

  // Brand identity block — this comment must travel with 'brand'.
  brand: {
    id: "demo",
    name: "Demo",
  },
  zebraCustom: { x: 1 }, // unknown key (trailing comment rides along)

  // Parent topology note.
  parent: false,
  domain: {
    provider: "namecheap",
  },
}
`;

test('applyCanonicalOrder: keys land in canonical order, comments travel, data identical', () => {
  const result = applyCanonicalOrder(SCRAMBLED);

  const keys = Object.keys(JSON5.parse(result));
  assert.deepStrictEqual(keys, ['parent', 'brand', 'domain', 'marketing', 'zebraCustom']);

  // Comment blocks moved WITH their keys
  const brandComment = result.indexOf('this comment must travel');
  const brandKey = result.indexOf('brand: {');
  assert.ok(brandComment !== -1 && brandComment < brandKey, 'brand comment sits above brand');
  assert.ok(result.indexOf('Parent topology note') < result.indexOf('parent: false'), 'parent comment sits above parent');
  assert.ok(result.indexOf('Parent topology note') < brandComment, 'parent block moved above brand block');

  // Header comment stays at the very top, trailing comment rides its key
  assert.ok(result.startsWith('// File header'));
  assert.match(result, /zebraCustom: \{ x: 1 \}, \/\/ unknown key/);

  // Data unchanged
  assert.deepStrictEqual(JSON5.parse(result), JSON5.parse(SCRAMBLED));
});

test('applyCanonicalOrder: already-canonical source returns byte-identical', () => {
  const canonical = applyCanonicalOrder(SCRAMBLED);
  assert.strictEqual(applyCanonicalOrder(canonical), canonical);
});

test('applyCanonicalOrder: unknown keys keep their relative order after known keys', () => {
  const source = `{
  bbbUnknown: 1,
  aaaUnknown: 2,
  brand: { id: "x" },
}
`;
  const keys = Object.keys(JSON5.parse(applyCanonicalOrder(source)));
  assert.deepStrictEqual(keys, ['brand', 'bbbUnknown', 'aaaUnknown']);
});

test('applyCanonicalOrder: targets is LAST by policy — even unknown keys never sort past it', () => {
  const source = `{
  targets: { web: {} },
  theme: { id: "classy" },
  zzzUnknown: 1,
  brand: { id: "x" },
}
`;
  const keys = Object.keys(JSON5.parse(applyCanonicalOrder(source)));
  assert.deepStrictEqual(keys, ['brand', 'theme', 'zzzUnknown', 'targets']);
});

test('applyCanonicalOrder: missing trailing comma on the last entry is handled', () => {
  const source = `{
  marketing: { campaigns: {} },
  brand: { id: "x" }
}
`;
  const result = applyCanonicalOrder(source);
  const keys = Object.keys(JSON5.parse(result));
  assert.deepStrictEqual(keys, ['brand', 'marketing']);
});

test('applyCanonicalOrder: single-line root is left alone', () => {
  const source = `{ marketing: {}, brand: { id: "x" } }`;
  assert.strictEqual(applyCanonicalOrder(source), source);
});

test('writeConfigValues normalizes key order on every writeback', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-order-'));
  fs.mkdirSync(path.join(root, 'config'));
  fs.writeFileSync(path.join(root, 'config', 'omega.json5'), SCRAMBLED);

  const { changed } = writeConfigValues(root, { 'marketing.campaigns.listId': 'lst_2' });
  assert.strictEqual(changed, true);

  const written = fs.readFileSync(path.join(root, 'config', 'omega.json5'), 'utf8');
  const keys = Object.keys(JSON5.parse(written));
  assert.deepStrictEqual(keys, ['parent', 'brand', 'domain', 'marketing', 'zebraCustom']);
  assert.match(written, /listId: "lst_2"/);

  fs.rmSync(root, { recursive: true, force: true });
});

test('canonical list sanity: no duplicates', () => {
  assert.strictEqual(new Set(CANONICAL_TOP_LEVEL_ORDER).size, CANONICAL_TOP_LEVEL_ORDER.length);
});

test('loadConfig: an app with no omega.json5 of its own rides the brand file alone', () => {
  const { loadConfig } = require('../src/load.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-optional-app-'));
  fs.mkdirSync(path.join(root, 'config'));
  fs.writeFileSync(path.join(root, 'config', 'omega.json5'), `{
  brand: { id: "demo", name: "Demo" },
  targets: {
    web: { theme: { id: "classy" } },
  },
}
`);
  const appDir = path.join(root, 'apps', 'website');
  fs.mkdirSync(appDir, { recursive: true });

  const { config, enabled, files } = loadConfig(appDir, 'web');
  assert.strictEqual(config.brand.name, 'Demo', 'brand layer resolves');
  assert.strictEqual(config.theme.id, 'classy', 'brand target overlay resolves');
  assert.strictEqual(enabled, true);
  assert.strictEqual(files.app, null, 'no app-layer file — and that is fine');
  assert.ok(files.brand.endsWith('config/omega.json5'));

  // Standalone (no brand above) still requires its own file
  const lone = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-lone-'));
  assert.throws(() => loadConfig(lone, 'web'), /No omega\.json5 found/);

  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(lone, { recursive: true, force: true });
});
