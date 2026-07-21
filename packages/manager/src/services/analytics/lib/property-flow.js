/**
 * Interactive GA account + property selection/creation (config-landing
 * flow): when analytics.providers.google.propertyId is missing in an
 * interactive run, pick the GA account (create-new opens the provision
 * page), then pick or create the GA4 property via the Admin API — both land
 * in omega.json5 (comment-preserving writeback). An accountId already in
 * config is used as-is without prompting — and when it arrived through the
 * COMPANY layer (company omega.json5 `analytics.providers.google.accountId`,
 * merged under the brand file so an explicit brand value always wins), the
 * flow says so with a dim note instead of silently proceeding. The
 * interactive picker stays the fallback when nothing is configured anywhere.
 */
const chalk = require('chalk').default;
const { resolveConfigValue } = require('../../../lib/config-flow.js');

const CREATE_ACCOUNT_URL = 'https://analytics.google.com/analytics/web/#/provision/create';

/**
 * Resolve (or interactively land) the GA4 property id.
 *
 * @param {Object} context - Service context
 * @param {Object} api - GoogleAnalyticsAPI client
 * @returns {Promise<string|null>} - propertyId, or null when skipped
 */
async function resolveGoogleProperty(context, api) {
  // When the account flow just ran (and the user said Yes), the property
  // selection rides that gate instead of asking "Set up now?" twice
  const configuredAccountId = context.brandConfig.analytics?.providers?.google?.accountId;
  const accountPreConfigured = Boolean(configuredAccountId);

  // Company-default GA account (Ian 2026-07-21): a company-managed brand
  // inherits the company's accountId through the merge chain — note the
  // provenance instead of prompting (an explicit brand-level accountId
  // wins in the merge before this ever runs)
  const companyAccountId = context.companyConfig?.analytics?.providers?.google?.accountId;
  if (configuredAccountId && companyAccountId && configuredAccountId === companyAccountId) {
    console.log(`    ${chalk.dim(`→ Google Analytics account ${configuredAccountId} — defaulting to company account`)}`);
  }

  const accountId = await resolveConfigValue(context, {
    path: 'analytics.providers.google.accountId',
    label: 'Google Analytics account',
    choices: () => api.listAccounts(),
    getName: (account) => `${account.displayName} (${account.name.replace('accounts/', '')})`,
    getValue: (account) => account.name.replace('accounts/', ''),
    createNew: { label: 'account', url: CREATE_ACCOUNT_URL, refreshChoices: true },
  });

  if (!accountId) {
    return null;
  }

  return resolveConfigValue(context, {
    path: 'analytics.providers.google.propertyId',
    label: 'GA4 property',
    gate: accountPreConfigured,
    choices: () => api.listProperties(accountId),
    getName: (property) => `${property.displayName} (${property.name.replace('properties/', '')})`,
    getValue: (property) => property.name.replace('properties/', ''),
    createNew: {
      label: 'property',
      handler: async () => {
        const { brand } = context.brandConfig;
        const google = context.brandConfig.analytics.providers.google;
        const domain = brand.url.replace(/^https?:\/\//, '').replace(/\/$/, '');
        const property = await api.createProperty(accountId, {
          displayName: `${brand.name} (${domain})`,
          timeZone: google.timeZone,
          currencyCode: google.currency,
        });
        return property.name.replace('properties/', '');
      },
    },
  });
}

module.exports = { resolveGoogleProperty };
