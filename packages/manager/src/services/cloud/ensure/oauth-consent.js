/**
 * Ensure the OAuth consent screen (IAP brand) exists: application title +
 * support email (required for Google sign-in).
 *
 * No OAuth clients here — IAP-created clients are locked (no redirect URIs);
 * Firebase auto-creates the client when Google sign-in is enabled.
 *
 * Google only accepts a supportEmail the AUTHORIZING USER owns (their own
 * email or a Google Group they manage) — anything else is "Request contains
 * an invalid argument" (friction #29; the old support@{domain} default could
 * never work). `cloud.supportEmail` in config wins (the Google-Group
 * case); the default is the authenticated user's own email via the
 * userinfo.email scope. Neither available → warn with guidance, never send
 * a doomed value.
 */
const chalk = require('chalk').default;
const { dryRunPlan } = require('../../../lib/run-gates.js');

module.exports = async function ensureOAuthConsent(context) {
  const { firebaseApi: api, brandConfig, projectId, options = {} } = context;
  const brandName = brandConfig.brand?.name;

  // === READ ===
  const existingBrands = await api.listBrands(projectId);

  if (existingBrands.length > 0) {
    const brand = existingBrands[0];
    console.log(`      ${chalk.green('✓')} OAuth consent screen exists`);

    return {
      state: {
        oauthConsent: {
          brandName: brand.name,
          applicationTitle: brand.applicationTitle,
          supportEmail: brand.supportEmail,
        },
      },
    };
  }

  // === WRITE ===
  if (options.dryRun) {
    const planned = brandConfig.cloud?.supportEmail || "(authorizing user's email)";
    return dryRunPlan(`create OAuth consent screen (${brandName}, ${planned})`, { output: { oauthConsent: { planned: 'create' } } });
  }

  const supportEmail = brandConfig.cloud?.supportEmail
    || await api.getAuthenticatedEmail();

  if (!supportEmail) {
    console.log(`      ${chalk.yellow('⚠')} No usable support email — Google only accepts one the authorizing user OWNS`);
    console.log(`      ${chalk.dim('→')} Re-auth to grant the email scope (delete .omega/auth/google-tokens.json and rerun), or set cloud.supportEmail to a Google Group you own`);
    return { status: 'warned', output: { oauthConsent: { note: 'no ownable supportEmail available' } } };
  }

  console.log('      Creating OAuth consent screen...');
  try {
    const brand = await api.createBrand(projectId, brandName, supportEmail);
    console.log(`      ${chalk.green('✓')} Created OAuth consent screen`);
    console.log(`        ${chalk.dim('→')} Application: ${chalk.cyan(brandName)}`);
    console.log(`        ${chalk.dim('→')} Support email: ${chalk.cyan(supportEmail)}`);

    return {
      state: {
        oauthConsent: {
          brandName: brand.name,
          applicationTitle: brandName,
          supportEmail,
        },
      },
    };
  } catch (error) {
    if (error.message?.includes('already exists')) {
      console.log(`      ${chalk.green('✓')} OAuth consent screen already exists`);
      return {};
    }

    console.log(`      ${chalk.yellow('⚠')} Could not create OAuth consent screen${chalk.dim(`: ${error.message}`)}`);
    console.log(`      ${chalk.dim('→')} Configure manually: ${chalk.cyan(`https://console.cloud.google.com/apis/credentials/consent?project=${projectId}`)}`);
    return { status: 'warned', output: { oauthConsent: { error: error.message } } };
  }
};
