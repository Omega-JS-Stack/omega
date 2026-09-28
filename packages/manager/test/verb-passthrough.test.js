/**
 * The brand root's pass-through: a framework verb the manager keeps no command
 * for. A fan-out verb (`fanout: 'each'`) runs each target's own
 * `npm run <verb>`, custom targets included, the args after `--`; a
 * single-target command (`fanout: 'none'`) runs the picked target's framework
 * CLI with the argv as typed. A real fixture brand on disk; only
 * child_process.spawn is replaced (before run-command.js binds it), so nothing
 * real starts.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const childProcess = require('node:child_process');

const spawned = [];
childProcess.spawn = (command, args, options) => {
  spawned.push({ command, args, cwd: options.cwd, env: options.env });
  const child = new EventEmitter();
  process.nextTick(() => child.emit('close', 0));
  return child;
};

const { parseArgv } = require('@omega.js/devkit/argv');
const Main = require('../src/cli.js');
const { BOOLEAN_FLAGS } = require('../src/cli-run.js');
const { passThroughRow, runPassThrough } = require('../src/lib/verb-passthrough.js');

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, typeof content === 'string' ? content : JSON.stringify(content));
}

/**
 * A brand with two web targets (web, admin), a backend, a desktop and a custom
 * api, each framework target carrying the verb scripts its scaffold writes.
 * @returns {string} the brand root
 */
function stageBrand() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mgr-passthrough-')));
  write(path.join(root, 'package.json'), { name: 'fixture-brand', private: true, workspaces: ['targets/*'] });
  write(path.join(root, 'config', 'omega.json5'), `{
  brand: { id: 'fixture-brand', name: 'Fixture Brand', url: 'https://fixture-brand.test' },
  targets: { web: { type: 'web' }, admin: { type: 'web' }, backend: { type: 'backend' }, desktop: { type: 'desktop' }, api: { type: 'custom' } },
}
`);
  const web = { translate: 'omega translate' };
  write(path.join(root, 'targets', 'web', 'package.json'), { name: 'web', private: true, dependencies: { '@omega.js/web': '*' }, scripts: web });
  write(path.join(root, 'targets', 'admin', 'package.json'), { name: 'admin', private: true, dependencies: { '@omega.js/web': '*' }, scripts: web });
  write(path.join(root, 'targets', 'backend', 'package.json'), { name: 'backend', private: true, dependencies: { '@omega.js/backend': '*' } });
  write(path.join(root, 'targets', 'desktop', 'package.json'), { name: 'desktop', private: true, dependencies: { '@omega.js/desktop': '*' } });
  write(path.join(root, 'targets', 'api', 'package.json'), { name: 'api', private: true, scripts: { translate: 'echo api' } });
  for (const pkg of ['@omega.js/web', '@omega.js/backend', '@omega.js/desktop']) {
    write(path.join(root, 'node_modules', pkg, 'package.json'), { name: pkg, bin: { omega: './bin.js' } });
    write(path.join(root, 'node_modules', pkg, 'bin.js'), '#!/usr/bin/env node\n');
  }
  return root;
}

const binOf = (root, pkg) => path.join(root, 'node_modules', '@omega.js', pkg, 'bin.js');

/** Run fn from the brand root, output captured and everything restored. */
async function atRoot(root, fn) {
  spawned.length = 0;
  const cwd0 = process.cwd();
  const log0 = console.log;
  const error0 = console.error;
  const exitCode0 = process.exitCode;
  const lines = [];
  console.log = (...args) => lines.push(args.join(' '));
  console.error = (...args) => lines.push(args.join(' '));
  process.chdir(root);
  try {
    await fn();
    return { lines: lines.join('\n'), exitCode: process.exitCode };
  } finally {
    process.chdir(cwd0);
    console.log = log0;
    console.error = error0;
    process.exitCode = exitCode0;
  }
}

test('translate --target=web at the brand root runs web\'s own `npm run translate`, the args after --', async () => {
  const root = stageBrand();
  const argv0 = process.argv;
  const args = ['translate', '--target=web', '--lang', 'de', 'framework:'];
  process.argv = [process.execPath, 'omega', ...args];
  try {
    await atRoot(root, () => new Main().process(parseArgv(args, { booleans: BOOLEAN_FLAGS })));
  } finally {
    process.argv = argv0;
  }

  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].command, 'npm');
  assert.deepEqual(spawned[0].args, ['run', 'translate', '--', '--lang', 'de', 'framework:']);
  assert.equal(spawned[0].cwd, path.join(root, 'targets', 'web'));
  assert.equal(spawned[0].env.OMEGA_ROOT_DISPATCH, undefined, 'the child needs no marker inside the target');
});

