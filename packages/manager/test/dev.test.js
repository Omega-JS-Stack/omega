// `omega dev` (brand root) — target-selection rules plus the boot SEQUENCE
// (freshness sweep, manage cycle, then the target legs). The spawn plumbing is composition of
// tested pieces (discoverTargets, resolveTargetNode, watch-all's forwarding
// pattern); the SELECTION is the behavior with rules worth pinning: default
// set, --only/--except/--all, unknowns, missing targets, backend-first ordering.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const childProcess = require('node:child_process');

// ─── Boot-sequence instrumentation ───────────────────────────────────────────
// Every boundary dev.js binds at load time (child_process.spawn, manage's
// runManage, devkit's freshnessSweep) is replaced BEFORE it is required, so
// their order is observable in-process without booting anything real.

const boot = [];
let manageReport = { hasErrors: false, results: {}, brand: {} };

// What OMEGA_NON_INTERACTIVE reads as at each boundary (#228): '1' during the
// boot manage cycle, back to its prior value by the time a leg spawns.
const nonInteractiveAt = { manage: [], spawn: [], spawnEnv: [] };

// What FORCE_COLOR each leg is spawned with (#395) — the legs pipe, so chalk
// downstream reads this switch instead of a TTY.
const forceColorAt = [];

// Whether each leg was spawned into its OWN process group (#690) — shutdown
// signals the group, so a same-group leg would leak its grandchild.
const spawnDetached = [];

// What each boot cycle asks runManage for — the lane lives here (#228)
const manageOptions = [];

// Every child the boot spawned, so a leg's output can be driven by hand (#230)
const spawned = [];

childProcess.spawn = (command, args, options) => {
  boot.push(`spawn:${path.basename(options.cwd)}`);
  // A LEG is spawned with an explicit env; the watch child (#587) inherits
  // this process' own, so record only what a leg carried.
  if (options.env) {
    nonInteractiveAt.spawn.push(process.env.OMEGA_NON_INTERACTIVE);
    nonInteractiveAt.spawnEnv.push(options.env.OMEGA_NON_INTERACTIVE);
    forceColorAt.push(options.env.FORCE_COLOR);
    spawnDetached.push(options.detached);
  }
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  // devkit's watch forwarder sets an encoding before reading; the legs do not.
  child.stdout.setEncoding = () => {};
  child.stderr.setEncoding = () => {};
  child.pid = 4242;
  child.kill = (signal) => { child.killedWith = signal; };
  spawned.push(child);
  return child;
};

// The hoisted freshness sweep (#340): stubbed at its module boundary so its
// ORDER in the boot and the lane hosts it is handed are observable without a
// real linked dist on disk.
let sweepResult = { checked: [], healed: [], staleLinked: [], healFailed: [], failed: [] };
const sweepHosts = [];

// The monorepo the staged brand's @omega.js deps resolve into (#587). Only the
// RESOLUTION is stubbed — the watch start below is devkit's real lock-aware
// function, spawning through the fake above, so the lock behavior is the real
// one and no watch ever runs.
let linkedMonorepo = null;
const realLocal = require('@omega.js/devkit/local');
const localPath = require.resolve('@omega.js/devkit/local');
require.cache[localPath] = {
  id: localPath,
  filename: localPath,
  path: path.dirname(localPath),
  loaded: true,
  exports: {
    ...realLocal,
    freshnessSweep: ({ hosts }) => {
      boot.push(`sweep:${hosts.map((host) => host.packageName).join(',') || 'none'}`);
      sweepHosts.push(hosts);
      return sweepResult;
    },
    resolveLinkedMonorepo: () => linkedMonorepo,
  },
};

const managePath = require.resolve('../src/manage.js');
require.cache[managePath] = {
  id: managePath,
  filename: managePath,
  path: path.dirname(managePath),
  loaded: true,
  exports: {
    runManage: async (startDir, options) => {
      boot.push(`manage:${startDir}`);
      nonInteractiveAt.manage.push(process.env.OMEGA_NON_INTERACTIVE);
      manageOptions.push(options);
      return manageReport;
    },
  },
};

const devCommand = require('../src/commands/dev.js');
const { selectDevTargets, DEFAULT_TARGETS, createLineDeduper } = devCommand;

