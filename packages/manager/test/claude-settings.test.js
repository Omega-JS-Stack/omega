// Tests for src/lib/claude-settings.js + the workspace `claude-settings`
// ensure op: the brand half of the plugin delivery. Every brand's committed
// .claude/settings.json turns on the PUBLISHED copy (`omega`, from GitHub) and
// turns the local one off; a brand whose manager is linked to the monorepo gets
// the reverse in its private .claude/settings.local.json, taken back out when
// it goes live. Only the omega keys are ever touched. Real files, no mocks.

const defineCases = require('@omega.js/devkit/test/define-cases');
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
function assertPublishedOn(expect, settings) {
  const entry = settings.extraKnownMarketplaces.omega;
  expect(entry.autoUpdate).toBe(true);
  expect(entry.source.source).toBe('github');
  expect(entry.source.repo).toBe('Omega-JS-Stack/omega');

  // A sparse checkout fetches the marketplace manifest and the plugin folder, and nothing else of the monorepo
  const sparse = entry.source.sparsePaths;
  expect(Array.isArray(sparse) && sparse.length > 0, 'the source is a sparse checkout').toBeTruthy();
  const covered = (file) => sparse.some((dir) => file === dir || file.startsWith(`${dir.replace(/\/$/, '')}/`));
  expect(covered('.claude-plugin/marketplace.json'), `the manifest is fetched: ${sparse}`).toBeTruthy();
  expect(covered('agent-plugins/claude/.claude-plugin/plugin.json'), `the plugin folder is fetched: ${sparse}`).toBeTruthy();
  for (const dir of sparse) {
    expect(/^(\.claude-plugin|agent-plugins\/claude)(\/|$)/.test(dir), `${dir} fetches more than the plugin`).toBeTruthy();
  }

  expect(settings.enabledPlugins['omega@omega']).toBe(true);
  expect(settings.enabledPlugins['omega@omega-local'], 'both on at once loads either copy').toBe(false);
  expect(settings.extraKnownMarketplaces['omega-local'], 'the committed file never names a machine path').toBe(undefined);
}

// The private shape: the local copy at the monorepo's local manifest; on, and the published copy off.
function assertLocalOn(expect, dir, settings) {
  const source = settings.extraKnownMarketplaces['omega-local'].source;
  expect(source.source).toBe('file');
  expect(path.resolve(dir, source.path)).toBe(LOCAL_MANIFEST_PATH);
  expect(settings.enabledPlugins['omega@omega-local']).toBe(true);
  expect(settings.enabledPlugins['omega@omega'], 'both on at once loads either copy').toBe(false);
}

// ─── The machine, from the manage walk ───────────────────────────────────────

/** Run the op with its console lines captured, against a fake machine for this test. */
async function opOnMachine(t, seed, options = {}) {
  const machine = createMachine(seed);
  t.after(machine.activate());
  const dir = liveBrand();
  const lines = [];
  const log = console.log;
  console.log = (...parts) => lines.push(parts.join(' '));
  try {
    await claudeSettingsOp({ brandRoot: dir, brand: { id: 'fixture', config: {} }, options });
  } finally {
    console.log = log;
  }
  return { machine, dir, lines: lines.join('\n') };
}

// The three reads one walk makes of the machine, as the words after `claude`
const MACHINE_READS = ['--version', 'plugin marketplace list --json', 'plugin list --json'];
const sortedCalls = (calls) => calls.map((argv) => argv.join(' ')).sort();

const ON_GITHUB = { omega: { source: 'github', repo: 'Omega-JS-Stack/omega' } };

