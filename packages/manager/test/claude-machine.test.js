// Tests for src/lib/claude-machine.js: the machine-wide half of the plugin
// delivery. The published copy is installed for the user from GitHub, moved
// there from an older folder record, updated when it falls behind the brand's
// OMEGA, and an omega developer's machine defaults to the local copy. Every
// call into `claude` goes through the injected exec: here a fake machine in a
// throwaway config folder (test/lib/fake-claude.js), never the real ~/.claude.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { machinePluginState, ensureMachinePlugin, ensureLocalDefault } = require('../src/lib/claude-machine.js');
const { createMachine } = require('./lib/fake-claude.js');

const MONOREPO = path.join(__dirname, '..', '..', '..');
const LOCAL_MANIFEST_PATH = path.join(MONOREPO, '.claude-plugin', 'marketplace.local.json');
const PUBLISHED = { source: 'github', repo: 'Omega-JS-Stack/omega' };

/** A fake machine, pointed at for the length of one test. */
function machine(t, seed) {
  const fake = createMachine(seed);
  t.after(fake.activate());
  return fake;
}

/** True when some call holds these words in this order (flags may sit between). */
const ran = (calls, words) => calls.some((argv) => {
  let at = 0;
  for (const word of argv) if (word === words[at]) at++;
  return at === words.length;
});

const userScoped = (argv) => {
  const at = argv.findIndex((word) => word === '--scope' || word === '-s');
  return at === -1 || argv[at + 1] === 'user';
};

// ─── machinePluginState ──────────────────────────────────────────────────────

test('machinePluginState: reads the installed version and whether the local copy is the default', async (t) => {
  const consumer = machine(t, { marketplaces: { omega: PUBLISHED }, installed: { 'omega@omega': '0.9.0' } });
  const state = await machinePluginState({ exec: consumer.exec });
  assert.equal(state.claude, true);
  assert.equal(state.version, '0.9.0');
  assert.equal(state.localDefault, false);

  const developer = machine(t, {
    marketplaces: { omega: PUBLISHED, 'omega-local': { source: 'file', path: LOCAL_MANIFEST_PATH } },
    installed: { 'omega@omega': '0.9.0', 'omega@omega-local': '0.9.0' },
    enabled: { 'omega@omega': false },
  });
  assert.equal((await machinePluginState({ exec: developer.exec })).localDefault, true);
});

test('machinePluginState: a machine with claude and no plugin reports no version', async (t) => {
  const bare = machine(t, {});
  const state = await machinePluginState({ exec: bare.exec });
  assert.equal(state.claude, true);
  assert.ok(state.version === null || state.version === undefined, `no install reads as no version, got ${state.version}`);
  assert.deepEqual(bare.mutations(), [], 'reading the state changes nothing');
});

// ─── Case 8: no claude ───────────────────────────────────────────────────────

test('case 8: with claude not on the machine, the helper does nothing and reports no error', async (t) => {
  const none = machine(t, { missing: true });

  assert.equal((await machinePluginState({ exec: none.exec })).claude, false);
  await ensureMachinePlugin({ exec: none.exec, familyVersion: '1.0.0' });
  await ensureLocalDefault({ exec: none.exec, monorepoRoot: MONOREPO });

  assert.deepEqual(fs.readdirSync(none.configDir).filter((name) => name !== 'fake-claude.json'), [], 'nothing was written for a machine with no Claude Code');
});

// ─── Case 9: register and install ────────────────────────────────────────────

test('case 9: an omega record that points at a folder is moved to GitHub', async (t) => {
  const old = machine(t, {
    marketplaces: { omega: { source: 'directory', path: '/Users/someone/omega' } },
    installed: { 'omega@omega': '1.0.0' },
    published: '1.0.0',
  });

  await ensureMachinePlugin({ exec: old.exec, familyVersion: '1.0.0' });

  const record = old.state().records.omega.source;
  assert.equal(record.source, 'github');
  assert.equal(record.repo, 'Omega-JS-Stack/omega');
  assert.ok(ran(old.mutations(), ['marketplace', 'add', 'Omega-JS-Stack/omega']), 'one add re-points the name');
});

test('case 9: a machine with no plugin gets omega registered from GitHub and omega@omega installed for the user', async (t) => {
  const fresh = machine(t, { published: '1.0.0' });

  await ensureMachinePlugin({ exec: fresh.exec, familyVersion: '1.0.0' });

  const { records, installed, settings } = fresh.state();
  assert.deepEqual([records.omega.source.source, records.omega.source.repo], ['github', 'Omega-JS-Stack/omega']);
  assert.equal(installed['omega@omega'][0].scope, 'user');
  assert.equal(settings.enabledPlugins['omega@omega'], true);
  const install = fresh.mutations().find((argv) => ran([argv], ['install', 'omega@omega']));
  assert.ok(install && userScoped(install), `installed for the user: ${JSON.stringify(fresh.mutations())}`);
});

test('case 9: a registered GitHub record with no install is installed, not re-added', async (t) => {
  const half = machine(t, { marketplaces: { omega: PUBLISHED }, published: '1.0.0' });

  await ensureMachinePlugin({ exec: half.exec, familyVersion: '1.0.0' });

  assert.equal(half.state().installed['omega@omega'][0].scope, 'user');
  assert.equal(ran(half.mutations(), ['marketplace', 'add']), false, 'a GitHub record is already right');
});

// ─── Case 10: updates follow releases ────────────────────────────────────────

