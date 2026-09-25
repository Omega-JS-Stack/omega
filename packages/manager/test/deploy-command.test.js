/**
 * Brand-root `omega deploy` fan-out (D13 brand layer) — real execution over a
 * staged fixture brand: fake framework packages whose `omega` bins record
 * every invocation (cwd + argv) to a log, so ordering (backend FIRST), flag
 * forwarding, filtering, and the stop-on-failure bail are asserted from what
 * actually got spawned.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// ─── The delivery lane's boundary (#678) ─────────────────────────────────────
// The lane deploy runs before it fans out is manage's own runner, stubbed HERE
// (dev.test.js's pattern) so the ORDER — lane first, then the targets — is
// observable in the same call log the fake framework bins write to, and no
// service walk ever touches a fixture brand.
const managePath = require.resolve('../src/manage.js');
const manageCalls = [];
let manageReport = { hasErrors: false, results: {}, brand: {} };

require.cache[managePath] = {
  id: managePath,
  filename: managePath,
  path: path.dirname(managePath),
  loaded: true,
  exports: {
    runManage: async (startDir, options) => {
      manageCalls.push({ startDir, options });
      fs.appendFileSync(path.join(startDir, 'calls.log'), `${JSON.stringify({ name: 'delivery-lane', cwd: startDir, argv: [] })}\n`);
      return manageReport;
    },
  },
};

// ─── The root's ONE delivery (#901, #915) ────────────────────────────────────
// The lane and its delivery are devkit's, patched HERE the way runManage is
// above, and only where this run needs them: the LANE is the one every brand
// takes, and the DELIVERY is devkit's real `deliverLane` driven through its own
// `steps` seam, so the fixture records what the root was asked to check, to
// compose and to push instead of reaching GitHub. Everything else in that
// module stays the real thing (the dispatch repo is derived from the fixture's
// own config).
const devkitDeployPath = require.resolve('@omega.js/devkit/deploy');
const realDevkitDeploy = require(devkitDeployPath);

const pushes = [];
const refWaits = [];
const composes = [];

// Every brand takes the ONE lane now (#915), so every case here runs a delivery
// and the delivery resolves a token: the fixture's, never the machine's `gh`
// session.
process.env.GH_TOKEN = 'fixture-token';

// Recorded in the call log too, so WHEN a delivery happened is asserted in the
// same sequence the spawns are: every target's scaffold composes its workflow
// into the brand root, and the push is what carries those files to the runner
// (#901).
function recordStep(name, brandRoot) {
  fs.appendFileSync(path.join(brandRoot, 'calls.log'), `${JSON.stringify({ name, cwd: brandRoot, argv: [] })}\n`);
}

const laneSteps = {
  // The registry lane's lockfile gate (#938) runs first in the ONE delivery;
  // devkit's own tests hold its verdicts, so here it only says WHEN it ran.
  lockfile: (options) => recordStep('lockfile-gate', options.root),
  defaultBranch: async () => 'main',
  behind: (options) => recordStep('behind-check', options.cwd),
  // The ONE write a deploy makes to the default branch (#915): the composed
  // workflows, and only when they differ.
  workflows: async (options) => {
    composes.push(options);
    recordStep('compose-workflows', options.brandRoot);
    return { pushed: [], sha: null };
  },
  stage: async () => ({ staged: [], restore: async () => {} }),
  push: (options) => {
    pushes.push(options);
    recordStep('snapshot-push', options.brandRoot);
    return 'sha1234567890abcdef';
  },
  // The ref the whole run dispatches against has to RESOLVE to that push before
  // a single target is spawned (#902). The step knows the repo, not the folder,
  // so the push it follows is what says where this fixture's log lives.
  waitRef: async (options) => {
    refWaits.push(options);
    recordStep('snapshot-wait-ref', pushes[pushes.length - 1].brandRoot);
  },
};

function patchModule(filename, exports) {
  require.cache[filename] = {
    id: filename,
    filename,
    path: path.dirname(filename),
    loaded: true,
    exports,
  };
}

patchModule(devkitDeployPath, {
  ...realDevkitDeploy,
  resolveDeployLane: ({ dir }) => ({
    mode: 'snapshot',
    ref: 'omega-deploy',
    // The fixture brand is its OWN repo's toplevel, which is the brand shape
    // the behind check applies to (#915).
    nested: false,
    linked: false,
    repo: true,
    // A target dir is <brand>/targets/<name>
    brandRoot: path.resolve(dir, '..', '..'),
  }),
  deliverLane: (options) => realDevkitDeploy.deliverLane({ ...options, steps: laneSteps }),
});

// The machine registry is per-machine state: this file's fixtures write into a
// temp home, never the developer's ~/.omega (#677).
require('./lib/temp-home.js');

const deployCommand = require('../src/commands/deploy.js');
const { selectTargets, buildForwardedFlags } = deployCommand;
const { BOOT_SERVICES } = require('../src/config.js');

// ─── Fixture staging (test-command.test.js pattern) ──────────────────────────

/**
 * Fake framework bin: appends { name, phase, cwd, argv } to <brand>/calls.log
 * on the way in and on the way out, holds the process between the two, and
 * exits 1 when this run's sentinel exists (`FAIL-<name>`). The two phases are
 * what makes concurrency observable (#901): three targets that ran together
 * all START before the first of them ENDS.
 *
 * `SKIP-<name>` is the other sentinel: the verb prints ONE line and exits 0,
 * which is what a framework verb does when it steps aside on purpose (the
 * backend's `cloud.shared` skip, #882).
 */
