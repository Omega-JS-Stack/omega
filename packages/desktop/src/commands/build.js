// Libraries
const Manager = new (require('../build.js'));
const logger = Manager.logger('build');
const { runPipeline } = require('../utils/build-pipeline.js');
const { ensureTarget } = require('./lib/ensure-target.js');

// The consumer's `build` script is `npx omega build` — this verb owns the
// pipeline and the build-mode flag; it must never shell back to that script.
// `certs` delivers the Apple artifacts first (#678).
function plan() {
  return {
    env: { OMEGA_BUILD_MODE: 'true' },
    steps: [
      { type: 'clean' },
      { type: 'certs' },
      { type: 'gulp', task: 'build' },
    ],
  };
}

module.exports = async function (options) {
  logger.log('Running production build...');

  // The local scaffold BEFORE the pipeline (#675): the gulp `defaults` task
  // ensures too, but gulp itself is one of the peer deps the ensure installs,
  // so a fresh consumer outside any node_modules hoist never reaches it.
  await ensureTarget({ log: (line) => logger.log(line), warn: (line) => logger.warn(line) });

  await runPipeline(plan(options), options);
};

module.exports.plan = plan;
