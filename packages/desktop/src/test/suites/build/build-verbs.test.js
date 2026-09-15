// Build-layer tests for the canonical build verbs (build / package / publish).
// The synced projectScripts are thin `omega <verb>` aliases, so each verb must
// run the pipeline ITSELF (clean, gulp task) and never shell back to
// `npm run build` / `npm run publish` (that would recurse forever).
//
// There is no `setup` step (#675): the local scaffold runs inside the gulp
// `defaults` task. Nothing COPIES signing material any more (#891): the tree
// is read in place and the env load derived the paths to it.

const path = require('path');
const fs   = require('fs');

const commandsDir = path.join(__dirname, '..', '..', '..', 'commands');
const pipeline    = require(path.join(__dirname, '..', '..', '..', 'utils', 'build-pipeline.js'));

const build   = require(path.join(commandsDir, 'build.js'));
const pkg     = require(path.join(commandsDir, 'package.js'));
const publish = require(path.join(commandsDir, 'publish.js'));
const defineCases = require('@omega.js/devkit/test/define-cases');

// Record the steps a plan runs, in order, without executing anything real.
// The step implementations (clean/setup/validate-certs/gulp) are the seam the
// pipeline already takes as an argument — nothing is faked, we just hand it a
// recorder instead of the real runners (a real gulp package build has no place
// in a unit test).
function recorder(log) {
  const record = (type) => (options, step) => { log.push(step.task ? `${type}:${step.task}` : type); };
  return {
    clean: record('clean'),
    'ship-keys': record('ship-keys'),
    'validate-certs': record('validate-certs'),
    gulp: record('gulp'),
  };
}

async function withEnv(run) {
  // OMEGA_ENVIRONMENT rides the list because it is the ONE environment input
  // ([#817](https://github.com/Omega-JS-Stack/omega/issues/817)) and
  // src/build.js WRITES it at load from the lane, so clearing a lane flag
  // without clearing it leaves the previous lane's word in the process.
  const keys = ['OMEGA_ENVIRONMENT', 'OMEGA_BUILD_MODE', 'OMEGA_IS_PUBLISH'];
  const previous = keys.map((key) => [key, process.env[key]]);
  keys.forEach((key) => delete process.env[key]);
  try {
    return await run();
  } finally {
    previous.forEach(([key, value]) => {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    });
  }
}

