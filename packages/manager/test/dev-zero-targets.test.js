/**
 * `omega dev` when targets drop out before any leg boots. A brand that declares
 * no targets says so, names the command that adds one, and exits clean. A target
 * missing a machine tool is skipped with the tool's line, and a boot left with
 * no target exits 1. The manage cycle, the freshness sweep and every spawn are
 * stubbed before dev.js loads, so nothing real can boot.
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

// The seam answers every `npm run start` leg itself and records it in `calls`
const { captureConsole, calls } = require('./lib/onboard-seams.js');

/** The target folders a leg was started in, since `from`. */
const legsSince = (from) => calls.slice(from).filter((call) => call.kind === 'dev').map((call) => path.basename(call.cwd));

/** Put `exports` in the require cache as the module `request` resolves to. */
function stubModule(request, exports) {
  const resolved = require.resolve(request);
  require.cache[resolved] = { id: resolved, filename: resolved, path: path.dirname(resolved), loaded: true, exports };
}

stubModule('../src/manage.js', { runManage: async () => ({ hasErrors: false, results: {}, brand: {} }) });
// A registry-shaped brand with every dist fresh: no sweep heal, no monorepo watch
stubModule('@omega.js/devkit/local', {
  ...require('@omega.js/devkit/local'),
  freshnessSweep: () => ({ checked: [], healed: [], staleLinked: [], healFailed: [], failed: [] }),
  resolveLinkedMonorepo: () => null,
});

require('@omega.js/devkit/test/temp-home');

const devCommand = require('../src/commands/dev.js');
const { missingMachineTools, machineToolLine } = require('@omega.js/devkit/machine-tools');
const { toolProbe } = require('./lib/tool-probe.js');

const ZERO_TARGET_LINE = 'Nothing to run: this brand has no targets. Add one: npx omega onboard --targets=web';

/** The one line the helper writes for `tool` missing on the backend target named `target`. */
const missingToolLine = (target, tool) => machineToolLine(
  missingMachineTools([{ name: target, type: 'backend' }], { platform: process.platform, execFn: toolProbe(tool) })[0],
);

/** A brand whose targets are `types`, each named for its type, declaring its framework and a `start` script. */
function stageBrand(types = []) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-dev-zero-')));
  fs.mkdirSync(path.join(root, 'config'));
  fs.writeFileSync(path.join(root, 'config', 'omega.json5'), `{
  brand: { id: 'empty-brand', name: 'Empty Brand', url: 'https://empty-brand.test' },
  targets: { ${types.map((type) => `${type}: { type: '${type}' }`).join(', ')} },
}
`);
  for (const type of types) {
    fs.mkdirSync(path.join(root, 'targets', type), { recursive: true });
    fs.writeFileSync(path.join(root, 'targets', type, 'package.json'), JSON.stringify({
      name: `fixture-${type}`,
      private: true,
      dependencies: { [`@omega.js/${type}`]: '*' },
      scripts: { start: 'omega dev' },
    }));
  }
  return root;
}

/**
 * Run the dev command in `root` with the console captured and process.exit
 * recorded. A boot that holds the terminal reads as 'running' after `settleMs`.
 */
async function runDev(t, root, options, settleMs) {
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
  let failure = null;
  const outcome = await Promise.race([
    devCommand(options).then(() => 'returned', (error) => {
      failure = error;
      return error.exited ? 'exited' : 'threw';
    }),
    new Promise((resolve) => setTimeout(() => resolve('running'), settleMs)),
  ]);
  const exitCode = process.exitCode;
  capture.restore();

  // A thrown error is exit 1 through the CLI router; an explicit exit wins
  const code = exits.length ? exits[exits.length - 1] : (outcome === 'threw' ? 1 : exitCode);
  const output = [capture.text(), outcome === 'threw' ? failure.message : ''].join('\n');
  return { outcome, exits, exitCode, code, failure, output };
}

test('#1030 case 4: omega dev on a brand with zero targets prints the zero-target line and exits 0', async (t) => {
  spawned.length = 0;
  const from = calls.length;
  const run = await runDev(t, stageBrand(), {}, 5000);

  assert.notEqual(run.outcome, 'running', 'dev ends instead of holding the terminal');
  assert.notEqual(run.outcome, 'threw', run.failure && run.failure.stack);
  assert.ok(run.output.includes(ZERO_TARGET_LINE), `the zero-target line: ${run.output}`);
  assert.ok(run.exits.every((code) => code === 0), `exits clean: ${JSON.stringify(run.exits)}`);
  assert.ok(run.exitCode === undefined || run.exitCode === 0, `exit code ${run.exitCode}`);
  assert.deepEqual(spawned, [], 'nothing spawned');
  assert.deepEqual(legsSince(from), [], 'no leg started');
});

test('#1032 case 5: on a web and backend brand with Java missing, the backend is skipped with the line and the web leg still starts', async (t) => {
  const from = calls.length;
  const run = await runDev(t, stageBrand(['web', 'backend']), { execFn: toolProbe('java') }, 500);

  assert.equal(run.outcome, 'running', `the web leg holds the terminal: ${run.output}`);
  assert.deepEqual(legsSince(from), ['web'], 'only the web leg started');
  assert.ok(run.output.includes(missingToolLine('backend', 'java')), `the skip names the tool, the target and the install command: ${run.output}`);
  assert.notEqual(run.code, 1, `the exit code is not 1: ${JSON.stringify(run.exits)} / ${run.exitCode}`);
});

test('#1032 case 6: when the only picked target misses a tool, dev prints the line and exits 1', async (t) => {
  const from = calls.length;
  const run = await runDev(t, stageBrand(['backend']), { execFn: toolProbe('java') }, 5000);

  assert.notEqual(run.outcome, 'running', 'nothing is left to boot, so dev ends');
  assert.ok(run.output.includes(missingToolLine('backend', 'java')), `the line: ${run.output}`);
  assert.equal(run.code, 1, `exits 1: ${JSON.stringify(run.exits)} / ${run.exitCode}`);
  assert.deepEqual(legsSince(from), [], 'no leg started');
});
