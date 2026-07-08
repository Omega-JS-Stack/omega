/**
 * Account service — required accounts exist in the brand's Firebase Auth
 * with the expected (derived) passwords, carry the admin role + highest
 * plan on their Firestore user doc, and no one else holds the admin role.
 * Runs after update (deploy) because signup/marketing calls hit the live
 * brand backend.
 *
 * De-ITW'd from omega-manager: the account list was the hardcoded company
 * ADMIN_EMAILS in config.js (personal Gmail addresses) — the port reads
 * account.admins from config, defaulting to support@{domain} only. The
 * password formula was a company-specific scheme in code — the port derives
 * passwords via HMAC from ACCOUNT_PASSWORD_SEED (brand .env,
 * auto-generated + persisted on first real run). firebase-admin is
 * replaced by the Identity Toolkit REST API + FirestoreREST over the
 * brand's own service account.
 */
const { join } = require('node:path');
const { randomBytes } = require('node:crypto');
const jetpack = require('fs-jetpack');
const chalk = require('chalk').default;

const { createServiceRunner } = require('../../lib/service-runner.js');
const { writeEnvValue } = require('../../lib/env-secret.js');
const { FirestoreREST, loadServiceAccount } = require('../../lib/firestore-rest.js');
const { createAuthAdmin } = require('./lib/auth-admin.js');
const { createBackendClient } = require('./lib/backend-client.js');

const SERVICE_ACCOUNT_PATH = join('.omega', 'secrets', 'service-account.json');

/**
 * Resolve ACCOUNT_PASSWORD_SEED from the brand .env — auto-generated and
 * persisted on first real run (dry-run only notes it). Rotation is safe
 * but updates every managed account's password on the next run.
 *
 * @param {string} brandRoot - Brand-monorepo root
 * @param {boolean} dryRun - Whether this is a dry run
 * @returns {string|null} The seed, or null in dry-run when none exists yet
 */
function resolvePasswordSeed(brandRoot, dryRun) {
  let seed = process.env.ACCOUNT_PASSWORD_SEED || '';

  if (!seed) {
    if (dryRun) {
      console.log(`      ${chalk.cyan('[DRY RUN]')} Would generate ACCOUNT_PASSWORD_SEED and save it to the brand .env`);
      return null;
    }

    seed = randomBytes(24).toString('base64url');
    writeEnvValue(brandRoot, 'ACCOUNT_PASSWORD_SEED', seed);
    process.env.ACCOUNT_PASSWORD_SEED = seed;
    console.log(`      ${chalk.green('✓')} Generated ACCOUNT_PASSWORD_SEED and saved to the brand .env`);
  }

  return seed;
}

module.exports.run = createServiceRunner({
  serviceDir: __dirname,
  setup: (context) => {
    const config = context.brandConfig.account;

    if (config === false || config?.enabled === false) {
      return { skip: true, reason: 'account.enabled = false' };
    }

    const targets = context.brandConfig.targets || {};
    if (!targets.backend) {
      return { skip: true, reason: 'no backend target' };
    }

    // Shared Firebase project — the owning brand manages accounts
    if (context.brandConfig.firebase?.shared === true) {
      return { skip: true, reason: 'shared Firebase project' };
    }

    const domain = (context.brandConfig.brand?.url || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (!domain) {
      return { skip: true, reason: 'no brand.url configured' };
    }

    // Resolve {domain} templates in the configured admin list
    const admins = (config?.admins || []).map((entry) => ({
      ...entry,
      email: entry.email.replace(/\{\s*domain\s*\}/g, domain),
    }));
    if (admins.length === 0) {
      return { skip: true, reason: 'no account.admins configured' };
    }

    // Firebase web API key from firebase state — without it, password
    // verification and backend calls degrade (handled per-operation)
    const apiKey = context.brandState?.firebase?.sdkConfig?.apiKey || null;
    const apiBaseUrl = `https://api.${domain}`;

    // Tests inject fakes via context
    let authAdmin = context.authAdmin;
    let firestore = context.firestore;
    let accountBackend = context.accountBackend;
    if (!authAdmin) {
      if (!jetpack.exists(join(context.brandRoot, SERVICE_ACCOUNT_PATH))) {
        return { skip: true, reason: `no service account at ${SERVICE_ACCOUNT_PATH} (run the firebase service first)` };
      }

      const serviceAccount = loadServiceAccount(SERVICE_ACCOUNT_PATH, context.brandRoot);
      authAdmin = createAuthAdmin(serviceAccount);
      firestore = new FirestoreREST(serviceAccount);
      accountBackend = createBackendClient({ authAdmin, apiKey, apiBaseUrl });
    }

    // After the client gates so a skipped brand never gets a seed written
    const dryRun = context.options?.dryRun || false;
    const passwordSeed = resolvePasswordSeed(context.brandRoot, dryRun);

    return { authAdmin, firestore, accountBackend, admins, domain, apiKey, passwordSeed };
  },
});