module.exports = defineCases({
  type: 'suite',
  layer: 'build',
  description: 'build verbs — the CLI owns the pipeline and its env flags',
  tests: [
    {
      name: 'build: OMEGA_BUILD_MODE + clean → gulp build',
      run: (ctx) => {
        const plan = build.plan({});
        ctx.expect(plan.env.OMEGA_BUILD_MODE).toBe('true');
        ctx.expect(plan.steps.map((s) => (s.task ? `${s.type}:${s.task}` : s.type)))
          .toEqual(['clean', 'gulp:build']);
      },
    },
    {
      name: 'package: OMEGA_BUILD_MODE + clean → gulp packageBuild',
      run: (ctx) => {
        const plan = pkg.plan({});
        ctx.expect(plan.env.OMEGA_BUILD_MODE).toBe('true');
        ctx.expect(plan.steps.map((s) => (s.task ? `${s.type}:${s.task}` : s.type)))
          .toEqual(['clean', 'gulp:packageBuild']);
      },
    },
    {
      name: 'package --quick: same steps, gulp packageQuick',
      run: (ctx) => {
        const plan = pkg.plan({ quick: true });
        ctx.expect(plan.steps.map((s) => (s.task ? `${s.type}:${s.task}` : s.type)))
          .toEqual(['clean', 'gulp:packageQuick']);
        ctx.expect(pkg.plan({ q: true }).steps[1].task).toBe('packageQuick');
      },
    },
    {
      name: 'publish: both flags + ship-keys → validate-certs → gulp publish (no clean)',
      run: (ctx) => {
        const plan = publish.plan({});
        ctx.expect(plan.env.OMEGA_BUILD_MODE).toBe('true');
        ctx.expect(plan.env.OMEGA_IS_PUBLISH).toBe('true');
        ctx.expect(plan.steps.map((s) => (s.task ? `${s.type}:${s.task}` : s.type)))
          .toEqual(['ship-keys', 'validate-certs', 'gulp:publish']);
      },
    },
    {
      name: 'publish --local: clean → ship-keys → validate-certs → gulp publish',
      run: (ctx) => {
        const plan = publish.plan({ local: true });
        ctx.expect(plan.steps.map((s) => (s.task ? `${s.type}:${s.task}` : s.type)))
          .toEqual(['clean', 'ship-keys', 'validate-certs', 'gulp:publish']);
      },
    },
    // #867: a shipped format with no credential is a release that dies on a
    // runner, so publish refuses FIRST, before a minute of build time, naming
    // the key, the declaration that requires it, and the walk that collects it.
    // The SAME JS runs in both lanes: CI's `npm run release:local` is this verb.
    {
      name: 'publish refuses a declared format with no ship credential, naming the key and the walk (#867)',
      run: (ctx) => {
        const { assertShipKeys } = require(path.join(__dirname, '..', '..', '..', 'utils', 'ship-keys.js'));
        const config = { platforms: { linux: { formats: { snap: { channels: ['stable'] } } } } };

        let message = '';
        try {
          assertShipKeys({ config, env: {} });
        } catch (error) {
          message = error.message;
        }

        ctx.expect(message).toContain('SNAPCRAFT_STORE_CREDENTIALS (required by platforms.linux.formats.snap)');
        ctx.expect(message).toContain('omega manage --service publishing');

        // With the credential, the same declaration ships
        ctx.expect(assertShipKeys({ config, env: { SNAPCRAFT_STORE_CREDENTIALS: 'blob' } }).length > 0).toBe(true);

        // And a brand that never mentions the snap owes nothing: the default
        // format is on, but nothing in its config makes the credential due
        ctx.expect(assertShipKeys({ config: {}, env: {} }).length > 0).toBe(true);
      },
    },
    {
      name: 'runPipeline sets the env flags and runs the steps in order',
      run: async (ctx) => {
        const log = [];
        await withEnv(async () => {
          await pipeline.runPipeline(publish.plan({ local: true }), {}, recorder(log));
          ctx.expect(process.env.OMEGA_BUILD_MODE).toBe('true');
          ctx.expect(process.env.OMEGA_IS_PUBLISH).toBe('true');
        });
        ctx.expect(log).toEqual(['clean', 'ship-keys', 'validate-certs', 'gulp:publish']);
      },
    },
    {
      name: 'gulp steps shell `npm run gulp -- <task>` (the one script with no alias to recurse through)',
      run: (ctx) => {
        ctx.expect(pipeline.gulpCommand('packageQuick')).toBe('npm run gulp -- packageQuick');
      },
    },
    {
      name: 'no verb shells back to `npm run build` / `npm run package` / `npm run publish`',
      run: (ctx) => {
        const files = [
          path.join(commandsDir, 'build.js'),
          path.join(commandsDir, 'package.js'),
          path.join(commandsDir, 'publish.js'),
          // The pipeline owns the one execute() call — a recursive shell-out
          // reintroduced HERE would pass a commands-only scan.
          path.join(__dirname, '..', '..', '..', 'utils', 'build-pipeline.js'),
        ];
        for (const file of files) {
          // Comments may NAME the forbidden commands (the pipeline header
          // documents the recursion rule) — the guard polices code only.
          const source = fs.readFileSync(file, 'utf8')
            .replace(/\/\/[^\n]*/g, '')
            .replace(/\/\*[\s\S]*?\*\//g, '');
          ctx.expect(/npm run (build|package|publish)/.test(source)).toBe(false);
        }
      },
    },
    {
      name: 'every plan step type has a runner in the RUNNERS table',
      run: (ctx) => {
        const plans = [
          build.plan({}),
          pkg.plan({}),
          pkg.plan({ quick: true }),
          publish.plan({}),
          publish.plan({ local: true }),
        ];
        const known = Object.keys(pipeline.RUNNERS);
        for (const plan of plans) {
          for (const step of plan.steps) {
            ctx.expect(known.includes(step.type)).toBe(true);
          }
        }
      },
    },
  ],
});