function fakeBinSource(name) {
  return `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const brandRoot = path.resolve(__dirname, '..', '..', '..');
const record = (phase) => fs.appendFileSync(path.join(brandRoot, 'calls.log'), JSON.stringify({
  name: ${JSON.stringify(name)},
  phase: phase,
  cwd: process.cwd(),
  argv: process.argv.slice(2),
}) + '\\n');
record('start');
// Long enough that a SEQUENTIAL fan-out could not interleave these.
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 120);
record('end');
if (fs.existsSync(path.join(brandRoot, 'SKIP-' + ${JSON.stringify(name)}))) {
  console.log('  Skipping the ' + ${JSON.stringify(name)} + ' deploy: cloud.shared is true');
  process.exit(0);
}
if (fs.existsSync(path.join(brandRoot, 'FAIL-' + ${JSON.stringify(name)}))) process.exit(1);
`;
}

/**
 * Fake framework scaffold: the `ensureTarget` the fan-out calls IN-PROCESS
 * through `@omega.js/<framework>/ensure-target` (#901). It records the same
 * `{ name, phase, cwd, argv }` row the bins write, so the ordering assertions
 * read a scaffold exactly as they always did, and throws when this run's
 * `FAIL-scaffold-<name>` sentinel exists, so a case can break a target's
 * scaffold without breaking its deploy.
 */
function fakeEnsureTargetSource(name) {
  return `const fs = require('fs');
const path = require('path');
const brandRoot = path.resolve(__dirname, '..', '..', '..');

exports.ensureTarget = async ({ projectDir }) => {
  fs.appendFileSync(path.join(brandRoot, 'calls.log'), JSON.stringify({
    name: ${JSON.stringify(name)},
    phase: 'scaffold',
    cwd: projectDir,
    argv: ['scaffold'],
  }) + '\\n');

  if (fs.existsSync(path.join(brandRoot, 'FAIL-scaffold-' + ${JSON.stringify(name)}))) {
    throw new Error('scaffold refused');
  }

  return { written: [], merged: [], changed: [] };
};
`;
}

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

/**
 * Stage a brand monorepo with a web target and a backend target (LISTED so the
 * web dir sorts before backend, proving the order comes from
 * DEPLOY_ORDER, not the directory listing), plus fake framework packages. The
 * config names a repo org, because a snapshot-lane run derives its push
 * address from it (#901).
 *
 * @param {string[]} [extra] - Further target types to stage ('desktop', …), the
 *   surfaces that deploy TOGETHER after the backend.
 * @returns {{ scratch: string, brand: string }} the staged tree
 */
