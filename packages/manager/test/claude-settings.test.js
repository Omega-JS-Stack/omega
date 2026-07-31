// Tests for src/lib/claude-settings.js + the workspace `claude-settings`
// ensure op — the consumer half of the plugin install
// ([#62](https://github.com/Omega-JS-Stack/omega/issues/62)): a brand's
// committed .claude/settings.json registers the omega marketplace from the
// INSTALLED manager package and enables the plugin, so every brand session
// loads it. Gated on a published install (the vendored marketplace); the
// local era is covered by the developer's own user-scope install and skips.
// Idempotent, non-clobbering: only the two omega keys are ever touched.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  SETTINGS_FILE,
  MARKETPLACE_KEY,
  PLUGIN_KEY,
  marketplaceEntry,
  ensureClaudeSettings,
} = require('../src/lib/claude-settings.js');
const claudeSettingsOp = require('../src/services/workspace/ensure/claude-settings.js');

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'omega-claude-settings-'));
}

// A brand whose node_modules carries a PUBLISHED manager install — the
// vendored .claude-plugin/marketplace.json is the gate.
function publishedBrand() {
  const dir = tmpdir();
  const managerRoot = path.join(dir, 'node_modules', '@omega.js', 'manager', '.claude-plugin');
  fs.mkdirSync(managerRoot, { recursive: true });
  fs.writeFileSync(path.join(managerRoot, 'marketplace.json'), JSON.stringify({ name: 'omega', plugins: [] }));
  return dir;
}

const readSettings = (dir) => JSON.parse(fs.readFileSync(path.join(dir, SETTINGS_FILE), 'utf8'));

// ─── ensureClaudeSettings ────────────────────────────────────────────────────

test('claude-settings: a published install with no settings file gets one created', () => {
  const dir = publishedBrand();

  assert.equal(ensureClaudeSettings(dir), 'created');

  const settings = readSettings(dir);
  assert.deepEqual(settings[MARKETPLACE_KEY].omega, marketplaceEntry());
  assert.equal(settings[MARKETPLACE_KEY].omega.source.path, './node_modules/@omega.js/manager', 'never the monorepo path');
  assert.equal(settings[PLUGIN_KEY]['omega@omega'], true);

  assert.equal(ensureClaudeSettings(dir), 'present', 'a second run is a no-op');
});

test('claude-settings: an existing file is healed in place — every other key survives', () => {
  const dir = publishedBrand();
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(dir, SETTINGS_FILE), `${JSON.stringify({
    permissions: { allow: ['Bash(npm test)'] },
    extraKnownMarketplaces: { other: { source: { source: 'github', repo: 'someone/plugins' } } },
    enabledPlugins: { 'other@other': true, 'omega@omega': false },
  }, null, 2)}\n`);

  assert.equal(ensureClaudeSettings(dir), 'healed');

  const settings = readSettings(dir);
  assert.deepEqual(settings.permissions, { allow: ['Bash(npm test)'] }, 'consumer keys are preserved');
  assert.deepEqual(settings[MARKETPLACE_KEY].other, { source: { source: 'github', repo: 'someone/plugins' } });
  assert.equal(settings[PLUGIN_KEY]['other@other'], true, 'other plugins are left enabled');
  assert.deepEqual(settings[MARKETPLACE_KEY].omega, marketplaceEntry());
  assert.equal(settings[PLUGIN_KEY]['omega@omega'], true, 'the stale disabled entry is healed');

  assert.equal(ensureClaudeSettings(dir), 'present');
});

test('claude-settings: an already-correct file is never rewritten', () => {
  const dir = publishedBrand();
  ensureClaudeSettings(dir);

  const file = path.join(dir, SETTINGS_FILE);
  const before = fs.statSync(file).mtimeMs;
  fs.utimesSync(file, new Date(0), new Date(0));

  assert.equal(ensureClaudeSettings(dir), 'present');
  assert.equal(fs.statSync(file).mtimeMs, 0, 'no write happened');
  assert.ok(before >= 0);
});

test('claude-settings: no vendored marketplace (local era / pre-install) skips without writing', () => {
  const local = tmpdir();
  fs.mkdirSync(path.join(local, 'node_modules', '@omega.js', 'manager'), { recursive: true });

  assert.equal(ensureClaudeSettings(local), 'skipped');
  assert.ok(!fs.existsSync(path.join(local, '.claude')), 'nothing is created in a local-era brand');

  const bare = tmpdir();
  assert.equal(ensureClaudeSettings(bare), 'skipped');
  assert.ok(!fs.existsSync(path.join(bare, '.claude')));
});

test('claude-settings: a LOCALLY LINKED manager skips even though it carries a marketplace', () => {
  // The monorepo's own packages/manager grows the vendored marketplace on every
  // prepare/pack, and `omega i local` symlinks the brand at it — so the file
  // exists and the gate must not fire: the settings would point every session
  // in that brand at one developer's machine.
  const dir = tmpdir();
  const monorepoManager = path.join(tmpdir(), 'packages', 'manager', '.claude-plugin');
  fs.mkdirSync(monorepoManager, { recursive: true });
  fs.writeFileSync(path.join(monorepoManager, 'marketplace.json'), JSON.stringify({ name: 'omega', plugins: [] }));

  fs.mkdirSync(path.join(dir, 'node_modules', '@omega.js'), { recursive: true });
  fs.symlinkSync(path.dirname(monorepoManager), path.join(dir, 'node_modules', '@omega.js', 'manager'));

  assert.equal(
    fs.existsSync(path.join(dir, 'node_modules', '@omega.js', 'manager', '.claude-plugin', 'marketplace.json')),
    true,
    'fixture sanity: the marketplace resolves through the link'
  );
  assert.equal(ensureClaudeSettings(dir), 'skipped');
  assert.ok(!fs.existsSync(path.join(dir, '.claude')), 'a linked brand is never written to');
});

test('claude-settings: an unparseable settings file is reported, never clobbered', () => {
  const dir = publishedBrand();
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(dir, SETTINGS_FILE), '{ not json');

  assert.equal(ensureClaudeSettings(dir), 'invalid');
  assert.equal(fs.readFileSync(path.join(dir, SETTINGS_FILE), 'utf8'), '{ not json');
});

// ─── The workspace ensure op ─────────────────────────────────────────────────

test('claude-settings: op creates on a published brand and is a no-op second run', async () => {
  const dir = publishedBrand();
  const context = { brandRoot: dir, brand: { id: 'fixture', config: {} } };

  const first = await claudeSettingsOp(context);
  assert.deepEqual(first.output, { claudeSettings: 'created' });
  assert.equal(readSettings(dir)[PLUGIN_KEY]['omega@omega'], true);

  assert.equal(await claudeSettingsOp(context), null);
});

test('claude-settings op is registered in the workspace OPERATIONS', () => {
  const { OPERATIONS } = require('../src/config.js');
  assert.ok(OPERATIONS.workspace.some((op) => op.name === 'claude-settings' && op.ensure === true));
});

test('claude-settings: op is a silent no-op in the local era and warns on an unreadable file', async () => {
  const local = tmpdir();
  assert.equal(await claudeSettingsOp({ brandRoot: local, brand: { id: 'fixture', config: {} } }), null);

  const dir = publishedBrand();
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(dir, SETTINGS_FILE), 'nope');
  const result = await claudeSettingsOp({ brandRoot: dir, brand: { id: 'fixture', config: {} } });
  assert.equal(result.status, 'warned');
  assert.equal(result.output.claudeSettings, 'invalid');
});
