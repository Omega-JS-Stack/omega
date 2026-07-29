// Libraries
const Manager = new (require('../build.js'));
const logger = Manager.logger('publish');
const { runPipeline } = require('../utils/build-pipeline.js');

// `npx omega publish` publishes from an already-built tree (the CI lane calls it
// after its own build); `--local` (the consumer's `release:local` script) cleans
// and re-scaffolds first. Both run cert validation before the gulp task — a
// warning gate unless `--strict` makes it fatal (validate-certs.js owns that).
function plan(options) {
  options = options || {};

  const steps = [];

  if (options.local === true) {
    steps.push({ type: 'clean' }, { type: 'setup' });
  }

  steps.push({ type: 'validate-certs' }, { type: 'gulp', task: 'publish' });

  return {
    env: { OMEGA_BUILD_MODE: 'true', OMEGA_IS_PUBLISH: 'true' },
    steps: steps,
  };
}

module.exports = async function (options) {
  logger.log('Running publish...');

  await runPipeline(plan(options), options);
};

module.exports.plan = plan;
