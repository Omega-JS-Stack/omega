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
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const JSON5 = require('json5');

const { applyConfigEdits, writeConfigValues } = require('../src/index.js');

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

// ─── Replace ───

test('replace an existing leaf: only the value span changes, every other byte survives', () => {
  const result = applyConfigEdits(NASTY, { 'marketing.campaigns.providers.sendgrid.listId': 'sg-list-123' });

  assert.equal(result, NASTY.replace('listId: null, // resolved', 'listId: "sg-list-123", // resolved'));
  assert.equal(JSON5.parse(result).marketing.campaigns.providers.sendgrid.listId, 'sg-list-123');
});

test('already-equal edits are skipped: output is byte-identical (quote style untouched)', () => {
  // brand.id already holds 'fixture-brand' in single quotes — no rewrite to double
  const result = applyConfigEdits(NASTY, {
    'brand.id': 'fixture-brand',
    'marketing.campaigns.enabled': true,
    'payment.products.1.stripe.productId': null,
  });

  assert.equal(result, NASTY);
});

test('array-element leaf replace via numeric segment', () => {
  const result = applyConfigEdits(NASTY, { 'payment.products.1.stripe.productId': 'prod_ABC' });

  assert.equal(result, NASTY.replace("stripe: { productId: null }", 'stripe: { productId: "prod_ABC" }'));
});

test('[key=value] matcher self-locates the array element: replace and insert', () => {
  // Replace inside the matched element — identical result to the index path
  const replaced = applyConfigEdits(NASTY, { 'payment.products[id=plus].stripe.productId': 'prod_ABC' });
  assert.equal(replaced, applyConfigEdits(NASTY, { 'payment.products.1.stripe.productId': 'prod_ABC' }));

  // Insert a missing branch into the matched element (free has no `paypal` key)
  const inserted = applyConfigEdits(NASTY, { 'payment.products[id=plus].paypal.productId': 'PP-1' });
  const parsed = JSON5.parse(inserted);
  assert.equal(parsed.payment.products[1].paypal.productId, 'PP-1');
  assert.ok(inserted.includes("name: 'Plus', // display name"));

  // Already-equal through a matcher is skipped byte-identically
  assert.equal(applyConfigEdits(inserted, { 'payment.products[id=plus].paypal.productId': 'PP-1' }), inserted);
});

test('[key=value] matcher with no matching element throws; matcher below a missing branch throws', () => {
  assert.throws(
    () => applyConfigEdits(NASTY, { 'payment.products[id=ghost].stripe.productId': 'x' }),
    /no array element with id=ghost/
  );
  assert.throws(
    () => applyConfigEdits(NASTY, { 'oauth2.providers[id=google].clientId': 'x' }),
    /matcher cannot create array elements/
  );
});

test('replacing a leaf with an object serializes a house-style block at the right indent', () => {
  const source = `{
  cloud: null, // filled by the firebase service
}
`;
  const result = applyConfigEdits(source, { cloud: { apiKey: 'k', projectId: 'p' } });

  assert.equal(result, `{
  cloud: {
    apiKey: "k",
    projectId: "p",
  }, // filled by the firebase service
}
`);
});

// ─── Insert ───

test('insert a missing leaf into a multi-line object: lands before the closing brace', () => {
  const result = applyConfigEdits(NASTY, { 'marketing.campaigns.providers.sendgrid.listName': 'Fixture Brand' });

  assert.match(result, /listId: null, \/\/ resolved by the campaigns service\n          listName: "Fixture Brand",\n        \},/);
  assert.equal(JSON5.parse(result).marketing.campaigns.providers.sendgrid.listName, 'Fixture Brand');
});

test('insert a whole missing branch: nested block, one property, correct depth', () => {
  const result = applyConfigEdits(NASTY, { 'marketing.newsletter.providers.beehiiv.publicationId': 'pub-1' });

  assert.match(result, /    newsletter: \{\n      providers: \{\n        beehiiv: \{\n          publicationId: "pub-1",\n        \},\n      \},\n    \},\n  \},/);
  assert.equal(JSON5.parse(result).marketing.newsletter.providers.beehiiv.publicationId, 'pub-1');
  // The sibling campaigns block (and its comments) survives untouched
  assert.ok(result.includes('listId: null, // resolved by the campaigns service'));
  assert.ok(result.includes('/* marketing — ids resolve at manage time */'));
});

