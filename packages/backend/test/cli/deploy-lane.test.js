/**
 * `omega deploy` takes ONE lane, the same one every OMEGA target takes
 * ([#872](https://github.com/Omega-JS-Stack/omega/issues/872)).
 *
 * The DEFAULT is a dispatch of the brand's composed backend workflow: the
 * runner then runs this very verb with `--direct`, which is the whole local
 * behavior that used to BE the verb (license verdict, stage, local-package
 * staging, `firebase deploy`, public-invoker IAM).
 *
 * What these tests hold it to:
 *   - the bare verb dispatches and touches nothing else: no `firebase deploy`,
 *     no staged dist/, because a dispatch deploys from the runner's checkout;
 *   - `--direct` is the firebase lane, unchanged;
 *   - the dispatch names the composed workflow, so a brand monorepo's target
 *     dispatches `backend-deploy.yml` at the brand root rather than a file
 *     GitHub never runs.
 *
 * Offline by construction: `--dry-run` builds the plan and sends nothing, and
 * `powertools.execute` is swapped for a recorder, so a shell command that DID
 * run is visible instead of running.
 *
 * Run: npx omega test backend:cli/deploy-lane
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const powertools = require('node-powertools');

const DEPLOY = require.resolve('../../dist/cli/commands/deploy.js');
const DeployCommand = require(DEPLOY);
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

// The vendored devkit the command loads: the SAME instances, by the path the
// prepare rewrite gave its requires.
const devkitDeploy = require('../../dist/vendor/devkit/deploy.js');
const devkitFollow = require('../../dist/vendor/devkit/deploy-follow.js');
const devkitRecord = require('../../dist/vendor/devkit/deploy-record.js');
const attachLogFile = require('../../dist/vendor/devkit/attach-log-file.js');

// The verb's OWN precheck module, wrapped rather than replaced below, so a run
// records whether the network half was entered at all (#882).
const backendPrecheck = require('../../dist/cli/utils/deploy-precheck.js');

/**
 * A backend target on disk, in a brand that names its GitHub repo.
 *
 * @param {object} [options] - `brandRoot: true` nests the target under a brand;
 *   `version` is that brand root's number, which every target follows (#869).
 *   The target stays at 0.0.0, so a different number here is a DRIFTED brand.
 *   `shared: true` is a brand pointed at a cloud project several brands own
 *   (`cloud.shared`, #882).
 * @returns {{ root: string, dir: string }} The staged tree.
 */
function targetDir({ brandRoot, version = '0.0.0', shared } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-deploy-lane-')));
  const config = JSON.stringify({
    brand: { id: 'fixture', name: 'Fixture Brand', url: 'https://fixture.test' },
    repo: { provider: 'github', org: 'Fixture-Org' },
    ...(shared ? { cloud: { shared: true } } : {}),
    targets: { backend: { type: 'backend' } },
  });

  // A brand monorepo puts the config at the BRAND root and the target under
  // targets/; a standalone target carries its own.
  const dir = brandRoot ? path.join(root, 'targets', 'backend') : root;
  fs.mkdirSync(path.join(brandRoot ? root : dir, 'config'), { recursive: true });
  fs.writeFileSync(path.join(brandRoot ? root : dir, 'config', 'omega.json5'), config);

  // The brand root's version is the one every target follows (#869): a deploy
  // reads it before either lane, so the fixture carries one like a real brand.
  if (brandRoot) {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture-brand', version, private: true }));
  }

  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'fixture-backend', version: '0.0.0' }));
  fs.writeFileSync(path.join(dir, 'src', 'index.js'), '// fixture backend entry\n');

  return { root, dir };
}

/** Run the command with console + shell captured. Nothing here reaches a shell. */
async function runDeploy(dir, argv) {
  const lines = [];
  const shell = [];
  const originalLog = console.log;
  const originalExecute = powertools.execute;

  console.log = (...args) => lines.push(args.map(String).join(' '));
  powertools.execute = async (command) => { shell.push(command); return ''; };

  try {
    await new DeployCommand({ firebaseProjectPath: dir, argv: { _: [], ...argv }, options: {} }).execute();
    return { output: lines.join('\n'), shell };
  } finally {
    console.log = originalLog;
    powertools.execute = originalExecute;
  }
}

/**
 * Run the verb with the dispatch, the token read and the follower swapped out,
 * so a REAL dispatch lane runs with nothing on the network. The command
 * DESTRUCTURES its devkit imports at load, so it is dropped from the cache and
 * re-required inside the patch.
 *
 * @param {string} dir - The staged target dir.
 * @param {Function} follower - What `followRun` does for this run.
 * @param {object} [argv] - Extra argv for this run (the fan-out's `--snapshot`).
 * @returns {Promise<{ sent: object[], followed: object[], prechecked: object[], error: Error|null, lines: string[] }>} The run's record.
 */