function stageBrand(extra = []) {
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mgr-deploy-cmd-')));
  const brand = path.join(scratch, 'brand');
  const types = ['web', 'backend', ...extra];

  write(path.join(brand, 'package.json'), JSON.stringify({
    name: 'fixture-brand', private: true, workspaces: ['targets/*'],
  }));
  write(path.join(brand, 'config', 'omega.json5'), `{
  brand: { id: 'fixture-brand', name: 'Fixture Brand', url: 'https://fixture-brand.test' },
  repo: { provider: 'github', org: 'Fixture-Org' },
  targets: { ${types.map((type) => `${type}: { type: '${type}' }`).join(', ')} },
}
`);

  for (const type of types) {
    write(path.join(brand, 'targets', type, 'package.json'), JSON.stringify({
      name: type, private: true, dependencies: { [`@omega.js/${type}`]: '*' },
    }));

    const pkgDir = path.join(brand, 'node_modules', `@omega.js/${type}`);
    write(path.join(pkgDir, 'package.json'), JSON.stringify({
      name: `@omega.js/${type}`, bin: { omega: './bin.js' },
    }));
    write(path.join(pkgDir, 'bin.js'), fakeBinSource(type));
    write(path.join(pkgDir, 'ensure-target.js'), fakeEnsureTargetSource(type));
  }

  return { scratch, brand };
}

/**
 * The spawns of ONE verb from the brand's call log, in the order they STARTED
 * (`deploy` by default, which is what most cases are about). The root's own
 * steps record themselves there too: the delivery lane, which must run before
 * the first spawn (#678), and the snapshot push, which must run after every
 * scaffold (#901). `{ all: true }` is how the ordering assertions see the whole
 * run, and `{ phases: true }` keeps each bin's end marker for the concurrency
 * assertion (#901).
 */
function readCalls(brand, { all = false, phases = false, verb = 'deploy' } = {}) {
  const logPath = path.join(brand, 'calls.log');
  if (!fs.existsSync(logPath)) return [];
  const entries = fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const started = phases ? entries : entries.filter((entry) => entry.phase !== 'end');
  return all ? started : started.filter((entry) => entry.argv[0] === verb);
}

/** `<target>:<verb>` per row of the whole run, the root's own steps by name. */
function readSequence(brand) {
  return readCalls(brand, { all: true }).map((entry) => (entry.argv.length > 0 ? `${entry.name}:${entry.argv[0]}` : entry.name));
}

/** Run the command from `cwd` with parsed options, restoring cwd + exitCode. */
async function runDeployCommand(cwd, options = {}) {
  manageCalls.length = 0;
  pushes.length = 0;
  refWaits.length = 0;
  composes.length = 0;
  const cwd0 = process.cwd();
  process.chdir(cwd);
  try {
    await deployCommand({ _: ['deploy'], ...options });
    return process.exitCode;
  } finally {
    // The verb tees to <brandRoot>/logs/<verb>.log (#623) — release the writers
    // so the next case starts from an unpatched stdout.
    require('@omega.js/devkit/attach-log-file').detach();
    process.chdir(cwd0);
    process.exitCode = undefined;
  }
}

// ─── Execution over the staged brand ─────────────────────────────────────────

test('bare run fans out to every target, BACKEND FIRST, each spawned `deploy` in its own cwd', async () => {
  const { brand } = stageBrand();
  const code = await runDeployCommand(brand);

  const calls = readCalls(brand);
  assert.equal(calls.length, 2);
  // Order is DEPLOY_ORDER (backend → web), not the directory listing
  assert.deepEqual(calls.map((c) => c.name), ['backend', 'web']);
  for (const call of calls) {
    // The only flag a bare run carries is the root's own word about the
    // delivery it performed for the whole run (#901), never a user flag.
    assert.deepEqual(call.argv, ['deploy', '--snapshot=sha1234567890abcdef'], 'bare per-target: the deploy command and the root delivery hand-off');
  }
  assert.equal(calls[0].cwd, path.join(brand, 'targets', 'backend'));
  assert.equal(calls[1].cwd, path.join(brand, 'targets', 'web'));
  assert.equal(code, undefined, 'all targets green → no error exit code');
});

