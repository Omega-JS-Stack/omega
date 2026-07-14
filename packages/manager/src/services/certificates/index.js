/**
 * Certificates service — Apple signing certificates, bundle IDs, and
 * provisioning profiles for brands with desktop/mobile targets, reconciled
 * via the App Store Connect API.
 *
 * Layout under the brand's gitignored .omega/certificates/apple/:
 *   AuthKey_*.p8                           (user-placed App Store Connect API key)
 *   certificates/{TYPE}.cer + .p12         (downloaded/created + exported)
 *   csr/{TYPE}/{private.key,request.csr}   (PRESERVED — the issued cert is paired with this key)
 *   profiles/{TYPE}/{PLATFORM}.mobileprovision
 *
 * De-ITW'd from omega-manager: certs lived in the company instance's shared
 * .output/_shared/ tree (one set for all brands) and the bundle-ID prefix
 * was hardcoded to the company — the port keeps everything brand-local and
 * reads certificates.apple.bundleIdPrefix from config. The interactive
 * rescue for portal-only certs is restored and upgraded (Ian 2026-07-14,
 * lib/manual-walkthrough.js): the pipeline stages the CSR itself — legacy
 * sent users to Keychain Access — opens the portal create page Enter-gated,
 * and watches Downloads for the issued .cer; non-interactive runs keep
 * printed guidance + converge-on-rerun. The --force-recreate CLI flag was
 * not ported (delete the local .cer to force a re-download; expired certs
 * recreate automatically).
 *
 * Env (brand .env): APPLE_API_ISSUER, APPLE_API_KEY_ID, APPLE_TEAM_ID
 * required; CSC_KEY_PASSWORD auto-generated + persisted to the brand .env
 * on first real run (never rotate it — that orphans existing .p12 files);
 * APPLE_KEYCHAIN_PASSWORD optional (suppresses macOS keychain prompts).
 */
const { join } = require('node:path');
const { randomBytes } = require('node:crypto');
const jetpack = require('fs-jetpack');
const chalk = require('chalk').default;

const { createServiceRunner } = require('../../lib/service-runner.js');
const { writeEnvValue } = require('../../lib/env-secret.js');
const { createAppleClient } = require('./lib/apple-api.js');
const { importP12Files } = require('./lib/keychain.js');

const APPSTORE_KEYS_URL = 'https://appstoreconnect.apple.com/access/api';

/**
 * Find the user-placed App Store Connect API key (AuthKey_*.p8) in the
 * brand's Apple dir. Auto-detected by prefix so no path config is needed.
 *
 * @param {string} appleDir - {brandRoot}/.omega/certificates/apple
 * @returns {string|null} - Absolute path to the .p8, or null
 */
function findAuthKey(appleDir) {
  if (!jetpack.exists(appleDir)) {
    return null;
  }
  const p8Files = jetpack.find(appleDir, { matching: 'AuthKey_*.p8', recursive: false });
  return p8Files[0] || null;
}

/**
 * Generate a random CSC_KEY_PASSWORD and persist it to the brand .env.
 *
 * .p12 files MUST carry a real password — modern macOS rejects
 * empty-password .p12 in `security import` ("MAC verification failed").
 * The value is meaningless to the user; it just has to stay stable, so it
 * is written back to .env for every future run (and for CI signing).
 *
 * @param {string} brandRoot - Brand-monorepo root (its .env is the target)
 * @returns {string} - The generated password
 */
function ensureCertPassword(brandRoot) {
  const password = randomBytes(24).toString('base64url');
  writeEnvValue(brandRoot, 'CSC_KEY_PASSWORD', password);
  console.log(`      ${chalk.green('✓')} Generated CSC_KEY_PASSWORD and saved to the brand .env`);

  return password;
}

/**
 * Resolve the App Store Connect credentials from the environment + the
 * brand's Apple dir. Returns { skip, reason } when anything is missing.
 */
function resolveAppleSecrets(appleDir, brandRoot, dryRun) {
  const issuerId = process.env.APPLE_API_ISSUER;
  const keyId = process.env.APPLE_API_KEY_ID;
  const teamId = process.env.APPLE_TEAM_ID;

  const missing = [];
  if (!issuerId) missing.push('APPLE_API_ISSUER');
  if (!keyId) missing.push('APPLE_API_KEY_ID');
  if (!teamId) missing.push('APPLE_TEAM_ID');

  if (missing.length > 0) {
    return { skip: true, reason: `no Apple credentials configured (set ${missing.join(', ')} in the brand .env)` };
  }

  const privateKeyPath = findAuthKey(appleDir);
  if (!privateKeyPath) {
    return {
      skip: true,
      reason: `no App Store Connect API key found — download the .p8 from ${APPSTORE_KEYS_URL} and save it as AuthKey_<KEYID>.p8 in .omega/certificates/apple/`,
    };
  }

  let certificatePassword = process.env.CSC_KEY_PASSWORD || '';
  if (!certificatePassword) {
    if (dryRun) {
      console.log(`      ${chalk.cyan('[DRY RUN]')} Would generate CSC_KEY_PASSWORD and save it to the brand .env`);
    } else {
      certificatePassword = ensureCertPassword(brandRoot);
      process.env.CSC_KEY_PASSWORD = certificatePassword;
    }
  }

  return {
    secrets: {
      issuerId,
      keyId,
      teamId,
      privateKeyPath,
      certificatePassword,
      keychainPassword: process.env.APPLE_KEYCHAIN_PASSWORD || null,
    },
  };
}

module.exports.run = createServiceRunner({
  serviceDir: __dirname,
  setup: (context) => {
    const config = context.brandConfig.certificates;

    if (config === false || config?.enabled === false) {
      return { skip: true, reason: 'certificates.enabled = false' };
    }

    const targets = context.brandConfig.targets || {};
    if (!targets.desktop && !targets.mobile) {
      return { skip: true, reason: 'no desktop or mobile target' };
    }

    const appleDir = join(context.brandRoot, '.omega', 'certificates', 'apple');

    // Tests inject a fake client + secrets via context
    let appleClient = context.appleClient;
    let appleSecrets = context.appleSecrets;
    if (!appleClient) {
      const resolved = resolveAppleSecrets(appleDir, context.brandRoot, context.options?.dryRun || false);
      if (resolved.skip) {
        return resolved;
      }
      appleSecrets = resolved.secrets;
      appleClient = createAppleClient(appleSecrets);
    }

    return {
      appleClient,
      appleSecrets,
      appleDir,
      // Tests inject a recorder so the real macOS keychain is never touched
      keychainImport: context.keychainImport || importP12Files,
    };
  },
});
