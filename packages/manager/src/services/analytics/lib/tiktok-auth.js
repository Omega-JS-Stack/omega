/**
 * TikTok pixel authorization (#448, Ian 2026-08-21) — the ONE pass that puts
 * a TikTok Events API token in a brand's hands, as an instance of the shared
 * setup contract (#608, lib/service-input.js): ask when needed, never demand
 * a standing key.
 *
 * Meta's token is minted in a dashboard and pasted, so it rides the generic
 * paste lane. TikTok's is minted by an OAuth exchange, so its acquire is its
 * own flow — and the app secret is a MINT-TIME credential, not a standing one:
 *
 *   1. the app id is public config (`analytics.providers.tiktok.appId`);
 *   2. the app secret is pasted ONCE, masked, and never persisted anywhere;
 *   3. the portal authorization is OFFERED (Enter-gated open, house rule: ask
 *      permission, never auto-open) and the `auth_code` it lands is pasted back;
 *   4. the exchange runs inline;
 *   5. ONLY the long-lived TIKTOK_ACCESS_TOKEN reaches the brand .env — the
 *      name @omega.js/backend reads.
 *
 * A re-authorization asks for the secret again (a company-level home for it is
 * #446). Nothing here ever fails a walk: a headless run, a declined gate, an
 * empty paste, or a rejected exchange all return false, and the caller keeps
 * its warned where-to-get guidance.
 */
const chalk = require('chalk').default;

const { writeEnvValue } = require('../../../lib/env-secret.js');
const { canPrompt } = require('../../../lib/run-gates.js');
const { confirmSetup, resolveConfigValue } = require('../../../lib/config-flow.js');
const { exchangeAuthCode, TIKTOK_APP_URL, TIKTOK_APPS_URL, TIKTOK_AUTH_BASE, isAuthUrlFor, parseAuthCode } = require('./tiktok-api.js');

/**
 * Put a long-lived TikTok access token in the environment, walking the portal
 * authorization when the run can ask.
 *
 * @param {Object} context - Handler context ({ brandRoot, brandConfig, options };
 *   `tiktokExchange` is the test seam that replaces the live exchange).
 * @param {Object} spec - The TikTok pixel spec (envVar, label, key).
 * @param {Object} [options]
 * @param {boolean} [options.gate] - false = the caller already ran the
 *   Provide / Skip / Disable gate for this provider.
 * @param {Object} [options.prompt] - Test seam over devkit/prompt members.
 * @returns {Promise<boolean>} Whether the token is now in process.env.
 */
async function acquireTikTokToken(context, spec, options = {}) {
  const { brandRoot, brandConfig, options: runOptions = {} } = context;

  if (process.env[spec.envVar]) {
    return true;
  }

  if (!canPrompt(runOptions)) {
    return false;
  }

  const provider = brandConfig.analytics?.providers?.[spec.key] || {};

  // Whether this flow's Provide / Skip / Disable gate has already been opened.
  let gated = options.gate === false;

  let appId = provider.appId;
  if (!appId) {
    // The app id is the developer app's — public config, so it is ASKED for
    // right here (#635) rather than warned about, and the mint continues into
    // the same pass on the id just entered.
    console.log(`      ${chalk.dim('Create a TikTok developer app, then copy its App ID from the app\'s Basic Information')}`);
    appId = await resolveConfigValue(context, {
      path: `analytics.providers.${spec.key}.appId`,
      label: 'TikTok developer app id',
      instructions: [
        '1. The next step opens the TikTok developer portal',
        '2. Create (or open) the app, then paste back its App ID',
        `3. The authorization and the exchange run here and only the long-lived token is saved (${chalk.cyan(spec.envVar)})`,
      ],
      entry: { url: TIKTOK_APPS_URL, message: 'Paste the TikTok developer app id:' },
      disablePath: `analytics.providers.${spec.key}`,
      ...(gated ? { gate: false } : {}),
    });
    if (!appId) {
      // Skipped, disabled, or headless — the caller keeps its guidance
      return false;
    }
    // That ask WAS this flow's gate: asking again for the same setup would
    // put the same question twice in one pass.
    gated = true;
  }

  if (!gated) {
    const action = await confirmSetup(context, {
      label: spec.label,
      instructions: [
        '1. The next step opens your app\'s page in the TikTok developer portal: paste its secret, then its "Advertiser authorization URL"',
        '2. That URL opens next: approve the advertiser account, then paste back the redirect URL (it carries the auth_code)',
        `3. The exchange runs here and only the long-lived token is saved (${chalk.cyan(spec.envVar)})`,
      ],
      disablePath: `analytics.providers.${spec.key}`,
    });
    if (action !== 'yes') {
      return false;
    }
  }

  const prompt = { ...require('@omega.js/devkit/prompt'), ...options.prompt };

  // The app page shows the "Advertiser authorization URL" TikTok built for the
  // app (app id, state, and the redirect URI configured ON the app). The secret
  // lives there too, so the page opens FIRST; the link is pasted back here, so
  // it is never wrong and never stored (Ian 2026-08-27).
  await prompt.pressEnterToOpen(
    TIKTOK_APP_URL(appId),
    `the ${spec.label} app page`,
  );

  // Mint-time only: masked, held in a local, never written to .env or config
  const secret = (await prompt.password({ message: 'TikTok app secret (used once, never saved):' }) || '').trim();
  if (!secret) {
    return false;
  }

  const authUrl = (await prompt.input({ message: 'Paste the "Advertiser authorization URL" from the app page:' }) || '').trim();
  if (!authUrl) {
    return false;
  }
  if (!isAuthUrlFor(authUrl, appId)) {
    console.log(`      ${chalk.yellow('⚠')} That is not the authorization URL for app ${chalk.cyan(appId)} ${chalk.dim(`(expected ${TIKTOK_AUTH_BASE}?app_id=${appId}&…)`)}`);
    return false;
  }

  await prompt.pressEnterToOpen(authUrl, `the ${spec.label} authorization portal`);

  const authCode = parseAuthCode((await prompt.input({ message: 'Paste the redirect URL (or just the auth_code):' }) || '').trim());
  if (!authCode) {
    return false;
  }

  const exchange = context.tiktokExchange || ((params) => exchangeAuthCode(params));

  let token;
  try {
    token = await exchange({ appId, secret, authCode });
  } catch (error) {
    // A rejected exchange is a normal outcome of a stale/mistyped code — the
    // caller's guidance stands and the manage walk continues
    console.log(`      ${chalk.yellow('⚠')} TikTok token exchange failed${chalk.dim(`: ${error.message}`)}`);
    return false;
  }

  writeEnvValue(brandRoot, spec.envVar, token);
  process.env[spec.envVar] = token;
  console.log(`      ${chalk.green('✓')} ${spec.envVar} minted and saved to the brand .env`);
  return true;
}

module.exports = { acquireTikTokToken };
