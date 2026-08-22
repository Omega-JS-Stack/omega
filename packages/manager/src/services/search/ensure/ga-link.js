/**
 * Ensure Search Console is associated with the brand's GA4 property.
 *
 * There is NO API for this on either side (the GA Admin API supports
 * Firebase/Ads/BigQuery links but not Search Console; the Search Console API
 * can't read associations either) — so the check follows the firebase
 * OAuth-redirect pattern: instructions + interactive confirm, warned until
 * the link is confirmed. A confirmation nothing can re-check is the one kind
 * of reconcile flag config keeps (#434): it lands at
 * `search.providers.searchConsole.gaLinked`, so the next run believes it.
 */
const chalk = require('chalk').default;
const { confirm, pressEnterToOpen } = require('@omega.js/devkit/prompt');
const { writeBrandConfig } = require('../../../lib/config-write.js');
const { canPrompt } = require('../../../lib/run-gates.js');

const CONFIG_PATH = 'search.providers.searchConsole.gaLinked';

module.exports = async function ensureGaLink(context) {
  const { brandConfig, serviceData, options = {} } = context;

  if (!serviceData.propertyUrl) {
    console.log(chalk.dim('      ⊘ No Search Console property yet — nothing to associate'));
    return {};
  }

  const propertyId = brandConfig.analytics?.providers?.google?.propertyId;
  if (!propertyId) {
    console.log(chalk.dim('      ⊘ No analytics.providers.google.propertyId — nothing to associate'));
    return {};
  }

  if (brandConfig.search?.providers?.searchConsole?.gaLinked === true) {
    console.log(`      ${chalk.green('✓')} GA association confirmed`);
    return {};
  }

  const associationsUrl = `https://search.google.com/search-console/settings/associations?resource_id=${encodeURIComponent(serviceData.propertyUrl)}`;

  console.log(`      ${chalk.yellow('⚠')} No API exists to check the Search Console ↔ GA association`);
  console.log(`      ${chalk.dim('→')} Associate with GA property ${chalk.cyan(propertyId)} on the associations page`);

  if (canPrompt(options)) {
    await pressEnterToOpen(associationsUrl, 'the Search Console associations page');
    const done = await confirm({ message: `Search Console associated with GA property ${propertyId}?`, default: false });
    if (done) {
      writeBrandConfig(context, { [CONFIG_PATH]: true });
      console.log(`      ${chalk.green('✓')} GA association confirmed`);
      return {};
    }
  } else {
    console.log(`      ${chalk.dim('→')} ${chalk.cyan(associationsUrl)}`);
    console.log(`      ${chalk.dim('→')} (rerun in an interactive terminal to confirm)`);
  }

  return { status: 'warned', output: { gaLink: { associationsUrl } } };
};