const ALL_TARGETS = ['web', 'backend', 'desktop', 'extension'];

/** Stage a brand monorepo with a single website target. */
function stageBrand() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-manager-dev-')));

  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.writeFileSync(path.join(root, 'config', 'omega.json5'), `{
  brand: { id: 'fixture-brand', name: 'Fixture Brand', url: 'https://fixture-brand.test' },
  targets: { web: {} },
}
`);

  const website = path.join(root, 'targets', 'website');
  fs.mkdirSync(website, { recursive: true });
  fs.writeFileSync(path.join(website, 'package.json'), JSON.stringify({
    name: 'fixture-website',
    private: true,
    dependencies: { '@omega.js/web': '*' }, // the target declares its framework, as every real one does
  }));

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
  const { selected, unknown, missing } = selectDevTargets({ available: ALL_TARGETS });

  assert.deepStrictEqual(selected, ['backend', 'web'], 'backend boots first (publishes the port map)');
  assert.deepStrictEqual(DEFAULT_TARGETS, ['web', 'backend']);
  assert.deepStrictEqual(unknown, []);
  assert.deepStrictEqual(missing, []);
});

test('--only is the exact set; --except subtracts; --all boots every leg', () => {
  assert.deepStrictEqual(
    selectDevTargets({ available: ALL_TARGETS, only: 'web' }).selected,
    ['web'],
  );
  assert.deepStrictEqual(
    selectDevTargets({ available: ALL_TARGETS, only: 'desktop,web' }).selected,
    ['desktop', 'web'],
    '--only can opt GUI targets in',
  );
  assert.deepStrictEqual(
    selectDevTargets({ available: ALL_TARGETS, except: 'backend' }).selected,
    ['web'],
  );
  assert.deepStrictEqual(
    selectDevTargets({ available: ALL_TARGETS, all: true }).selected,
    ['backend', 'web', 'desktop', 'extension'],
    'backend still first under --all',
  );
});

test('unknown targets are reported, not booted; targets without dirs go to missing', () => {
  const result = selectDevTargets({ available: ['web'], only: 'web,backend,mobile' });

  assert.deepStrictEqual(result.selected, ['web']);
  assert.deepStrictEqual(result.unknown, ['mobile'], 'no mobile dev leg exists (MAM parked)');
  assert.deepStrictEqual(result.missing, ['backend'], 'requested but no dir in this brand');
});

test('a web-only brand defaults to just web — no phantom backend leg', () => {
  const { selected, missing } = selectDevTargets({ available: ['web'] });

  assert.deepStrictEqual(selected, ['web']);
  assert.deepStrictEqual(missing, [], 'the default set adapts to the brand instead of warning');
});

// ─── Boot sequence ───────────────────────────────────────────────────────────

test('boot opens with the manage cycle, THEN spawns the target legs — brand asset edits land on restart', async () => {
  boot.length = 0;
  manageReport = { hasErrors: false, results: {}, brand: {} };
  const root = stageBrand();

  const outcome = await bootDev(root, { only: 'web' });

  assert.strictEqual(outcome, 'running', 'the orchestrator stays alive after booting');
  assert.deepStrictEqual(boot, ['sweep:@omega.js/web', `manage:${root}`, 'spawn:website'],
    'the full service walk runs against the brand root before any target leg starts');
});

test('a manage cycle with errors stops dev boot loudly — no target leg spawns', async () => {
  boot.length = 0;
  manageReport = { hasErrors: true, results: {}, brand: {} };
  const root = stageBrand();

  await assert.rejects(() => bootDev(root, { only: 'web' }), /manage/i);
  assert.deepStrictEqual(boot, ['sweep:@omega.js/web', `manage:${root}`], 'nothing booted on top of a broken brand');
});

// ─── Quiet boot (#228) ───────────────────────────────────────────────────────

/** Clear the boot recorder and the env/options observations before a boot. */
function resetRecorders() {
  boot.length = 0;
  manageOptions.length = 0;
  forceColorAt.length = 0;
  Object.values(nonInteractiveAt).forEach((seen) => { seen.length = 0; });
}

/** Run fn with console.log captured; returns the joined lines. */
async function captureLogAsync(fn) {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return lines.join('\n');
}

