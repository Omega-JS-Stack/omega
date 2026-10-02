// Tests for src/lib/claude-settings.js + the workspace `claude-settings`
// ensure op: the brand half of the plugin delivery. Every brand's committed
// .claude/settings.json turns on the PUBLISHED copy (`omega`, from GitHub) and
// turns the local one off; a brand whose manager is linked to the monorepo gets
// the reverse in its private .claude/settings.local.json, taken back out when
// it goes live. Only the omega keys are ever touched. Real files, no mocks.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const claudeSettings = require('../src/lib/claude-settings.js');
const claudeSettingsOp = require('../src/services/workspace/ensure/claude-settings.js');
const { createMachine } = require('./lib/fake-claude.js');

const { ensureClaudeSettings } = claudeSettings;

// Anything here that reaches for `claude` reaches a fake machine that already
// has the plugin, never the real ~/.claude.
const PATH_MACHINE = createMachine({
  marketplaces: { omega: { source: 'github', repo: 'Omega-JS-Stack/omega' } },
  installed: { 'omega@omega': '999.0.0' },
});
PATH_MACHINE.activate();

const MONOREPO = path.join(__dirname, '..', '..', '..');
const LOCAL_MANIFEST_PATH = path.join(MONOREPO, '.claude-plugin', 'marketplace.local.json');
const COMMITTED = path.join('.claude', 'settings.json');
const PRIVATE = path.join('.claude', 'settings.local.json');

function tmpdir() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-claude-settings-')));
}

// The root manifest onboarding scaffolds: the manager is a declared dependency,
// which is what devkit reads to tell a linked brand from a live one.
function brandRoot() {
  const dir = tmpdir();
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'a-brand', private: true, devDependencies: { '@omega.js/manager': '1.0.0' } }));
  return dir;
}

// A brand on a published install: its manager is a plain folder in node_modules.
function liveBrand() {
  const dir = brandRoot();
  const manager = path.join(dir, 'node_modules', '@omega.js', 'manager');
  fs.mkdirSync(manager, { recursive: true });
  fs.writeFileSync(path.join(manager, 'package.json'), JSON.stringify({ name: '@omega.js/manager', version: '1.0.0' }));
  return dir;
}

// A brand after `omega i local`: its manager is a link into this monorepo.
function linkedBrand() {
  const dir = brandRoot();
  fs.mkdirSync(path.join(dir, 'node_modules', '@omega.js'), { recursive: true });
  fs.symlinkSync(path.join(MONOREPO, 'packages', 'manager'), path.join(dir, 'node_modules', '@omega.js', 'manager'));
  return dir;
}

// The `omega i live` flip: the link is replaced by a registry install.
function goLive(dir) {
  const manager = path.join(dir, 'node_modules', '@omega.js', 'manager');
  fs.unlinkSync(manager);
  fs.mkdirSync(manager);
  fs.writeFileSync(path.join(manager, 'package.json'), JSON.stringify({ name: '@omega.js/manager', version: '1.0.0' }));
}

const read = (dir, file) => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
const write = (dir, file, value) => {
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(dir, file), typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
};

// The committed shape: the published copy from GitHub, sparse, auto-updating; on, and the local copy off.
function assertPublishedOn(settings) {
  const entry = settings.extraKnownMarketplaces.omega;
  assert.equal(entry.autoUpdate, true);
  assert.equal(entry.source.source, 'github');
  assert.equal(entry.source.repo, 'Omega-JS-Stack/omega');

  // A sparse checkout fetches the marketplace manifest and the plugin folder, and nothing else of the monorepo
  const sparse = entry.source.sparsePaths;
  assert.ok(Array.isArray(sparse) && sparse.length > 0, 'the source is a sparse checkout');
  const covered = (file) => sparse.some((dir) => file === dir || file.startsWith(`${dir.replace(/\/$/, '')}/`));
  assert.ok(covered('.claude-plugin/marketplace.json'), `the manifest is fetched: ${sparse}`);
  assert.ok(covered('agent-plugins/claude/.claude-plugin/plugin.json'), `the plugin folder is fetched: ${sparse}`);
  for (const dir of sparse) {
    assert.ok(/^(\.claude-plugin|agent-plugins\/claude)(\/|$)/.test(dir), `${dir} fetches more than the plugin`);
  }

  assert.equal(settings.enabledPlugins['omega@omega'], true);
  assert.equal(settings.enabledPlugins['omega@omega-local'], false, 'both on at once loads either copy');
  assert.equal(settings.extraKnownMarketplaces['omega-local'], undefined, 'the committed file never names a machine path');
}

