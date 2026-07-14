/**
 * Sanity checkpoint — the App Store Connect client was built in setup();
 * this prints what's configured so the run log shows which Apple account
 * the downstream operations act on.
 */
const chalk = require('chalk').default;
const { catchAgreements } = require('../lib/apple-api.js');

module.exports = catchAgreements(async (context) => {
  const { appleClient, appleSecrets } = context;

  if (!appleClient || !appleSecrets) {
    return { status: 'error', error: 'App Store Connect client not initialized' };
  }

  console.log(`      ${chalk.green('✓')} API client ready`);
  console.log(`        ${chalk.dim(`Issuer: ${appleSecrets.issuerId}`)}`);
  console.log(`        ${chalk.dim(`Team:   ${appleSecrets.teamId}`)}`);
  console.log(`        ${chalk.dim(`Key:    ${appleSecrets.keyId}`)}`);

  return {};
});
