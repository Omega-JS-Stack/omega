/**
 * Ensure Firebase Authentication is configured: Identity Platform enabled,
 * email/password sign-in, email-enumeration privacy, anonymous-user
 * auto-delete, the password policy, authorized domains — all diffed via the
 * Identity Toolkit API — plus Google sign-in.
 *
 * Google sign-in's OAuth client CANNOT be created programmatically (no Google
 * API exists); omega-manager opened a browser and polled. Not-enabled prints
 * the console instructions and warns — reruns converge once it's enabled
 * (the API verifies). The OAuth client's redirect URIs have no API either:
 * instructions + an interactive confirm that records completion in state
 * (`authentication.oauthRedirectsConfigured`); non-interactive runs warn.
 *
 * OAuth client credentials land in the brand's gitignored
 * .omega/secrets/google-oauth.json (never in state or omega.json5).
 */
const { join } = require('node:path');
const chalk = require('chalk').default;
const jetpack = require('fs-jetpack');
const { confirm, pressEnterToOpen } = require('@omega.js/devkit/prompt');
const { canPrompt, dryRunPlan } = require('../../../lib/run-gates.js');

module.exports = async function ensureAuthentication(context) {
  const { firebaseApi: api, brandRoot, projectId, domain, serviceData = {}, options = {} } = context;

  let warned = false;
  let needsInteractive = null; // #32: set when a step steps aside for lack of a TTY

  // === Identity Platform (upgrade only when the config GET says it's absent) ===
  let config = await api.getIdentityConfig(projectId);

  if (!config) {
    if (options.dryRun) {
      return dryRunPlan('enable Identity Platform', { output: { authentication: { planned: 'initialize' } } });
    }

    try {
      await api.initializeIdentityPlatform(projectId);
      console.log(`      ${chalk.green('✓')} Identity Platform enabled`);
    } catch (error) {
      if (!/409|ALREADY_EXISTS|already/.test(error.message || '')) {
        console.log(`      ${chalk.yellow('⚠')} Could not enable Identity Platform${chalk.dim(`: ${error.message}`)}`);
      }
    }

    config = await api.getIdentityConfig(projectId);
    if (!config) {
      console.log(`      ${chalk.yellow('⚠')} Could not get Identity Platform config`);
      console.log(`      ${chalk.dim('→')} Enable Identity Platform in the Firebase Console, then rerun`);
      return { status: 'warned', output: { authentication: { error: 'no identity config' } } };
    }
  } else {
    console.log(`      ${chalk.green('✓')} Identity Platform enabled`);
  }

  const enabled = [];

  // Helper: diff-gated PATCH of one identity-config slice
  const patchConfig = async (label, needsUpdate, payload) => {
    if (!needsUpdate) {
      console.log(`      ${chalk.green('✓')} ${label} already configured`);
      return;
    }
    if (options.dryRun) {
      return dryRunPlan(`configure ${label}`);
    }
    try {
      await api.updateIdentityConfig(projectId, payload);
      console.log(`      ${chalk.green('✓')} ${label} configured`);
    } catch (error) {
      console.log(`      ${chalk.yellow('⚠')} Could not configure ${label}${chalk.dim(`: ${error.message}`)}`);
    }
  };

  // === Email/password sign-in ===
  const signInConfig = config.signIn || {};
  await patchConfig('Email/password sign-in', !signInConfig.email?.enabled, {
    signIn: {
      ...signInConfig,
      email: { enabled: true, passwordRequired: true },
    },
  });
  enabled.push('email');

  // === Email privacy (prevents email-enumeration attacks) ===
  await patchConfig('Email privacy', !config.emailPrivacyConfig?.enableImprovedEmailPrivacy, {
    emailPrivacyConfig: { enableImprovedEmailPrivacy: true },
  });

  // === Auto-delete anonymous users (30 days) ===
  await patchConfig('Anonymous-user auto-delete', !config.autodeleteAnonymousUsers, {
    autodeleteAnonymousUsers: true,
  });

  // === Password policy (8–128 chars, enforced) ===
  const currentPolicy = config.passwordPolicyConfig || {};
  const currentConstraints = currentPolicy.passwordPolicyVersions?.[0]?.customStrengthOptions || {};
  const policyDrifted = currentPolicy.passwordPolicyEnforcementState !== 'ENFORCE'
    || currentPolicy.forceUpgradeOnSignin !== false
    || currentConstraints.minPasswordLength !== 8
    || currentConstraints.maxPasswordLength !== 128;
  await patchConfig('Password policy', policyDrifted, {
    passwordPolicyConfig: {
      passwordPolicyEnforcementState: 'ENFORCE',
      forceUpgradeOnSignin: false,
      passwordPolicyVersions: [{
        customStrengthOptions: {
          minPasswordLength: 8,
          maxPasswordLength: 128,
        },
      }],
    },
  });

  // === Google sign-in ===
  const googleConfig = await api.getIdpConfig(projectId, 'google.com');
  const firebaseAuthUrl = `https://console.firebase.google.com/project/${projectId}/authentication/providers`;
  let googleClientId = null;

  // OAuth client IDs start with the project number — a mismatch means the
  // wrong project's credentials got attached
  let projectNumber = null;
  try {
    projectNumber = await api.getProjectNumber(projectId);
  } catch {
    // Validation is best-effort without it
  }

  if (googleConfig?.enabled && googleConfig.clientId && googleConfig.clientSecret) {
    const clientProjectNumber = googleConfig.clientId.split('-')[0];

    if (projectNumber && clientProjectNumber !== projectNumber) {
      console.log(`      ${chalk.yellow('⚠')} Google sign-in has the WRONG OAuth client (project ${clientProjectNumber}, expected ${projectNumber})`);
      console.log(`      ${chalk.dim('→')} Delete Google sign-in in the Firebase Console and re-enable it: ${chalk.cyan(firebaseAuthUrl)}`);
      warned = true;
    } else {
      console.log(`      ${chalk.green('✓')} Google sign-in enabled`);
      enabled.push('google');
      googleClientId = googleConfig.clientId;

      // Secrets belong in the gitignored secrets dir, never state/omega.json5
      const secretsPath = join(brandRoot, '.omega', 'secrets', 'google-oauth.json');
      if (!options.dryRun) {
        jetpack.write(secretsPath, {
          clientId: googleConfig.clientId,
          clientSecret: googleConfig.clientSecret,
        });
      }
    }
  } else if (googleConfig?.enabled) {
    console.log(`      ${chalk.yellow('⚠')} Google sign-in enabled but OAuth credentials missing (corrupted config)`);
    console.log(`      ${chalk.dim('→')} Delete Google sign-in and re-enable it: ${chalk.cyan(firebaseAuthUrl)}`);
    warned = true;
  } else {
    // No API to create the OAuth client — manual enable in the console
    console.log(`      ${chalk.yellow('⚠')} Google sign-in not enabled — requires one-time manual setup`);
    console.log(`      ${chalk.dim('→')} Enable "Google", pick a support email, Save — then rerun`);
    if (canPrompt(options)) {
      await pressEnterToOpen(firebaseAuthUrl, 'the sign-in providers page');
    } else {
      console.log(`      ${chalk.dim('→')} ${chalk.cyan(firebaseAuthUrl)}`);
    }
    warned = true;
  }

  // === OAuth client redirect URIs (no API — instructions + confirm until done) ===
  let oauthRedirectsConfigured = serviceData.authentication?.oauthRedirectsConfigured || false;
  if (googleClientId && !oauthRedirectsConfigured) {
    const gcpCredentialsUrl = `https://console.cloud.google.com/apis/credentials/oauthclient/${googleClientId}?project=${projectId}`;
    const authorizedOrigins = [
      'https://localhost',
      'https://localhost:5000',
      `https://${projectId}.firebaseapp.com`,
      `https://${domain}`,
    ];
    const redirectUris = [
      `https://${projectId}.firebaseapp.com/__/auth/handler`,
      'https://localhost:5000/__/auth/handler',
      `https://${domain}/__/auth/handler`,
    ];
    console.log(`      ${chalk.yellow('⚠')} OAuth client redirect URIs need one-time manual configuration`);
    console.log(`      ${chalk.dim('→')} Authorized origins:`);
    for (const origin of authorizedOrigins) {
      console.log(`        ${chalk.cyan(origin)}`);
    }
    console.log(`      ${chalk.dim('→')} Redirect URIs:`);
    for (const uri of redirectUris) {
      console.log(`        ${chalk.cyan(uri)}`);
    }

    if (canPrompt(options)) {
      await pressEnterToOpen(gcpCredentialsUrl, 'the OAuth client settings');
      const done = await confirm({ message: 'Origins + redirect URIs configured in the OAuth client?', default: false });
      if (done) {
        oauthRedirectsConfigured = true;
        console.log(`      ${chalk.green('✓')} OAuth client redirect URIs confirmed`);
      } else {
        warned = true;
      }
    } else {
      console.log(`      ${chalk.dim('→')} ${chalk.cyan(gcpCredentialsUrl)}`);
      console.log(`      ${chalk.dim('→')} (rerun in an interactive terminal to confirm)`);
      needsInteractive = 'confirm the OAuth client origins + redirect URIs (the run opens the console for you)';
      warned = true;
    }
  } else if (googleClientId) {
    console.log(`      ${chalk.green('✓')} OAuth client redirect URIs configured`);
  }

  // === Authorized domains ===
  const authorizedDomains = config.authorizedDomains || [];
  const domainsToAdd = [
    domain,
    `${projectId}.firebaseapp.com`,
    `${projectId}.web.app`,
    'localhost',
  ].filter((d) => !authorizedDomains.includes(d));

  if (domainsToAdd.length === 0) {
    console.log(`      ${chalk.green('✓')} Authorized domains configured`);
  } else if (options.dryRun) {
    dryRunPlan(`add ${domainsToAdd.length} authorized domain(s)`);
  } else {
    try {
      await api.updateIdentityConfig(projectId, {
        authorizedDomains: [...authorizedDomains, ...domainsToAdd],
      });
      console.log(`      ${chalk.green('✓')} Added ${chalk.bold(domainsToAdd.length)} authorized domain(s)`);
    } catch (error) {
      console.log(`      ${chalk.yellow('⚠')} Could not update authorized domains${chalk.dim(`: ${error.message}`)}`);
    }
  }

  return {
    status: warned ? 'warned' : 'success',
    state: {
      authentication: {
        enabled,
        authorizedDomains: [domain, `${projectId}.firebaseapp.com`, `${projectId}.web.app`],
        oauthRedirectsConfigured,
      },
    },
    ...(needsInteractive ? { output: { authentication: { needsInteractive } } } : {}),
  };
};
