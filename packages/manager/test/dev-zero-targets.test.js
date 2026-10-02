/**
 * `omega dev` on a brand that declares no targets: nothing to boot, so it says
 * so, names the command that adds a target, and exits clean. The manage cycle
 * and every spawn are stubbed before dev.js loads, so nothing real can boot.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const childProcess = require('node:child_process');

// Installed first, so every binding taken after this one (the seams' too) records here
const spawned = [];
childProcess.spawn = (command, args) => {
  spawned.push([command, ...(args || [])].join(' '));
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => true;
  return child;
};

const { captureConsole } = require('./lib/onboard-seams.js');

const managePath = require.resolve('../src/manage.js');
require.cache[managePath] = {
  id: managePath,
  filename: managePath,
  path: path.dirname(managePath),
  loaded: true,
  exports: { runManage: async () => ({ hasErrors: false, results: {}, brand: {} }) },
};

require('@omega.js/devkit/test/temp-home');

const devCommand = require('../src/commands/dev.js');

const ZERO_TARGET_LINE = 'Nothing to run: this brand has no targets. Add one: npx omega onboard --targets=web';

function stageEmptyBrand() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-dev-zero-')));
  fs.mkdirSync(path.join(root, 'config'));
  fs.writeFileSync(path.join(root, 'config', 'omega.json5'), `{
  brand: { id: 'empty-brand', name: 'Empty Brand', url: 'https://empty-brand.test' },
  targets: {},
}
`);
  return root;
}

test('#1030 case 4: omega dev on a brand with zero targets prints the zero-target line and exits 0', async (t) => {
  const root = stageEmptyBrand();
  const cwd = process.cwd();
  const priorExitCode = process.exitCode;
  const realExit = process.exit;
  const exits = [];
  const capture = captureConsole();
  // An exit is the run's end, so it stops here instead of ending the test process
  process.exit = (code) => {
    exits.push(code ?? 0);
    throw Object.assign(new Error('process.exit'), { exited: true });
  };
  t.after(() => {
    process.exit = realExit;
    process.exitCode = priorExitCode;
    process.chdir(cwd);
    capture.restore();
  });

  process.chdir(root);
  const outcome = await Promise.race([
    devCommand({}).then(() => 'returned', (error) => (error.exited ? 'exited' : Promise.reject(error))),
    new Promise((resolve) => setTimeout(() => resolve('running'), 5000)),
  ]);
  const exitCode = process.exitCode;
  capture.restore();

  assert.notEqual(outcome, 'running', 'dev ends instead of holding the terminal');
  assert.ok(capture.text().includes(ZERO_TARGET_LINE), `the zero-target line: ${capture.text()}`);
  assert.ok(exits.every((code) => code === 0), `exits clean: ${JSON.stringify(exits)}`);
  assert.ok(exitCode === undefined || exitCode === 0, `exit code ${exitCode}`);
  assert.deepEqual(spawned, [], 'nothing spawned');
});
