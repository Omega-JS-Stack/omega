/**
 * `omega i local` / `omega i live` at a brand root: the link flip runs ONCE for
 * the whole brand, handed the brand root, and the plugin follows it with no
 * other step. Devkit's two flips are stubbed at their module boundary
 * (dev.test.js's pattern), because the real ones run an npm install; the stubs
 * leave the manager link the real ones leave, and their own behavior is
 * devkit's local.test.js. `claude` is a fake machine (test/lib/fake-claude.js).
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createMachine } = require('./lib/fake-claude.js');

const MONOREPO = path.join(__dirname, '..', '..', '..');
const LOCAL_MANIFEST_PATH = path.join(MONOREPO, '.claude-plugin', 'marketplace.local.json');

const managerLink = (dir) => path.join(dir, 'node_modules', '@omega.js', 'manager');

const calls = [];
const localPath = require.resolve('@omega.js/devkit/local');
require.cache[localPath] = {
  id: localPath,
  filename: localPath,
  path: path.dirname(localPath),
  loaded: true,
  exports: {
    ...require('@omega.js/devkit/local'),
    resolveMonorepoRoot: () => MONOREPO,
    linkLocalPackages: async (options) => {
      calls.push({ fn: 'link', ...options });
      if (!options.dryRun) {
        fs.mkdirSync(path.dirname(managerLink(options.dir)), { recursive: true });
        fs.rmSync(managerLink(options.dir), { recursive: true, force: true });
        fs.symlinkSync(path.join(MONOREPO, 'packages', 'manager'), managerLink(options.dir));
      }
      return [{ action: 'link' }];
    },
    restoreRegistrySpecs: async (options) => {
      calls.push({ fn: 'restore', ...options });
      if (!options.dryRun) {
        fs.rmSync(managerLink(options.dir), { recursive: true, force: true });
        fs.mkdirSync(managerLink(options.dir), { recursive: true });
        fs.writeFileSync(path.join(managerLink(options.dir), 'package.json'), JSON.stringify({ name: '@omega.js/manager', version: '1.0.0' }));
      }
      return [{ action: 'flip' }];
    },
  },
};

const { parseArgv } = require('@omega.js/devkit/argv');
const Main = require('../src/cli.js');
const { BOOLEAN_FLAGS } = require('../src/cli-run.js');

/** A brand root with one web target, declaring the manager the way onboarding scaffolds it. */
function stageBrand() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mgr-install-')));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture-brand', private: true, devDependencies: { '@omega.js/manager': '1.0.0' } }));
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.writeFileSync(path.join(root, 'config', 'omega.json5'), '{ brand: { id: "fixture-brand" }, targets: { web: { type: "web" } } }\n');
  fs.mkdirSync(path.join(root, 'targets', 'web'), { recursive: true });
  fs.writeFileSync(path.join(root, 'targets', 'web', 'package.json'), JSON.stringify({ name: 'web', dependencies: { '@omega.js/web': '*' } }));
  return root;
}

const PUBLISHED_INSTALLED = {
  marketplaces: { omega: { source: 'github', repo: 'Omega-JS-Stack/omega' } },
  installed: { 'omega@omega': '999.0.0' },
};

/** A fake machine (by default with the published plugin installed), pointed at for one test. */
function machine(t, seed = PUBLISHED_INSTALLED) {
  const fake = createMachine(seed);
  t.after(fake.activate());
  return fake;
}