async function runFollowedDeploy(dir, follower, argv = {}) {
  const followed = [];
  const sent = [];
  const prechecked = [];
  const realPrecheck = backendPrecheck.deployPrecheck;
  const patched = [
    // Recorded, not stubbed: the precheck still runs exactly as it would, and a
    // run that never entered it is visible as an empty list (#882).
    [backendPrecheck, 'deployPrecheck', async (args) => {
      prechecked.push(args);
      return realPrecheck(args);
    }],
    [devkitDeploy, 'deployViaDispatch', async (args) => {
      sent.push(args);
      // The executor's own answer shape, the `sha` included (#902): it is what
      // the verb labels the dispatch with and what it holds the followed run's
      // head to, so a stub that dropped it hid both.
      return {
        plan: { runsUrl: 'https://github.com/Fixture-Org/fixture-omega/actions' },
        dispatched: true,
        sha: args.snapshot || null,
        lane: args.snapshot ? { mode: 'snapshot', ref: 'main' } : { mode: 'push', ref: 'main' },
      };
    }],
    [devkitDeploy, 'resolveToken', () => 'tok'],
    [devkitRecord, 'recordDeploy', () => {}],
    [devkitFollow, 'followRun', async (args) => {
      followed.push(args);
      return follower(args);
    }],
  ];
  const restore = patched.map(([module, key]) => [module, key, module[key]]);
  for (const [module, key, value] of patched) module[key] = value;

  const lines = [];
  const originalLog = console.log;
  console.log = (...args) => lines.push(args.map(String).join(' '));
  delete require.cache[DEPLOY];

  let error = null;
  try {
    const Command = require(DEPLOY);
    await new Command({ firebaseProjectPath: dir, argv: { _: [], secrets: false, ...argv }, options: {} }).execute();
  } catch (e) {
    error = e;
  } finally {
    // The verb tees this process' writers: hand them back before the next case
    // prints through a fixture that is about to be gone.
    attachLogFile.detach();
    console.log = originalLog;
    for (const [module, key, value] of restore) module[key] = value;
    delete require.cache[DEPLOY];
  }

  return { sent, followed, prechecked, error, lines };
}

