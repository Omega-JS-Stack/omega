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
const { confirmSetup } = require('../../../lib/config-flow.js');
const { exchangeAuthCode, TIKTOK_PORTAL_URL } = require('./tiktok-api.js');

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
  if (!provider.appId) {
    // The app id is the developer app's, not something a brand can be walked
    // to — without it there is no portal page to open and no exchange to run.
    console.log(`      ${chalk.yellow('⚠')} No ${chalk.cyan(`analytics.providers.${spec.key}.appId`)} in omega.json5`);
    console.log(`      ${chalk.dim('→')} Create a TikTok developer app, then set its app id there — the setup mints the token from it`);
    return false;
  }

  if (options.gate !== false) {
    const action = await confirmSetup(context, {
      label: spec.label,
      instructions: [
        '1. The next step opens the TikTok authorization portal for your app',
        '2. Approve the advertiser account, then paste back the auth_code from the redirect URL',
        `3. The exchange runs here and only the long-lived token is saved (${chalk.cyan(spec.envVar)})`,
      ],
      disablePath: `analytics.providers.${spec.key}`,
    });
    if (action !== 'yes') {
      return false;
    }
  }

  const prompt = { ...require('@omega.js/devkit/prompt'), ...options.prompt };

  // Mint-time only: masked, held in a local, never written to .env or config
  const secret = (await prompt.password({ message: 'TikTok app secret (used once, never saved):' }) || '').trim();
  if (!secret) {
    return false;
  }

  await prompt.pressEnterToOpen(
    TIKTOK_PORTAL_URL({ appId: provider.appId, redirectUri: provider.redirectUri }),
    `the ${spec.label} authorization portal`,
  );

  const authCode = (await prompt.input({ message: 'Paste the auth_code from the redirect URL:' }) || '').trim();
  if (!authCode) {
    return false;
  }

  const exchange = context.tiktokExchange || ((params) => exchangeAuthCode(params));

  let token;
  try {
    token = await exchange({ appId: provider.appId, secret, authCode });
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
