// Libraries
const build = require('../build.js');
const logger = build.logger('publish');
const { runPipeline } = require('../utils/build-pipeline.js');

// Publish from an already-built tree (`--local` cleans first): the ship keys the
// shipped formats need are checked first, so a runner never dies on a missing
// login, then cert validation runs STRICT, since publish puts a build in front of
// users (validate-certs.js owns which leg is strict).
function plan(options) {
  options = options || {};

  const steps = [];

  if (options.local === true) {
    steps.push({ type: 'clean' });
  }

  steps.push({ type: 'ship-keys' }, { type: 'validate-certs', strict: true }, { type: 'gulp', task: 'publish' });

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