test('case 10: an installed plugin older than the brand\'s OMEGA gets the two update commands', async (t) => {
  const behind = machine(t, { marketplaces: { omega: PUBLISHED }, installed: { 'omega@omega': '1.3.9' }, published: '1.4.0' });

  await ensureMachinePlugin({ exec: behind.exec, familyVersion: '1.4.0' });

  const mutations = behind.mutations();
  assert.equal(mutations.length, 2, JSON.stringify(mutations));
  assert.ok(ran(mutations, ['marketplace', 'update', 'omega']), 'the marketplace is refreshed');
  assert.ok(mutations.some((argv) => !argv.includes('marketplace') && ran([argv], ['update', 'omega@omega'])), 'the plugin is updated');
  assert.equal(behind.state().installed['omega@omega'][0].version, '1.4.0');
});

test('case 10: an installed plugin equal to or newer than the brand\'s OMEGA runs no command', async (t) => {
  // 1.10.0 is newer than 1.9.0: versions compare by number, never as text
  for (const [installed, family] of [['1.4.0', '1.4.0'], ['1.5.0', '1.4.0'], ['1.10.0', '1.9.0']]) {
    const current = machine(t, { marketplaces: { omega: PUBLISHED }, installed: { 'omega@omega': installed }, published: installed });

    await ensureMachinePlugin({ exec: current.exec, familyVersion: family });

    assert.deepEqual(current.mutations(), [], `installed ${installed}, family ${family}`);
  }
});

// ─── Case 11: the developer switch ───────────────────────────────────────────

/**
 * The local copy is registered for the user through the CLI (a source record a
 * session starts on), declared in the user settings, on, and the published copy off.
 */
function assertLocalDefault(fake) {
  const { records, settings } = fake.state();
  const local = { source: 'file', path: LOCAL_MANIFEST_PATH };
  assert.deepEqual((records['omega-local'] || {}).source, local, `omega-local has a source record: ${JSON.stringify(fake.state())}`);
  assert.deepEqual(((settings.extraKnownMarketplaces || {})['omega-local'] || {}).source, local, 'the user settings declare it');
  assert.equal(settings.enabledPlugins['omega@omega-local'], true);
  assert.equal(settings.enabledPlugins['omega@omega'], false);
  assert.ok(ran(fake.mutations(), ['marketplace', 'add', LOCAL_MANIFEST_PATH]), 'registered through the CLI add');
}

test('case 11: a consumer machine becomes a developer machine: local on, published off, for the user', async (t) => {
  const consumer = machine(t, { marketplaces: { omega: PUBLISHED }, installed: { 'omega@omega': '1.0.0' } });

  await ensureLocalDefault({ exec: consumer.exec, monorepoRoot: MONOREPO });

  assertLocalDefault(consumer);
  assert.ok(consumer.mutations().every(userScoped), 'every change is for the user, never a project');
});

test('case 11: a machine with no plugin at all gets the same default', async (t) => {
  const bare = machine(t, {});

  await ensureLocalDefault({ exec: bare.exec, monorepoRoot: MONOREPO });

  assertLocalDefault(bare);
});

test('case 11: a second run on a developer machine adds nothing and changes nothing', async (t) => {
  const developer = machine(t, { marketplaces: { omega: PUBLISHED }, installed: { 'omega@omega': '1.0.0' } });
  await ensureLocalDefault({ exec: developer.exec, monorepoRoot: MONOREPO });
  const before = JSON.stringify(developer.state());
  const settled = developer.mutations().length;

  await ensureLocalDefault({ exec: developer.exec, monorepoRoot: MONOREPO });

  assert.equal(JSON.stringify(developer.state()), before);
  assert.deepEqual(developer.mutations().slice(settled), [], 'no add and no other command on a machine already switched');
  assertLocalDefault(developer);
});

test('case 11: the switch heals an omega record that points at a folder: removed, then added from GitHub', async (t) => {
  const old = machine(t, {
    marketplaces: { omega: { source: 'directory', path: '/Users/someone/omega' } },
    installed: { 'omega@omega': '1.0.0' },
  });

  await ensureLocalDefault({ exec: old.exec, monorepoRoot: MONOREPO });

  // The fake refuses a GitHub add over a folder declaration, as the real CLI does, so this passing proves the remove
  const { records, settings } = old.state();
  assert.deepEqual([records.omega.source.source, records.omega.source.repo], ['github', 'Omega-JS-Stack/omega']);
  assert.equal(settings.extraKnownMarketplaces.omega.source.source, 'github');
  assert.ok(ran(old.mutations(), ['marketplace', 'remove', 'omega']), 'the folder record is removed first');
  assertLocalDefault(old);
});

test('case 11: a claude failure in the switch is a warning, never a throw', async (t) => {
  const broken = machine(t, { failing: [['marketplace', 'add']] });
  const lines = [];
  const saved = { log: console.log, warn: console.warn, error: console.error };
  for (const key of Object.keys(saved)) console[key] = (...parts) => lines.push(parts.join(' '));
  let result;
  try {
    result = await ensureLocalDefault({ exec: broken.exec, monorepoRoot: MONOREPO });
  } finally {
    Object.assign(console, saved);
  }

  assert.ok(ran(broken.calls(), ['marketplace', 'add']), 'the add was tried');
  assert.match(`${lines.join('\n')}\n${JSON.stringify(result)}`, /fails "marketplace add"|warn/i, 'the failure is reported, not swallowed');
});
