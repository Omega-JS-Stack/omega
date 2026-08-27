/**
 * Schema-derived defaults ([#478](https://github.com/Omega-JS-Stack/omega/issues/478)):
 * the schema is the ONE home of every config default, the merge chain's lowest
 * layer derives from it, and `missingDefaults()` names the blocks a brand file
 * has yet to materialize (the manage-walk heal reads exactly this list).
 *
 * Fixtures are built under packages/config/.temp/ (gitignored), matching the
 * writeback tests' convention.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { schemaDefaults, missingDefaults, defaultComments, loadConfig, validateConfig } = require('../src/index.js');
const { SHARED_SCHEMA, TARGET_SCHEMAS } = require('../src/schema.js');

const TEMP_ROOT = path.join(__dirname, '..', '.temp');

function makeBrand(name, contents) {
  const root = path.join(TEMP_ROOT, `${name}-${process.pid}`);
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.writeFileSync(path.join(root, 'config', 'omega.json5'), contents);
  return root;
}

function cleanup(t, root) {
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
}

// ─── schemaDefaults ───

test('schemaDefaults: every schema `default:` lands at its own dot-path', () => {
  const defaults = schemaDefaults();

  assert.equal(defaults.marketing.campaigns.enabled, true);
  assert.equal(defaults.repo.providers.github.private, true);
  assert.deepEqual(defaults.search.providers.searchConsole.sitemapPaths, ['/sitemap.xml']);
});

test('schemaDefaults: marketing.prune.enabled defaults TRUE (Ian 2026-08-22)', () => {
  // The #422 follow-up: pruning is ON by default, visible in config, per-brand
  // disableable — never the old opt-in silence.
  const rule = SHARED_SCHEMA.find((entry) => entry.path === 'marketing.prune.enabled');

  assert.equal(rule.default, true);
  assert.equal(schemaDefaults().marketing.prune.enabled, true);
});

test('schemaDefaults: owner-only decisions and provisioned ids carry NO default', () => {
  // Nothing here has a sane framework answer: secrets live in .env, ids are
  // written back by the services, tri-states mean "ask".
  const undefaulted = [
    'brand.id',
    'cloud.config.projectId',
    'cloud.billingAccount',
    'cloud.organizationId',
    'marketing.campaigns.providers.sendgrid.listId',
    'marketing.newsletter.providers.beehiiv.publicationId',
    'payment.providers.stripe.publishableKey',
    'monitoring.providers.sentry.dsn',
    'inbound.chat.providers.chatsy.agentId',
    'forms.providers.slapform.formId',
  ];

  for (const dotted of undefaulted) {
    const rule = SHARED_SCHEMA.find((entry) => entry.path === dotted);
    assert.ok(rule, `missing schema entry ${dotted}`);
    assert.ok(!Object.prototype.hasOwnProperty.call(rule, 'default'), `${dotted} must not carry a default`);
  }
});

test('schemaDefaults: each call returns its own copy — a caller cannot mutate the schema', () => {
  const first = schemaDefaults();
  first.marketing.prune.enabled = false;
  first.search.providers.searchConsole.sitemapPaths.push('/sitemap-2.xml');

  const second = schemaDefaults();
  assert.equal(second.marketing.prune.enabled, true);
  assert.deepEqual(second.search.providers.searchConsole.sitemapPaths, ['/sitemap.xml']);
});

test('schemaDefaults: every default satisfies its own rule (the schema validates itself)', () => {
  const config = { ...schemaDefaults(), brand: { id: 'mini', name: 'MiniCo' } };

  assert.deepEqual(validateConfig(config).errors, []);
});

test('schemaDefaults: a target overlays its own refinements on the shared set', () => {
  const targetRules = Object.values(TARGET_SCHEMAS).flat().filter((rule) => Object.prototype.hasOwnProperty.call(rule, 'default'));
  const web = schemaDefaults('web');

  assert.equal(web.marketing.prune.enabled, true, 'the shared set always applies');
  for (const rule of targetRules) {
    assert.notEqual(
      rule.path.split('.').reduce((node, key) => (node == null ? undefined : node[key]), web),
      undefined,
      `targets.web.${rule.path} default did not land`,
    );
  }
});

// ─── The merge chain's lowest layer ───

test('loadConfig: schema defaults are the LOWEST layer — a brand value beats them', (t) => {
  const root = makeBrand('defaults-lowest', `{
  brand: { id: 'mini', name: 'MiniCo' },
  marketing: { prune: { enabled: false } },
  targets: { web: {} },
}
`);
  cleanup(t, root);

  const { config } = loadConfig(root, 'web');

  assert.equal(config.marketing.prune.enabled, false, 'the brand file wins');
  assert.equal(config.marketing.campaigns.enabled, true, 'the untouched default still lands');
  assert.equal(config.repo.providers.github.private, true);
});

test('loadConfig: framework defaults still layer ON TOP of the schema defaults', (t) => {
  const root = makeBrand('defaults-framework', `{
  brand: { id: 'mini', name: 'MiniCo' },
  targets: { web: {} },
}
`);
  cleanup(t, root);

  const { config } = loadConfig(root, 'web', { defaults: { marketing: { prune: { enabled: false } } } });

  assert.equal(config.marketing.prune.enabled, false, 'a genuine framework difference overrides the schema default');
});

// ─── missingDefaults (the heal list) ───

test('missingDefaults: reports the HIGHEST missing branch, once', () => {
  const missing = missingDefaults({ brand: { id: 'mini', name: 'MiniCo' } });
  const paths = missing.map((entry) => entry.path);

  assert.ok(paths.includes('marketing'), 'the whole missing section materializes as one block');
  assert.ok(!paths.some((dotted) => dotted.startsWith('marketing.')), 'never a second edit inside the block it just added');

  const marketing = missing.find((entry) => entry.path === 'marketing');
  assert.equal(marketing.value.prune.enabled, true);
});

test('defaultComments: every defaulted key and the containers above it are documented', () => {
  const comments = defaultComments();

  assert.match(comments['marketing.prune.enabled'], /ON by default/);
  assert.match(comments.marketing, /\S/, 'the container a materialized block lands at is documented too');
  assert.equal(comments['brand.id'], undefined, 'a key with no default is never written, so it needs no comment');
});

test('missingDefaults: an existing block keeps its values and gains only what it lacks', () => {
  const missing = missingDefaults({
    brand: { id: 'mini', name: 'MiniCo' },
    marketing: { campaigns: { enabled: false } },
  });
  const paths = missing.map((entry) => entry.path);

  assert.ok(!paths.includes('marketing'), 'the section is present — never rewritten whole');
  assert.ok(!paths.includes('marketing.campaigns.enabled'), 'an authored value is never overwritten');
  assert.ok(paths.includes('marketing.newsletter'), 'the missing sibling block is named');
  assert.ok(paths.includes('marketing.prune'), 'the new subsystem appears on the next run');

  const prune = missing.find((entry) => entry.path === 'marketing.prune');
  assert.deepEqual(prune.value, { enabled: true });
});

test('missingDefaults: a block the brand deliberately switched off is left alone', () => {
  // `marketing: false` is an authored value, not a hole to fill — diving into
  // it would clobber the brand's own decision.
  const paths = missingDefaults({ brand: { id: 'mini' }, marketing: false }).map((entry) => entry.path);

  assert.ok(!paths.some((dotted) => dotted.startsWith('marketing')), 'nothing is written under an authored non-object');
});

test('missingDefaults: a fully materialized config has nothing left to heal', () => {
  const config = { ...schemaDefaults(), brand: { id: 'mini', name: 'MiniCo' } };

  assert.deepEqual(missingDefaults(config), []);
});
