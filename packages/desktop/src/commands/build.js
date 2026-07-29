// Libraries
const Manager = new (require('../build.js'));
const logger = Manager.logger('build');
const { runPipeline } = require('../utils/build-pipeline.js');

// The consumer's `build` script is `npx omega build` — this verb owns the
// pipeline and the build-mode flag; it must never shell back to that script.
function plan() {
  return {
    env: { OMEGA_BUILD_MODE: 'true' },
    steps: [
      { type: 'clean' },
      { type: 'setup' },
      { type: 'gulp', task: 'build' },
    ],
  };
}

module.exports = async function (options) {
  logger.log('Running production build...');

  await runPipeline(plan(options), options);
};

module.exports.plan = plan;
