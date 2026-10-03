// Tests for src/lib/claude-machine.js: the machine-wide half of the plugin
// delivery. The published copy is installed for the user from GitHub, moved
// there from an older folder record, updated when it falls behind the brand's
// OMEGA, and an omega developer's machine defaults to the local copy. Every
// call into `claude` goes through the injected execFn: here a fake machine in a
// throwaway config folder (test/lib/fake-claude.js), never the real ~/.claude.

const defineCases = require('@omega.js/devkit/test/define-cases');
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

// ─── Case 11: the developer switch ───────────────────────────────────────────

/**
 * The local copy is registered for the user through the CLI (a source record a
 * session starts on), declared in the user settings, on, and the published copy off.
 */
function assertLocalDefault(expect, fake) {
  const { records, settings } = fake.state();
  const local = { source: 'file', path: LOCAL_MANIFEST_PATH };
  expect((records['omega-local'] || {}).source, `omega-local has a source record: ${JSON.stringify(fake.state())}`).toEqual(local);
  expect(((settings.extraKnownMarketplaces || {})['omega-local'] || {}).source, 'the user settings declare it').toEqual(local);
  expect(settings.enabledPlugins['omega@omega-local']).toBe(true);
  expect(settings.enabledPlugins['omega@omega']).toBe(false);
  expect(ran(fake.mutations(), ['marketplace', 'add', LOCAL_MANIFEST_PATH]), 'registered through the CLI add').toBeTruthy();
}

