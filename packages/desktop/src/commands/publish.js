// Libraries
const Manager = new (require('../build.js'));
const logger = Manager.logger('publish');
const { runPipeline } = require('../utils/build-pipeline.js');

// `npx omega publish` publishes from an already-built tree (the CI lane calls it
// after its own build); `--local` (the consumer's `release:local` script) cleans
// first. Both check the SHIP credentials the brand's declared formats need
// before anything else runs (#867: a declared snap with no Snap Store login is
// a release that dies on a runner, so it is refused in a second rather than in
// a build), then deliver the Apple signing artifacts (#678) and run cert
// validation before the gulp task, STRICT
// ([#891](https://github.com/Omega-JS-Stack/omega/issues/891)): publish is the
// verb that puts a build in front of users, so signing material it cannot find
// stops it here rather than shipping an app Gatekeeper refuses. What is strict
// about it is the mac leg (validate-certs.js owns that rule: a leg that cannot
// sign for mac only warns).
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
