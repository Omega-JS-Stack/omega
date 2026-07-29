// Libraries
const Manager = new (require('../build.js'));
const logger = Manager.logger('package');
const { runPipeline } = require('../utils/build-pipeline.js');

// `npx omega package` (the consumer's `package` script) builds the full installer
// set; `--quick` (the `package:quick` script) builds only the host platform/arch.
// Quick mode also propagates to clean/setup via Manager.isQuickMode().
function plan(options) {
  options = options || {};

  const quick = options.quick === true || options.q === true;

  return {
    env: { OMEGA_BUILD_MODE: 'true' },
    steps: [
      { type: 'clean' },
      { type: 'setup' },
      { type: 'gulp', task: quick ? 'packageQuick' : 'packageBuild' },
    ],
  };
}

module.exports = async function (options) {
  logger.log('Running package...');

  await runPipeline(plan(options), options);
};

module.exports.plan = plan;