test('translate with no picker runs every web target and every custom target, and no other framework', async () => {
  const root = stageBrand();
  await atRoot(root, () => runPassThrough('translate', ['translate']));

  assert.deepEqual(spawned.map((call) => path.basename(call.cwd)).sort(), ['admin', 'api', 'web'], 'a fan-out verb is each target\'s own script, custom included');
  assert.ok(spawned.every((call) => call.command === 'npm' && call.args.join(' ') === 'run translate'));
});

test('a single-target command passes through to the framework CLI with the alias as typed, never an npm script', async () => {
  const root = stageBrand();
  await atRoot(root, () => runPassThrough('firestore:set', ['firestore:set', '--target=backend', 'users/abc', '{"a":1}']));

  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].command, process.execPath);
  assert.deepEqual(spawned[0].args, [binOf(root, 'backend'), 'firestore:set', 'users/abc', '{"a":1}']);
  assert.equal(spawned[0].cwd, path.join(root, 'targets', 'backend'));
});

test('a single-target command on a custom target steps aside loudly, and nothing fails', async () => {
  const root = stageBrand();
  const { lines, exitCode } = await atRoot(root, () => runPassThrough('emulators', ['emulators', '--target=api']));

  assert.equal(spawned.length, 0);
  assert.match(lines, /emulators is a @omega\.js\/backend command; api is custom/);
  assert.equal(exitCode, undefined);
});

test('launch with no picker refuses, naming the desktop targets; with one it runs there', async () => {
  const root = stageBrand();
  await atRoot(root, () => assert.rejects(runPassThrough('launch', ['launch']), (error) => {
    assert.equal(error.refusal, true);
    assert.match(error.message, /"launch" runs on one target: npx omega launch --target=<name>, the name one of desktop\. Nothing ran\./);
    return true;
  }));
  assert.equal(spawned.length, 0);

  await atRoot(root, () => runPassThrough('launch', ['launch', '--target', 'desktop']));
  assert.deepEqual(spawned.map((call) => call.args), [[binOf(root, 'desktop'), 'launch']]);
});

test('--dry-run on a fan-out verb reaches the walk: a brand-owned script plans, the framework\'s own hears the flag', async () => {
  const root = stageBrand();
  const { lines } = await atRoot(root, () => runPassThrough('translate', ['translate', '--dry-run']));

  assert.deepEqual(spawned.map((call) => path.basename(call.cwd)).sort(), ['admin', 'web'], 'only the framework scripts ran');
  assert.ok(spawned.every((call) => call.args.join(' ') === 'run translate -- --dry-run'));
  assert.match(lines, /api: dry run .*would run npm run translate in targets\/api/, 'the custom target stopped at its plan');
});

test('--dry-run on a single-target command prints the plan and spawns nothing', async () => {
  const root = stageBrand();
  const { lines, exitCode } = await atRoot(root, () => runPassThrough('firestore:set', ['firestore:set', '--target=backend', 'users/abc', '--dry-run']));

  assert.equal(spawned.length, 0);
  assert.match(lines, /would run @omega\.js\/backend firestore:set users\/abc --dry-run in targets\/backend/);
  assert.equal(exitCode, undefined);
});

test('audit --target=backend refuses by name: the backend does not own audit', async () => {
  const root = stageBrand();
  await atRoot(root, () => assert.rejects(runPassThrough('audit', ['audit', '--target=backend']), (error) => {
    assert.equal(error.refusal, true);
    assert.match(error.message, /"audit" is @omega\.js\/web's verb, and backend \(@omega\.js\/backend\) cannot run it\. Nothing ran\./);
    return true;
  }));
  assert.equal(spawned.length, 0);
});

test('a verb no row knows gets the manager\'s unknown-verb answer', async () => {
  const root = stageBrand();
  assert.equal(passThroughRow('notaverb'), null);
  assert.equal(passThroughRow('dev'), null, 'a root row is the manager\'s own command, never passed through');

  const { lines, exitCode } = await atRoot(root, () => new Main().process(parseArgv(['notaverb'], { booleans: BOOLEAN_FLAGS })));
  assert.match(lines, /Unknown command "notaverb"\. Available: /);
  assert.equal(exitCode, 1);
  assert.equal(spawned.length, 0);
});