module.exports = defineCases({
  type: 'group',
  description: 'claude-settings',
  tests: [
    // ─── The names ───────────────────────────────────────────────────────────────

    {
      name: 'claude-settings: the names of the two copies and the two files',
      run: (ctx) => {
        ctx.expect(claudeSettings.MARKETPLACE_NAME).toBe('omega');
        ctx.expect(claudeSettings.LOCAL_MARKETPLACE_NAME).toBe('omega-local');
        ctx.expect(claudeSettings.PLUGIN_ID).toBe('omega@omega');
        ctx.expect(claudeSettings.LOCAL_PLUGIN_ID).toBe('omega@omega-local');
        ctx.expect(claudeSettings.PLUGIN_REPO).toBe('Omega-JS-Stack/omega');
        ctx.expect(claudeSettings.SETTINGS_FILE).toBe('.claude/settings.json');
        ctx.expect(claudeSettings.LOCAL_SETTINGS_FILE).toBe('.claude/settings.local.json');
        ctx.expect(claudeSettings.LOCAL_MANIFEST).toBe('.claude-plugin/marketplace.local.json');
        ctx.expect(Array.isArray(claudeSettings.SPARSE_PATHS)).toBeTruthy();

        for (const gone of ['MANAGER_PATH', 'MANAGER_DIR', 'VENDORED_MARKETPLACE', 'hasVendoredPlugin']) {
          ctx.expect(claudeSettings[gone], `${gone} is the node_modules plugin source, which is gone`).toBe(undefined);
        }
      },
    },

    // ─── The committed file ──────────────────────────────────────────────────────

    {
      name: 'case 1: a brand with no settings file gets the published copy from GitHub',
      run: (ctx) => {
        const dir = liveBrand();

        ctx.expect(ensureClaudeSettings(dir)).toEqual({ committed: 'created', local: 'absent' });
        assertPublishedOn(ctx.expect, read(dir, COMMITTED));
        ctx.expect(fs.existsSync(path.join(dir, PRIVATE)), 'a live brand gets no private file').toBe(false);
      },
    },

    {
      name: 'case 1: a brand with no install at all still gets the committed file',
      run: (ctx) => {
        const dir = tmpdir();

        ctx.expect(ensureClaudeSettings(dir).committed).toBe('created');
        assertPublishedOn(ctx.expect, read(dir, COMMITTED));
      },
    },

    {
      name: 'case 2: the old node_modules folder source is healed to GitHub, every other key kept',
      run: (ctx) => {
        const dir = liveBrand();
        write(dir, COMMITTED, {
          permissions: { allow: ['Bash(npm test)'] },
          extraKnownMarketplaces: {
            omega: { source: { source: 'directory', path: './node_modules/@omega.js/manager' } },
            other: { source: { source: 'github', repo: 'someone/plugins' } },
          },
          enabledPlugins: { 'omega@omega': true, 'other@other': true },
        });

        ctx.expect(ensureClaudeSettings(dir).committed).toBe('healed');

        const settings = read(dir, COMMITTED);
        assertPublishedOn(ctx.expect, settings);
        ctx.expect(settings.permissions).toEqual({ allow: ['Bash(npm test)'] });
        ctx.expect(settings.extraKnownMarketplaces.other).toEqual({ source: { source: 'github', repo: 'someone/plugins' } });
        ctx.expect(settings.enabledPlugins['other@other']).toBe(true);
      },
    },

    {
      name: 'case 2: a published copy left disabled by hand is turned back on',
      run: (ctx) => {
        const dir = liveBrand();
        write(dir, COMMITTED, { model: 'x', enabledPlugins: { 'omega@omega': false } });

        ctx.expect(ensureClaudeSettings(dir).committed).toBe('healed');
        assertPublishedOn(ctx.expect, read(dir, COMMITTED));
        ctx.expect(read(dir, COMMITTED).model).toBe('x');
      },
    },

    // ─── The private file of a linked brand ──────────────────────────────────────

    {
      name: 'case 3: a linked brand gets the local copy in its private file, the committed file unchanged in shape',
      run: (ctx) => {
        const dir = linkedBrand();

        ctx.expect(ensureClaudeSettings(dir)).toEqual({ committed: 'created', local: 'written' });
        assertPublishedOn(ctx.expect, read(dir, COMMITTED));
        assertLocalOn(ctx.expect, dir, read(dir, PRIVATE));
      },
    },

    {
      name: 'case 3: the private file keeps every key that is not the omega keys',
      run: (ctx) => {
        const dir = linkedBrand();
        write(dir, PRIVATE, {
          permissions: { allow: ['Bash(ls)'] },
          extraKnownMarketplaces: { mine: { source: { source: 'directory', path: '/somewhere' } } },
          enabledPlugins: { 'mine@mine': true },
        });

        ctx.expect(ensureClaudeSettings(dir).local).toBe('written');

        const settings = read(dir, PRIVATE);
        assertLocalOn(ctx.expect, dir, settings);
        ctx.expect(settings.permissions).toEqual({ allow: ['Bash(ls)'] });
        ctx.expect(settings.extraKnownMarketplaces.mine).toEqual({ source: { source: 'directory', path: '/somewhere' } });
        ctx.expect(settings.enabledPlugins['mine@mine']).toBe(true);
      },
    },

    {
      name: 'case 4: a linked brand that goes live loses the omega keys, and its other keys stay',
      run: (ctx) => {
        const dir = linkedBrand();
        write(dir, PRIVATE, { permissions: { allow: ['Bash(ls)'] }, enabledPlugins: { 'mine@mine': true } });
        ensureClaudeSettings(dir);
        goLive(dir);

        ctx.expect(ensureClaudeSettings(dir)).toEqual({ committed: 'present', local: 'removed' });

        const settings = read(dir, PRIVATE);
        ctx.expect(settings.permissions).toEqual({ allow: ['Bash(ls)'] });
        ctx.expect(settings.enabledPlugins['mine@mine']).toBe(true);
        ctx.expect((settings.extraKnownMarketplaces || {})['omega-local']).toBe(undefined);
        ctx.expect('omega@omega-local' in settings.enabledPlugins).toBe(false);
        ctx.expect('omega@omega' in settings.enabledPlugins, 'the committed file decides for a live brand').toBe(false);
      },
    },

    {
      name: 'case 4: a private file that held only the omega keys is removed when the brand goes live',
      run: (ctx) => {
        const dir = linkedBrand();
        ensureClaudeSettings(dir);
        ctx.expect(fs.existsSync(path.join(dir, PRIVATE)), 'fixture sanity: the linked run wrote the file').toBeTruthy();
        goLive(dir);

        ctx.expect(ensureClaudeSettings(dir).local).toBe('removed');
        ctx.expect(fs.existsSync(path.join(dir, PRIVATE))).toBe(false);
        assertPublishedOn(ctx.expect, read(dir, COMMITTED));
      },
    },

    {
      name: 'case 4: a live brand whose private file has no omega keys leaves it untouched',
      run: (ctx) => {
        const dir = liveBrand();
        write(dir, PRIVATE, '{ "permissions": { "allow": [] } }\n');

        ctx.expect(ensureClaudeSettings(dir).local).toBe('absent');
        ctx.expect(fs.readFileSync(path.join(dir, PRIVATE), 'utf8')).toBe('{ "permissions": { "allow": [] } }\n');
      },
    },

    // ─── Unreadable files ────────────────────────────────────────────────────────

    {
      name: 'case 5: a committed file that is not JSON is reported invalid and never written',
      run: (ctx) => {
        const dir = liveBrand();
        write(dir, COMMITTED, '{ not json');

        ctx.expect(ensureClaudeSettings(dir).committed).toBe('invalid');
        ctx.expect(fs.readFileSync(path.join(dir, COMMITTED), 'utf8')).toBe('{ not json');
      },
    },

    {
      name: 'case 5: a private file that is not JSON is reported invalid and never written',
      run: (ctx) => {
        const dir = linkedBrand();
        write(dir, PRIVATE, 'nope');

        ctx.expect(ensureClaudeSettings(dir).local).toBe('invalid');
        ctx.expect(fs.readFileSync(path.join(dir, PRIVATE), 'utf8')).toBe('nope');

        goLive(dir);
        ctx.expect(ensureClaudeSettings(dir).local, 'a live run never deletes a file it cannot read').toBe('invalid');
        ctx.expect(fs.readFileSync(path.join(dir, PRIVATE), 'utf8')).toBe('nope');
      },
    },

    // ─── Idempotence and the dry run ─────────────────────────────────────────────

    {
      name: 'case 6: a second run with nothing changed writes no file',
      run: (ctx) => {
        const past = new Date('2020-01-01T00:00:00Z');

        for (const [dir, local] of [[liveBrand(), 'absent'], [linkedBrand(), 'present']]) {
          ensureClaudeSettings(dir);
          const written = [COMMITTED, PRIVATE].filter((file) => fs.existsSync(path.join(dir, file)));
          for (const file of written) fs.utimesSync(path.join(dir, file), past, past);

          ctx.expect(ensureClaudeSettings(dir)).toEqual({ committed: 'present', local });
          for (const file of written) {
            ctx.expect(fs.statSync(path.join(dir, file)).mtime.getTime(), `${file} was rewritten`).toBe(past.getTime());
          }
        }
      },
    },

    {
      name: 'ensureClaudeSettings: a dry run returns the verdicts and writes nothing',
      run: (ctx) => {
        const dir = linkedBrand();

        ctx.expect(ensureClaudeSettings(dir, { dryRun: true })).toEqual({ committed: 'created', local: 'written' });
        ctx.expect(fs.existsSync(path.join(dir, '.claude'))).toBe(false);
      },
    },

    // ─── The workspace ensure op ─────────────────────────────────────────────────

    {
      name: 'claude-settings op is registered in the workspace OPERATIONS',
      run: (ctx) => {
        const { OPERATIONS } = require('../src/config.js');
        ctx.expect(OPERATIONS.workspace.some((op) => op.name === 'claude-settings' && op.ensure === true)).toBeTruthy();
      },
    },

    {
      name: 'claude-settings: the op writes both files for a linked brand, then is a no-op',
      run: async (ctx) => {
        const dir = linkedBrand();
        const context = { brandRoot: dir, brand: { id: 'fixture', config: {} } };

        ctx.expect(await claudeSettingsOp(context)).not.toBe(null);
        assertPublishedOn(ctx.expect, read(dir, COMMITTED));
        assertLocalOn(ctx.expect, dir, read(dir, PRIVATE));

        ctx.expect(await claudeSettingsOp(context), 'a second run has nothing to say').toBe(null);
      },
    },

    {
      name: 'claude-settings: the op warns on an unreadable file',
      run: async (ctx) => {
        const dir = liveBrand();
        write(dir, COMMITTED, 'nope');

        const result = await claudeSettingsOp({ brandRoot: dir, brand: { id: 'fixture', config: {} } });
        ctx.expect(result.status).toBe('warned');
        ctx.expect(fs.readFileSync(path.join(dir, COMMITTED), 'utf8')).toBe('nope');
      },
    },

    {
      name: '#971: the op under --dry-run plans the writes and writes nothing',
      run: async (ctx) => {
        const dir = linkedBrand();
        const result = await claudeSettingsOp({ brandRoot: dir, brand: { id: 'fixture', config: {} }, options: { dryRun: true } });

        ctx.expect(JSON.stringify(result.output)).toMatch(/planned/);
        ctx.expect(fs.existsSync(path.join(dir, '.claude'))).toBe(false);
      },
    },

    {
      name: 'case 10: manage runs the two update commands when the installed plugin is older than the brand\'s OMEGA',
      run: async (ctx) => {
        const { machine } = await opOnMachine(ctx, { marketplaces: ON_GITHUB, installed: { 'omega@omega': '0.0.1' }, published: '999.0.0' });

        const mutations = machine.mutations();
        ctx.expect(mutations.length, JSON.stringify(mutations)).toBe(2);
        ctx.expect(mutations.some((argv) => argv.join(' ').includes('marketplace update omega'))).toBeTruthy();
        ctx.expect(mutations.some((argv) => !argv.includes('marketplace') && argv.includes('update') && argv.includes('omega@omega'))).toBeTruthy();
      },
    },

    {
      name: 'case 10: manage runs no command when the installed plugin is equal or newer',
      run: async (ctx) => {
        const { machine } = await opOnMachine(ctx, { marketplaces: ON_GITHUB, installed: { 'omega@omega': '999.0.0' } });
        ctx.expect(machine.mutations()).toEqual([]);
      },
    },

    {
      name: 'manage says in one line when the plugin is not installed, and never installs it unasked',
      run: async (ctx) => {
        const { machine, lines } = await opOnMachine(ctx, {});

        ctx.expect(lines.includes('Claude plugin not installed on this machine. Run: claude plugin marketplace add Omega-JS-Stack/omega && claude plugin install omega@omega'), lines).toBeTruthy();
        ctx.expect(machine.mutations()).toEqual([]);
      },
    },

    {
      name: 'the op runs claude through the runner the manage context injects, never the one on PATH',
      run: async (ctx) => {
        const injected = createMachine({ marketplaces: ON_GITHUB, installed: { 'omega@omega': '0.0.1' }, published: '999.0.0' });
        const onPath = PATH_MACHINE.calls().length;

        await claudeSettingsOp({ brandRoot: liveBrand(), brand: { id: 'fixture', config: {} }, execFn: injected.exec });

        ctx.expect(injected.mutations().length, `the injected runner ran the update: ${JSON.stringify(injected.calls())}`).toBe(2);
        ctx.expect(PATH_MACHINE.calls().length, 'nothing reached the claude on PATH').toBe(onPath);
      },
    },

    // ─── The machine check is the full walk's, and one walk reads it once ───────

    {
      name: '#1042 the boot lane writes the settings files and never runs claude',
      run: async (ctx) => {
        const { machine, dir } = await opOnMachine(ctx, { marketplaces: ON_GITHUB, installed: { 'omega@omega': '0.0.1' }, published: '999.0.0' }, { lane: 'boot' });

        assertPublishedOn(ctx.expect, read(dir, COMMITTED));
        ctx.expect(machine.calls(), 'npm start spawns no claude at all').toEqual([]);
      },
    },

    {
      name: '#1042 a full walk on a current plugin reads the machine once: three calls, no mutation',
      run: async (ctx) => {
        const { machine } = await opOnMachine(ctx, { marketplaces: ON_GITHUB, installed: { 'omega@omega': '999.0.0' } });

        ctx.expect(sortedCalls(machine.calls())).toEqual([...MACHINE_READS].sort());
        ctx.expect(machine.mutations()).toEqual([]);
      },
    },

    {
      name: '#1042 a full walk on a plugin behind the family version reads once, then runs the two updates',
      run: async (ctx) => {
        const { machine } = await opOnMachine(ctx, { marketplaces: ON_GITHUB, installed: { 'omega@omega': '0.0.1' }, published: '999.0.0' });

        const calls = machine.calls();
        ctx.expect(calls.length, JSON.stringify(calls)).toBe(5);
        ctx.expect(sortedCalls(calls.slice(0, 3)), 'the three reads come first, once').toEqual([...MACHINE_READS].sort());
        const updates = calls.slice(3).map((argv) => argv.join(' '));
        ctx.expect(updates.some((line) => line.includes('marketplace update omega')), updates.join(' | ')).toBeTruthy();
        ctx.expect(updates.some((line) => !line.includes('marketplace') && line.includes('update') && line.includes('omega@omega')), updates.join(' | ')).toBeTruthy();
      },
    },

    {
      name: '#1042 a full walk with no plugin installed prints the install hint off one read of the machine',
      run: async (ctx) => {
        const { machine, lines } = await opOnMachine(ctx, {});

        ctx.expect(lines.includes('Claude plugin not installed on this machine. Run: claude plugin marketplace add Omega-JS-Stack/omega && claude plugin install omega@omega'), lines).toBeTruthy();
        ctx.expect(sortedCalls(machine.calls())).toEqual([...MACHINE_READS].sort());
      },
    },

    {
      name: '#1042 a dry run never runs claude',
      run: async (ctx) => {
        const { machine } = await opOnMachine(ctx, { marketplaces: ON_GITHUB, installed: { 'omega@omega': '0.0.1' }, published: '999.0.0' }, { dryRun: true });

        ctx.expect(machine.calls()).toEqual([]);
      },
    },
  ],
});
