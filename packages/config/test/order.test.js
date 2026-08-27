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
    campaigns: { providers: { sendgrid: { listId: "lst_1" } } },
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
    providers: { namecheap: {} },
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

  const { changed } = writeConfigValues(root, { 'marketing.campaigns.providers.sendgrid.listId': 'lst_2' });
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

// The canonical list's ONLY legitimate members with no schema rule: top-level
// blocks a manager service owns and reads directly. Every other entry must be
// schema-known, so a key nothing reads can never sit here unnoticed (#484 —
// `testing` did, for the whole life of the list).
const MANAGER_OWNED_NON_SCHEMA_KEYS = [
  'enabled',      // target enable flag — loadConfig reads it, not a validated value
  'local',        // the local layer's own block
  'domain',       // services/domain
  'server',       // services/server
  'assets',       // services/assets
  'certificates', // services/certificates
  'migrations',   // services/migrations
];

test('every canonical key is schema-known or a named manager-owned block (reverse drift guard)', () => {
  const { SHARED_SCHEMA, TARGET_SCHEMAS } = require('../src/schema.js');
  const topLevel = new Set([...SHARED_SCHEMA, ...Object.values(TARGET_SCHEMAS).flat()]
    .map((rule) => rule.path.split(/[.[]/)[0]));

  const orphans = CANONICAL_TOP_LEVEL_ORDER
    .filter((key) => !topLevel.has(key) && !MANAGER_OWNED_NON_SCHEMA_KEYS.includes(key));

  assert.deepStrictEqual(orphans, [], `canonical keys with no schema rule and no named owner: ${orphans.join(', ')}`);
});

test('canonical list covers every SHARED_SCHEMA top-level key (drift guard)', () => {
  const { SHARED_SCHEMA } = require('../src/schema.js');
  const topLevel = [...new Set(SHARED_SCHEMA.map((rule) => rule.path.split(/[.[]/)[0]))];
  const missing = topLevel.filter((key) => !CANONICAL_TOP_LEVEL_ORDER.includes(key));

  assert.deepStrictEqual(missing, [], `schema keys absent from CANONICAL_TOP_LEVEL_ORDER: ${missing.join(', ')}`);
});

test('loadConfig: a target with no omega.json5 of its own rides the brand file alone', () => {
  const { loadConfig } = require('../src/load.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-optional-target-'));
  fs.mkdirSync(path.join(root, 'config'));
  fs.writeFileSync(path.join(root, 'config', 'omega.json5'), `{
  brand: { id: "demo", name: "Demo" },
  targets: {
    web: { theme: { id: "classy" } },
  },
}
`);
  const targetDir = path.join(root, 'targets', 'website');
  fs.mkdirSync(targetDir, { recursive: true });

  const { config, enabled, files } = loadConfig(targetDir, 'web');
  assert.strictEqual(config.brand.name, 'Demo', 'brand layer resolves');
  assert.strictEqual(config.theme.id, 'classy', 'brand target overlay resolves');
  assert.strictEqual(enabled, true);
  assert.strictEqual(files.local, null, 'no local-layer file — and that is fine');
  assert.ok(files.brand.endsWith('config/omega.json5'));

  // Standalone (no brand above) still requires its own file
  const lone = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-lone-'));
  assert.throws(() => loadConfig(lone, 'web'), /No omega\.json5 found/);

  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(lone, { recursive: true, force: true });
});