// The private shape: the local copy at the monorepo's local manifest; on, and the published copy off.
function assertLocalOn(dir, settings) {
  const source = settings.extraKnownMarketplaces['omega-local'].source;
  assert.equal(source.source, 'file');
  assert.equal(path.resolve(dir, source.path), LOCAL_MANIFEST_PATH);
  assert.equal(settings.enabledPlugins['omega@omega-local'], true);
  assert.equal(settings.enabledPlugins['omega@omega'], false, 'both on at once loads either copy');
}

// ─── The names ───────────────────────────────────────────────────────────────

test('claude-settings: the names of the two copies and the two files', () => {
  assert.equal(claudeSettings.MARKETPLACE_NAME, 'omega');
  assert.equal(claudeSettings.LOCAL_MARKETPLACE_NAME, 'omega-local');
  assert.equal(claudeSettings.PLUGIN_ID, 'omega@omega');
  assert.equal(claudeSettings.LOCAL_PLUGIN_ID, 'omega@omega-local');
  assert.equal(claudeSettings.PLUGIN_REPO, 'Omega-JS-Stack/omega');
  assert.equal(claudeSettings.SETTINGS_FILE, '.claude/settings.json');
  assert.equal(claudeSettings.LOCAL_SETTINGS_FILE, '.claude/settings.local.json');
  assert.equal(claudeSettings.LOCAL_MANIFEST, '.claude-plugin/marketplace.local.json');
  assert.ok(Array.isArray(claudeSettings.SPARSE_PATHS));

  for (const gone of ['MANAGER_PATH', 'MANAGER_DIR', 'VENDORED_MARKETPLACE', 'hasVendoredPlugin']) {
    assert.equal(claudeSettings[gone], undefined, `${gone} is the node_modules plugin source, which is gone`);
  }
});

// ─── The committed file ──────────────────────────────────────────────────────

test('case 1: a brand with no settings file gets the published copy from GitHub', () => {
  const dir = liveBrand();

  assert.deepEqual(ensureClaudeSettings(dir), { committed: 'created', local: 'absent' });
  assertPublishedOn(read(dir, COMMITTED));
  assert.equal(fs.existsSync(path.join(dir, PRIVATE)), false, 'a live brand gets no private file');
});

test('case 1: a brand with no install at all still gets the committed file', () => {
  const dir = tmpdir();

  assert.equal(ensureClaudeSettings(dir).committed, 'created');
  assertPublishedOn(read(dir, COMMITTED));
});

test('case 2: the old node_modules folder source is healed to GitHub, every other key kept', () => {
  const dir = liveBrand();
  write(dir, COMMITTED, {
    permissions: { allow: ['Bash(npm test)'] },
    extraKnownMarketplaces: {
      omega: { source: { source: 'directory', path: './node_modules/@omega.js/manager' } },
      other: { source: { source: 'github', repo: 'someone/plugins' } },
    },
    enabledPlugins: { 'omega@omega': true, 'other@other': true },
  });

  assert.equal(ensureClaudeSettings(dir).committed, 'healed');

  const settings = read(dir, COMMITTED);
  assertPublishedOn(settings);
  assert.deepEqual(settings.permissions, { allow: ['Bash(npm test)'] });
  assert.deepEqual(settings.extraKnownMarketplaces.other, { source: { source: 'github', repo: 'someone/plugins' } });
  assert.equal(settings.enabledPlugins['other@other'], true);
});

test('case 2: a published copy left disabled by hand is turned back on', () => {
  const dir = liveBrand();
  write(dir, COMMITTED, { model: 'x', enabledPlugins: { 'omega@omega': false } });

  assert.equal(ensureClaudeSettings(dir).committed, 'healed');
  assertPublishedOn(read(dir, COMMITTED));
  assert.equal(read(dir, COMMITTED).model, 'x');
});

// ─── The private file of a linked brand ──────────────────────────────────────

test('case 3: a linked brand gets the local copy in its private file, the committed file unchanged in shape', () => {
  const dir = linkedBrand();

  assert.deepEqual(ensureClaudeSettings(dir), { committed: 'created', local: 'written' });
  assertPublishedOn(read(dir, COMMITTED));
  assertLocalOn(dir, read(dir, PRIVATE));
});

