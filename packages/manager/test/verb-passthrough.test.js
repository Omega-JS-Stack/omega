/**
 * The brand root's pass-through: a framework verb the manager keeps no command
 * for runs on the picked targets through each target's own bin, the args after
 * the verb forwarded verbatim, and every spawned child inheriting the
 * root-dispatch marker the dispatcher set. A real fixture brand on disk; only
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

const { ROOT_DISPATCH_ENV } = require('@omega.js/devkit/omega-bin');
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
 * api, plus a fake installed bin for each framework.
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
  write(path.join(root, 'targets', 'web', 'package.json'), { name: 'web', private: true, dependencies: { '@omega.js/web': '*' } });
  write(path.join(root, 'targets', 'admin', 'package.json'), { name: 'admin', private: true, dependencies: { '@omega.js/web': '*' } });
  write(path.join(root, 'targets', 'backend', 'package.json'), { name: 'backend', private: true, dependencies: { '@omega.js/backend': '*' } });
  write(path.join(root, 'targets', 'desktop', 'package.json'), { name: 'desktop', private: true, dependencies: { '@omega.js/desktop': '*' } });
  write(path.join(root, 'targets', 'api', 'package.json'), { name: 'api', private: true, scripts: { translate: 'echo no' } });
  for (const pkg of ['@omega.js/web', '@omega.js/backend', '@omega.js/desktop']) {
    write(path.join(root, 'node_modules', pkg, 'package.json'), { name: pkg, bin: { omega: './bin.js' } });
    write(path.join(root, 'node_modules', pkg, 'bin.js'), '#!/usr/bin/env node\n');
  }
  return root;
}

const binOf = (root, pkg) => path.join(root, 'node_modules', '@omega.js', pkg, 'bin.js');

/** Run fn from the brand root with the marker the dispatcher sets, output captured and everything restored. */
async function atRoot(root, fn) {
  spawned.length = 0;
  const cwd0 = process.cwd();
  const log0 = console.log;
  const error0 = console.error;
  const exitCode0 = process.exitCode;
  const lines = [];
  console.log = (...args) => lines.push(args.join(' '));
  console.error = (...args) => lines.push(args.join(' '));
  process.env[ROOT_DISPATCH_ENV] = root;
  process.chdir(root);
  try {
    await fn();
    return { lines: lines.join('\n'), exitCode: process.exitCode };
  } finally {
    process.chdir(cwd0);
    delete process.env[ROOT_DISPATCH_ENV];
    console.log = log0;
    console.error = error0;
    process.exitCode = exitCode0;
  }
}

test('translate --target=web at the brand root spawns web\'s bin with the verb and the forwarded args, marker inherited', async () => {
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
  assert.equal(spawned[0].command, process.execPath);
  assert.deepEqual(spawned[0].args, [binOf(root, 'web'), 'translate', '--lang', 'de', 'framework:']);
  assert.equal(spawned[0].cwd, path.join(root, 'targets', 'web'));
  assert.equal(spawned[0].env[ROOT_DISPATCH_ENV], root, 'the child passes the dispatcher\'s check inside the target');
});

test('translate with no picker runs every web target, and nothing else', async () => {
  const root = stageBrand();
  await atRoot(root, () => runPassThrough('translate', ['translate']));

  assert.deepEqual(spawned.map((call) => path.basename(call.cwd)).sort(), ['admin', 'web']);
  assert.ok(spawned.every((call) => call.args[0] === binOf(root, 'web') && call.args[1] === 'translate'));
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
