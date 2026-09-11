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

const DeployCommand = require('../../dist/cli/commands/deploy.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

/** A backend target on disk, in a brand that names its GitHub repo. */
function targetDir({ brandRoot } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-deploy-lane-')));
  const config = JSON.stringify({
    brand: { id: 'fixture', name: 'Fixture Brand', url: 'https://fixture.test' },
    repo: { providers: { github: { org: 'Fixture-Org', repo: 'Fixture-Org/fixture-omega' } } },
    targets: { backend: {} },
  });

  // A brand monorepo puts the config at the BRAND root and the target under
  // targets/; a standalone target carries its own.
  const dir = brandRoot ? path.join(root, 'targets', 'backend') : root;
  fs.mkdirSync(path.join(brandRoot ? root : dir, 'config'), { recursive: true });
  fs.writeFileSync(path.join(brandRoot ? root : dir, 'config', 'omega.json5'), config);

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
  ],
});