test('case 3: the private file keeps every key that is not the omega keys', () => {
  const dir = linkedBrand();
  write(dir, PRIVATE, {
    permissions: { allow: ['Bash(ls)'] },
    extraKnownMarketplaces: { mine: { source: { source: 'directory', path: '/somewhere' } } },
    enabledPlugins: { 'mine@mine': true },
  });

  assert.equal(ensureClaudeSettings(dir).local, 'written');

  const settings = read(dir, PRIVATE);
  assertLocalOn(dir, settings);
  assert.deepEqual(settings.permissions, { allow: ['Bash(ls)'] });
  assert.deepEqual(settings.extraKnownMarketplaces.mine, { source: { source: 'directory', path: '/somewhere' } });
  assert.equal(settings.enabledPlugins['mine@mine'], true);
});

test('case 4: a linked brand that goes live loses the omega keys, and its other keys stay', () => {
  const dir = linkedBrand();
  write(dir, PRIVATE, { permissions: { allow: ['Bash(ls)'] }, enabledPlugins: { 'mine@mine': true } });
  ensureClaudeSettings(dir);
  goLive(dir);

  assert.deepEqual(ensureClaudeSettings(dir), { committed: 'present', local: 'removed' });

  const settings = read(dir, PRIVATE);
  assert.deepEqual(settings.permissions, { allow: ['Bash(ls)'] });
  assert.equal(settings.enabledPlugins['mine@mine'], true);
  assert.equal((settings.extraKnownMarketplaces || {})['omega-local'], undefined);
  assert.equal('omega@omega-local' in settings.enabledPlugins, false);
  assert.equal('omega@omega' in settings.enabledPlugins, false, 'the committed file decides for a live brand');
});

test('case 4: a private file that held only the omega keys is removed when the brand goes live', () => {
  const dir = linkedBrand();
  ensureClaudeSettings(dir);
  assert.ok(fs.existsSync(path.join(dir, PRIVATE)), 'fixture sanity: the linked run wrote the file');
  goLive(dir);

  assert.equal(ensureClaudeSettings(dir).local, 'removed');
  assert.equal(fs.existsSync(path.join(dir, PRIVATE)), false);
  assertPublishedOn(read(dir, COMMITTED));
});

test('case 4: a live brand whose private file has no omega keys leaves it untouched', () => {
  const dir = liveBrand();
  write(dir, PRIVATE, '{ "permissions": { "allow": [] } }\n');

  assert.equal(ensureClaudeSettings(dir).local, 'absent');
  assert.equal(fs.readFileSync(path.join(dir, PRIVATE), 'utf8'), '{ "permissions": { "allow": [] } }\n');
});

// ─── Unreadable files ────────────────────────────────────────────────────────

test('case 5: a committed file that is not JSON is reported invalid and never written', () => {
  const dir = liveBrand();
  write(dir, COMMITTED, '{ not json');

  assert.equal(ensureClaudeSettings(dir).committed, 'invalid');
  assert.equal(fs.readFileSync(path.join(dir, COMMITTED), 'utf8'), '{ not json');
});

test('case 5: a private file that is not JSON is reported invalid and never written', () => {
  const dir = linkedBrand();
  write(dir, PRIVATE, 'nope');

  assert.equal(ensureClaudeSettings(dir).local, 'invalid');
  assert.equal(fs.readFileSync(path.join(dir, PRIVATE), 'utf8'), 'nope');

  goLive(dir);
  assert.equal(ensureClaudeSettings(dir).local, 'invalid', 'a live run never deletes a file it cannot read');
  assert.equal(fs.readFileSync(path.join(dir, PRIVATE), 'utf8'), 'nope');
});

// ─── Idempotence and the dry run ─────────────────────────────────────────────

test('case 6: a second run with nothing changed writes no file', () => {
  const past = new Date('2020-01-01T00:00:00Z');

  for (const [dir, local] of [[liveBrand(), 'absent'], [linkedBrand(), 'present']]) {
    ensureClaudeSettings(dir);
    const written = [COMMITTED, PRIVATE].filter((file) => fs.existsSync(path.join(dir, file)));
    for (const file of written) fs.utimesSync(path.join(dir, file), past, past);

    assert.deepEqual(ensureClaudeSettings(dir), { committed: 'present', local });
    for (const file of written) {
      assert.equal(fs.statSync(path.join(dir, file)).mtime.getTime(), past.getTime(), `${file} was rewritten`);
    }
  }
});

