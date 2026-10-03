/**
 * @omega.js/config/order — canonical top-level key ordering: comments travel
 * with their keys, unknown keys keep relative order after known ones, data
 * never changes, and writeConfigValues normalizes order on every writeback.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');
const JSON5 = require('json5');

// The machine registry is per-machine state: this file's fixtures record into a temp home.
require('@omega.js/devkit/test/temp-home');

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

  // Company topology note.
  company: { id: "acme-co" },
  domain: {
    providers: { namecheap: {} },
  },
}
`;

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

module.exports = defineCases({
  type: 'group',
  description: 'order',
  tests: [
    {
      name: 'applyCanonicalOrder: keys land in canonical order, comments travel, data identical',
      run: (ctx) => {
        const result = applyCanonicalOrder(SCRAMBLED);

        const keys = Object.keys(JSON5.parse(result));
        ctx.expect(keys).toEqual(['brand', 'company', 'domain', 'marketing', 'zebraCustom']);

        // Comment blocks moved WITH their keys
        const brandComment = result.indexOf('this comment must travel');
        const brandKey = result.indexOf('brand: {');
        ctx.expect(brandComment !== -1 && brandComment < brandKey, 'brand comment sits above brand').toBeTruthy();
        ctx.expect(result.indexOf('Company topology note') < result.indexOf('company: {'), 'company comment sits above company').toBeTruthy();
        ctx.expect(result.indexOf('Company topology note') > brandComment, 'company block moved below brand block').toBeTruthy();

        // Header comment stays at the very top, trailing comment rides its key
        ctx.expect(result.startsWith('// File header')).toBeTruthy();
        ctx.expect(result).toMatch(/zebraCustom: \{ x: 1 \}, \/\/ unknown key/);

        // Data unchanged
        ctx.expect(JSON5.parse(result)).toEqual(JSON5.parse(SCRAMBLED));
      },
    },

    {
      name: 'applyCanonicalOrder: already-canonical source returns byte-identical',
      run: (ctx) => {
        const canonical = applyCanonicalOrder(SCRAMBLED);
        ctx.expect(applyCanonicalOrder(canonical)).toBe(canonical);
      },
    },

    {
      name: 'applyCanonicalOrder: unknown keys keep their relative order after known keys',
      run: (ctx) => {
        const source = `{
  bbbUnknown: 1,
  aaaUnknown: 2,
  brand: { id: "x" },
}
`;
        const keys = Object.keys(JSON5.parse(applyCanonicalOrder(source)));
        ctx.expect(keys).toEqual(['brand', 'bbbUnknown', 'aaaUnknown']);
      },
    },

    {
      name: 'applyCanonicalOrder: targets is LAST by policy — even unknown keys never sort past it',
      run: (ctx) => {
        const source = `{
  targets: { web: { type: 'web' } },
  theme: { id: "classy" },
  zzzUnknown: 1,
  brand: { id: "x" },
}
`;
        const keys = Object.keys(JSON5.parse(applyCanonicalOrder(source)));
        ctx.expect(keys).toEqual(['brand', 'theme', 'zzzUnknown', 'targets']);
      },
    },

    {
      name: 'applyCanonicalOrder: missing trailing comma on the last entry is handled',
      run: (ctx) => {
        const source = `{
  marketing: { campaigns: {} },
  brand: { id: "x" }
}
`;
        const result = applyCanonicalOrder(source);
        const keys = Object.keys(JSON5.parse(result));
        ctx.expect(keys).toEqual(['brand', 'marketing']);
      },
    },

    {
      name: 'applyCanonicalOrder: single-line root is left alone',
      run: (ctx) => {
        const source = `{ marketing: {}, brand: { id: "x" } }`;
        ctx.expect(applyCanonicalOrder(source)).toBe(source);
      },
    },

    {
      name: 'writeConfigValues normalizes key order on every writeback',
      run: (ctx) => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-order-'));
        fs.mkdirSync(path.join(root, 'config'));
        fs.writeFileSync(path.join(root, 'config', 'omega.json5'), SCRAMBLED);

        const { changed } = writeConfigValues(root, { 'marketing.campaigns.providers.sendgrid.listId': 'lst_2' });
        ctx.expect(changed).toBe(true);

        const written = fs.readFileSync(path.join(root, 'config', 'omega.json5'), 'utf8');
        const keys = Object.keys(JSON5.parse(written));
        ctx.expect(keys).toEqual(['brand', 'company', 'domain', 'marketing', 'zebraCustom']);
        ctx.expect(written).toMatch(/listId: "lst_2"/);

        fs.rmSync(root, { recursive: true, force: true });
      },
    },

    {
      name: 'canonical list sanity: no duplicates',
      run: (ctx) => {
        ctx.expect(new Set(CANONICAL_TOP_LEVEL_ORDER).size).toBe(CANONICAL_TOP_LEVEL_ORDER.length);
      },
    },

    {
      name: 'every canonical key is schema-known or a named manager-owned block (reverse drift guard)',
      run: (ctx) => {
        const { SHARED_SCHEMA, TARGET_SCHEMAS } = require('../src/schema.js');
        const topLevel = new Set([...SHARED_SCHEMA, ...Object.values(TARGET_SCHEMAS).flat()]
          .map((rule) => rule.path.split(/[.[]/)[0]));

        const orphans = CANONICAL_TOP_LEVEL_ORDER
          .filter((key) => !topLevel.has(key) && !MANAGER_OWNED_NON_SCHEMA_KEYS.includes(key));

        ctx.expect(orphans, `canonical keys with no schema rule and no named owner: ${orphans.join(', ')}`).toEqual([]);
      },
    },

    {
      name: 'canonical list covers every SHARED_SCHEMA top-level key (drift guard)',
      run: (ctx) => {
        const { SHARED_SCHEMA } = require('../src/schema.js');
        const topLevel = [...new Set(SHARED_SCHEMA.map((rule) => rule.path.split(/[.[]/)[0]))];
        const missing = topLevel.filter((key) => !CANONICAL_TOP_LEVEL_ORDER.includes(key));

        ctx.expect(missing, `schema keys absent from CANONICAL_TOP_LEVEL_ORDER: ${missing.join(', ')}`).toEqual([]);
      },
    },

    {
      name: 'loadConfig: a target with no omega.json5 of its own rides the brand file alone',
      run: (ctx) => {
        const { loadConfig } = require('../src/load.js');
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-optional-target-'));
        fs.mkdirSync(path.join(root, 'config'));
        fs.writeFileSync(path.join(root, 'config', 'omega.json5'), `{
  brand: { id: "demo", name: "Demo" },
  targets: {
    web: { type: "web", theme: { id: "classy" } },
  },
}
`);
        const targetDir = path.join(root, 'targets', 'web');
        fs.mkdirSync(targetDir, { recursive: true });

        const { config, enabled, files } = loadConfig(targetDir, 'web');
        ctx.expect(config.brand.name, 'brand layer resolves').toBe('Demo');
        ctx.expect(config.theme.id, 'brand target overlay resolves').toBe('classy');
        ctx.expect(enabled).toBe(true);
        ctx.expect(files.local, 'no local-layer file — and that is fine').toBe(null);
        ctx.expect(files.brand.endsWith('config/omega.json5')).toBeTruthy();

        // Standalone (no brand above) still requires its own file
        const lone = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-lone-'));
        ctx.expect(() => loadConfig(lone, 'web')).toThrow(/No omega\.json5 found/);

        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(lone, { recursive: true, force: true });
      },
    },
  ],
});
