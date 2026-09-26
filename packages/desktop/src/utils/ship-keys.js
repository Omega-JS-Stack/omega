// The ship-credential check every publish runs FIRST
// ([#867](https://github.com/Omega-JS-Stack/omega/issues/867)).
//
// A format this brand DECLARES is one it means to ship, so a credential that
// format cannot publish without is a release that dies on a runner: the snap
// leg with no Snap Store login, the Windows leg with no credential for the
// signing strategy it configured. Both used to surface minutes into a build,
// or (worse) as a silently skipped target.
//
// What is owed comes from @omega.js/config's format table, narrowed to this
// brand by the env schema's own `requiredWhen` gates, so a brand that never
// mentions the snap owes nothing and a brand that writes
// `platforms.linux.formats.snap` owes the login. The refusal carries the same
// line shape push-secrets prints
// ([#891](https://github.com/Omega-JS-Stack/omega/issues/891)) and names the
// ONE walk that collects it, exactly as the extension publish does.
//
// A BUILD is not a publish: it keeps its clean skip (gulp/build-config drops
// the snap target when the login is absent), because nothing is being put in
// front of users.

const { shipPlan, missingShipKeys, shipKeyRefusal } = require('@omega.js/devkit/ship-plan');

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
  const plan = shipPlan(config, 'desktop');
  const missing = missingShipKeys(plan, options.env || process.env);

  if (missing.length > 0) {
    throw new Error(shipKeyRefusal(missing));
  }

  logger.log(`Shipping ${plan.map((entry) => `${entry.platform}/${entry.format}`).join(', ')}`);

  return plan;
}

module.exports = { assertShipKeys };