test('flags forward verbatim to every target; --target= is consumed here', async () => {
  const { brand } = stageBrand();
  // The parse shape: kebab original + camelCase twin (the twin must NOT forward twice)
  await runDeployCommand(brand, { 'dry-run': true, dryRun: true, direct: true });

  const calls = readCalls(brand);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.deepEqual(call.argv, ['deploy', '--dry-run', '--direct']);
  }
});

test('--target= picks by target NAME; nothing else runs', async () => {
  const { brand } = stageBrand();
  await runDeployCommand(brand, { target: 'web' });

  let calls = readCalls(brand);
  assert.deepEqual(calls.map((c) => c.name), ['web']);
  assert.deepEqual(calls[0].argv, ['deploy', '--snapshot=sha1234567890abcdef'], '--target= never forwards');

  fs.rmSync(path.join(brand, 'calls.log'));
  await runDeployCommand(brand, { target: 'backend,web' });
  calls = readCalls(brand);
  assert.deepEqual(calls.map((c) => c.name), ['backend', 'web'], 'order stays backend-first regardless of the flag order');
});

// The retired pickers (#780) — `--only` is firebase's own flag on the backend
// target, so accepting it at the brand root would mean two things at once
test('--only and --except are REFUSED, not ignored and not aliased — zero spawns', async () => {
  const { brand } = stageBrand();

  await assert.rejects(
    () => runDeployCommand(brand, { only: 'web' }),
    (error) => {
      assert.equal(error.refusal, true, 'a refusal prints its message alone (no stack)');
      assert.match(error.message, /--only is retired: pick targets with --target=/);
      assert.match(error.message, /firebase's own --only hosting runs from targets\/backend/, 'the sentence names where the firebase flag DOES belong');
      return true;
    },
  );
  await assert.rejects(() => runDeployCommand(brand, { except: 'backend' }), /--except is retired/);

  assert.deepEqual(readCalls(brand, { all: true }), [], 'not even the delivery lane ran');
});

test('a --target= token matching nothing STOPS the run — never a matched subset, never deploy-everything', async () => {
  const { brand } = stageBrand();

  await assert.rejects(
    () => runDeployCommand(brand, { target: 'hosting' }),
    (error) => {
      assert.equal(error.refusal, true);
      assert.match(error.message, /Unknown --target token "hosting"/);
      assert.match(error.message, /this brand's targets are backend, web/, 'the error names what the brand actually has');
      return true;
    },
  );

  // A typo BESIDE a real target must not quietly deploy the matched half
  await assert.rejects(() => runDeployCommand(brand, { target: 'web,hosting' }), /Unknown --target token "hosting"/);

  assert.deepEqual(readCalls(brand, { all: true }), [], 'not even the delivery lane ran');
});

test('a failing backend STOPS the run before web (later targets depend on it) — exit 1', async () => {
  const { brand } = stageBrand();
  fs.writeFileSync(path.join(brand, 'FAIL-backend'), '');
  const code = await runDeployCommand(brand);

  assert.deepEqual(readCalls(brand).map((c) => c.name), ['backend'], 'web never deployed after the backend failure');
  assert.equal(code, 1);
});

test('a backend that SKIPS (one line, exit 0) never stops the group, and reads green (#882)', async () => {
  const { brand } = stageBrand();
  // What the backend verb does on a shared cloud project: it prints its skip
  // line and exits 0. The gate ahead of the group stops the run on FAILURE
  // only, so the fan-out has nothing to add: the verb's own line rides through
  // its inherited stdout and the summary ticks the target.
  fs.writeFileSync(path.join(brand, 'SKIP-backend'), '');

  const lines = [];
  const originalLog = console.log;
  console.log = (...args) => lines.push(args.map(String).join(' '));

  let code;
  try {
    code = await runDeployCommand(brand);
  } finally {
    console.log = originalLog;
  }

  assert.deepEqual(readCalls(brand).map((c) => c.name), ['backend', 'web'], 'web still deploys after the skipped backend');
  assert.equal(code, undefined, 'a skip is not a failure: the run stays green');
  assert.ok(lines.join('\n').includes('✓ backend'), `the summary ticks the skipped target (printed: ${lines.join('\n')})`);
});

test('--continue-on-error keeps going past the failure, still exit 1', async () => {
  const { brand } = stageBrand();
  fs.writeFileSync(path.join(brand, 'FAIL-backend'), '');
  const code = await runDeployCommand(brand, { 'continue-on-error': true, continueOnError: true });

  const calls = readCalls(brand);
  assert.deepEqual(calls.map((c) => c.name), ['backend', 'web']);
  for (const call of calls) {
    assert.deepEqual(call.argv, ['deploy', '--snapshot=sha1234567890abcdef'], 'the brand-level bail switch never forwards');
  }
  assert.equal(code, 1);
});

test('outside any brand: errors with exit 1', async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'mgr-deploy-cmd-nobrand-'));
  const code = await runDeployCommand(scratch);
  assert.equal(code, 1);
});

