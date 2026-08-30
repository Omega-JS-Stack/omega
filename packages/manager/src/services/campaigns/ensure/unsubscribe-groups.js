/**
 * Ensure the SendGrid unsubscribe groups (ASM) @omega.js/backend sends through
 * exist, and land their ids in config.
 *
 * The KEYS come from @omega.js/backend's email SSOT — its send path names a
 * group by key — and the recipient-facing name + description of each live
 * HERE, the provider side. Groups are matched by NAME, never by id: ASM ids
 * are per SendGrid ACCOUNT, so sibling brands sharing one account converge on
 * the same seven groups and land the same ids.
 *
 * Each resolved id is written into omega.json5 at
 * marketing.campaigns.providers.sendgrid.groups.<key>, its ONE authoritative
 * home (comment-preserving) — @omega.js/backend reads it there and fails loudly
 * at send time when one is missing
 * ([#649](https://github.com/Omega-JS-Stack/omega/issues/649)).
 */
const chalk = require('chalk').default;
const { BEM_GROUP_KEYS } = require('../../../lib/backend-marketing.js');
const { writeBrandConfig } = require('../../../lib/config-write.js');
const { dryRunPlan } = require('../../../lib/run-gates.js');

// The recipient-facing group name + description, one row per @omega.js/backend
// group key. Brand-neutral on purpose: the NAME is the match key, so two
// brands on one SendGrid account resolve the same group instead of each
// creating their own.
const GROUP_DEFINITIONS = {
  orders: {
    name: 'OMEGA - Order Updates',
    description: 'Receipts, renewals, refunds, and changes to your plan.',
  },
  hello: {
    name: 'OMEGA - Onboarding',
    description: 'Welcome emails and getting-started tips for your first weeks.',
  },
  account: {
    name: 'OMEGA - Account',
    description: 'Account actions you asked for: deletions, data requests, and confirmations.',
  },
  marketing: {
    name: 'OMEGA - Marketing & Promotions',
    description: 'Offers, discounts, product news, and reminders.',
  },
  security: {
    name: 'OMEGA - Security',
    description: 'Password resets, sign-in codes, and security alerts.',
  },
  newsletter: {
    name: 'OMEGA - Newsletter',
    description: 'The regular newsletter: feature announcements and industry news.',
  },
  internal: {
    name: 'OMEGA - Internal Alerts',
    description: 'Operational alerts sent to the team.',
  },
};

module.exports = async function ensureUnsubscribeGroups(context) {
  const { sendgridApi: api, options = {} } = context;

  // A key @omega.js/backend added without a row here would send through a group
  // this service never provisions — loud, at the top, not at send time.
  const undefinedKeys = BEM_GROUP_KEYS.filter((key) => !GROUP_DEFINITIONS[key]);
  if (undefinedKeys.length > 0) {
    throw new Error(`@omega.js/backend group key(s) with no name+description row here: ${undefinedKeys.join(', ')}`);
  }

  const existing = await api.getUnsubscribeGroups();
  const existingByName = Object.fromEntries(existing.map((group) => [group.name, group]));

  const missing = BEM_GROUP_KEYS.filter((key) => !existingByName[GROUP_DEFINITIONS[key].name]);

  if (missing.length > 0 && options.dryRun) {
    return dryRunPlan(
      `create ${missing.length} unsubscribe group(s): ${missing.map((key) => GROUP_DEFINITIONS[key].name).join(', ')}`,
      { output: { unsubscribeGroups: { planned: { create: missing.map((key) => GROUP_DEFINITIONS[key].name) } } } },
    );
  }

  const ids = {};

  for (const key of BEM_GROUP_KEYS) {
    const { name, description } = GROUP_DEFINITIONS[key];
    const found = existingByName[name];

    if (found) {
      ids[key] = found.id;
      continue;
    }

    const created = await api.createUnsubscribeGroup(name, description);
    console.log(`      ${chalk.green('✓')} Created group ${chalk.cyan(`"${name}"`)} ${chalk.dim(`(${created.id})`)}`);
    ids[key] = created.id;
  }

  if (missing.length === 0) {
    console.log(`      ${chalk.green('✓')} All ${BEM_GROUP_KEYS.length} unsubscribe groups exist`);
  }

  // Already-equal ids are skipped by the editor, so a converged brand leaves
  // omega.json5 byte-identical.
  const written = writeBrandConfig(context, Object.fromEntries(
    BEM_GROUP_KEYS.map((key) => [`marketing.campaigns.providers.sendgrid.groups.${key}`, ids[key]]),
  ));

  return {
    output: {
      unsubscribeGroups: {
        total: BEM_GROUP_KEYS.length,
        created: missing.length,
        written: written.length,
      },
    },
  };
};

module.exports.GROUP_DEFINITIONS = GROUP_DEFINITIONS;