test('the boot manage cycle runs non-interactive — human gates skip instead of blocking the boot', async () => {
  resetRecorders();
  manageReport = { hasErrors: false, results: {}, brand: {} };
  const root = stageBrand();

  await bootDev(root, { only: 'web' });

  assert.deepStrictEqual(nonInteractiveAt.manage, ['1'],
    'the boot walk runs under OMEGA_NON_INTERACTIVE — no console confirm, consent flow, or secret paste can stall it');
});

test('the non-interactive switch is restored before any leg spawns — the dev servers stay interactive', async () => {
  resetRecorders();
  manageReport = { hasErrors: false, results: {}, brand: {} };
  const root = stageBrand();

  await bootDev(root, { only: 'web' });

  assert.deepStrictEqual(boot, ['sweep:@omega.js/web', `manage:${root}`, 'spawn:website'], 'the boot still runs manage, then the leg');
  assert.deepStrictEqual(nonInteractiveAt.spawn, [undefined], 'the switch is off the process env again by spawn time');
  assert.deepStrictEqual(nonInteractiveAt.spawnEnv, [undefined], "the leg's inherited env carries no switch");
  assert.strictEqual(process.env.OMEGA_NON_INTERACTIVE, undefined, 'and nothing leaks past the boot');
});

test('a clean report with pending human gates still boots the legs — pending is not an error', async () => {
  resetRecorders();
  manageReport = {
    hasErrors: false,
    brand: {},
    results: {
      cloud: {
        status: 'warned',
        output: { billing: { needsInteractive: 'pick a billing account' } },
      },
    },
  };
  const root = stageBrand();

  const outcome = await bootDev(root, { only: 'web' });

  assert.strictEqual(outcome, 'running');
  assert.deepStrictEqual(boot, ['sweep:@omega.js/web', `manage:${root}`, 'spawn:website'],
    "the summary's ⚑ pending list is the report — the stack boots regardless");
});

test('a pre-existing OMEGA_NON_INTERACTIVE survives the boot — the restore is not a blind delete', async () => {
  resetRecorders();
  manageReport = { hasErrors: false, results: {}, brand: {} };
  const root = stageBrand();
  process.env.OMEGA_NON_INTERACTIVE = '1';

  try {
    await bootDev(root, { only: 'web' });

    assert.deepStrictEqual(nonInteractiveAt.manage, ['1']);
    assert.strictEqual(process.env.OMEGA_NON_INTERACTIVE, '1', "the caller's own switch is put back, not dropped");
    assert.deepStrictEqual(nonInteractiveAt.spawnEnv, ['1'], 'so the legs inherit what the caller asked for');
  } finally {
    delete process.env.OMEGA_NON_INTERACTIVE;
  }
});

// ─── Boot lane (#228) ────────────────────────────────────────────────────────

test('the boot walks the LOCAL lane only, and says where the full setup lives', async () => {
  resetRecorders();
  manageReport = { hasErrors: false, results: {}, brand: {} };
  const root = stageBrand();

  const log = await captureLogAsync(() => bootDev(root, { only: 'web' }));

  assert.deepStrictEqual(manageOptions, [{ lane: 'boot' }],
    'the dev legs consume the local slice — the slow services must not hold the boot');
  assert.match(log, /npm run manage/, 'and the boot names the one command that runs the rest');
  assert.deepStrictEqual(boot, ['sweep:@omega.js/web', `manage:${root}`, 'spawn:website'], 'still manage, then the legs');
});

test('omega dev --full boots on the whole manage walk instead of the lane', async () => {
  resetRecorders();
  manageReport = { hasErrors: false, results: {}, brand: {} };
  const root = stageBrand();

  const log = await captureLogAsync(() => bootDev(root, { only: 'web', full: true }));

  assert.deepStrictEqual(manageOptions, [{}], 'no lane — the full walk');
  assert.deepStrictEqual(nonInteractiveAt.manage, ['1'], 'and it is still quiet');
  assert.ok(!/local lane/.test(log), 'nothing to point at — this run WAS the full setup');
});

