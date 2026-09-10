// Build-layer tests for the canonical build verbs (build / package / publish).
// The synced projectScripts are thin `omega <verb>` aliases, so each verb must
// run the pipeline ITSELF — clean, certs, gulp task — and never shell back to
// `npm run build` / `npm run publish` (that would recurse forever).
//
// There is no `setup` step (#675): the local scaffold runs inside the gulp
// `defaults` task. `certs` delivers the Apple signing artifacts (#678).

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
    certs: record('certs'),
    'validate-certs': record('validate-certs'),
    gulp: record('gulp'),
  };
}

async function withEnv(run) {
  const keys = ['OMEGA_BUILD_MODE', 'OMEGA_IS_PUBLISH'];
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
      name: 'build: OMEGA_BUILD_MODE + clean → certs → gulp build',
      run: (ctx) => {
        const plan = build.plan({});
        ctx.expect(plan.env.OMEGA_BUILD_MODE).toBe('true');
        ctx.expect(plan.steps.map((s) => (s.task ? `${s.type}:${s.task}` : s.type)))
          .toEqual(['clean', 'certs', 'gulp:build']);
      },
    },
    {
      name: 'package: OMEGA_BUILD_MODE + clean → certs → gulp packageBuild',
      run: (ctx) => {
        const plan = pkg.plan({});
        ctx.expect(plan.env.OMEGA_BUILD_MODE).toBe('true');
        ctx.expect(plan.steps.map((s) => (s.task ? `${s.type}:${s.task}` : s.type)))
          .toEqual(['clean', 'certs', 'gulp:packageBuild']);
      },
    },
    {
      name: 'package --quick: same steps, gulp packageQuick',
      run: (ctx) => {
        const plan = pkg.plan({ quick: true });
        ctx.expect(plan.steps.map((s) => (s.task ? `${s.type}:${s.task}` : s.type)))
          .toEqual(['clean', 'certs', 'gulp:packageQuick']);
        ctx.expect(pkg.plan({ q: true }).steps[2].task).toBe('packageQuick');
      },
    },
    {
      name: 'publish: both flags + certs → validate-certs → gulp publish (no clean)',
      run: (ctx) => {
        const plan = publish.plan({});
        ctx.expect(plan.env.OMEGA_BUILD_MODE).toBe('true');
        ctx.expect(plan.env.OMEGA_IS_PUBLISH).toBe('true');
        ctx.expect(plan.steps.map((s) => (s.task ? `${s.type}:${s.task}` : s.type)))
          .toEqual(['certs', 'validate-certs', 'gulp:publish']);
      },
    },
    {
      name: 'publish --local: clean → certs → validate-certs → gulp publish',
      run: (ctx) => {
        const plan = publish.plan({ local: true });
        ctx.expect(plan.steps.map((s) => (s.task ? `${s.type}:${s.task}` : s.type)))
          .toEqual(['clean', 'certs', 'validate-certs', 'gulp:publish']);
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
        ctx.expect(log).toEqual(['clean', 'certs', 'validate-certs', 'gulp:publish']);
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
