/**
 * @omegajs/web — the OMEGA web framework: Eleventy 3 + LiquidJS +
 * @omegajs/template-kit engine core (promoted from the winning bake-off
 * spike — decision memo: spikes/bakeoff-shared/DECISION.md) plus the `omega`
 * CLI (bin/omega → src/cli.js → src/commands/), which consumes these same
 * entry points.
 */
const { configureOmega } = require('./engine.js');
const { buildSite } = require('./build.js');
const { buildAssets, purgeCss } = require('./assets.js');
const { collectLayered } = require('./layers.js');
const { createFrontmatterResolver } = require('./frontmatter-liquid.js');
const { permalinkOf, scanConsumerPermalinks } = require('./consumer-scan.js');
const { registerVirtualLayouts, composeSymlinkFarm } = require('./layouts.js');
const { PATHS, resolveClientEntry } = require('./paths.js');
const { consumerPaths, loadSiteData } = require('./consumer.js');
const { scaffoldDefaults } = require('./scaffold.js');
const { runMigration } = require('./migrate/index.js');

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
  resolveClientEntry,
  consumerPaths,
  loadSiteData,
  scaffoldDefaults,
  runMigration,
};