module.exports = defineCases({
  type: 'group',
  description: 'claude-machine',
  tests: [
    // ─── machinePluginState ──────────────────────────────────────────────────────

    {
      name: 'machinePluginState: reads the installed version and whether the local copy is the default',
      run: async (ctx) => {
        const consumer = machine(ctx, { marketplaces: { omega: PUBLISHED }, installed: { 'omega@omega': '0.9.0' } });
        const state = await machinePluginState({ execFn: consumer.exec });
        ctx.expect(state.claude).toBe(true);
        ctx.expect(state.version).toBe('0.9.0');
        ctx.expect(state.localDefault).toBe(false);

        const developer = machine(ctx, {
          marketplaces: { omega: PUBLISHED, 'omega-local': { source: 'file', path: LOCAL_MANIFEST_PATH } },
          installed: { 'omega@omega': '0.9.0', 'omega@omega-local': '0.9.0' },
          enabled: { 'omega@omega': false },
        });
        ctx.expect((await machinePluginState({ execFn: developer.exec })).localDefault).toBe(true);
      },
    },

    {
      name: 'machinePluginState: a machine with claude and no plugin reports no version',
      run: async (ctx) => {
        const bare = machine(ctx, {});
        const state = await machinePluginState({ execFn: bare.exec });
        ctx.expect(state.claude).toBe(true);
        ctx.expect(state.version === null || state.version === undefined, `no install reads as no version, got ${state.version}`).toBeTruthy();
        ctx.expect(bare.mutations(), 'reading the state changes nothing').toEqual([]);
      },
    },

    {
      name: '#1044 machinePluginState runs every call through execFn, the program named first',
      run: async (ctx) => {
        const fake = machine(ctx, { marketplaces: { omega: PUBLISHED }, installed: { 'omega@omega': '0.9.0' } });
        const files = [];
        const execFn = (file, args, options) => {
          files.push(file);
          return fake.exec(file, args, options);
        };

        await machinePluginState({ execFn });

        ctx.expect(files.length > 0, 'the machine was read through the injected runner').toBeTruthy();
        ctx.expect(files.every((file) => file === 'claude'), JSON.stringify(files)).toBeTruthy();
      },
    },

    {
      name: '#1042 ensureMachinePlugin acts on the machine it is handed, without reading it again',
      run: async (ctx) => {
        const behind = machine(ctx, { marketplaces: { omega: PUBLISHED }, installed: { 'omega@omega': '1.3.9' }, published: '1.4.0' });
        const state = await machinePluginState({ execFn: behind.exec });
        const read = behind.calls().length;

        await ensureMachinePlugin({ execFn: behind.exec, familyVersion: '1.4.0', machine: state });

        const after = behind.calls().slice(read);
        ctx.expect(after.length, `only the two update commands: ${JSON.stringify(after)}`).toBe(2);
        ctx.expect(ran(after, ['marketplace', 'update', 'omega']), 'the marketplace is refreshed').toBeTruthy();
        ctx.expect(after.some((argv) => !argv.includes('marketplace') && ran([argv], ['update', 'omega@omega'])), 'the plugin is updated').toBeTruthy();
      },
    },

    // ─── Case 8: no claude ───────────────────────────────────────────────────────

    {
      name: 'case 8: with claude not on the machine, the helper does nothing and reports no error',
      run: async (ctx) => {
        const none = machine(ctx, { missing: true });

        ctx.expect((await machinePluginState({ execFn: none.exec })).claude).toBe(false);
        await ensureMachinePlugin({ execFn: none.exec, familyVersion: '1.0.0' });
        await ensureLocalDefault({ execFn: none.exec, monorepoRoot: MONOREPO });

        ctx.expect(fs.readdirSync(none.configDir).filter((name) => name !== 'fake-claude.json'), 'nothing was written for a machine with no Claude Code').toEqual([]);
      },
    },

    // ─── Case 9: register and install ────────────────────────────────────────────

    {
      name: 'case 9: an omega record that points at a folder is moved to GitHub',
      run: async (ctx) => {
        const old = machine(ctx, {
          marketplaces: { omega: { source: 'directory', path: '/Users/someone/omega' } },
          installed: { 'omega@omega': '1.0.0' },
          published: '1.0.0',
        });

        await ensureMachinePlugin({ execFn: old.exec, familyVersion: '1.0.0' });

        const record = old.state().records.omega.source;
        ctx.expect(record.source).toBe('github');
        ctx.expect(record.repo).toBe('Omega-JS-Stack/omega');
        ctx.expect(ran(old.mutations(), ['marketplace', 'add', 'Omega-JS-Stack/omega']), 'one add re-points the name').toBeTruthy();
      },
    },

    {
      name: 'case 9: a machine with no plugin gets omega registered from GitHub and omega@omega installed for the user',
      run: async (ctx) => {
        const fresh = machine(ctx, { published: '1.0.0' });

        await ensureMachinePlugin({ execFn: fresh.exec, familyVersion: '1.0.0' });

        const { records, installed, settings } = fresh.state();
        ctx.expect([records.omega.source.source, records.omega.source.repo]).toEqual(['github', 'Omega-JS-Stack/omega']);
        ctx.expect(installed['omega@omega'][0].scope).toBe('user');
        ctx.expect(settings.enabledPlugins['omega@omega']).toBe(true);
        const install = fresh.mutations().find((argv) => ran([argv], ['install', 'omega@omega']));
        ctx.expect(install && userScoped(install), `installed for the user: ${JSON.stringify(fresh.mutations())}`).toBeTruthy();
      },
    },

    {
      name: 'case 9: a registered GitHub record with no install is installed, not re-added',
      run: async (ctx) => {
        const half = machine(ctx, { marketplaces: { omega: PUBLISHED }, published: '1.0.0' });

        await ensureMachinePlugin({ execFn: half.exec, familyVersion: '1.0.0' });

        ctx.expect(half.state().installed['omega@omega'][0].scope).toBe('user');
        ctx.expect(ran(half.mutations(), ['marketplace', 'add']), 'a GitHub record is already right').toBe(false);
      },
    },

    // ─── Case 10: updates follow releases ────────────────────────────────────────

    {
      name: 'case 10: an installed plugin older than the brand\'s OMEGA gets the two update commands',
      run: async (ctx) => {
        const behind = machine(ctx, { marketplaces: { omega: PUBLISHED }, installed: { 'omega@omega': '1.3.9' }, published: '1.4.0' });

        await ensureMachinePlugin({ execFn: behind.exec, familyVersion: '1.4.0' });

        const mutations = behind.mutations();
        ctx.expect(mutations.length, JSON.stringify(mutations)).toBe(2);
        ctx.expect(ran(mutations, ['marketplace', 'update', 'omega']), 'the marketplace is refreshed').toBeTruthy();
        ctx.expect(mutations.some((argv) => !argv.includes('marketplace') && ran([argv], ['update', 'omega@omega'])), 'the plugin is updated').toBeTruthy();
        ctx.expect(behind.state().installed['omega@omega'][0].version).toBe('1.4.0');
      },
    },

    {
      name: 'case 10: an installed plugin equal to or newer than the brand\'s OMEGA runs no command',
      run: async (ctx) => {
        // 1.10.0 is newer than 1.9.0: versions compare by number, never as text
        for (const [installed, family] of [['1.4.0', '1.4.0'], ['1.5.0', '1.4.0'], ['1.10.0', '1.9.0']]) {
          const current = machine(ctx, { marketplaces: { omega: PUBLISHED }, installed: { 'omega@omega': installed }, published: installed });

          await ensureMachinePlugin({ execFn: current.exec, familyVersion: family });

          ctx.expect(current.mutations(), `installed ${installed}, family ${family}`).toEqual([]);
        }
      },
    },

    {
      name: 'case 11: a consumer machine becomes a developer machine: local on, published off, for the user',
      run: async (ctx) => {
        const consumer = machine(ctx, { marketplaces: { omega: PUBLISHED }, installed: { 'omega@omega': '1.0.0' } });

        await ensureLocalDefault({ execFn: consumer.exec, monorepoRoot: MONOREPO });

        assertLocalDefault(ctx.expect, consumer);
        ctx.expect(consumer.mutations().every(userScoped), 'every change is for the user, never a project').toBeTruthy();
      },
    },

    {
      name: 'case 11: a machine with no plugin at all gets the same default',
      run: async (ctx) => {
        const bare = machine(ctx, {});

        await ensureLocalDefault({ execFn: bare.exec, monorepoRoot: MONOREPO });

        assertLocalDefault(ctx.expect, bare);
      },
    },

    {
      name: 'case 11: a second run on a developer machine adds nothing and changes nothing',
      run: async (ctx) => {
        const developer = machine(ctx, { marketplaces: { omega: PUBLISHED }, installed: { 'omega@omega': '1.0.0' } });
        await ensureLocalDefault({ execFn: developer.exec, monorepoRoot: MONOREPO });
        const before = JSON.stringify(developer.state());
        const settled = developer.mutations().length;

        await ensureLocalDefault({ execFn: developer.exec, monorepoRoot: MONOREPO });

        ctx.expect(JSON.stringify(developer.state())).toBe(before);
        ctx.expect(developer.mutations().slice(settled), 'no add and no other command on a machine already switched').toEqual([]);
        assertLocalDefault(ctx.expect, developer);
      },
    },

    {
      name: 'case 11: the switch heals an omega record that points at a folder: removed, then added from GitHub',
      run: async (ctx) => {
        const old = machine(ctx, {
          marketplaces: { omega: { source: 'directory', path: '/Users/someone/omega' } },
          installed: { 'omega@omega': '1.0.0' },
        });

        await ensureLocalDefault({ execFn: old.exec, monorepoRoot: MONOREPO });

        // The fake refuses a GitHub add over a folder declaration, as the real CLI does, so this passing proves the remove
        const { records, settings } = old.state();
        ctx.expect([records.omega.source.source, records.omega.source.repo]).toEqual(['github', 'Omega-JS-Stack/omega']);
        ctx.expect(settings.extraKnownMarketplaces.omega.source.source).toBe('github');
        ctx.expect(ran(old.mutations(), ['marketplace', 'remove', 'omega']), 'the folder record is removed first').toBeTruthy();
        assertLocalDefault(ctx.expect, old);
      },
    },

    {
      name: 'case 11: a claude failure in the switch is a warning, never a throw',
      run: async (ctx) => {
        const broken = machine(ctx, { failing: [['marketplace', 'add']] });
        const lines = [];
        const saved = { log: console.log, warn: console.warn, error: console.error };
        for (const key of Object.keys(saved)) console[key] = (...parts) => lines.push(parts.join(' '));
        let result;
        try {
          result = await ensureLocalDefault({ execFn: broken.exec, monorepoRoot: MONOREPO });
        } finally {
          Object.assign(console, saved);
        }

        ctx.expect(ran(broken.calls(), ['marketplace', 'add']), 'the add was tried').toBeTruthy();
        ctx.expect(`${lines.join('\n')}\n${JSON.stringify(result)}`, 'the failure is reported, not swallowed').toMatch(/fails "marketplace add"|warn/i);
      },
    },
  ],
});
