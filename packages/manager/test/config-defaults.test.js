// Tests for the workspace `defaults` ensure op — the self-healing config
// ([#478](https://github.com/Omega-JS-Stack/omega/issues/478)): every manage
// run materializes the schema-defaulted blocks a brand's omega.json5 is
// missing, with the schema's own description as the guiding comment, and never
// rewrites a value the brand authored. Real files in a temp dir, no mocks.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const JSON5 = require('json5');

const defaultsOp = require('../src/services/workspace/ensure/defaults.js');

// A hand-authored brand config: comments and blank lines are load-bearing,
// marketing is switched OFF against the schema default, and whole sections
// (search, monitoring, …) have never been written.
const AUTHORED = `// Fixture Brand — hand-edited
{
  brand: {
    id: 'fixture-brand', // single quotes, stay single
    name: "Fixture Brand",
  },

  /* marketing — the brand disabled pruning on purpose */
  marketing: {
    prune: {
      enabled: false,
    },
  },

  targets: {
    web: { type: 'web' },
  },
}
`;

function makeBrand(contents = AUTHORED) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-config-defaults-'));
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.writeFileSync(path.join(root, 'config', 'omega.json5'), contents);
  return root;
}

const configPath = (root) => path.join(root, 'config', 'omega.json5');
const read = (root) => fs.readFileSync(configPath(root), 'utf8');

test('defaults: a config missing a schema-defaulted block gains it, comments intact', async () => {
  const root = makeBrand();

  const result = await defaultsOp({ brandRoot: root, options: {} });

  const source = read(root);
  const parsed = JSON5.parse(source);

  assert.equal(parsed.marketing.campaigns.enabled, true, 'the missing sibling block materialized');
  assert.equal(parsed.search.providers.searchConsole.enabled, true, 'a whole missing section materialized');
  assert.deepEqual(parsed.search.providers.searchConsole.sitemapPaths, ['/sitemap.xml']);

  // Every authored byte survives: comments, quote style, blank lines
  assert.ok(source.includes('// Fixture Brand — hand-edited'));
  assert.ok(source.includes("id: 'fixture-brand', // single quotes, stay single"));
  assert.ok(source.includes('/* marketing — the brand disabled pruning on purpose */'));

  // Every materialized key carries the schema's own guiding comment, wrapped
  // at its own indent
  assert.match(source, /\n {8}\/\/ false = skip sitemap submission to Google Search Console\.\n {8}submitSitemap: true,/);
  assert.match(source, /\/\/ Role-level switch for email marketing[\s\S]*?\n {6}enabled: true,/);

  assert.ok(result.output.defaults.materialized.includes('search'), 'the run output names what was healed');
});

test('#793: a resolution-only default (connections) is never written into the brand file', async () => {
  // `materialize: false` on the schema rule: the connection cards' presentation
  // resolves from the framework and is never copied into a brand's config,
  // where it would drift from the framework it came from.
  const root = makeBrand();

  const result = await defaultsOp({ brandRoot: root, options: {} });

  const source = read(root);
  const parsed = JSON5.parse(source);

  assert.equal(parsed.connections, undefined, `the brand file gained no connections block: ${source}`);
  assert.ok(!source.includes('Per-provider user-connection settings'), 'nor its schema description as a comment');
  assert.ok(!result.output.defaults.materialized.includes('connections'), 'and the run never claims to have healed one');
  assert.ok(result.output.defaults.materialized.includes('search'), 'while the ordinary blocks still materialize');
});

test('#883: the repo block is never materialized, because its presence IS the switch', async () => {
  // A defaulted `repo: { provider: 'github' }` would say every brand hosts its
  // source somewhere, and the repo service would run for a brand that declared
  // nothing.
  const root = makeBrand();

  const result = await defaultsOp({ brandRoot: root, options: {} });

  assert.equal(JSON5.parse(read(root)).repo, undefined);
  assert.ok(!result.output.defaults.materialized.includes('repo'));
});

test('defaults: a value the brand authored is never overwritten', async () => {
  const root = makeBrand();

  await defaultsOp({ brandRoot: root, options: {} });

  const parsed = JSON5.parse(read(root));
  assert.equal(parsed.marketing.prune.enabled, false, 'the brand\'s own decision stands');
  assert.equal(parsed.brand.id, 'fixture-brand');
});

test('defaults: marketing.prune.enabled materializes TRUE for a brand that never wrote it', async () => {
  const root = makeBrand(`{
  brand: { id: 'fixture-brand', name: 'Fixture Brand' },
}
`);

  await defaultsOp({ brandRoot: root, options: {} });

  assert.equal(JSON5.parse(read(root)).marketing.prune.enabled, true);
});

test('defaults: a second run heals nothing and leaves the file byte-identical', async () => {
  const root = makeBrand();

  await defaultsOp({ brandRoot: root, options: {} });
  const healed = read(root);

  const second = await defaultsOp({ brandRoot: root, options: {} });

  assert.equal(read(root), healed, 'not one byte rewritten');
  assert.equal(second, null, 'a converged config is a plain no-op');
});

test('defaults: a dry run reports the blocks and writes nothing', async () => {
  const root = makeBrand();
  const before = read(root);

  const result = await defaultsOp({ brandRoot: root, options: { dryRun: true } });

  assert.equal(read(root), before, 'a dry run never touches the file');
  assert.ok(result.output.defaults.planned.includes('search'));
});

test('defaults: a brand root with no config/omega.json5 steps aside', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-config-defaults-none-'));

  assert.equal(await defaultsOp({ brandRoot: root, options: {} }), null);
});

test('defaults op is registered in the workspace OPERATIONS, right after config', () => {
  const { OPERATIONS } = require('../src/config.js');
  const names = OPERATIONS.workspace.map((op) => op.name);

  assert.ok(OPERATIONS.workspace.some((op) => op.name === 'defaults' && op.ensure === true));
  assert.equal(names.indexOf('defaults'), names.indexOf('config') + 1, 'heals only after the config is known sane');
});

test('manager DEFAULTS derive from the schema — one home per default', () => {
  const { DEFAULTS } = require('../src/config.js');
  const { schemaDefaults } = require('@omega.js/config');

  // The schema answer reaches every manager read site through DEFAULTS…
  assert.equal(DEFAULTS.search.providers.searchConsole.enabled, schemaDefaults().search.providers.searchConsole.enabled);
  assert.equal(DEFAULTS.marketing.prune.enabled, true);
  assert.equal(DEFAULTS.inbound.chat.providers.chatsy.enabled, true);

  // …and the service-owned data the schema does not declare still lives here
  assert.equal(DEFAULTS.edge.providers.cloudflare.settings.ssl, 'full');
  assert.equal(DEFAULTS.analytics.providers.google.currency, 'USD');
});
