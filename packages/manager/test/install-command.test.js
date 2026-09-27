/**
 * `omega i local` / `omega i live` at a brand root: the link flip runs ONCE for
 * the whole brand, handed the brand root. Devkit's two flips are stubbed at
 * their module boundary (dev.test.js's pattern), because the real ones run an
 * npm install; their own behavior is devkit's local.test.js.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const calls = [];
const localPath = require.resolve('@omega.js/devkit/local');
require.cache[localPath] = {
  id: localPath,
  filename: localPath,
  path: path.dirname(localPath),
  loaded: true,
  exports: {
    ...require('@omega.js/devkit/local'),
    resolveMonorepoRoot: () => '/the/monorepo',
    linkLocalPackages: async (options) => { calls.push({ fn: 'link', ...options }); return [{ action: 'link' }]; },
    restoreRegistrySpecs: async (options) => { calls.push({ fn: 'restore', ...options }); return [{ action: 'flip' }]; },
  },
};

const { parseArgv } = require('@omega.js/devkit/argv');
const Main = require('../src/cli.js');
const { BOOLEAN_FLAGS } = require('../src/cli-run.js');

/** A brand root with one web target. */
function stageBrand() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mgr-install-')));
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.writeFileSync(path.join(root, 'config', 'omega.json5'), '{ brand: { id: "fixture-brand" }, targets: { web: { type: "web" } } }\n');
  fs.mkdirSync(path.join(root, 'targets', 'web'), { recursive: true });
  fs.writeFileSync(path.join(root, 'targets', 'web', 'package.json'), JSON.stringify({ name: 'web', dependencies: { '@omega.js/web': '*' } }));
  return root;
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

test('omega i live at the brand root restores registry specs once, from the brand root', async () => {
  const root = stageBrand();
  await omega(root, ['i', 'live']);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].fn, 'restore');
  assert.equal(calls[0].dir, root);
  assert.equal(calls[0].dryRun, false);
});

test('omega i local at the brand root links the whole tree once, from the brand root', async () => {
  const root = stageBrand();
  await omega(root, ['install', 'local']);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].fn, 'link');
  assert.equal(calls[0].dir, root);
  assert.equal(calls[0].monorepoRoot, '/the/monorepo');
});

test('--dry-run reaches the flip as its plan-only switch', async () => {
  const root = stageBrand();
  const { lines } = await omega(root, ['i', 'live', '--dry-run']);

  assert.equal(calls[0].dryRun, true);
  assert.match(lines, /Would restore 1 spec\(s\)/);
});

test('an unknown kind refuses, naming both spellings, and flips nothing', async () => {
  const root = stageBrand();
  const { lines, exitCode } = await omega(root, ['i', 'lcoal']);

  assert.equal(calls.length, 0);
  assert.equal(exitCode, 1);
  assert.match(lines, /Unknown install kind "lcoal": `omega i` takes local \(local, l, dev, d, development\) or live/);
});
