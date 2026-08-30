/**
 * Validate Chargebee API access and report site info.
 *
 * A lightweight read (list item families, limit 1) proves the site is
 * reachable and CHARGEBEE_API_KEY works before the webhook/products
 * operations rely on it. Pure read — dry-run is identical by construction.
 */
const chalk = require('chalk').default;

module.exports = async function ensureChargebeeAccount(context) {
  const { chargebeeApi: api } = context;

  if (!api) {
    console.log(`      ${chalk.dim('⊘ Chargebee not configured')}`);
    return {};
  }

  try {
    await api.makeRequest('GET', '/item_families', { limit: 1 });
  } catch (error) {
    console.log(`      ${chalk.yellow('⚠')} Could not connect to Chargebee${chalk.dim(`: ${error.message}`)}`);
    return { status: 'warned', reason: 'could not connect to Chargebee', output: { chargebeeAccount: { connected: false, error: error.message } } };
  }

  console.log(`      site: ${chalk.cyan(api.site)}`);
  console.log(`      url: ${chalk.dim(`https://${api.site}.chargebee.com`)}`);
  console.log(`      API: ${chalk.green('connected')}`);

  return { output: { chargebeeAccount: { connected: true, site: api.site } } };
};
