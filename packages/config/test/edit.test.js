/**
 * Writeback tests for @omega.js/config — comment-preserving omega.json5
 * edits. Pins the surgical guarantee (every byte outside the edited spans
 * survives: comments, blank lines, key order, quote style), replace vs
 * insert (leaf, whole missing branch, empty/single-line/comment-only
 * objects, array elements), the already-equal skip that makes reruns
 * byte-identical, the never-write-corrupt verification, and the file-level
 * writeConfigValues contract on a scaffold-shaped brand config.
 *
 * Fixtures are built under packages/config/.temp/ (gitignored), matching the
 * devkit test convention.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const path = require('node:path');
const JSON5 = require('json5');

const { applyConfigEdits, writeConfigValues, writeConfigFileValues, applyConfigRemovals, removeConfigValues, removeConfigFileValues } = require('../src/index.js');

const TEMP_ROOT = path.join(__dirname, '..', '.temp');

// Build a fixture tree ({ 'relative/path': contents }) and return its root.
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

function cleanup(t, root) {
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
}

// A nasty hand-authored config: line + block comments, blank lines, mixed
// quotes, trailing commas, a comment-documented null awaiting writeback.
const NASTY = `// Fixture Brand — hand-edited, every comment is load-bearing for these tests
{
  brand: {
    id: 'fixture-brand', // single quotes, stay single
    name: "Fixture Brand",
    url: 'https://fixture-brand.test',
  },

  /* marketing — ids resolve at manage time */
  marketing: {
    campaigns: {
      enabled: true,
      providers: {
        sendgrid: {
          listId: null, // resolved by the campaigns service
        },
      },
    },
  },

  payment: {
    products: [
      { id: 'free', name: 'Free', type: 'free' },
      {
        id: 'plus',
        name: 'Plus', // display name
        type: 'subscription',
        stripe: { productId: null },
      },
    ],
  },

  targets: {
    web: {},
    backend: {}, // enabled, defaults
  },
}
`;

// ─── Remove (#612) ───

// A converted brand config still carrying the two retired page maps (#610),
// each documented by the converter's own comment.
const CONVERTED = `// Fixture Brand — converted from UJM, comments carried across
{
  brand: {
    id: 'fixture-brand',
  },

  targets: {
    web: {
      // The download page map — one card per platform.
      download: {
        mac: 'https://cdn.fixture-brand.test/mac.dmg',
        windows: 'https://cdn.fixture-brand.test/win.exe',
      },

      // Store listings for the /extension page.
      extension: { chrome: 'https://chrome.test/abc' },

      redirects: [], // keep me
    },
    backend: {}, // enabled, defaults
  },
}
`;

module.exports = defineCases({
  type: 'group',
  description: 'edit',
  tests: [
    // ─── Replace ───

    {
      name: 'replace an existing leaf: only the value span changes, every other byte survives',
      run: (ctx) => {
        const result = applyConfigEdits(NASTY, { 'marketing.campaigns.providers.sendgrid.listId': 'sg-list-123' });

        ctx.expect(result).toBe(NASTY.replace('listId: null, // resolved', 'listId: "sg-list-123", // resolved'));
        ctx.expect(JSON5.parse(result).marketing.campaigns.providers.sendgrid.listId).toBe('sg-list-123');
      },
    },

    {
      name: 'already-equal edits are skipped: output is byte-identical (quote style untouched)',
      run: (ctx) => {
        // brand.id already holds 'fixture-brand' in single quotes — no rewrite to double
        const result = applyConfigEdits(NASTY, {
          'brand.id': 'fixture-brand',
          'marketing.campaigns.enabled': true,
          'payment.products[1].stripe.productId': null,
        });

        ctx.expect(result).toBe(NASTY);
      },
    },

    {
      name: 'array-element leaf replace via a [N] position',
      run: (ctx) => {
        const result = applyConfigEdits(NASTY, { 'payment.products[1].stripe.productId': 'prod_ABC' });

        ctx.expect(result).toBe(NASTY.replace("stripe: { productId: null }", 'stripe: { productId: "prod_ABC" }'));
      },
    },

    {
      name: '[key=value] matcher self-locates the array element: replace and insert',
      run: (ctx) => {
        // Replace inside the matched element — identical result to the index path
        const replaced = applyConfigEdits(NASTY, { 'payment.products[id=plus].stripe.productId': 'prod_ABC' });
        ctx.expect(replaced).toBe(applyConfigEdits(NASTY, { 'payment.products[1].stripe.productId': 'prod_ABC' }));

        // Insert a missing branch into the matched element (free has no `paypal` key)
        const inserted = applyConfigEdits(NASTY, { 'payment.products[id=plus].paypal.productId': 'PP-1' });
        const parsed = JSON5.parse(inserted);
        ctx.expect(parsed.payment.products[1].paypal.productId).toBe('PP-1');
        ctx.expect(inserted.includes("name: 'Plus', // display name")).toBeTruthy();

        // Already-equal through a matcher is skipped byte-identically
        ctx.expect(applyConfigEdits(inserted, { 'payment.products[id=plus].paypal.productId': 'PP-1' })).toBe(inserted);
      },
    },

    {
      name: '[key=value] matcher with no matching element throws; matcher below a missing branch throws',
      run: (ctx) => {
        ctx.expect(() => applyConfigEdits(NASTY, { 'payment.products[id=ghost].stripe.productId': 'x' })).toThrow(/no array element with id=ghost/);
        ctx.expect(() => applyConfigEdits(NASTY, { 'connections.providers[id=google].clientId': 'x' })).toThrow(/matcher cannot create array elements/);
      },
    },

    {
      name: 'replacing a leaf with an object serializes a house-style block at the right indent',
      run: (ctx) => {
        const source = `{
  cloud: null, // filled by the firebase service
}
`;
        const result = applyConfigEdits(source, { cloud: { apiKey: 'k', projectId: 'p' } });

        ctx.expect(result).toBe(`{
  cloud: {
    apiKey: "k",
    projectId: "p",
  }, // filled by the firebase service
}
`);
      },
    },

    // ─── Insert ───

    {
      name: 'insert a missing leaf into a multi-line object: lands before the closing brace',
      run: (ctx) => {
        const result = applyConfigEdits(NASTY, { 'marketing.campaigns.providers.sendgrid.listName': 'Fixture Brand' });

        ctx.expect(result).toMatch(/listId: null, \/\/ resolved by the campaigns service\n          listName: "Fixture Brand",\n        \},/);
        ctx.expect(JSON5.parse(result).marketing.campaigns.providers.sendgrid.listName).toBe('Fixture Brand');
      },
    },

    {
      name: 'insert a whole missing branch: nested block, one property, correct depth',
      run: (ctx) => {
        const result = applyConfigEdits(NASTY, { 'marketing.newsletter.providers.beehiiv.publicationId': 'pub-1' });

        ctx.expect(result).toMatch(/    newsletter: \{\n      providers: \{\n        beehiiv: \{\n          publicationId: "pub-1",\n        \},\n      \},\n    \},\n  \},/);
        ctx.expect(JSON5.parse(result).marketing.newsletter.providers.beehiiv.publicationId).toBe('pub-1');
        // The sibling campaigns block (and its comments) survives untouched
        ctx.expect(result.includes('listId: null, // resolved by the campaigns service')).toBeTruthy();
        ctx.expect(result.includes('/* marketing — ids resolve at manage time */')).toBeTruthy();
      },
    },

    {
      name: 'insert at the root: goes before the final brace, previous last entry gains its comma',
      run: (ctx) => {
        const source = `{
  brand: { id: 'a' },
  theme: { id: 'classy' }
}
`;
        const result = applyConfigEdits(source, { 'monitoring.providers.sentry.dsn': 'https://x@sentry.test/1' });

        ctx.expect(result).toBe(`{
  brand: { id: 'a' },
  theme: { id: 'classy' },
  monitoring: {
    providers: {
      sentry: {
        dsn: "https://x@sentry.test/1",
      },
    },
  },
}
`);
      },
    },

    {
      name: 'insert into an empty single-line object: {} becomes a block at the right depth',
      run: (ctx) => {
        const result = applyConfigEdits(NASTY, { 'targets.web.distribute': false });

        ctx.expect(result).toMatch(/    web: \{\n      distribute: false,\n    \},\n    backend: \{\}, \/\/ enabled, defaults/);
      },
    },

    {
      name: 'insert into a single-line object with entries stays single-line',
      run: (ctx) => {
        const source = `{
  connections: { google: 'client-id' },
}
`;
        const result = applyConfigEdits(source, { 'connections.github': 'gh-id' });

        ctx.expect(result).toBe(`{
  connections: { google: 'client-id', github: "gh-id" },
}
`);
      },
    },

    {
      name: 'insert into a comment-only single-line object keeps the comment',
      run: (ctx) => {
        const source = `{
  chatsy: { /* dashboard-created */ },
}
`;
        const result = applyConfigEdits(source, { 'chatsy.agentId': 'agent-9' });

        ctx.expect(JSON5.parse(result).chatsy.agentId).toBe('agent-9');
        ctx.expect(result.includes('/* dashboard-created */')).toBeTruthy();
      },
    },

    {
      name: 'insert into a multi-line comment-only object lands after the comment',
      run: (ctx) => {
        const source = `{
  payment: {
    // providers land here at onboarding
  },
}
`;
        const result = applyConfigEdits(source, { 'payment.enabled': true });

        ctx.expect(result).toBe(`{
  payment: {
    // providers land here at onboarding
    enabled: true,
  },
}
`);
      },
    },

    // ─── Inserted comments (the manage-run heal, #478) ───

    {
      name: 'an inserted block is documented by dot-path: the property AND the keys inside it',
      run: (ctx) => {
        const source = `{
  brand: { id: 'a' },
}
`;
        const result = applyConfigEdits(
          source,
          { marketing: { prune: { enabled: true } } },
          {
            comments: {
              marketing: 'Marketing automation: the campaigns + newsletter roles and the prune switch.',
              'marketing.prune.enabled': 'Monthly cold-contact prune across both providers. ON by default — false is the per-brand off switch.',
            },
          },
        );

        ctx.expect(result).toBe(`{
  brand: { id: 'a' },
  // Marketing automation: the campaigns + newsletter roles and the prune
  // switch.
  marketing: {
    prune: {
      // Monthly cold-contact prune across both providers. ON by default — false
      // is the per-brand off switch.
      enabled: true,
    },
  },
}
`);
        ctx.expect(JSON5.parse(result).marketing.prune.enabled).toBe(true);
      },
    },

    {
      name: 'a comment lands at the key its dot-path names, wherever inside the insert that is',
      run: (ctx) => {
        const source = `{
  brand: { id: 'a' },
}
`;
        const result = applyConfigEdits(
          source,
          { 'marketing.prune': { enabled: true } },
          { comments: { 'marketing.prune': 'The prune switch.' } },
        );

        ctx.expect(result).toBe(`{
  brand: { id: 'a' },
  marketing: {
    // The prune switch.
    prune: {
      enabled: true,
    },
  },
}
`);
      },
    },

    {
      name: 'a REPLACED value never gains a comment (comments document new blocks only)',
      run: (ctx) => {
        const result = applyConfigEdits(
          NASTY,
          { 'marketing.campaigns.enabled': false },
          { comments: { 'marketing.campaigns.enabled': 'Role-level switch for email marketing.' } },
        );

        ctx.expect(result).toBe(NASTY.replace('enabled: true,', 'enabled: false,'));
        ctx.expect(!result.includes('// Role-level switch'), 'an authored key keeps its own documentation').toBeTruthy();
      },
    },

    {
      name: 'an insert with no comment for its path is unchanged by the comments option',
      run: (ctx) => {
        const withOption = applyConfigEdits(NASTY, { 'brand.tagline': 'Test' }, { comments: { 'something.else': 'x' } });

        ctx.expect(withOption).toBe(applyConfigEdits(NASTY, { 'brand.tagline': 'Test' }));
      },
    },

    {
      name: 'string values escape safely via JSON.stringify',
      run: (ctx) => {
        const result = applyConfigEdits(NASTY, { 'brand.tagline': `It's "quoted"\nand multiline` });

        ctx.expect(JSON5.parse(result).brand.tagline).toBe(`It's "quoted"\nand multiline`);
      },
    },

    {
      name: 'duplicate keys: the last occurrence (the one JSON5 keeps) is the one edited',
      run: (ctx) => {
        const source = `{
  theme: { id: 'old' },
  theme: { id: 'classy' },
}
`;
        const result = applyConfigEdits(source, { 'theme.id': 'bootstrap' });

        ctx.expect(result.includes("theme: { id: 'old' }")).toBeTruthy();
        ctx.expect(JSON5.parse(result).theme.id).toBe('bootstrap');
      },
    },

    // ─── Errors: never write nonsense ───

    {
      name: 'intermediate non-object, out-of-range array index, and non-numeric array segment all throw',
      run: (ctx) => {
        const source = `{
  marketing: false,
  payment: { products: [{ id: 'a' }] },
}
`;
        ctx.expect(() => applyConfigEdits(source, { 'marketing.campaigns.providers.sendgrid.listId': 'x' })).toThrow(/'marketing' is not an object/);
        ctx.expect(() => applyConfigEdits(source, { 'payment.products[3].id': 'x' })).toThrow(/index 3 is out of range/);
        ctx.expect(() => applyConfigEdits(source, { 'payment.products.first.id': 'x' })).toThrow(/expected a \[0\] position or \[key=value\] matcher/);
        // The old dotted spelling of a position is a plain key now, never an index
        ctx.expect(() => applyConfigEdits(source, { 'payment.products.1.id': 'x' })).toThrow(/expected a \[0\] position or \[key=value\] matcher, got '1'/);
      },
    },

    {
      name: 'unparseable input throws before any editing',
      run: (ctx) => {
        ctx.expect(() => applyConfigEdits('{ brand: }', { 'brand.id': 'x' })).toThrow(/JSON5/i);
      },
    },

    // ─── writeConfigValues (file-level) ───

    {
      name: 'writeConfigValues edits config/omega.json5 in place and reports applied paths',
      run: (ctx) => {
        const root = makeFixture('write-values', { 'config/omega.json5': NASTY });
        cleanup(ctx, root);

        const report = writeConfigValues(root, {
          'marketing.campaigns.providers.sendgrid.listId': 'sg-9',
          'marketing.newsletter.providers.beehiiv.publicationId': 'pub-9',
          'brand.id': 'fixture-brand', // already equal — must not count as applied
        });

        ctx.expect(report.path).toBe(path.join(root, 'config', 'omega.json5'));
        ctx.expect(report.changed).toBe(true);
        ctx.expect(report.applied.sort()).toEqual(['marketing.campaigns.providers.sendgrid.listId', 'marketing.newsletter.providers.beehiiv.publicationId']);

        const written = fs.readFileSync(report.path, 'utf8');
        ctx.expect(JSON5.parse(written).marketing.campaigns.providers.sendgrid.listId).toBe('sg-9');
        ctx.expect(written.includes('// Fixture Brand — hand-edited')).toBeTruthy();

        // Rerun with the same values: nothing applied, file byte-identical
        const rerun = writeConfigValues(root, { 'marketing.campaigns.providers.sendgrid.listId': 'sg-9', 'marketing.newsletter.providers.beehiiv.publicationId': 'pub-9' });
        ctx.expect(rerun.changed).toBe(false);
        ctx.expect(rerun.applied).toEqual([]);
        ctx.expect(fs.readFileSync(report.path, 'utf8')).toBe(written);
      },
    },

    {
      name: 'writeConfigValues resolves the target-root location (staged functions/config is never a writeback target) and throws when no config exists',
      run: (ctx) => {
        // src/dist pillar: a backend target's AUTHORED config is config/omega.json5 at
        // the target root; functions/config/omega.json5 is staged compose output and
        // must never be edited (the next stage would overwrite it).
        const backend = makeFixture('write-backend', {
          'config/omega.json5': `{\n  brand: { id: 'b' },\n}\n`,
          'functions/config/omega.json5': `// staged output — never a writeback target\n{ brand: { id: 'b' } }\n`,
        });
        cleanup(ctx, backend);

        const report = writeConfigValues(backend, { 'brand.name': 'B' });
        ctx.expect(report.path).toBe(path.join(backend, 'config', 'omega.json5'));
        ctx.expect(JSON5.parse(fs.readFileSync(report.path, 'utf8')).brand.name).toBe('B');
        ctx.expect(!fs.readFileSync(path.join(backend, 'functions', 'config', 'omega.json5'), 'utf8').includes('"B"'), 'staged file untouched').toBeTruthy();

        const empty = makeFixture('write-empty', { 'README.md': 'no config here' });
        cleanup(ctx, empty);
        ctx.expect(() => writeConfigValues(empty, { 'brand.id': 'x' })).toThrow(/No omega\.json5 found/);
      },
    },

    // ─── The real thing: a scaffold-shaped config takes the full cp59 write set ───

    {
      name: 'scaffold-shaped omega.json5 absorbs the manage-run writeback set with every comment intact',
      run: (ctx) => {
        const scaffold = `// Acme — brand-level omega.json5: the shared config layer every target
// under targets/ inherits. Local files override any key per-surface; key presence
// under \`targets\` = this brand supports that target. Secrets NEVER live here —
// they go in the gitignored .env (the loader hard-fails on secret-shaped keys).
{
  brand: {
    id: "acme",
    name: "Acme",
    url: "https://acme.com",
    contact: {
      email: "support@acme.com",
    },
  },

  // Project-owned theme — seeded at onboarding, yours to change.
  theme: {
    id: "classy",
    appearance: "system", // "system" | "light" | "dark"
  },

  // Key presence = target enabled; the value is that target's type-wide
  // config (any shared key inside overrides it for that surface).
  targets: {
    web: {},
    backend: {},
  },
}
`;
        const commentLines = scaffold.split('\n').filter((line) => line.trim().startsWith('//'));

        const result = applyConfigEdits(scaffold, {
          'marketing.campaigns.providers.sendgrid.listId': 'sg-list-1',
          'marketing.newsletter.providers.beehiiv.publicationId': 'pub-1',
          'cloud.config.apiKey': 'AIza-test',
          'cloud.config.authDomain': 'acme.com',
          'cloud.config.projectId': 'acme-app',
          'cloud.config.appId': '1:123:web:abc',
        });

        const parsed = JSON5.parse(result);
        ctx.expect(parsed.marketing.campaigns.providers.sendgrid.listId).toBe('sg-list-1');
        ctx.expect(parsed.marketing.newsletter.providers.beehiiv.publicationId).toBe('pub-1');
        ctx.expect(parsed.cloud.config).toEqual({ apiKey: 'AIza-test', authDomain: 'acme.com', projectId: 'acme-app', appId: '1:123:web:abc' });

        for (const line of commentLines) {
          ctx.expect(result.includes(line), `comment lost: ${line}`).toBeTruthy();
        }

        // Second application of the same set is a no-op
        ctx.expect(applyConfigEdits(result, {
          'marketing.campaigns.providers.sendgrid.listId': 'sg-list-1',
          'marketing.newsletter.providers.beehiiv.publicationId': 'pub-1',
          'cloud.config.apiKey': 'AIza-test',
          'cloud.config.authDomain': 'acme.com',
          'cloud.config.projectId': 'acme-app',
          'cloud.config.appId': '1:123:web:abc',
        })).toBe(result);
      },
    },

    {
      name: 'remove: the key, its subtree, its comma and its own comment go — every other byte survives',
      run: (ctx) => {
        const result = applyConfigRemovals(CONVERTED, ['targets.web.download', 'targets.web.extension']);
        const parsed = JSON5.parse(result);

        ctx.expect(parsed.targets.web.download).toBe(undefined);
        ctx.expect(parsed.targets.web.extension).toBe(undefined);
        ctx.expect(parsed.targets.web.redirects).toEqual([]);
        ctx.expect(parsed.targets.backend).toEqual({});
        ctx.expect(parsed.brand.id).toBe('fixture-brand');

        // The removed keys' documenting comments go with them; nothing else moves.
        ctx.expect(!result.includes('The download page map'), 'the removed key kept its comment').toBeTruthy();
        ctx.expect(!result.includes('Store listings for the /extension page'), 'the removed key kept its comment').toBeTruthy();
        ctx.expect(result.includes('// Fixture Brand — converted from UJM, comments carried across')).toBeTruthy();
        ctx.expect(result.includes('redirects: [], // keep me')).toBeTruthy();
        ctx.expect(result.includes('backend: {}, // enabled, defaults')).toBeTruthy();
        ctx.expect(!/^\s*mac:/m.test(result), 'the subtree survived the removal').toBeTruthy();
        ctx.expect(!/\n[ \t]*\n[ \t]*\n/.test(result), 'the removal left blank lines stacked up').toBeTruthy();
      },
    },

    {
      name: 'remove: an absent path is a no-op — reruns are byte-identical',
      run: (ctx) => {
        const once = applyConfigRemovals(CONVERTED, ['targets.web.download', 'targets.web.extension']);
        const twice = applyConfigRemovals(once, ['targets.web.download', 'targets.web.extension', 'targets.web.nothing']);

        ctx.expect(twice).toBe(once);
        ctx.expect(applyConfigRemovals(CONVERTED, [])).toBe(CONVERTED);
      },
    },

    {
      name: 'remove: a single-line object loses the property inline',
      run: (ctx) => {
        const source = `{\n  targets: { web: { extension: { chrome: 'x' }, redirects: [] } },\n}\n`;
        const result = applyConfigRemovals(source, ['targets.web.extension']);

        ctx.expect(result).toBe(`{\n  targets: { web: { redirects: [] } },\n}\n`);
      },
    },

    {
      name: 'remove: a name-matched retired key at any depth, including inside an instance array',
      run: (ctx) => {
        const source = `{
  targets: {
    backend: [
      { id: 'main', web_manager: { auth: true } },
      { id: 'worker' },
    ],
  },
}
`;
        const parsed = JSON5.parse(applyConfigRemovals(source, ['targets.backend[0].web_manager']));

        ctx.expect(parsed.targets.backend).toEqual([{ id: 'main' }, { id: 'worker' }]);
      },
    },

    {
      name: 'removeConfigValues: reports what it removed, dry-run writes nothing, reruns are no-ops',
      run: (ctx) => {
        const root = makeFixture('remove-values', { 'config/omega.json5': CONVERTED });
        cleanup(ctx, root);
        const configPath = path.join(root, 'config', 'omega.json5');

        const planned = removeConfigValues(root, ['targets.web.download', 'targets.web.extension'], { dryRun: true });
        ctx.expect(planned.removed).toEqual(['targets.web.download', 'targets.web.extension']);
        ctx.expect(planned.changed).toBe(true);
        ctx.expect(fs.readFileSync(configPath, 'utf8'), 'dry run wrote to the file').toBe(CONVERTED);

        const report = removeConfigValues(root, ['targets.web.download', 'targets.web.extension']);
        ctx.expect(report.path).toBe(configPath);
        ctx.expect(report.removed).toEqual(['targets.web.download', 'targets.web.extension']);
        const written = fs.readFileSync(configPath, 'utf8');
        ctx.expect(JSON5.parse(written).targets.web.download).toBe(undefined);

        const rerun = removeConfigValues(root, ['targets.web.download', 'targets.web.extension']);
        ctx.expect(rerun.removed).toEqual([]);
        ctx.expect(rerun.changed).toBe(false);
        ctx.expect(fs.readFileSync(configPath, 'utf8'), 'the rerun rewrote the file').toBe(written);
      },
    },

    // ─── A list position in a file path: the seo sidecar's shape ───

    {
      name: 'writeConfigFileValues and removeConfigFileValues take a [N] position: the item key lands and goes, comments kept',
      run: (ctx) => {
        const source = `// SEO sidecar: one content item
{
  github: {
    content: [
      {
        // The repo name is infrastructure
        name: 'fixture-tool',
        org: 'Acme-Org',
        title: 'Fixture Tool', // the brand's voice
      },
    ],
  },
}
`;
        const root = makeFixture('file-values-position', { 'config/seo.json5': source });
        cleanup(ctx, root);
        const file = path.join(root, 'config', 'seo.json5');

        writeConfigFileValues(file, { 'github.content[0].owner': 'Acme' });
        removeConfigFileValues(file, ['github.content[0].org']);

        const written = fs.readFileSync(file, 'utf8');
        ctx.expect(JSON5.parse(written)).toEqual({
          github: { content: [{ name: 'fixture-tool', owner: 'Acme', title: 'Fixture Tool' }] },
        });

        // Every other byte stays: less the one line each edit touched, the files match
        const without = (text, key) => text.split('\n').filter((line) => !line.includes(`${key}:`)).join('\n');
        ctx.expect(without(written, 'owner')).toBe(without(source, 'org'));
      },
    },
  ],
});
