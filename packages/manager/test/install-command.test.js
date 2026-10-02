/**
 * `omega i local` / `omega i live` at a brand root: the link flip runs ONCE for
 * the whole brand, handed the brand root, and the plugin follows it with no
 * other step. Devkit's two flips are stubbed at their module boundary
 * (dev.test.js's pattern), because the real ones run an npm install; the stubs
 * leave the manager link the real ones leave, and their own behavior is
 * devkit's local.test.js. `claude` is a fake machine (test/lib/fake-claude.js).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
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

test('omega i live at the brand root restores registry specs once, from the brand root', async (t) => {
  machine(t);
  const root = stageBrand();
  await omega(root, ['i', 'live']);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].fn, 'restore');
  assert.equal(calls[0].dir, root);
  assert.equal(calls[0].dryRun, false);
});

test('omega i local at the brand root links the whole tree once, from the brand root', async (t) => {
  machine(t);
  const root = stageBrand();
  await omega(root, ['install', 'local']);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].fn, 'link');
  assert.equal(calls[0].dir, root);
  assert.equal(calls[0].monorepoRoot, MONOREPO);
});

/** omega-local registered through the CLI and declared for the user, on, and omega@omega off. */
function assertLocalDefault(fake) {
  const { records, settings } = fake.state();
  const local = { source: 'file', path: LOCAL_MANIFEST_PATH };
  assert.deepEqual((records['omega-local'] || {}).source, local, `omega-local has a source record: ${JSON.stringify(fake.state())}`);
  assert.deepEqual(((settings.extraKnownMarketplaces || {})['omega-local'] || {}).source, local);
  assert.equal(settings.enabledPlugins['omega@omega-local'], true);
  assert.equal(settings.enabledPlugins['omega@omega'], false);
  assert.ok(fake.mutations().some((argv) => argv.join(' ').includes(`marketplace add ${LOCAL_MANIFEST_PATH}`)), 'registered through the CLI add');
}

for (const [label, seed] of [['a machine with the published copy', PUBLISHED_INSTALLED], ['a machine with no plugin yet', {}]]) {
  test(`case 11: omega i local on ${label} makes the local copy the user default: omega-local registered and on, omega@omega off`, async (t) => {
    const fake = machine(t, seed);
    const root = stageBrand();
    await omega(root, ['i', 'local']);

    assertLocalDefault(fake);
  });
}

test('case 11: omega i local on a machine whose user settings declare omega from a folder moves omega to GitHub', async (t) => {
  const fake = machine(t, {
    marketplaces: { omega: { source: 'directory', path: '/Users/someone/omega' } },
    installed: { 'omega@omega': '1.0.0' },
  });
  const root = stageBrand();
  await omega(root, ['i', 'local']);

  const { records, settings } = fake.state();
  assert.deepEqual([records.omega.source.source, records.omega.source.repo], ['github', 'Omega-JS-Stack/omega']);
  assert.equal(settings.extraKnownMarketplaces.omega.source.source, 'github', 'one source under the name, never two');
  assertLocalDefault(fake);
});

test('omega i local then omega i live swaps the brand\'s plugin with no other step', async (t) => {
  machine(t);
  const root = stageBrand();
  const committed = path.join(root, '.claude', 'settings.json');
  const privateFile = path.join(root, '.claude', 'settings.local.json');

  await omega(root, ['i', 'local']);
  assert.equal(readJson(committed).enabledPlugins['omega@omega'], true, 'the committed file names the published copy either way');
  const local = readJson(privateFile);
  assert.equal(local.extraKnownMarketplaces['omega-local'].source.path, LOCAL_MANIFEST_PATH);
  assert.deepEqual([local.enabledPlugins['omega@omega-local'], local.enabledPlugins['omega@omega']], [true, false]);

  await omega(root, ['i', 'live']);
  assert.equal(fs.existsSync(privateFile), false, 'the live brand loads the published copy again');
  assert.equal(readJson(committed).enabledPlugins['omega@omega'], true);
});

test('--dry-run reaches the flip as its plan-only switch, and writes no settings and changes no machine', async (t) => {
  const fake = machine(t);
  const root = stageBrand();
  const { lines } = await omega(root, ['i', 'live', '--dry-run']);

  assert.equal(calls[0].dryRun, true);
  assert.match(lines, /Would restore 1 spec\(s\)/);
  assert.equal(fs.existsSync(path.join(root, '.claude')), false);

  await omega(root, ['i', 'local', '--dry-run']);
  assert.equal(fs.existsSync(path.join(root, '.claude')), false);
  assert.deepEqual(fake.mutations(), []);
});

test('an unknown kind refuses, naming both spellings, and flips nothing', async (t) => {
  machine(t);
  const root = stageBrand();
  const { lines, exitCode } = await omega(root, ['i', 'lcoal']);

  assert.equal(calls.length, 0);
  assert.equal(exitCode, 1);
  assert.match(lines, /Unknown install kind "lcoal": `omega i` takes local \(local, l, dev, d, development\) or live/);
});