test('omega dev --full is declared boolean (yargs would otherwise eat the next positional)', () => {
  const { BOOLEAN_FLAGS } = require('../src/cli-run.js');
  assert.ok(BOOLEAN_FLAGS.includes('full'), '--full takes no value — it must be declared boolean');
});

test('omega manage --execute is declared boolean (yargs would otherwise eat the next positional)', () => {
  const { BOOLEAN_FLAGS } = require('../src/cli-run.js');
  assert.ok(BOOLEAN_FLAGS.includes('execute'), '--execute takes no value — it must be declared boolean');
});

// ─── Hoisted freshness sweep (#340) ──────────────────────────────────────────

/** Stage a brand with a website AND a backend target, each declaring its framework. */
function stageFanOutBrand() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-manager-dev-')));

  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.writeFileSync(path.join(root, 'config', 'omega.json5'), `{
  brand: { id: 'fixture-brand', name: 'Fixture Brand', url: 'https://fixture-brand.test' },
  targets: { web: {}, backend: {} },
}
`);

  for (const [dir, framework] of [['website', '@omega.js/web'], ['backend', '@omega.js/backend']]) {
    const targetPath = path.join(root, 'targets', dir);
    fs.mkdirSync(targetPath, { recursive: true });
    fs.writeFileSync(path.join(targetPath, 'package.json'), JSON.stringify({
      name: `fixture-${dir}`,
      private: true,
      dependencies: { [framework]: '*' },
    }));
  }

  return root;
}

/** Clear the sweep recorders and put the result back to an all-fresh brand. */
function resetSweep() {
  sweepHosts.length = 0;
  sweepResult = { checked: [], healed: [], staleLinked: [], healFailed: [], failed: [] };
}

test('the freshness sweep runs ONCE, before the manage cycle and before any leg spawns (#340)', async () => {
  resetRecorders();
  resetSweep();
  manageReport = { hasErrors: false, results: {}, brand: {} };
  const root = stageFanOutBrand();

  await bootDev(root);

  assert.deepStrictEqual(boot, [
    'sweep:@omega.js/backend,@omega.js/web',
    `manage:${root}`,
    'spawn:backend',
    'spawn:website',
  ], 'one check pass covers every lane — a lane that rebuilds after the fan-out purges a sibling\'s dispatcher');
  assert.strictEqual(sweepHosts.length, 1, 'ONE sweep, not one per lane');
});

test('the sweep is handed each selected lane\'s framework host, resolved from its target (#340)', async () => {
  resetRecorders();
  resetSweep();
  manageReport = { hasErrors: false, results: {}, brand: {} };
  const root = stageFanOutBrand();

  await bootDev(root);

  assert.deepStrictEqual(sweepHosts[0], [
    { packageName: '@omega.js/backend', fromDir: path.join(root, 'targets', 'backend') },
    { packageName: '@omega.js/web', fromDir: path.join(root, 'targets', 'website') },
  ], 'each host resolves from the target that declares it — the same chain the lane itself would walk');
});

test('a lane whose framework is unfiltered out is not swept — --only narrows the pass too (#340)', async () => {
  resetRecorders();
  resetSweep();
  manageReport = { hasErrors: false, results: {}, brand: {} };
  const root = stageFanOutBrand();

  await bootDev(root, { only: 'web' });

  assert.deepStrictEqual(sweepHosts[0].map((host) => host.packageName), ['@omega.js/web']);
});

test('a stale monorepo-linked dist stops the boot before the manage cycle — nothing spawns (#340)', async () => {
  resetRecorders();
  resetSweep();
  manageReport = { hasErrors: false, results: {}, brand: {} };
  sweepResult = {
    checked: [],
    healed: [],
    staleLinked: [{ packageName: '@omega.js/web', reason: 'dist/ is missing' }],
    healFailed: [],
    failed: [],
  };
  const root = stageFanOutBrand();

  await assert.rejects(() => bootDev(root, { only: 'web' }), /@omega\.js\/web/);
  assert.deepStrictEqual(boot, ['sweep:@omega.js/web'],
    'the watch owns that dist — half-booting the stack on it is what the loud stop prevents');
});