test('cli routes `deploy` through ALIASES to the command file', () => {
  const Main = require('../src/cli.js');
  assert.ok(Object.prototype.hasOwnProperty.call(Main.config.aliases, 'deploy'));
  assert.ok(fs.existsSync(path.join(Main.config.commandsDir, 'deploy.js')));
});

// ─── The delivery lane (#678) ────────────────────────────────────────────────

test('the delivery lane runs ONCE, before the first target — brand inputs land before anything publishes', async () => {
  const { brand } = stageBrand();
  await runDeployCommand(brand);

  assert.deepEqual(readSequence(brand), ['delivery-lane', 'backend:scaffold', 'web:scaffold', 'lockfile-gate', 'behind-check', 'compose-workflows', 'snapshot-push', 'snapshot-wait-ref', 'backend:deploy', 'web:deploy']);
  assert.equal(manageCalls.length, 1, 'one lane pass for the whole fan-out, not one per target');
  assert.equal(manageCalls[0].startDir, brand);
});

test('the lane deploy runs IS the boot lane — one constant, two triggers', async () => {
  const { brand } = stageBrand();
  await runDeployCommand(brand);

  // The lane is asked for BY NAME, so its service list can never be a second
  // copy of BOOT_SERVICES: manage resolves 'boot' to that constant
  // (manage.test.js pins the resolution), and deploy hand-picks nothing.
  assert.equal(manageCalls[0].options.lane, 'boot');
  assert.equal(manageCalls[0].options.service, undefined);
  assert.ok(BOOT_SERVICES.includes('disperse'), 'the delivery services are the boot lane\'s');
});

test('--dry-run reaches the lane too — a planned deploy plans its delivery', async () => {
  const { brand } = stageBrand();
  await runDeployCommand(brand, { 'dry-run': true, dryRun: true });

  assert.equal(manageCalls[0].options.dryRun, true);
});

test('a delivery lane with errors stops the deploy — nothing publishes on broken inputs', async () => {
  const { brand } = stageBrand();
  manageReport = { hasErrors: true, results: {}, brand: {} };

  try {
    const code = await runDeployCommand(brand);

    assert.equal(code, 1);
    assert.deepEqual(readCalls(brand), [], 'no target was spawned');
  } finally {
    manageReport = { hasErrors: false, results: {}, brand: {} };
  }
});

// ─── The one push, and the parallel group (#901) ─────────────────────────────

