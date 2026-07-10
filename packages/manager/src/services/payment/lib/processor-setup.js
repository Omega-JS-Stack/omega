/**
 * Interactive payment-processor credential entry (config-landing flows):
 * when a processor is enabled but its credentials are missing, open the
 * processor dashboard and take the keys — public halves (publishable key,
 * client id, site) land in omega.json5 via the comment-preserving
 * writeback; secret halves land in the brand .env (replace-or-append) AND
 * in process.env so the current run proceeds immediately. A Disable answer
 * writes `payment.processors.<name>: false` so the run stops asking.
 *
 * Non-interactive or dry-run sessions return null without prompting — the
 * processor stays unconfigured and its operations print their dim note.
 */
const chalk = require('chalk').default;
const { input, select, isInteractive } = require('@omega.js/devkit/prompt');
const { openBrowser } = require('@omega.js/devkit/flows');
const { writeBrandConfig } = require('../../../lib/config-write.js');
const { setAtPath } = require('../../../lib/config-flow.js');
const { writeEnvValue } = require('../../../lib/env-secret.js');

const PROCESSORS = {
  stripe: {
    label: 'Stripe',
    url: 'https://dashboard.stripe.com/apikeys',
    instructions: 'Create or switch to the brand\'s Stripe account, then go to Developers → API keys.',
    fields: [
      {
        message: 'Stripe publishable key (pk_live_... or pk_test_...):',
        validate: (val) => (val?.trim().startsWith('pk_') ? true : 'Must start with pk_live_ or pk_test_'),
        configPath: 'payment.processors.stripe.publishableKey',
      },
      {
        message: 'Stripe secret key (sk_live_... or sk_test_...):',
        validate: (val) => (val?.trim().startsWith('sk_') ? true : 'Must start with sk_live_ or sk_test_'),
        envName: 'STRIPE_SECRET_KEY',
      },
    ],
  },
  paypal: {
    label: 'PayPal',
    url: 'https://developer.paypal.com/dashboard/applications',
    instructions: 'Create or open the brand\'s REST API app (live), then copy its credentials.',
    fields: [
      {
        message: 'PayPal client ID:',
        validate: (val) => (val?.trim() ? true : 'Required'),
        configPath: 'payment.processors.paypal.clientId',
      },
      {
        message: 'PayPal client secret:',
        validate: (val) => (val?.trim() ? true : 'Required'),
        envName: 'PAYPAL_CLIENT_SECRET',
      },
    ],
  },
  chargebee: {
    label: 'Chargebee',
    url: 'https://app.chargebee.com/',
    instructions: 'Open the brand\'s Chargebee site, then go to Settings → API keys.',
    fields: [
      {
        message: 'Chargebee site (the {site}.chargebee.com subdomain):',
        validate: (val) => (val?.trim() ? true : 'Required'),
        configPath: 'payment.processors.chargebee.site',
      },
      {
        message: 'Chargebee API key:',
        validate: (val) => (val?.trim() ? true : 'Required'),
        envName: 'CHARGEBEE_API_KEY',
      },
    ],
  },
};

/**
 * Run the credential-entry flow for one processor. Returns true when
 * credentials were landed (config + .env + process.env), false otherwise.
 *
 * @param {Object} context - Service context (brandConfig, brandRoot, options)
 * @param {string} name - 'stripe' | 'paypal' | 'chargebee'
 */
async function processorSetupFlow(context, name) {
  if (!isInteractive() || context.options?.dryRun) {
    return false;
  }

  const processor = PROCESSORS[name];
  const brandName = context.brandConfig.brand?.name || context.brandId;

  console.log(`    ${chalk.yellow('!')} ${processor.label} not configured for ${chalk.cyan(brandName)}`);
  console.log(`        ${processor.instructions}`);
  console.log(`        URL: ${chalk.cyan(processor.url)}`);

  const action = await select({
    message: 'Set up now?',
    choices: [
      { name: 'Yes', value: 'yes' },
      { name: 'Skip for now', value: 'skip' },
      { name: 'Disable (stop prompting)', value: 'disable' },
    ],
    default: 'yes',
  });

  if (action === 'skip') {
    return false;
  }

  if (action === 'disable') {
    const disablePath = `payment.processors.${name}`;
    writeBrandConfig(context, { [disablePath]: false });
    setAtPath(context.brandConfig, disablePath, false);
    console.log(`    ${chalk.yellow('!')} ${processor.label} disabled in omega.json5`);
    return false;
  }

  await openBrowser(processor.url);

  const configEdits = {};
  for (const field of processor.fields) {
    const value = (await input({ message: field.message, validate: field.validate })).trim();

    if (field.configPath) {
      configEdits[field.configPath] = value;
      setAtPath(context.brandConfig, field.configPath, value);
    } else {
      writeEnvValue(context.brandRoot, field.envName, value);
      process.env[field.envName] = value;
      console.log(`    ${chalk.green('✓')} ${field.envName} saved to the brand .env`);
    }
  }

  writeBrandConfig(context, configEdits);
  return true;
}

module.exports = { processorSetupFlow };
