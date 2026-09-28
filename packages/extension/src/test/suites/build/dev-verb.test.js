// Build-layer tests for the `dev` verb, what the target's `start` script runs:
// clean, then the gulp default task (serve, then the watch build), with the
// `--` flags it was given forwarded to the gulp lane. No build-mode flag, and
// never a shell-out back to `npm start` (that script IS this verb).

const path = require('path');
const fs   = require('fs');
const defineCases = require('@omega.js/devkit/test/define-cases');

const SRC          = path.join(__dirname, '..', '..', '..');
const COMMANDS_DIR = path.join(SRC, 'commands');

const build = require(path.join(COMMANDS_DIR, 'build.js'));
const dev   = require(path.join(COMMANDS_DIR, 'dev.js'));

const stepsOf = (plan) => plan.steps.map((s) => (s.task ? `${s.type}:${s.task}` : s.type));

module.exports = defineCases({
  type: 'suite',
  layer: 'build',
  description: 'dev verb: clean, then the gulp default task',
  tests: [
    {
      name: 'dev: clean → gulp default, no build-mode flag',
      run: (ctx) => {
        const plan = dev.plan({}, []);
        ctx.expect(stepsOf(plan)).toEqual(['clean', 'gulp:default']);
        ctx.expect(plan.env.OMEGA_BUILD_MODE).toBe(undefined);
      },
    },
    {
      name: 'dev forwards its `--` flags to the gulp lane (`npm start -- --debug`)',
      run: (ctx) => {
        const plan = dev.plan({}, ['dev', '--debug', 'stray']);
        ctx.expect(plan.steps[1].args).toEqual(['--debug']);
        ctx.expect(build.gulpCommand('default', plan.steps[1].args)).toBe('npm run gulp -- default --debug');
      },
    },
    {
      name: 'runPlan runs the dev plan in order and leaves the build-mode flag unset',
      run: async (ctx) => {
        const log = [];
        const record = (type) => (options, step) => { log.push(step.task ? `${type}:${step.task}` : type); };
        const previous = process.env.OMEGA_BUILD_MODE;
        delete process.env.OMEGA_BUILD_MODE;
        try {
          await build.runPlan(dev.plan({}, []), {}, { clean: record('clean'), gulp: record('gulp') });
          ctx.expect(process.env.OMEGA_BUILD_MODE).toBe(undefined);
        } finally {
          if (previous !== undefined) process.env.OMEGA_BUILD_MODE = previous;
        }
        ctx.expect(log).toEqual(['clean', 'gulp:default']);
      },
    },
    {
      name: 'the CLI answers dev and its aliases, and the verb never shells back to `npm start`',
      run: (ctx) => {
        const { aliases } = require(path.join(SRC, 'cli.js')).config;
        ctx.expect(aliases.dev).toEqual(['serve', 'start', '--dev']);

        const source = fs.readFileSync(path.join(COMMANDS_DIR, 'dev.js'), 'utf8')
          .replace(/\/\/[^\n]*/g, '')
          .replace(/\/\*[\s\S]*?\*\//g, '');
        ctx.expect(/npm (run )?start/.test(source)).toBe(false);
      },
    },
  ],
});
