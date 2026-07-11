/**
 * Per-account password resolution — the owner-controlled channels, strongest
 * first (brand-account provisioning ownership, Ian 2026-07-10):
 *
 *   1. env    — OMEGA_ACCOUNT_PASSWORD__<EMAIL> (email uppercased, runs of
 *               non-alphanumerics → _), e.g. support@acme.com →
 *               OMEGA_ACCOUNT_PASSWORD__SUPPORT_ACME_COM. Rides the D15
 *               cascade, so a fixed password can live in the brand or
 *               company .env.
 *   2. hook   — .omega/hooks/account/password.js (brand root, else company
 *               root via the company stamp): ({ email, domain, apex, brand })
 *               → password. A company-wide formula lives in the OWNER'S tree,
 *               never in framework source. A broken hook throws — an owner
 *               who wrote one never gets silent fallback.
 *   3. seed   — derivePassword(ACCOUNT_PASSWORD_SEED, email, domain), the
 *               generated default. The seed is resolved LAZILY: only when
 *               some account actually falls through to this channel does it
 *               get generated + persisted to the brand .env — a brand fully
 *               covered by env/hook never grows a seed.
 */
const { randomBytes } = require('node:crypto');
const chalk = require('chalk').default;

const { loadHook } = require('@omega.js/config');

const { writeEnvValue } = require('../../../lib/env-secret.js');
const { getApexDomain } = require('../../../lib/domain-utils.js');
const { derivePassword } = require('./password.js');

const HOOK_POINT = 'account/password';

// Firebase Auth's own minimum — catch a broken hook here, not as an opaque
// Identity Toolkit 400 later.
const MIN_PASSWORD_LENGTH = 6;

/**
 * The env var that pins a specific account's password.
 * @param {string} email - Resolved account email (templates already applied)
 * @returns {string} e.g. 'OMEGA_ACCOUNT_PASSWORD__SUPPORT_ACME_COM'
 */
function passwordEnvVar(email) {
  const key = email.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return `OMEGA_ACCOUNT_PASSWORD__${key}`;
}

/**
 * Build the per-account password resolver for one brand run.
 *
 * @param {Object} spec
 * @param {string} spec.brandRoot - Brand-monorepo root (hook + seed home)
 * @param {string} spec.domain - Brand domain (hook context + seed derivation)
 * @param {Object} spec.brand - brandConfig.brand (hook context: id, name, url)
 * @param {boolean} spec.dryRun - Dry runs never generate/persist a seed
 * @returns {(email: string) => Promise<{ password: string|null, source: string|null }>}
 *   password null only in a dry run that fell through to a not-yet-existing
 *   seed (the caller's "seed pending" path); source is 'env <VAR>',
 *   'hook <file>', or 'seed'.
 */
function createPasswordResolver({ brandRoot, domain, brand, dryRun }) {
  let hook; // undefined = not looked up yet; null = no hook file
  let seed; // undefined = not resolved yet; null = dry run without one

  return async function resolvePassword(email) {
    // 1. Explicit env pin
    const envVar = passwordEnvVar(email);
    if (process.env[envVar]) {
      return { password: process.env[envVar], source: `env ${envVar}` };
    }

    // 2. Owner hook (loaded once; a broken hook throws out of the service)
    if (hook === undefined) {
      hook = loadHook(brandRoot, HOOK_POINT);
    }
    if (hook) {
      const password = await hook.fn({ email, domain, apex: getApexDomain(domain), brand });
      if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
        throw new Error(`Hook ${HOOK_POINT} (${hook.file}) returned an invalid password for ${email} — must be a string of at least ${MIN_PASSWORD_LENGTH} characters`);
      }
      return { password, source: `hook ${hook.file}` };
    }

    // 3. Seed derivation — the seed materializes on first need
    if (seed === undefined) {
      seed = process.env.ACCOUNT_PASSWORD_SEED || null;

      if (!seed && dryRun) {
        console.log(`      ${chalk.cyan('[DRY RUN]')} Would generate ACCOUNT_PASSWORD_SEED and save it to the brand .env`);
      } else if (!seed) {
        seed = randomBytes(24).toString('base64url');
        writeEnvValue(brandRoot, 'ACCOUNT_PASSWORD_SEED', seed);
        process.env.ACCOUNT_PASSWORD_SEED = seed;
        console.log(`      ${chalk.green('✓')} Generated ACCOUNT_PASSWORD_SEED and saved to the brand .env`);
      }
    }

    return { password: seed ? derivePassword(seed, email, domain) : null, source: 'seed' };
  };
}

module.exports = { createPasswordResolver, passwordEnvVar };
