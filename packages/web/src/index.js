/**
 * @omegajs/web — the OMEGA web framework engine core: Eleventy 3 + LiquidJS +
 * @omegajs/template-kit, promoted from the winning bake-off spike (decision
 * memo: spikes/bakeoff-shared/DECISION.md). This surface is the B1 seed —
 * the CLI (`omega dev/build/...`) arrives in B3 and consumes these same
 * entry points.
 */
const { configureOmega } = require('./engine.js');
const { buildSite } = require('./build.js');
const { buildAssets, purgeCss } = require('./assets.js');
const { collectLayered } = require('./layers.js');
const { createFrontmatterResolver } = require('./frontmatter-liquid.js');
const { permalinkOf, scanConsumerPermalinks } = require('./consumer-scan.js');
const { registerVirtualLayouts, composeSymlinkFarm } = require('./layouts.js');
const { PATHS } = require('./paths.js');

module.exports = {
  configureOmega,
  buildSite,
  buildAssets,
  purgeCss,
  collectLayered,
  createFrontmatterResolver,
  permalinkOf,
  scanConsumerPermalinks,
  registerVirtualLayouts,
  composeSymlinkFarm,
  PATHS,
};