/** Run `omega <args>` through the manager's router from `cwd`, output captured. */
async function omega(cwd, args) {
  calls.length = 0;
  const cwd0 = process.cwd();
  const log0 = console.log;
  const error0 = console.error;
  const exitCode0 = process.exitCode;
  const lines = [];
  console.log = (...parts) => lines.push(parts.join(' '));
  console.error = (...parts) => lines.push(parts.join(' '));
  process.chdir(cwd);
  try {
    await new Main().process(parseArgv(args, { booleans: BOOLEAN_FLAGS }));
    return { lines: lines.join('\n'), exitCode: process.exitCode };
  } finally {
    process.chdir(cwd0);
    console.log = log0;
    console.error = error0;
    process.exitCode = exitCode0;
  }
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

/** omega-local registered through the CLI and declared for the user, on, and omega@omega off. */
function assertLocalDefault(expect, fake) {
  const { records, settings } = fake.state();
  const local = { source: 'file', path: LOCAL_MANIFEST_PATH };
  expect((records['omega-local'] || {}).source, `omega-local has a source record: ${JSON.stringify(fake.state())}`).toEqual(local);
  expect(((settings.extraKnownMarketplaces || {})['omega-local'] || {}).source).toEqual(local);
  expect(settings.enabledPlugins['omega@omega-local']).toBe(true);
  expect(settings.enabledPlugins['omega@omega']).toBe(false);
  expect(fake.mutations().some((argv) => argv.join(' ').includes(`marketplace add ${LOCAL_MANIFEST_PATH}`)), 'registered through the CLI add').toBeTruthy();
}

module.exports = defineCases({
  type: 'group',
  description: 'install-command',
  tests: [
    {
      name: 'omega i live at the brand root restores registry specs once, from the brand root',
      run: async (ctx) => {
        machine(ctx);
        const root = stageBrand();
        await omega(root, ['i', 'live']);

        ctx.expect(calls.length).toBe(1);
        ctx.expect(calls[0].fn).toBe('restore');
        ctx.expect(calls[0].dir).toBe(root);
        ctx.expect(calls[0].dryRun).toBe(false);
      },
    },

    {
      name: 'omega i local at the brand root links the whole tree once, from the brand root',
      run: async (ctx) => {
        machine(ctx);
        const root = stageBrand();
        await omega(root, ['install', 'local']);

        ctx.expect(calls.length).toBe(1);
        ctx.expect(calls[0].fn).toBe('link');
        ctx.expect(calls[0].dir).toBe(root);
        ctx.expect(calls[0].monorepoRoot).toBe(MONOREPO);
      },
    },

    ...(() => {
      const cases = [];
      for (const [label, seed] of [['a machine with the published copy', PUBLISHED_INSTALLED], ['a machine with no plugin yet', {}]]) {
        cases.push({
          name: `case 11: omega i local on ${label} makes the local copy the user default: omega-local registered and on, omega@omega off`,
          run: async (ctx) => {
            const fake = machine(ctx, seed);
            const root = stageBrand();
            await omega(root, ['i', 'local']);

            assertLocalDefault(ctx.expect, fake);
          },
        });
      }
      return cases;
    })(),

    {
      name: 'case 11: omega i local on a machine whose user settings declare omega from a folder moves omega to GitHub',
      run: async (ctx) => {
        const fake = machine(ctx, {
          marketplaces: { omega: { source: 'directory', path: '/Users/someone/omega' } },
          installed: { 'omega@omega': '1.0.0' },
        });
        const root = stageBrand();
        await omega(root, ['i', 'local']);

        const { records, settings } = fake.state();
        ctx.expect([records.omega.source.source, records.omega.source.repo]).toEqual(['github', 'Omega-JS-Stack/omega']);
        ctx.expect(settings.extraKnownMarketplaces.omega.source.source, 'one source under the name, never two').toBe('github');
        assertLocalDefault(ctx.expect, fake);
      },
    },

    {
      name: 'omega i local then omega i live swaps the brand\'s plugin with no other step',
      run: async (ctx) => {
        machine(ctx);
        const root = stageBrand();
        const committed = path.join(root, '.claude', 'settings.json');
        const privateFile = path.join(root, '.claude', 'settings.local.json');

        await omega(root, ['i', 'local']);
        ctx.expect(readJson(committed).enabledPlugins['omega@omega'], 'the committed file names the published copy either way').toBe(true);
        const local = readJson(privateFile);
        ctx.expect(local.extraKnownMarketplaces['omega-local'].source.path).toBe(LOCAL_MANIFEST_PATH);
        ctx.expect([local.enabledPlugins['omega@omega-local'], local.enabledPlugins['omega@omega']]).toEqual([true, false]);

        await omega(root, ['i', 'live']);
        ctx.expect(fs.existsSync(privateFile), 'the live brand loads the published copy again').toBe(false);
        ctx.expect(readJson(committed).enabledPlugins['omega@omega']).toBe(true);
      },
    },

    {
      name: '--dry-run reaches the flip as its plan-only switch, and writes no settings and changes no machine',
      run: async (ctx) => {
        const fake = machine(ctx);
        const root = stageBrand();
        const { lines } = await omega(root, ['i', 'live', '--dry-run']);

        ctx.expect(calls[0].dryRun).toBe(true);
        ctx.expect(lines).toMatch(/Would restore 1 spec\(s\)/);
        ctx.expect(fs.existsSync(path.join(root, '.claude'))).toBe(false);

        await omega(root, ['i', 'local', '--dry-run']);
        ctx.expect(fs.existsSync(path.join(root, '.claude'))).toBe(false);
        ctx.expect(fake.mutations()).toEqual([]);
      },
    },

    {
      name: 'an unknown kind refuses, naming both spellings, and flips nothing',
      run: async (ctx) => {
        machine(ctx);
        const root = stageBrand();
        const { lines, exitCode } = await omega(root, ['i', 'lcoal']);

        ctx.expect(calls.length).toBe(0);
        ctx.expect(exitCode).toBe(1);
        ctx.expect(lines).toMatch(/Unknown install kind "lcoal": `omega i` takes local \(local, l, dev, d, development\) or live/);
      },
    },
  ],
});
