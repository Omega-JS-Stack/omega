/**
 * Certificates service — Apple signing certificates, bundle IDs, and
 * provisioning profiles for brands with desktop/mobile targets, reconciled
 * via the App Store Connect API.
 *
 * Signing home: ONE Apple account signs everything a company ships, so a
 * company-managed brand (`.omega/company.json` marker → context.companyRoot)
 * shares the COMPANY workspace's signing tree; a standalone brand (the
 * playground today — no parent yet) keeps it brand-local, and the material
 * simply moves to the company root when one is born. Layout under the
 * gitignored {companyRoot||brandRoot}/.omega/certificates/apple/:
 *   AuthKey_*.p8                           (App Store Connect API key — the interactive rescue files it from Downloads)
 *   certificates/{TYPE}.cer + .p12         (downloaded/created + exported)
 *   csr/{TYPE}/{private.key,request.csr}   (PRESERVED — the issued cert is paired with this key)
 *   profiles/{BRAND_ID}/{TYPE}/{PLATFORM}.mobileprovision  (per-brand — profiles bind one bundle ID)
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
const { homedir } = require('node:os');
const { randomBytes } = require('node:crypto');
const jetpack = require('fs-jetpack');
const chalk = require('chalk').default;
const { openBrowserAndPoll } = require('@omega.js/devkit/flows');

const { createServiceRunner } = require('../../lib/service-runner.js');
const { canPrompt } = require('../../lib/run-gates.js');
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
 * Generate a random CSC_KEY_PASSWORD and persist it to the signing root's
 * .env (the company workspace when company-managed — shared .p12s need the
 * ONE shared password, and the env chain loads the company .env under every
 * sibling brand's — else the brand root).
 *
 * .p12 files MUST carry a real password — modern macOS rejects
 * empty-password .p12 in `security import` ("MAC verification failed").
 * The value is meaningless to the user; it just has to stay stable, so it
 * is written back to .env for every future run (and for CI signing).
 *
 * @param {string} signingRoot - The signing tree's owning root (its .env is the target)
 * @returns {string} - The generated password
 */
function ensureCertPassword(signingRoot) {
  const password = randomBytes(24).toString('base64url');
  writeEnvValue(signingRoot, 'CSC_KEY_PASSWORD', password);
  console.log(`      ${chalk.green('✓')} Generated CSC_KEY_PASSWORD and saved to the signing root's .env`);

  return password;
}

/**
 * Interactive rescue for a missing App Store Connect API key. The .p8
 * downloads ONCE (Apple never re-serves it), so the walkthrough opens the
 * keys page Enter-gated and watches Downloads for a fresh AuthKey_*.p8,
 * filing it into the signing tree. Non-interactive runs keep the skip +
 * guidance contract.
 */
async function rescueAuthKey(appleDir, downloadsDir = join(homedir(), 'Downloads')) {
  const startedAt = Date.now();

  const result = await openBrowserAndPoll({
    url: APPSTORE_KEYS_URL,
    promptMessage: [
      'An App Store Connect API key is needed (Users and Access → Integrations):',
      `          1. Generate an API key with the ${chalk.bold('Admin')} role — or download an existing one (each .p8 downloads ONCE)`,
      '          2. I\'ll detect the AuthKey_*.p8 in Downloads and file it into the signing tree',
    ].join('\n'),
    label: 'the App Store Connect API keys page',
    waitMessage: 'Waiting for the AuthKey_*.p8 download',
    intervalMs: 3000,
    check: async () => {
      for (const name of jetpack.list(downloadsDir) || []) {
        if (!/^AuthKey_[A-Z0-9]+\.p8$/.test(name)) {
          continue;
        }
        const modified = jetpack.inspect(join(downloadsDir, name), { times: true })?.modifyTime;
        if (!modified || modified.getTime() < startedAt) {
          continue;
        }
        jetpack.move(join(downloadsDir, name), join(appleDir, name));
        return { done: true, result: name };
      }
      return { done: false };
    },
  });

  if (result.success) {
    console.log(`      ${chalk.green('✓')} Filed ${chalk.cyan(result.result)} into ${chalk.gray(appleDir)}`);
    return findAuthKey(appleDir);
  }

  return null;
}

/**
 * Resolve the App Store Connect credentials from the environment + the
 * signing tree. Returns { skip, reason } when anything is missing — except
 * a missing .p8 on an interactive run, which gets the download rescue.
 */
async function resolveAppleSecrets(context, appleDir, signingRoot) {
  const dryRun = context.options?.dryRun || false;
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

  let privateKeyPath = findAuthKey(appleDir);
  if (!privateKeyPath && canPrompt(context.options)) {
    privateKeyPath = await rescueAuthKey(appleDir, context.downloadsDir);
  }
  if (!privateKeyPath) {
    return {
      skip: true,
      reason: `no App Store Connect API key found — download the .p8 from ${APPSTORE_KEYS_URL} and save it as AuthKey_<KEYID>.p8 in ${appleDir}`,
    };
  }

  let certificatePassword = process.env.CSC_KEY_PASSWORD || '';
  if (!certificatePassword) {
    if (dryRun) {
      console.log(`      ${chalk.cyan('[DRY RUN]')} Would generate CSC_KEY_PASSWORD and save it to the signing root's .env`);
    } else {
      certificatePassword = ensureCertPassword(signingRoot);
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
  setup: async (context) => {
    const config = context.brandConfig.certificates;

    if (config === false || config?.enabled === false) {
      return { skip: true, reason: 'certificates.enabled = false' };
    }

    const targets = context.brandConfig.targets || {};
    if (!targets.desktop && !targets.mobile) {
      return { skip: true, reason: 'no desktop or mobile target' };
    }

    // One Apple account signs everything a company ships — company-managed
    // brands share the company workspace's signing tree; standalone brands
    // keep it brand-local (and the material moves when a company is born)
    const signingRoot = context.companyRoot || context.brandRoot;
    const appleDir = join(signingRoot, '.omega', 'certificates', 'apple');

    // Tests inject a fake client + secrets via context
    let appleClient = context.appleClient;
    let appleSecrets = context.appleSecrets;
    if (!appleClient) {
      const resolved = await resolveAppleSecrets(context, appleDir, signingRoot);
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