test('ensureClaudeSettings: a dry run returns the verdicts and writes nothing', () => {
  const dir = linkedBrand();

  assert.deepEqual(ensureClaudeSettings(dir, { dryRun: true }), { committed: 'created', local: 'written' });
  assert.equal(fs.existsSync(path.join(dir, '.claude')), false);
});

// ─── The workspace ensure op ─────────────────────────────────────────────────

test('claude-settings op is registered in the workspace OPERATIONS', () => {
  const { OPERATIONS } = require('../src/config.js');
  assert.ok(OPERATIONS.workspace.some((op) => op.name === 'claude-settings' && op.ensure === true));
});

test('claude-settings: the op writes both files for a linked brand, then is a no-op', async () => {
  const dir = linkedBrand();
  const context = { brandRoot: dir, brand: { id: 'fixture', config: {} } };

  assert.notEqual(await claudeSettingsOp(context), null);
  assertPublishedOn(read(dir, COMMITTED));
  assertLocalOn(dir, read(dir, PRIVATE));

  assert.equal(await claudeSettingsOp(context), null, 'a second run has nothing to say');
});

test('claude-settings: the op warns on an unreadable file', async () => {
  const dir = liveBrand();
  write(dir, COMMITTED, 'nope');

  const result = await claudeSettingsOp({ brandRoot: dir, brand: { id: 'fixture', config: {} } });
  assert.equal(result.status, 'warned');
  assert.equal(fs.readFileSync(path.join(dir, COMMITTED), 'utf8'), 'nope');
});

test('#971: the op under --dry-run plans the writes and writes nothing', async () => {
  const dir = linkedBrand();
  const result = await claudeSettingsOp({ brandRoot: dir, brand: { id: 'fixture', config: {} }, options: { dryRun: true } });

  assert.match(JSON.stringify(result.output), /planned/);
  assert.equal(fs.existsSync(path.join(dir, '.claude')), false);
});

// ─── The machine, from the manage walk ───────────────────────────────────────

/** Run the op with its console lines captured, against a fake machine for this test. */
async function opOnMachine(t, seed) {
  const machine = createMachine(seed);
  t.after(machine.activate());
  const lines = [];
  const log = console.log;
  console.log = (...parts) => lines.push(parts.join(' '));
  try {
    await claudeSettingsOp({ brandRoot: liveBrand(), brand: { id: 'fixture', config: {} } });
  } finally {
    console.log = log;
  }
  return { machine, lines: lines.join('\n') };
}

const ON_GITHUB = { omega: { source: 'github', repo: 'Omega-JS-Stack/omega' } };

test('case 10: manage runs the two update commands when the installed plugin is older than the brand\'s OMEGA', async (t) => {
  const { machine } = await opOnMachine(t, { marketplaces: ON_GITHUB, installed: { 'omega@omega': '0.0.1' }, published: '999.0.0' });

  const mutations = machine.mutations();
  assert.equal(mutations.length, 2, JSON.stringify(mutations));
  assert.ok(mutations.some((argv) => argv.join(' ').includes('marketplace update omega')));
  assert.ok(mutations.some((argv) => !argv.includes('marketplace') && argv.includes('update') && argv.includes('omega@omega')));
});

test('case 10: manage runs no command when the installed plugin is equal or newer', async (t) => {
  const { machine } = await opOnMachine(t, { marketplaces: ON_GITHUB, installed: { 'omega@omega': '999.0.0' } });
  assert.deepEqual(machine.mutations(), []);
});

test('manage says in one line when the plugin is not installed, and never installs it unasked', async (t) => {
  const { machine, lines } = await opOnMachine(t, {});

  assert.ok(
    lines.includes('Claude plugin not installed on this machine. Run: claude plugin marketplace add Omega-JS-Stack/omega && claude plugin install omega@omega'),
    lines,
  );
  assert.deepEqual(machine.mutations(), []);
});

test('the op runs claude through the runner the manage context injects, never the one on PATH', async () => {
  const injected = createMachine({ marketplaces: ON_GITHUB, installed: { 'omega@omega': '0.0.1' }, published: '999.0.0' });
  const onPath = PATH_MACHINE.calls().length;

  await claudeSettingsOp({ brandRoot: liveBrand(), brand: { id: 'fixture', config: {} }, claudeExec: injected.exec });

  assert.equal(injected.mutations().length, 2, `the injected runner ran the update: ${JSON.stringify(injected.calls())}`);
  assert.equal(PATH_MACHINE.calls().length, onPath, 'nothing reached the claude on PATH');
});