test('insert at the root: goes before the final brace, previous last entry gains its comma', () => {
  const source = `{
  brand: { id: 'a' },
  theme: { id: 'classy' }
}
`;
  const result = applyConfigEdits(source, { 'monitoring.providers.sentry.dsn': 'https://x@sentry.test/1' });

  assert.equal(result, `{
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
});

test('insert into an empty single-line object: {} becomes a block at the right depth', () => {
  const result = applyConfigEdits(NASTY, { 'targets.web.distribute': false });

  assert.match(result, /    web: \{\n      distribute: false,\n    \},\n    backend: \{\}, \/\/ enabled, defaults/);
});

test('insert into a single-line object with entries stays single-line', () => {
  const source = `{
  oauth2: { google: 'client-id' },
}
`;
  const result = applyConfigEdits(source, { 'oauth2.github': 'gh-id' });

  assert.equal(result, `{
  oauth2: { google: 'client-id', github: "gh-id" },
}
`);
});

test('insert into a comment-only single-line object keeps the comment', () => {
  const source = `{
  chatsy: { /* dashboard-created */ },
}
`;
  const result = applyConfigEdits(source, { 'chatsy.agentId': 'agent-9' });

  assert.equal(JSON5.parse(result).chatsy.agentId, 'agent-9');
  assert.ok(result.includes('/* dashboard-created */'));
});

test('insert into a multi-line comment-only object lands after the comment', () => {
  const source = `{
  payment: {
    // providers land here at onboarding
  },
}
`;
  const result = applyConfigEdits(source, { 'payment.enabled': true });

  assert.equal(result, `{
  payment: {
    // providers land here at onboarding
    enabled: true,
  },
}
`);
});

test('string values escape safely via JSON.stringify', () => {
  const result = applyConfigEdits(NASTY, { 'brand.tagline': `It's "quoted"\nand multiline` });

  assert.equal(JSON5.parse(result).brand.tagline, `It's "quoted"\nand multiline`);
});

test('duplicate keys: the last occurrence (the one JSON5 keeps) is the one edited', () => {
  const source = `{
  theme: { id: 'old' },
  theme: { id: 'classy' },
}
`;
  const result = applyConfigEdits(source, { 'theme.id': 'bootstrap' });

  assert.ok(result.includes("theme: { id: 'old' }"));
  assert.equal(JSON5.parse(result).theme.id, 'bootstrap');
});

// ─── Errors: never write nonsense ───

test('intermediate non-object, out-of-range array index, and non-numeric array segment all throw', () => {
  const source = `{
  marketing: false,
  payment: { products: [{ id: 'a' }] },
}
`;
  assert.throws(() => applyConfigEdits(source, { 'marketing.campaigns.providers.sendgrid.listId': 'x' }), /'marketing' is not an object/);
  assert.throws(() => applyConfigEdits(source, { 'payment.products.3.id': 'x' }), /index 3 is out of range/);
  assert.throws(() => applyConfigEdits(source, { 'payment.products.first.id': 'x' }), /expected a numeric index/);
});

test('unparseable input throws before any editing', () => {
  assert.throws(() => applyConfigEdits('{ brand: }', { 'brand.id': 'x' }), /JSON5/i);
});

// ─── writeConfigValues (file-level) ───

test('writeConfigValues edits config/omega.json5 in place and reports applied paths', (t) => {
  const root = makeFixture('write-values', { 'config/omega.json5': NASTY });
  cleanup(t, root);

  const report = writeConfigValues(root, {
    'marketing.campaigns.providers.sendgrid.listId': 'sg-9',
    'marketing.newsletter.providers.beehiiv.publicationId': 'pub-9',
    'brand.id': 'fixture-brand', // already equal — must not count as applied
  });

  assert.equal(report.path, path.join(root, 'config', 'omega.json5'));
  assert.equal(report.changed, true);
  assert.deepEqual(report.applied.sort(), ['marketing.campaigns.providers.sendgrid.listId', 'marketing.newsletter.providers.beehiiv.publicationId']);

  const written = fs.readFileSync(report.path, 'utf8');
  assert.equal(JSON5.parse(written).marketing.campaigns.providers.sendgrid.listId, 'sg-9');
  assert.ok(written.includes('// Fixture Brand — hand-edited'));

  // Rerun with the same values: nothing applied, file byte-identical
  const rerun = writeConfigValues(root, { 'marketing.campaigns.providers.sendgrid.listId': 'sg-9', 'marketing.newsletter.providers.beehiiv.publicationId': 'pub-9' });
  assert.equal(rerun.changed, false);
  assert.deepEqual(rerun.applied, []);
  assert.equal(fs.readFileSync(report.path, 'utf8'), written);
});

test('writeConfigValues resolves the target-root location (staged functions/config is never a writeback target) and throws when no config exists', (t) => {
  // src/dist pillar: a backend target's AUTHORED config is config/omega.json5 at
  // the target root; functions/config/omega.json5 is staged compose output and
  // must never be edited (the next stage would overwrite it).
  const backend = makeFixture('write-backend', {
    'config/omega.json5': `{\n  brand: { id: 'b' },\n}\n`,
    'functions/config/omega.json5': `// staged output — never a writeback target\n{ brand: { id: 'b' } }\n`,
  });
  cleanup(t, backend);

  const report = writeConfigValues(backend, { 'brand.name': 'B' });
  assert.equal(report.path, path.join(backend, 'config', 'omega.json5'));
  assert.equal(JSON5.parse(fs.readFileSync(report.path, 'utf8')).brand.name, 'B');
  assert.ok(!fs.readFileSync(path.join(backend, 'functions', 'config', 'omega.json5'), 'utf8').includes('"B"'), 'staged file untouched');

  const empty = makeFixture('write-empty', { 'README.md': 'no config here' });
  cleanup(t, empty);
  assert.throws(() => writeConfigValues(empty, { 'brand.id': 'x' }), /No omega\.json5 found/);
});

// ─── The real thing: a scaffold-shaped config takes the full cp59 write set ───

test('scaffold-shaped omega.json5 absorbs the manage-run writeback set with every comment intact', () => {
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
  assert.equal(parsed.marketing.campaigns.providers.sendgrid.listId, 'sg-list-1');
  assert.equal(parsed.marketing.newsletter.providers.beehiiv.publicationId, 'pub-1');
  assert.deepEqual(parsed.cloud.config, { apiKey: 'AIza-test', authDomain: 'acme.com', projectId: 'acme-app', appId: '1:123:web:abc' });

  for (const line of commentLines) {
    assert.ok(result.includes(line), `comment lost: ${line}`);
  }

  // Second application of the same set is a no-op
  assert.equal(applyConfigEdits(result, {
    'marketing.campaigns.providers.sendgrid.listId': 'sg-list-1',
    'marketing.newsletter.providers.beehiiv.publicationId': 'pub-1',
    'cloud.config.apiKey': 'AIza-test',
    'cloud.config.authDomain': 'acme.com',
    'cloud.config.projectId': 'acme-app',
    'cloud.config.appId': '1:123:web:abc',
  }), result);
});
