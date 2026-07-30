/**
 * Webpack loader form of the `@dev-only` strip (#18).
 *
 * Unconditional: the lane that registers it decides WHEN — desktop adds the
 * rule only to its production configs. Extension keeps its own thin wrapper
 * because it gates on OMEGA_BUILD_MODE from inside the loader.
 */

const { stripDevBlocks } = require('./strip-dev-blocks.js');

module.exports = function stripDevBlocksLoader(source) {
  return stripDevBlocks(source);
};
