/**
 * Ensure Search Console is associated with the brand's GA4 property.
 *
 * There is NO API for this on either side (the GA Admin API supports
 * Firebase/Ads/BigQuery links but not Search Console; the Search Console API
 * can't read associations either) — so the check follows the firebase
 * OAuth-redirect pattern: instructions + warned until the link is confirmed
 * (`gaLinked` in state; the confirm prompt rides the prompting port).
 */
const chalk = require('chalk').default;

module.exports = async function ensureGaLink(context) {
  const { brandConfig, serviceData } = context;

  if (!serviceData.propertyUrl) {
    console.log(chalk.dim('      ⊘ No Search Console property yet — nothing to associate'));
    return {};
  }

  const propertyId = brandConfig.analytics?.providers?.google?.propertyId;
  if (!propertyId) {
    console.log(chalk.dim('      ⊘ No analytics.providers.google.propertyId — nothing to associate'));
    return {};
  }

  if (serviceData.gaLinked === true) {
    console.log(`      ${chalk.green('✓')} GA association confirmed`);
    return { state: { gaLinked: true } };
  }

  const associationsUrl = `https://search.google.com/search-console/settings/associations?resource_id=${encodeURIComponent(serviceData.propertyUrl)}`;

  console.log(`      ${chalk.yellow('⚠')} No API exists to check the Search Console ↔ GA association`);
  console.log(`      ${chalk.dim('→')} Associate with GA property ${chalk.cyan(propertyId)} at: ${chalk.cyan(associationsUrl)}`);
  console.log(`      ${chalk.dim('→')} (the confirmation prompt rides the prompting port)`);

  return { status: 'warned', state: { gaLinked: false }, output: { gaLink: { associationsUrl } } };
};