test('the ONE lane pushes ONCE at the root, and every target dispatches against that sha (#901, #915)', async () => {
  const { brand } = stageBrand();
  const code = await runDeployCommand(brand);

  assert.equal(pushes.length, 1, 'one push for the whole fan-out, never one per target');
  assert.equal(pushes[0].brandRoot, brand, 'the BRAND folder is what rides');
  assert.equal(pushes[0].ref, 'omega-deploy', 'the one branch CI ever builds');
  assert.deepEqual(
    { owner: pushes[0].owner, repo: pushes[0].repo },
    { owner: 'Fixture-Org', repo: 'fixture-brand-omega' },
    'the push address is the brand repo the config names',
  );

  // And the ref has to CARRY that push before a target dispatches against it
  // (#902): GitHub resolves the branch on its side, so a dispatch sent in the
  // same second can start a run on the snapshot before this one.
  assert.equal(refWaits.length, 1, 'the root waits for the ref once, for the whole run');
  assert.deepEqual(
    { ref: refWaits[0].ref, sha: refWaits[0].sha },
    { ref: 'omega-deploy', sha: 'sha1234567890abcdef' },
    'it waits for the very sha the root just pushed',
  );

  const sequence = readSequence(brand);
  assert.ok(
    sequence.indexOf('snapshot-push') < sequence.indexOf('snapshot-wait-ref')
    && sequence.indexOf('snapshot-wait-ref') < sequence.indexOf('backend:deploy'),
    `the wait sits between the push and the first dispatch (got ${JSON.stringify(sequence)})`,
  );

  const calls = readCalls(brand);
  assert.deepEqual(calls.map((call) => call.name), ['backend', 'web']);
  for (const call of calls) {
    assert.deepEqual(call.argv, ['deploy', '--snapshot=sha1234567890abcdef'], 'every target is told the sha the root pushed');
  }
  assert.equal(code, undefined, 'all targets green → no error exit code');
});

test('the snapshot address composes the PRODUCTION config, never the machine\'s (#856, #915)', async () => {
  const { brand } = stageBrand();
  // A brand whose production layer names a different repo: the snapshot is a
  // production artifact, and an address read off this machine's ambient
  // environment (a terminal answers `development`) would push it to a repo the
  // targets never dispatch against.
  write(path.join(brand, 'config', 'omega.production.json5'), `{
  repo: { provider: 'github', org: 'Prod-Org' },
}
`);

  // The machine stating what a developer's terminal states.
  const ambient = process.env.OMEGA_ENVIRONMENT;
  process.env.OMEGA_ENVIRONMENT = 'development';

  try {
    await runDeployCommand(brand);
  } finally {
    if (ambient === undefined) delete process.env.OMEGA_ENVIRONMENT;
    else process.env.OMEGA_ENVIRONMENT = ambient;
  }

  assert.equal(pushes[0].owner, 'Prod-Org', 'the push goes to the production org');
  assert.equal(composes[0].owner, 'Prod-Org', 'and the composed workflows to the same repo');
});

test('the root checks it is current and composes the workflows ONCE, before the group, and commits nothing (#915)', async () => {
  const { brand } = stageBrand(['desktop']);

  await runDeployCommand(brand);

  assert.equal(composes.length, 1, 'one workflow compare for the whole fan-out, never one per target');
  assert.deepEqual(
    { brandRoot: composes[0].brandRoot, branch: composes[0].branch, repo: composes[0].repo },
    { brandRoot: brand, branch: 'main', repo: 'fixture-brand-omega' },
    'the composed files of THIS brand go to its repo\'s default branch',
  );

  // Both run before a single target is spawned, and in this order: a refusal
  // has to land before anything is written anywhere (#915).
  const sequence = readSequence(brand);
  const firstDeploy = sequence.findIndex((entry) => entry.endsWith(':deploy'));
  assert.ok(
    sequence.indexOf('lockfile-gate') !== -1
    && sequence.indexOf('lockfile-gate') < sequence.indexOf('behind-check')
    && sequence.indexOf('behind-check') < sequence.indexOf('compose-workflows')
    && sequence.indexOf('compose-workflows') < sequence.indexOf('snapshot-push')
    && sequence.indexOf('snapshot-push') < firstDeploy,
    `gate the lockfile, check, compose, push, then the targets (got ${JSON.stringify(sequence)})`,
  );

  for (const call of readCalls(brand)) {
    assert.deepEqual(call.argv, ['deploy', '--snapshot=sha1234567890abcdef'], 'the root delivered: no child repeats it');
    assert.ok(!call.argv.includes('--no-sync'), 'the flag is retired with the push lane (#915)');
  }
});

