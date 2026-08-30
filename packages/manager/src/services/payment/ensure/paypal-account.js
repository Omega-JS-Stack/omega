/**
 * Report PayPal app/account info.
 *
 * PayPal doesn't expose a "get my account settings" API via client
 * credentials, but the OAuth2 token response includes the app ID and the
 * auth probe resolves the environment (live vs sandbox). Proving the
 * credentials here also means later paypal operations fail loudly instead
 * of mysteriously. Pure read — dry-run is identical by construction.
 */
const chalk = require('chalk').default;

module.exports = async function ensurePayPalAccount(context) {
  const { paypalApi: api } = context;

  if (!api) {
    console.log(`      ${chalk.dim('⊘ PayPal not configured')}`);
    return {};
  }

  try {
    // Ensure we've authenticated (triggers live/sandbox detection)
    await api.getAccessToken();
  } catch (error) {
    console.log(`      ${chalk.yellow('⚠')} Could not authenticate with PayPal${chalk.dim(`: ${error.message}`)}`);
    return { status: 'warned', reason: 'could not authenticate with PayPal', output: { paypalAccount: { authenticated: false, error: error.message } } };
  }

  const info = api.getAccountInfo();
  const envColor = info.environment === 'live' ? chalk.green : chalk.yellow;

  console.log(`      environment: ${envColor(info.environment)}`);
  console.log(`      app ID: ${chalk.cyan(info.appId || '(unknown)')}`);
  console.log(`      client ID: ${chalk.dim(info.clientId.slice(0, 12) + '...')}`);

  return { output: { paypalAccount: { authenticated: true, environment: info.environment, appId: info.appId } } };
};
