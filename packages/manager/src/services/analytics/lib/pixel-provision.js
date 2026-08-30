/**
 * Shared pixel PROVISIONING for the meta-pixel/tiktok-pixel operations — the
 * create half of the pair whose check half is pixel-token.js, and the same
 * reconcile shape the GA4 side uses (#417).
 *
 * The pixel id is public config, so a configured
 * `analytics.providers.{provider}.id` is converged proof and nothing is
 * called. A missing id reconciles idempotently in ONE interactive pass
 * (Ian 2026-08-21, the GA4 near-zero-input standard): acquire the access
 * token (pixel-token.js — guidance, the Enter-gated open, paste-in), resolve
 * the ad account (pixel-account.js — auto-selected when the token sees
 * exactly one, `meta.accountId` = the Meta AD ACCOUNT, `tiktok.accountId` =
 * the TikTok ADVERTISER; the non-secret ids live in config beside
 * `google.accountId`/`propertyId`, never in .env), find the brand's pixel BY
 * NAME, create it when absent, then land the id in omega.json5
 * (comment-preserving) and in the in-memory config, so the token check in the
 * same pass reports the pixel it just made.
 *
 * The access token is still the gate. No token — nothing pasted, or a
 * non-interactive run — means no provisioning this pass: warned with the same
 * where-to-get guidance the token check prints, never a failure (Ian
 * 2026-08-21: a manage walk must not break for a key that isn't filled in).
 *
 * Tri-state (#33): `analytics.providers.{provider}: false` disables the
 * provider outright — no calls, no prompts, no warns — and every prompt this
 * flow opens offers the choice that writes it.
 *
 * Clients hand back one normalized shape: `listPixels(accountId)` →
 * `[{ id, name }]`, `createPixel(accountId, name)` → `{ id, name }`, and
 * (when the spec declares discoverAccounts) `listAdAccounts()` →
 * `[{ id, name }]`.
 */
const chalk = require('chalk').default;

const { confirmSetup, landValue, readTriState } = require('../../../lib/config-flow.js');
const { canPrompt, dryRunPlan } = require('../../../lib/run-gates.js');
const { acquirePixelToken } = require('./pixel-token.js');
const { resolvePixelAccount } = require('./pixel-account.js');

/**
 * Whether a provider has anything for the service to do: a configured id to
 * check, an account to create under, or — for a provider that can discover
 * its own account — a token in hand or an interactive run that can ask for
 * one. A disabled provider never has work.
 *
 * @param {Object} brandConfig - The merged brand config
 * @param {Object} spec - The provider spec
 * @param {Object} [options] - Run options (dryRun gates the prompt path)
 * @returns {boolean}
 */
function hasPixelWork(brandConfig, spec, options) {
  const { optedOut, value } = readTriState(brandConfig, `analytics.providers.${spec.key}`);
  if (optedOut) {
    return false;
  }

  const provider = value || {};
  if (provider.id || provider.accountId) {
    return true;
  }

  return Boolean(spec.discoverAccounts && (process.env[spec.envVar] || canPrompt(options)));
}

/**
 * Create the provider's pixel when config has no id yet.
 *
 * @param {Object} context - Handler context (carries the client at spec.apiKey)
 * @param {Object} spec - { key, label, envVar, tokenSource, tokenUrl, apiKey,
 *   accountLabel, accountGuidance, discoverAccounts, instructions }
 * @returns {Promise<Object|null>} A handler return when the pass ENDS here (the
 *   provider is disabled, no token to create with, no account to create on, or
 *   a dry-run plan), or null when the id is in hand and the token check should
 *   run.
 */
async function provisionPixel(context, spec) {
  const { brandConfig, options = {} } = context;
  const { optedOut, value } = readTriState(brandConfig, `analytics.providers.${spec.key}`);

  if (optedOut) {
    console.log(chalk.dim(`      ⊘ ${spec.label} disabled (analytics.providers.${spec.key}: false)`));
    return {};
  }

  const provider = value || {};

  // Configured id = converged; nothing configured and nothing to discover
  // with = the token check keeps its clean "not configured" skip
  if (provider.id || !hasPixelWork(brandConfig, spec, options)) {
    return null;
  }

  // Nothing configured at all: ask permission before asking for a secret —
  // the uniform gate, whose Disable lands `providers.{provider}: false`
  let gated = false;
  if (!provider.accountId && canPrompt(options)) {
    const action = await confirmSetup(context, {
      label: spec.label,
      instructions: spec.instructions,
      disablePath: `analytics.providers.${spec.key}`,
    });
    if (action !== 'yes') {
      return {};
    }
    gated = true;
  }

  // When the gate above ran, the acquire must not open the same question
  // twice; when it didn't (a configured accountId), the acquire owns it
  if (!await acquirePixelToken(context, spec, gated ? { gate: false } : {})) {
    console.log(`      ${chalk.dim('→')} ${spec.label} not created — rerun with ${chalk.cyan(spec.envVar)} set (or set ${chalk.cyan(`analytics.providers.${spec.key}: false`)} to stop asking)`);
    return { status: 'warned', reason: `${spec.label} not created — no ${spec.envVar}`, output: { [spec.key]: { pixelId: null, tokenConfigured: false } } };
  }

  const accountId = provider.accountId || await resolvePixelAccount(context, spec);
  if (!accountId) {
    return { status: 'warned', reason: `${spec.label} not created — no account resolved`, output: { [spec.key]: { pixelId: null, tokenConfigured: true } } };
  }

  const api = context[spec.apiKey];
  const name = brandConfig.brand.name;
  const configPath = `analytics.providers.${spec.key}.id`;

  const existing = await api.listPixels(accountId);
  const found = existing.find((pixel) => pixel.name === name);

  if (found) {
    console.log(`      ${chalk.green('✓')} Matched ${spec.label} ${chalk.cyan(`"${name}"`)} ${chalk.dim(`(${found.id})`)}`);
    landValue(context, configPath, found.id);
    return null;
  }

  if (options.dryRun) {
    return dryRunPlan(
      `create ${spec.label} "${name}" on ${spec.accountLabel} ${accountId}`,
      { output: { [spec.key]: { planned: 'create', name } } },
    );
  }

  const created = await api.createPixel(accountId, name);
  if (!created?.id) {
    // The create answered 200 without an id: the response shape moved and
    // landing `undefined` would poison the config — fail at the break
    throw new Error(`${spec.label} create returned no id (${JSON.stringify(created)})`);
  }

  console.log(`      ${chalk.green('✓')} Created ${spec.label} ${chalk.cyan(`"${name}"`)} ${chalk.dim(`(${created.id})`)}`);
  landValue(context, configPath, created.id);
  return null;
}

module.exports = { hasPixelWork, provisionPixel };
