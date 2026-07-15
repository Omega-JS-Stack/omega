/**
 * `omega purge` — purge the site's Cloudflare zone cache (purge_everything).
 * The UJM `uj cloudflare-purge` successor, hitting the Cloudflare API
 * directly with the brand's own CLOUDFLARE_TOKEN (env cascade). Also runs
 * automatically after `omega deploy --direct`, and the scaffolded CI
 * workflow runs it after the gh-pages publish when the repo has the token
 * secret. `--dry-run` resolves the zone and prints the plan.
 */
const Logger = require('@omega.js/devkit/logger');
const { consumerPaths, loadSiteData } = require('../consumer.js');
const { purgeZoneCache } = require('../purge.js');

const logger = new Logger('omega:purge');

module.exports = async function (options) {
  options = options || {};
  const paths = consumerPaths();
  const config = loadSiteData(paths.root);

  const result = await purgeZoneCache({ config, dryRun: Boolean(options.dryRun) });

  if (result.status === 'skipped') {
    logger.log(`Purge skipped — ${result.reason}`);
  } else if (result.status === 'planned') {
    logger.log(`[dry-run] Would purge Cloudflare zone ${result.zoneName || result.zone} (purge_everything)`);
  } else {
    logger.log(`Cloudflare cache purged (zone ${result.zoneName || result.zone})`);
  }

  return result;
};
