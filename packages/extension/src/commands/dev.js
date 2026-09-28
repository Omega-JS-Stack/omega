// Libraries
const build = require('../build.js');
const logger = build.logger('dev');
const { runPlan } = require('./build.js');

// The local dev loop the target's `start` script runs: clean (which runs the
// local scaffold), then the gulp default task, serve then the watched build. The
// `--` flags it was given ride to the gulp lane (`--debug`).
function plan(options, argv = process.argv.slice(2)) {
  return {
    env: {},
    steps: [
      { type: 'clean' },
      { type: 'gulp', task: 'default', args: argv.filter((arg) => arg.startsWith('--')) },
    ],
  };
}

module.exports = async function (options) {
  logger.log('Starting the dev loop...');

  await runPlan(plan(options), options);
};

module.exports.plan = plan;