test('a monorepo-linked dist whose sweep heal FAILED stops the boot too (#398)', async () => {
  resetRecorders();
  resetSweep();
  manageReport = { hasErrors: false, results: {}, brand: {} };
  sweepResult = {
    checked: [],
    healed: [],
    staleLinked: [],
    healFailed: [{ packageName: '@omega.js/web', reason: 'dist/ is missing' }],
    failed: [],
  };
  const root = stageFanOutBrand();

  await assert.rejects(() => bootDev(root, { only: 'web' }), /@omega\.js\/web/);
  assert.deepStrictEqual(boot, ['sweep:@omega.js/web'],
    'with the watch down and the rebuild broken, no leg boots on that dist');
});

test('a heal before the fan-out is announced, so the boot pause has a reason (#340)', async () => {
  resetRecorders();
  resetSweep();
  manageReport = { hasErrors: false, results: {}, brand: {} };
  sweepResult = { checked: [], healed: ['@omega.js/web'], staleLinked: [], healFailed: [], failed: [] };
  const root = stageFanOutBrand();

  const log = await captureLogAsync(() => bootDev(root, { only: 'web' }));

  assert.match(log, /@omega\.js\/web/);
});

// ─── The monorepo watch as a session child (#587) ────────────────────────────

/** A monorepo-root-shaped temp dir the watch lock can live in. */
function stageMonorepo() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-monorepo-')));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'omega', private: true }));
  return root;
}

