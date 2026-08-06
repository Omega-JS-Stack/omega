// `omega dev` (brand root) — target-selection rules plus the boot SEQUENCE
// (manage cycle, then the app legs). The spawn plumbing is composition of
// tested pieces (discoverApps, resolveAppNode, watch-all's forwarding
// pattern); the SELECTION is the behavior with rules worth pinning: default
// set, --only/--except/--all, unknowns, missing apps, backend-first ordering.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const childProcess = require('node:child_process');

// ─── Boot-sequence instrumentation ───────────────────────────────────────────
// Both boundaries dev.js binds at load time (child_process.spawn, manage's
// runManage) are replaced BEFORE it is required, so the order of the two is
// observable in-process without booting anything real.

const boot = [];
let manageReport = { hasErrors: false, results: {}, brand: {} };

childProcess.spawn = (command, args, options) => {
  boot.push(`spawn:${path.basename(options.cwd)}`);
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  return child;
};

const managePath = require.resolve('../src/manage.js');
require.cache[managePath] = {
  id: managePath,
  filename: managePath,
  path: path.dirname(managePath),
  loaded: true,
  exports: {
    runManage: async (startDir) => {
      boot.push(`manage:${startDir}`);
      return manageReport;
    },
  },
};

const devCommand = require('../src/commands/dev.js');
const { selectDevTargets, DEFAULT_TARGETS } = devCommand;

const ALL_APPS = ['web', 'backend', 'desktop', 'extension'];

/** Stage a brand monorepo with a single website app. */
function stageBrand() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-manager-dev-')));

  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.writeFileSync(path.join(root, 'config', 'omega.json5'), `{
  brand: { id: 'fixture-brand', name: 'Fixture Brand', url: 'https://fixture-brand.test' },
  targets: { web: {} },
}
`);

  const website = path.join(root, 'apps', 'website');
  fs.mkdirSync(website, { recursive: true });
  fs.writeFileSync(path.join(website, 'package.json'), JSON.stringify({ name: 'fixture-website', private: true }));

  return root;
}

/**
 * Boot the dev command from `cwd`. It never resolves by design (it holds the
 * orchestrator alive while children run), so the run races a settle timer;
 * a rejection still surfaces.
 */
async function bootDev(cwd, options = {}) {
  const cwd0 = process.cwd();
  process.chdir(cwd);
  try {
    return await Promise.race([
      devCommand(options),
      new Promise((resolve) => setTimeout(() => resolve('running'), 250)),
    ]);
  } finally {
    process.chdir(cwd0);
  }
}

test('default set is the local web loop — web + backend, GUI targets stay down', () => {
  const { selected, unknown, missing } = selectDevTargets({ available: ALL_APPS });

  assert.deepStrictEqual(selected, ['backend', 'web'], 'backend boots first (publishes the port map)');
  assert.deepStrictEqual(DEFAULT_TARGETS, ['web', 'backend']);
  assert.deepStrictEqual(unknown, []);
  assert.deepStrictEqual(missing, []);
});

test('--only is the exact set; --except subtracts; --all boots every leg', () => {
  assert.deepStrictEqual(
    selectDevTargets({ available: ALL_APPS, only: 'web' }).selected,
    ['web'],
  );
  assert.deepStrictEqual(
    selectDevTargets({ available: ALL_APPS, only: 'desktop,web' }).selected,
    ['desktop', 'web'],
    '--only can opt GUI targets in',
  );
  assert.deepStrictEqual(
    selectDevTargets({ available: ALL_APPS, except: 'backend' }).selected,
    ['web'],
  );
  assert.deepStrictEqual(
    selectDevTargets({ available: ALL_APPS, all: true }).selected,
    ['backend', 'web', 'desktop', 'extension'],
    'backend still first under --all',
  );
});

test('unknown targets are reported, not booted; targets without apps go to missing', () => {
  const result = selectDevTargets({ available: ['web'], only: 'web,backend,mobile' });

  assert.deepStrictEqual(result.selected, ['web']);
  assert.deepStrictEqual(result.unknown, ['mobile'], 'no mobile dev leg exists (MAM parked)');
  assert.deepStrictEqual(result.missing, ['backend'], 'requested but no app in this brand');
});

test('a web-only brand defaults to just web — no phantom backend leg', () => {
  const { selected, missing } = selectDevTargets({ available: ['web'] });

  assert.deepStrictEqual(selected, ['web']);
  assert.deepStrictEqual(missing, [], 'the default set adapts to the brand instead of warning');
});

// ─── Boot sequence ───────────────────────────────────────────────────────────

test('boot opens with the manage cycle, THEN spawns the app legs — brand asset edits land on restart', async () => {
  boot.length = 0;
  manageReport = { hasErrors: false, results: {}, brand: {} };
  const root = stageBrand();

  const outcome = await bootDev(root, { only: 'web' });

  assert.strictEqual(outcome, 'running', 'the orchestrator stays alive after booting');
  assert.deepStrictEqual(boot, [`manage:${root}`, 'spawn:website'],
    'the full service walk runs against the brand root before any app leg starts');
});

test('a manage cycle with errors stops dev boot loudly — no app leg spawns', async () => {
  boot.length = 0;
  manageReport = { hasErrors: true, results: {}, brand: {} };
  const root = stageBrand();

  await assert.rejects(() => bootDev(root, { only: 'web' }), /manage/i);
  assert.deepStrictEqual(boot, [`manage:${root}`], 'nothing booted on top of a broken brand');
});

// ─── Verb log (#197) ─────────────────────────────────────────────────────────

test('boot tees the brand-level fan-out to <brandRoot>/logs/manage.log, ANSI stripped', async () => {
  boot.length = 0;
  manageReport = { hasErrors: false, results: {}, brand: {} };
  const root = stageBrand();

  // The tee declines under a runner by design; this asserts what it does when
  // it does not decline, so the signal is lifted for the duration.
  const priorCi = { CI: process.env.CI, GITHUB_ACTIONS: process.env.GITHUB_ACTIONS };
  delete process.env.CI;
  delete process.env.GITHUB_ACTIONS;

  try {
    await bootDev(root, { only: 'web' });
  } finally {
    // dev() never returns, so nothing else would restore the writers.
    require('@omega.js/devkit/attach-log-file').detach();
    for (const [key, value] of Object.entries(priorCi)) {
      if (value === undefined) { delete process.env[key]; } else { process.env[key] = value; }
    }
  }

  const contents = fs.readFileSync(path.join(root, 'logs', 'manage.log'), 'utf8');
  assert.match(contents, /omega dev — booting web/, "the boot banner is in the brand's log");
  assert.ok(!contents.includes('\x1B['), 'the file is ANSI-free');
});