test('a --dry-run and a --direct run deliver NOTHING at the root (#901)', async () => {
  const { brand } = stageBrand();

  await runDeployCommand(brand, { 'dry-run': true, dryRun: true });
  assert.equal(pushes.length, 0, 'a dry run promises to send nothing at all');
  assert.equal(composes.length, 0, 'the default branch is not touched either');

  await runDeployCommand(brand, { direct: true });
  assert.equal(pushes.length, 0, 'a --direct run publishes from this machine without dispatching');
  for (const call of readCalls(brand, { verb: 'deploy' })) {
    assert.ok(!call.argv.includes('--snapshot=sha1234567890abcdef'), 'and neither forwards a sha for a delivery nobody ran');
  }
});

test('a --dry-run pushes NOTHING: the run promises to send nothing at all (#901)', async () => {
  const { brand } = stageBrand();

  await runDeployCommand(brand, { 'dry-run': true, dryRun: true });

  assert.equal(pushes.length, 0);
  for (const call of readCalls(brand)) {
    assert.deepEqual(call.argv, ['deploy', '--dry-run'], 'and no sha is forwarded for a snapshot nobody pushed');
  }
});

test('web, desktop and extension deploy CONCURRENTLY, after the backend (#901)', async () => {
  const { brand } = stageBrand(['desktop', 'extension']);
  const code = await runDeployCommand(brand);

  const calls = readCalls(brand, { phases: true }).filter((entry) => entry.name !== 'delivery-lane');
  const starts = calls.filter((entry) => entry.phase === 'start').map((entry) => entry.name);
  const ends = calls.filter((entry) => entry.phase === 'end').map((entry) => entry.name);

  assert.equal(starts[0], 'backend', 'the API goes live before the surfaces that call it');
  assert.deepEqual(starts.slice(1).sort(), ['desktop', 'extension', 'web'], 'and the three surfaces all ran');
  assert.equal(ends[0], 'backend', 'the backend is finished before the group is spawned');

  // The group's three all START before the first of them ENDS: a sequential
  // fan-out could not produce this order.
  const groupStarts = calls.filter((entry) => entry.phase === 'start' && entry.name !== 'backend');
  const firstGroupEnd = calls.findIndex((entry) => entry.phase === 'end' && entry.name !== 'backend');
  assert.equal(groupStarts.length, 3);
  for (const start of groupStarts) {
    assert.ok(calls.indexOf(start) < firstGroupEnd, `${start.name} started before any of the group had finished`);
  }

  assert.equal(code, undefined);
});

test('a failing member of the group lets its siblings finish, then exits 1 naming it (#901)', async () => {
  const { brand } = stageBrand(['desktop', 'extension']);
  // The FIRST of the group: a run that stopped at a failure would leave
  // extension and desktop unpublished behind it.
  fs.writeFileSync(path.join(brand, 'FAIL-web'), '');

  const code = await runDeployCommand(brand);
  const ended = readCalls(brand, { phases: true }).filter((entry) => entry.phase === 'end').map((entry) => entry.name);

  assert.deepEqual(ended.sort(), ['backend', 'desktop', 'extension', 'web'], 'every sibling ran to the end');
  assert.equal(code, 1);
});

test('--target=web,desktop: no backend, and the two run together (#901)', async () => {
  const { brand } = stageBrand(['desktop', 'extension']);
  await runDeployCommand(brand, { target: 'web,desktop' });

  const calls = readCalls(brand, { phases: true }).filter((entry) => entry.name !== 'delivery-lane');
  assert.deepEqual(
    calls.filter((entry) => entry.phase === 'start').map((entry) => entry.name).sort(),
    ['desktop', 'web'],
    'the picked set, and nothing else: no backend, no extension',
  );

  const firstEnd = calls.findIndex((entry) => entry.phase === 'end');
  assert.equal(calls.slice(0, firstEnd).filter((entry) => entry.phase === 'start').length, 2, 'both started before either finished');
});

// ─── The scaffold, before the push (#901) ────────────────────────────────────