/** Poll until spawned holds count children (the boot spawns them across ticks). */
async function waitForSpawn(count) {
  const deadline = Date.now() + 2000;
  while (spawned.length < count) {
    if (Date.now() > deadline) {
      throw new Error(`only ${spawned.length} of ${count} children spawned`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return spawned[count - 1];
}

/**
 * Say what a real watch says once its initial prepare has landed (#670): the
 * roster line the count comes from, then every package's ready line.
 */
function reportWatchReady(child, packages) {
  child.stdout.emit('data', `Watching ${packages.length} packages (src→dist): ${packages.join(', ')}\n`);
  packages.forEach((name) => child.stdout.emit('data', `[${name}] [17:47:26] 'prepare-package': Ready for changes!\n`));
}

/** Exit hooks registered during fn, removed again; returns them. */
async function exitHooksAddedBy(fn) {
  const before = process.listeners('exit');
  await fn();
  const added = process.listeners('exit').filter((hook) => !before.includes(hook));
  added.forEach((hook) => process.removeListener('exit', hook));
  return added;
}

test('#587: a locally-linked brand boots the monorepo watch — after the manage cycle, before the legs', async () => {
  resetRecorders();
  resetSweep();
  spawned.length = 0;
  manageReport = { hasErrors: false, results: {}, brand: {} };
  const root = stageFanOutBrand();
  const monorepo = stageMonorepo();
  linkedMonorepo = monorepo;

  try {
    const booting = bootDev(root);
    const watchChild = await waitForSpawn(1);

    // #670: a fresh watch rewrites every dist in its initial prepare pass, so
    // the legs stay down until it reports ready — a leg booting into that
    // rewrite loads a half-written CLI.
    assert.deepStrictEqual(boot, [
      'sweep:@omega.js/backend,@omega.js/web',
      `manage:${root}`,
      `spawn:${path.basename(monorepo)}`,
    ], 'no leg boots while the watch is still preparing');

    reportWatchReady(watchChild, ['backend', 'web']);
    await booting;

    assert.deepStrictEqual(boot, [
      'sweep:@omega.js/backend,@omega.js/web',
      `manage:${root}`,
      `spawn:${path.basename(monorepo)}`,
      'spawn:backend',
      'spawn:website',
    ], 'the watch starts after the sweep has settled every dist, and before any leg reads one');
    assert.strictEqual(spawned.length, 3, 'ONE watch child, plus the two legs');
  } finally {
    linkedMonorepo = null;
    fs.rmSync(monorepo, { recursive: true, force: true });
  }
});

test('#587: the watch dies with the session — one exit hook, and it kills the child', async () => {
  resetRecorders();
  resetSweep();
  spawned.length = 0;
  manageReport = { hasErrors: false, results: {}, brand: {} };
  const root = stageFanOutBrand();
  const monorepo = stageMonorepo();
  linkedMonorepo = monorepo;

  try {
    const hooks = await exitHooksAddedBy(() => bootDev(root));
    const watch = spawned[0];

    assert.strictEqual(watch.killedWith, undefined, 'nothing killed while the session runs');

    // The boot registers other exit hooks too (the log-file tee closes its fd),
    // so the watch's own is identified by what it DOES.
    const killers = hooks.filter((hook) => {
      watch.killedWith = undefined;
      hook();
      return watch.killedWith === 'SIGTERM';
    });

    assert.strictEqual(killers.length, 1, 'the session ending takes the watch with it, once — no orphan, no pile-up');
  } finally {
    linkedMonorepo = null;
    fs.rmSync(monorepo, { recursive: true, force: true });
  }
});

test('#587: a watch already running is reused, never doubled', async () => {
  resetRecorders();
  resetSweep();
  manageReport = { hasErrors: false, results: {}, brand: {} };
  const root = stageFanOutBrand();
  const monorepo = stageMonorepo();
  linkedMonorepo = monorepo;
  realLocal.acquireWatchLock(monorepo); // held by a live process — this one

  try {
    await bootDev(root);

    assert.deepStrictEqual(boot, [
      'sweep:@omega.js/backend,@omega.js/web',
      `manage:${root}`,
      'spawn:backend',
      'spawn:website',
    ], 'the lock says a watch is already on the job — the legs boot, nothing else spawns');
  } finally {
    realLocal.releaseWatchLock(monorepo);
    linkedMonorepo = null;
    fs.rmSync(monorepo, { recursive: true, force: true });
  }
});

test('#587: a registry-installed brand spawns no watch, and says so once', async () => {
  resetRecorders();
  resetSweep();
  manageReport = { hasErrors: false, results: {}, brand: {} };
  const root = stageFanOutBrand();

  const log = await captureLogAsync(() => bootDev(root));

  assert.deepStrictEqual(boot, [
    'sweep:@omega.js/backend,@omega.js/web',
    `manage:${root}`,
    'spawn:backend',
    'spawn:website',
  ], 'nothing to watch — the frameworks came from the registry');
  assert.match(log, /registry/, 'the skip is stated, not silent');
  assert.strictEqual(log.match(/registry/g).length, 1, 'one line, not one per target');
});

// ─── Leg output dedup (#230) ─────────────────────────────────────────────────

/** Feed a whole stream through one deduper, flush included; lines in → out. */
function dedupe(lines) {
  const deduper = createLineDeduper();
  return lines.flatMap((line) => deduper.push(line)).concat(deduper.flush());
}

const LOADED = 'i  functions: Loaded environment variables from .env.';

test('consecutive duplicates collapse to the first line plus one count note', () => {
  assert.deepStrictEqual(
    dedupe([LOADED, LOADED, LOADED, LOADED, '✔  functions: emulator started']),
    [LOADED, '  (repeated 3×)', '✔  functions: emulator started'],
    'the emulator re-prints its infra lines once per function instance — a human reads them once',
  );
});

test('the rule is consecutive duplicates, not a list of known noisy lines', () => {
  assert.deepStrictEqual(
    dedupe(['[watch] rebuilding…', '[watch] rebuilding…', 'done']),
    ['[watch] rebuilding…', '  (repeated 1×)', 'done'],
  );
});

test('a line that comes back later is not a duplicate — only runs collapse', () => {
  assert.deepStrictEqual(dedupe(['A', 'B', 'A']), ['A', 'B', 'A']);
});

test('the pending count surfaces at end of stream — a leg that goes quiet never eats it', () => {
  assert.deepStrictEqual(dedupe(['A', 'A', 'A']), ['A', '  (repeated 2×)']);
});

test('blank lines pass through — a note in place of them reads louder than they do', () => {
  assert.deepStrictEqual(dedupe(['', '', 'A']), ['', '', 'A']);
});

test('each stream carries its own run — legs never dedup against each other', () => {
  const backend = createLineDeduper();
  const web = createLineDeduper();

  assert.deepStrictEqual(backend.push(LOADED), [LOADED]);
  assert.deepStrictEqual(web.push(LOADED), [LOADED], "the sibling leg still prints its own first line");
});

test('the booted leg prints the collapsed stream — the chatter lands once, then the count', async () => {
  resetRecorders();
  spawned.length = 0;
  manageReport = { hasErrors: false, results: {}, brand: {} };
  const root = stageBrand();

  const log = await captureLogAsync(async () => {
    await bootDev(root, { only: 'web' });
    spawned[0].stdout.emit('data', Buffer.from(`${LOADED}\n${LOADED}\n${LOADED}\n✔  ready\n`));
  });

  assert.strictEqual((log.match(/Loaded environment variables/g) || []).length, 1,
    'the repeated infra line reaches the terminal exactly once');
  assert.match(log, /\(repeated 2×\)/, 'and the repeats are counted, not silently dropped');
  assert.match(log, /\[web\] ✔  ready/, 'the leg prefix still rides every line');
});

// ─── Leg color passthrough (#395) ────────────────────────────────────────────

/** Boot one leg with the parent's TTY state (and inherited switch) staged; reports what the leg got. */
async function forceColorForLeg({ isTTY, inherited }) {
  resetRecorders();
  manageReport = { hasErrors: false, results: {}, brand: {} };
  const root = stageBrand();

  const priorTTY = process.stdout.isTTY;
  const priorForceColor = process.env.FORCE_COLOR;
  process.stdout.isTTY = isTTY;
  if (inherited === undefined) { delete process.env.FORCE_COLOR; } else { process.env.FORCE_COLOR = inherited; }

  try {
    await bootDev(root, { only: 'web' });
  } finally {
    process.stdout.isTTY = priorTTY;
    if (priorForceColor === undefined) { delete process.env.FORCE_COLOR; } else { process.env.FORCE_COLOR = priorForceColor; }
  }

  return forceColorAt;
}

test('a leg booted from a terminal carries FORCE_COLOR — piped stdio would strip chalk at the source (#395)', async () => {
  assert.deepStrictEqual(await forceColorForLeg({ isTTY: true }), ['1'],
    'the leg pipes to the orchestrator, so chalk downstream reads the switch instead of a TTY it will never see');
});

test('no terminal, no forced color — and a caller that asked for it still wins (#395)', async () => {
  assert.deepStrictEqual(await forceColorForLeg({ isTTY: false }), ['0'], 'nothing is painting for — a runner\'s capture stays plain');
  assert.deepStrictEqual(await forceColorForLeg({ isTTY: false, inherited: '1' }), ['1'], "the caller's own switch passes straight through");
});

// ─── Verb log (#197, #231) ───────────────────────────────────────────────────

test('boot tees the brand-level fan-out to <brandRoot>/logs/dev.log, ANSI stripped', async () => {
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

  const contents = fs.readFileSync(path.join(root, 'logs', 'dev.log'), 'utf8');
  assert.match(contents, /omega dev — booting web/, "the boot banner is in the brand's dev log");
  assert.ok(!contents.includes('\x1B['), 'the file is ANSI-free');
  assert.ok(!fs.existsSync(path.join(root, 'logs', 'manage.log')),
    'manage.log stays the service walk\'s record — a boot never truncates it (#231)');
});

// ─── Shutdown signals the whole chain (#690) ─────────────────────────────────

test('legs spawn detached — each leg owns its process group, so shutdown can reach the grandchild (#690)', async () => {
  boot.length = 0;
  spawnDetached.length = 0;
  manageReport = { hasErrors: false, results: {}, brand: {} };
  const root = stageBrand();

  await bootDev(root, { only: 'web' });

  assert.deepStrictEqual(spawnDetached, [true],
    'a leg is a chain (npm → the real server); a same-group leg leaks the grandchild on a programmatic stop');
});

test('stopChild signals the process GROUP, and falls back to the direct child when the group is gone (#690)', () => {
  const calls = [];
  const child = { pid: 4242, kill: (signal) => calls.push(`direct:${signal}`) };

  devCommand.stopChild(child, (pid, signal) => calls.push(`group:${pid}:${signal}`));
  assert.deepStrictEqual(calls, ['group:-4242:SIGTERM'], 'the group signal reaches npm AND the emulator behind it');

  calls.length = 0;
  devCommand.stopChild(child, () => { throw new Error('ESRCH'); });
  assert.deepStrictEqual(calls, ['direct:SIGTERM'], 'a dead group still gets the direct kill');
});
