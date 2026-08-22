/**
 * Ad-account discovery for the pixel provisioning path (#417, Ian
 * 2026-08-21: "auto-set accountId") — the near-zero-input half of the GA4
 * standard, applied to the pixels.
 *
 * The token already names the accounts it can act on, so a brand should
 * never have to look one up: with `analytics.providers.{provider}.accountId`
 * missing, ask the platform which accounts this token sees. Exactly one is
 * the answer (auto-selected, landed in omega.json5 — nothing to ask);
 * several is a real choice (the standard selection flow, with the tri-state
 * opt-out in the list); non-interactive runs print the candidates so the
 * value can be pasted into config, and zero means the token has no ad-account
 * access at all — guidance, never a failure.
 *
 * Only providers whose client can enumerate accounts take this path
 * (spec.discoverAccounts); the others keep the configured-accountId gate.
 */
const chalk = require('chalk').default;

const { landValue, resolveConfigValue } = require('../../../lib/config-flow.js');
const { canPrompt, dryRunPlan } = require('../../../lib/run-gates.js');

/**
 * Resolve the ad account the pixel gets created on, landing it in config.
 *
 * @param {Object} context - Handler context (carries the client at spec.apiKey)
 * @param {Object} spec - { key, label, envVar, apiKey, accountLabel, accountGuidance }
 * @returns {Promise<string|null>} - The account id, or null when unresolved
 */
async function resolvePixelAccount(context, spec) {
  const { options = {} } = context;
  const path = `analytics.providers.${spec.key}.accountId`;
  const accounts = await context[spec.apiKey].listAdAccounts();

  if (accounts.length === 0) {
    console.log(`      ${chalk.yellow('⚠')} No ${spec.accountLabel}s are visible to ${chalk.cyan(spec.envVar)}`);
    console.log(`      ${chalk.dim('→')} ${spec.accountGuidance}`);
    return null;
  }

  if (accounts.length === 1) {
    const [only] = accounts;
    const display = `${only.name} (${only.id})`;

    if (options.dryRun) {
      dryRunPlan(`set ${path} to ${only.id} (the only ${spec.accountLabel} ${spec.envVar} can see)`);
      return only.id;
    }

    console.log(`      ${chalk.green('✓')} ${spec.label} ${spec.accountLabel}: ${chalk.cyan(display)} ${chalk.dim(`— the only one ${spec.envVar} can see`)}`);
    landValue(context, path, only.id);
    return only.id;
  }

  if (!canPrompt(options)) {
    console.log(`      ${chalk.yellow('⚠')} ${accounts.length} ${spec.accountLabel}s visible — set ${chalk.cyan(path)} in omega.json5 (or rerun interactively to pick):`);
    for (const account of accounts) {
      console.log(`        ${chalk.dim('·')} ${account.name} ${chalk.dim(`(${account.id})`)}`);
    }
    return null;
  }

  // Several: the standard selection flow — brand matches sort first, and the
  // inline opt-out lands `analytics.providers.{provider}: false`
  return resolveConfigValue(context, {
    path,
    label: `${spec.label} ${spec.accountLabel}`,
    message: `Select the ${spec.accountLabel} for ${spec.label}:`,
    gate: false, // the provisioning flow already asked
    choices: () => accounts,
    getName: (account) => `${account.name} (${account.id})`,
    getValue: (account) => account.id,
    optOut: { label: `No ${spec.label} — don't ask again` },
    disablePath: `analytics.providers.${spec.key}`,
  });
}

module.exports = { resolvePixelAccount };
