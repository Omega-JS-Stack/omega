/**
 * Interactive payment-provider credential entry — one provider's instance of
 * the shared setup contract (#608): the same Provide / Skip / Disable gate
 * every service opens with (lib/config-flow.js confirmSetup, the ONE home of
 * that wording), then the provider dashboard and its keys. Public halves
 * (publishable key, client id, site) land in omega.json5 via the
 * comment-preserving writeback — a provider with no public half declares none
 * (coinbase, whose API key is the whole credential) — and the SECRET half rides
 * the shared helper
 * (lib/service-input.js), which persists it to the brand .env and exports it
 * so the current run proceeds immediately. Disable writes
 * `payment.providers.<name>: false` so the run stops asking — permanently.
 *
 * Non-interactive or dry-run sessions return false without prompting — the
 * provider stays unconfigured and its operations print their dim note.
 */
const chalk = require('chalk').default;
const { input } = require('@omega.js/devkit/prompt');
const { serviceInputSpec } = require('../../../config.js');
const { writeBrandConfig } = require('../../../lib/config-write.js');
const { confirmSetup, setAtPath } = require('../../../lib/config-flow.js');
const { requestServiceInput } = require('../../../lib/service-input.js');
const { canPrompt } = require('../../../lib/run-gates.js');

// Per provider: the dashboard to open, and the PUBLIC halves that land in
// omega.json5. The secret half's descriptor (name, mint URL, hint) lives once,
// in the REQUIRES registry — never re-spelled here.
const PROVIDERS = {
  stripe: {
    label: 'Stripe',
    url: 'https://dashboard.stripe.com/apikeys',
    instructions: 'Create or switch to the brand\'s Stripe account, then go to Developers → API keys.',
    secret: 'STRIPE_SECRET_KEY',
    fields: [
      {
        message: 'Stripe publishable key (pk_live_... or pk_test_...):',
        validate: (val) => (val?.trim().startsWith('pk_') ? true : 'Must start with pk_live_ or pk_test_'),
        configPath: 'payment.providers.stripe.publishableKey',
      },
    ],
  },
  paypal: {
    label: 'PayPal',
    url: 'https://developer.paypal.com/dashboard/applications',
    instructions: 'Create or open the brand\'s REST API app (live), then copy its credentials.',
    secret: 'PAYPAL_CLIENT_SECRET',
    fields: [
      {
        message: 'PayPal client ID:',
        validate: (val) => (val?.trim() ? true : 'Required'),
        configPath: 'payment.providers.paypal.clientId',
      },
    ],
  },
  chargebee: {
    label: 'Chargebee',
    url: 'https://app.chargebee.com/',
    instructions: 'Open the brand\'s Chargebee site, then go to Settings → API keys.',
    secret: 'CHARGEBEE_API_KEY',
    fields: [
      {
        message: 'Chargebee site (the {site}.chargebee.com subdomain):',
        validate: (val) => (val?.trim() ? true : 'Required'),
        configPath: 'payment.providers.chargebee.site',
      },
    ],
  },
  // The one provider with NO public half ([#642](https://github.com/Omega-JS-Stack/omega/issues/642)):
  // the Coinbase Commerce API key is the entire credential, so `fields` is empty
  // and nothing is written to omega.json5 — the gate and the secret ask are the
  // whole flow. Its Disable therefore lands on `enabled`, the switch the schema
  // declares and the checkout reads, rather than on the provider block the
  // siblings turn off.
  coinbase: {
    label: 'Coinbase Commerce',
    url: 'https://commerce.coinbase.com/settings/security',
    instructions: 'Open the brand\'s Coinbase Commerce account, then go to Settings → Security → API keys.',
    secret: 'COINBASE_COMMERCE_API_KEY',
    disablePath: 'payment.providers.coinbase.enabled',
    fields: [],
  },
};

/**
 * Run the credential-entry flow for one provider. Returns true when
 * credentials were landed (config + .env + process.env), false otherwise.
 *
 * @param {Object} context - Service context (brandConfig, brandRoot, options)
 * @param {string} name - 'stripe' | 'paypal' | 'chargebee' | 'coinbase'
 */
async function providerSetupFlow(context, name) {
  if (!canPrompt(context.options)) {
    return false;
  }

  const provider = PROVIDERS[name];
  // Where Disable lands `false`. The provider BLOCK is the switch for the ones
  // whose public data enables them; a provider carrying its own switch names it
  // (coinbase's `enabled`, #642), so the off state is the one shape the schema
  // declares and every reader already gates on.
  const disablePath = provider.disablePath || `payment.providers.${name}`;

  // The uniform gate — Disable lands `payment.providers.<name>: false`
  const action = await confirmSetup(context, {
    label: provider.label,
    instructions: [provider.instructions, `URL: ${chalk.cyan(provider.url)}`],
    disablePath,
  });
  if (action !== 'yes') {
    return false;
  }

  // The public halves land in omega.json5; the dashboard is opened by the
  // secret ask below (Enter-gated, the house rule) — one page, both keys.
  const configEdits = {};
  for (const field of provider.fields) {
    const value = (await input({ message: field.message, validate: field.validate })).trim();
    configEdits[field.configPath] = value;
    setAtPath(context.brandConfig, field.configPath, value);
  }
  writeBrandConfig(context, configEdits);

  // The secret half through the shared helper — the gate already ran, so it
  // goes straight to the guided paste, the brand .env, and process.env
  const gate = await requestServiceInput(context, serviceInputSpec('payment', {
    names: [provider.secret],
    label: provider.label,
    gate: false,
  }));

  return gate === null;
}

module.exports = { providerSetupFlow };