module.exports = defineCases({
  description: 'deploy lane (#872): the default is a CI dispatch, --direct is the firebase deploy',
  type: 'group',
  timeout: 60000,

  tests: [
    {
      name: 'the bare verb dispatches the workflow and stages nothing',
      async run() {
        const { root, dir } = targetDir();

        try {
          // `--no-secrets` keeps the precheck (a `gh` call) out of a unit run;
          // the dry run below sends nothing either way.
          const run = await runDeploy(dir, { 'dry-run': true, secrets: false });

          assert.match(run.output, /DRY RUN/, 'a dry run prints the plan it would send');
          assert.match(run.output, /actions\/workflows\/deploy\.yml\/dispatches/, 'the plan names the backend workflow');
          assert.match(run.output, /Fixture-Org\/fixture-omega/, 'it dispatches on the brand repo the config names');
          assert.deepStrictEqual(run.shell, [], 'a dispatch runs no firebase command of its own');
          assert.strictEqual(fs.existsSync(path.join(dir, 'dist')), false, 'nothing is staged here: the runner stages from its own checkout');
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'inside a brand the dispatch names the COMPOSED workflow, the only one GitHub runs',
      async run() {
        const { root, dir } = targetDir({ brandRoot: true });

        try {
          const run = await runDeploy(dir, { 'dry-run': true, secrets: false });

          assert.match(run.output, /actions\/workflows\/backend-deploy\.yml\/dispatches/, 'the composed name (#265) is what the brand root carries');
          assert.strictEqual(fs.existsSync(path.join(root, '.github', 'workflows', 'backend-deploy.yml')), true, 'the verb composes it on the way past, so the dispatch can never name a file that is not there');
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'a gcloud failure under CI FAILS the deploy by name instead of being swallowed (#872)',
      async run() {
        const { root, dir } = targetDir();
        const originalLog = console.log;
        const originalExecute = powertools.execute;
        const originalCI = process.env.CI;
        const originalActions = process.env.GITHUB_ACTIONS;
        const lines = [];

        // The runner's shape: a project to fix bindings on, and a gcloud that
        // cannot answer (not installed, or authenticated for nobody). On a
        // laptop that stays silent; in CI the workflow set gcloud up itself, so
        // the failure is the deploy's and the run goes red by name.
        fs.writeFileSync(path.join(dir, '.firebaserc'), JSON.stringify({ projects: { default: 'fixture-project' } }));
        console.log = (...args) => lines.push(args.map(String).join(' '));
        powertools.execute = async () => { throw new Error('gcloud: command not found'); };

        try {
          process.env.CI = 'true';
          await assert.rejects(
            () => new DeployCommand({ firebaseProjectPath: dir, argv: { _: [] }, options: {} }).ensurePublicInvoker(),
            (error) => /gcloud: command not found/.test(error.message) && /403/.test(error.message),
            'CI fails with what broke and what it costs',
          );

          lines.length = 0;
          delete process.env.CI;
          delete process.env.GITHUB_ACTIONS;
          await new DeployCommand({ firebaseProjectPath: dir, argv: { _: [] }, options: {} }).ensurePublicInvoker();
          const onALaptop = lines.join('\n');

          assert.strictEqual(onALaptop, '', 'a laptop stays as quiet as it was');
        } finally {
          console.log = originalLog;
          powertools.execute = originalExecute;
          if (originalCI === undefined) delete process.env.CI;
          else process.env.CI = originalCI;
          if (originalActions === undefined) delete process.env.GITHUB_ACTIONS;
          else process.env.GITHUB_ACTIONS = originalActions;
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },

    {
      name: '--direct --dry-run prints the plan and deploys nothing, like the other three (#872)',
      async run() {
        const { root, dir } = targetDir();

        try {
          const run = await runDeploy(dir, { direct: true, 'dry-run': true });

          assert.match(run.output, /DRY RUN, would run: firebase deploy/, 'the plan names the command');
          assert.deepStrictEqual(run.shell, [], 'and nothing shells out');
          assert.strictEqual(fs.existsSync(path.join(dir, 'dist')), false, 'nothing is staged for a dry run');
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },

    {
      name: '--direct is the firebase deploy, unchanged',
      async run() {
        const { root, dir } = targetDir();

        try {
          const run = await runDeploy(dir, { direct: true });

          assert.ok(run.shell.some((command) => command.startsWith('firebase deploy')), `--direct runs the deploy itself (ran: ${run.shell.join(', ')})`);
          assert.strictEqual(fs.existsSync(path.join(dir, 'dist', 'index.js')), true, 'and stages the upload first');
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },

    {
      // The scaffold is the LOCAL half of the retired `omega setup` (#675) and
      // belongs to every lane: web, desktop and extension all run it before
      // they split on `--direct`, and this verb's own header says every run
      // starts with it. Only the dispatch lane did.
      name: '--direct runs the local scaffold too, exactly as the other three targets do',
      async run() {
        const { root, dir } = targetDir();

        try {
          // A dry run: the scaffold is local and writes what a real run writes,
          // and nothing else about this lane reaches a shell.
          const run = await runDeploy(dir, { direct: true, 'dry-run': true });

          assert.strictEqual(
            fs.existsSync(path.join(dir, '.github', 'workflows', 'deploy.yml')),
            true,
            'the scaffold composed this target\'s workflow on the way past',
          );
          assert.deepStrictEqual(run.shell, [], 'and the lane still sends nothing');
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },

    {
      // #873: the dispatch used to BE the verb's answer, so a run that went red
      // minutes later left the deploy reported green.
      name: 'a dispatched deploy FOLLOWS its run, and a red run fails the verb (#873, #847)',
      async run() {
        const { root, dir } = targetDir({ brandRoot: true });

        try {
          const green = await runFollowedDeploy(dir, async () => ({ run: {}, conclusion: 'success' }));

          assert.strictEqual(green.error, null, green.error && green.error.message);

          // The dispatch address is devkit's ONE helper's (#847): the repo the
          // brand's config names, and the per-target workflow the scaffold
          // composed at the brand root (#265).
          assert.strictEqual(green.sent.length, 1);
          assert.deepStrictEqual(
            { owner: green.sent[0].owner, repo: green.sent[0].repo, workflow: green.sent[0].workflow },
            { owner: 'Fixture-Org', repo: 'fixture-omega', workflow: 'backend-deploy.yml' },
          );

          assert.strictEqual(green.followed.length, 1, 'the run is followed, not just dispatched');
          assert.strictEqual(green.followed[0].owner, 'Fixture-Org');
          assert.strictEqual(green.followed[0].repo, 'fixture-omega');
          assert.strictEqual(green.followed[0].workflow, 'backend-deploy.yml', 'the composed name the dispatch itself used');
          assert.strictEqual(green.followed[0].token, 'tok');
          assert.ok(green.followed[0].since instanceof Date, 'the instant read before the dispatch');
          assert.strictEqual(fs.existsSync(path.join(dir, 'logs', 'deploy.log')), true, 'the whole verb tees logs/deploy.log');

          const red = await runFollowedDeploy(dir, async () => {
            throw new Error('backend-deploy.yml concluded failure: https://github.com/Fixture-Org/fixture-omega/actions/runs/7');
          });

          assert.match(red.error && red.error.message, /concluded failure/, 'a red run is the verb failing');
          assert.match(red.error.message, /actions\/runs\/7/, 'with the run to look at');
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },

    {
      // #901: the brand root pushes the snapshot ONCE and hands every target of
      // the run the sha, so this verb dispatches against it and pushes nothing.
      // The flag is the root's word to the verb, never typed by a human.
      name: '--snapshot=<sha> reaches the executor as the run\'s snapshot (#901)',
      async run() {
        const { root, dir } = targetDir({ brandRoot: true });

        try {
          const run = await runFollowedDeploy(
            dir,
            async () => ({ run: {}, conclusion: 'success' }),
            { snapshot: 'abc1234567890' },
          );

          assert.strictEqual(run.error, null, run.error && run.error.message);
          assert.strictEqual(run.sent.length, 1);
          assert.strictEqual(run.sent[0].snapshot, 'abc1234567890');

          // And the sha the executor answers with is what the run is BOTH
          // labelled with and held to (#902): the dispatch line names it, and
          // the follower refuses a run whose head is anything else.
          assert.ok(
            run.lines.join('\n').includes('Dispatched backend-deploy.yml (snapshot lane, ref main @ abc1234)'),
            `the dispatch line names the snapshot sha (printed: ${run.lines.join('\n')})`,
          );
          assert.strictEqual(run.followed.length, 1);
          assert.strictEqual(run.followed[0].headSha, 'abc1234567890');
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'a target whose version drifted from the brand root is refused, before either lane (#869)',
      async run() {
        const { root, dir } = targetDir({ brandRoot: true, version: '0.0.3' });

        try {
          // The check is a READ, so it sits ahead of the lane split: neither the
          // dispatch (which would push secrets) nor `--direct` may ship a target
          // carrying a number the brand never released.
          for (const argv of [{ 'dry-run': true, secrets: false }, { direct: true, 'dry-run': true }]) {
            await assert.rejects(
              () => runDeploy(dir, argv),
              (error) => {
                assert.strictEqual(error.refusal, true, 'a refusal prints its message alone');
                assert.match(error.message, /targets\/backend is 0\.0\.0 but the brand is 0\.0\.3/, 'names the target and both numbers');
                assert.match(error.message, /omega bump/, 'and the fix');
                return true;
              },
            );
          }
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },

    {
      // #882: a shared cloud project belongs to several brands at once, so no
      // brand deploys into it. An intentional SKIP, in the shape every other
      // intentional skip in this lane takes: one line, exit 0, nothing run.
      name: 'cloud.shared: true skips the deploy on every lane, exit 0 (#882)',
      async run() {
        const { root, dir } = targetDir({ shared: true });
        const originalExitCode = process.exitCode;

        try {
          // The dispatch lane, the direct lane (what CI runs) and a dry run of
          // it: one answer for all three, because the project is the reason.
          for (const argv of [{ 'dry-run': true, secrets: false }, { direct: true }, { direct: true, 'dry-run': true }]) {
            const run = await runDeploy(dir, argv);
            const printed = run.output.split('\n').filter((line) => line.trim());

            assert.match(run.output, /Skipping the backend deploy/, `the skip names itself (argv: ${JSON.stringify(argv)})`);
            assert.match(run.output, /cloud\.shared is true/, 'and the key that decided it');
            assert.strictEqual(printed.length, 1, `and nothing else is printed (printed: ${run.output})`);
            assert.deepStrictEqual(run.shell, [], 'no firebase, no gcloud, no shell at all');
            assert.strictEqual(fs.existsSync(path.join(dir, 'dist')), false, 'nothing is staged for a deploy that will not happen');
            assert.strictEqual(process.exitCode, undefined, 'a skip is not a refusal: the verb exits 0');
          }
        } finally {
          process.exitCode = originalExitCode;
          attachLogFile.detach();
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },

    {
      // The same skip, watched from the network seams (#882): the gate sits
      // ahead of the precheck, so a shared project never pushes its secrets and
      // never dispatches a workflow that would deploy into the shared project.
      name: 'a shared project runs no precheck and dispatches nothing (#882)',
      async run() {
        const { root, dir } = targetDir({ brandRoot: true, shared: true });

        try {
          const run = await runFollowedDeploy(dir, async () => ({ run: {}, conclusion: 'success' }));

          assert.strictEqual(run.error, null, run.error && run.error.message);
          assert.strictEqual(run.prechecked.length, 0, 'no secrets are published for a deploy that will not happen');
          assert.strictEqual(run.sent.length, 0, 'no workflow is dispatched');
          assert.strictEqual(run.followed.length, 0, 'and no run is followed');
          assert.ok(
            run.lines.join('\n').includes('Skipping the backend deploy'),
            `the skip line is what the lane printed (printed: ${run.lines.join('\n')})`,
          );
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },
  ],
});
