// The ship-credential check every publish runs FIRST: a declared format with
// no credential is a release that dies on a runner. What is owed is
// @omega.js/config's missingEnvKeys for `publish` (the format table, narrowed
// by the schema's `requiredWhen`), so a brand that never mentions the snap owes
// no Snap login. The refusal names the ONE walk that collects the keys, as the
// extension publish does. A BUILD keeps its clean skip instead: it puts
// nothing in front of users.

const { missingEnvKeys } = require('@omega.js/config');
const { shipPlan, shipKeyRefusal } = require('@omega.js/devkit/ship-plan');

const build = require('../build.js');
const logger = build.logger('ship-keys');

/**
 * Refuse a publish whose declared formats have no credential to ship with.
 *
 * @param {object} [options]
 * @param {object} [options.config] - Resolved config (default: the consumer's).
 * @param {object} [options.env] - Env map (default: process.env).
 * @returns {Array<object>} The ship plan (what this brand ships).
 * @throws {Error} Naming every missing key, its declaration, and the walk.
 */
function assertShipKeys(options) {
  options = options || {};

  const config = options.config || build.getConfig();
  const env = options.env || process.env;
  const plan = shipPlan(config, 'desktop');

  const missing = missingEnvKeys(config, env, { target: 'desktop', verb: 'publish' });
  if (missing.length > 0) {
    throw new Error(shipKeyRefusal(missing));
  }

  logger.log(`Shipping ${plan.map((entry) => `${entry.platform}/${entry.format}`).join(', ')}`);

  return plan;
}

module.exports = { assertShipKeys };
