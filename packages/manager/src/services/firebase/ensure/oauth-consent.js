/**
 * Ensure the OAuth consent screen (IAP brand) exists: application title +
 * support email (required for Google sign-in).
 *
 * No OAuth clients here — IAP-created clients are locked (no redirect URIs);
 * Firebase auto-creates the client when Google sign-in is enabled.
 *
 * supportEmail must be the authenticated user's email or a Google Group they
 * own; `firebase.supportEmail` in config, defaulting to support@{domain}
 * (omega-manager defaulted to the company googlegroup — config owns it now).
 */
const chalk = require('chalk').default;

module.exports = async function ensureOAuthConsent(context) {
  const { firebaseApi: api, brandConfig, projectId, domain, options = {} } = context;
  const brandName = brandConfig.brand?.name;
  const supportEmail = brandConfig.firebase?.supportEmail || `support@${domain}`;

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
    console.log(`      ${chalk.dim(`⊘ Dry run — would create OAuth consent screen (${brandName}, ${supportEmail})`)}`);
    return { output: { oauthConsent: { planned: 'create' } } };
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