test('every selected target is SCAFFOLDED first, in order, before the push and before any deploy (#901)', async () => {
  const { brand } = stageBrand(['desktop']);
  const code = await runDeployCommand(brand);

  // A target's scaffold composes its workflow into the brand root, and the
  // snapshot is what carries it to the runner: scaffolding after the push
  // would dispatch a workflow the mirror does not hold yet.
  assert.deepEqual(readSequence(brand).slice(0, 6), [
    'delivery-lane',
    'backend:scaffold',
    'web:scaffold',
    'desktop:scaffold',
    'lockfile-gate',
    'behind-check',
  ], 'every scaffold ran, in DEPLOY_ORDER, before the run\'s one delivery');

  for (const call of readCalls(brand, { verb: 'scaffold' })) {
    assert.deepEqual(call.argv, ['scaffold'], 'the bare verb: no flags are forwarded to a scaffold');
    assert.equal(call.cwd, path.join(brand, 'targets', call.name), 'each one runs in its own target dir');
  }

  assert.equal(code, undefined);
});

test('a --dry-run scaffolds too, and still pushes nothing (#901)', async () => {
  const { brand } = stageBrand();
  await runDeployCommand(brand, { 'dry-run': true, dryRun: true });

  assert.deepEqual(readCalls(brand, { verb: 'scaffold' }).map((call) => call.name), ['backend', 'web'], 'a dry run of a deploy scaffolds, exactly as every verb does');
  assert.equal(pushes.length, 0);
});

test('a scaffold failure stops the run BEFORE the push: nothing pushed, nothing deployed (#901)', async () => {
  const { brand } = stageBrand();
  fs.writeFileSync(path.join(brand, 'FAIL-scaffold-backend'), '');

  const code = await runDeployCommand(brand);

  assert.deepEqual(readCalls(brand, { verb: 'scaffold' }).map((call) => call.name), ['backend'], 'the run stops at the first failing scaffold');
  assert.equal(pushes.length, 0, 'nothing was pushed');
  assert.deepEqual(readCalls(brand), [], 'and no target deployed');
  assert.equal(code, 1);
});

test('--target=web scaffolds web ONLY: the picked set is the scaffolded set (#901)', async () => {
  const { brand } = stageBrand(['desktop']);
  await runDeployCommand(brand, { target: 'web' });

  assert.deepEqual(readCalls(brand, { verb: 'scaffold' }).map((call) => call.name), ['web']);
  assert.deepEqual(readCalls(brand).map((call) => call.name), ['web']);
});

// ─── Units ───────────────────────────────────────────────────────────────────

test('selectTargets: full DEPLOY_ORDER — backend, web, then the rest', () => {
  const targets = [
    { name: 'desktop', target: 'desktop' },
    { name: 'web', target: 'web' },
    { name: 'extension', target: 'extension' },
    { name: 'backend', target: 'backend' },
  ];
  const { selected } = selectTargets({ targets });
  assert.deepEqual(selected.map((entry) => entry.target), ['backend', 'web', 'extension', 'desktop']);
});

test('selectTargets: an unknown token throws — a matched subset is never returned', () => {
  const targets = [{ name: 'web', target: 'web' }];

  assert.throws(
    () => selectTargets({ targets, target: 'web,hosting' }),
    (error) => {
      assert.equal(error.refusal, true);
      assert.match(error.message, /Unknown --target token "hosting": this brand's targets are web\. Nothing ran\./);
      return true;
    },
  );

  assert.deepEqual(selectTargets({ targets, target: 'web' }).selected.map((entry) => entry.name), ['web']);
});

test('buildForwardedFlags: values, booleans, --no- forms; brand-level keys consumed', () => {
  const flags = buildForwardedFlags({
    _: ['deploy'],
    target: 'web',
    'continue-on-error': true,
    continueOnError: true,
    'dry-run': true,
    dryRun: true,
    secrets: false,
    platforms: 'mac,win',
  });
  assert.deepEqual(flags, ['--dry-run', '--no-secrets', '--platforms=mac,win']);
});
