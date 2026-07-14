/**
 * AI brandmark generation via MrLogo (mrlogo.ai — a sibling ITW product) —
 * the fallback when a brand has no assets/logo/brandmark.svg yet. MrLogo is
 * OURS, so the endpoint is a product constant (like the Ghostii client's
 * write URL) and auth rides the same credential ladder as the other product
 * services (slapform/chatsy/replyify — Ian 2026-07-14: no config options,
 * "use an API key or service account or whatever slapform, chatsy,
 * replyify use"):
 *
 *   1. MRLOGO_SERVICE_ACCOUNT (path to MrLogo's service-account JSON,
 *      absolute or brand-root-relative) — full auto: ensures the brand's
 *      OWN MrLogo product user (email = brand.contact.email, canonical
 *      account shape via lib/product-create) and calls the API with that
 *      user's api.privateKey. New users land on MrLogo's basic plan
 *      (100 credits), plenty for brandmark generation.
 *   2. MRLOGO_API_KEY — an existing MrLogo account's api.privateKey used
 *      directly. Verified against the live wire contract: BEM's
 *      authenticate() resolves a non-JWT Bearer value by querying
 *      users.api.privateKey, and MrLogo's logos route rides that auth.
 *   3. LOGO_API_ID_TOKEN — a pasted Firebase ID token (manual escape
 *      hatch; ID tokens expire hourly, so the durable tiers rank first).
 *
 * No credentials → the assets service skips with guidance (generate at
 * mrlogo.ai by hand and drop the SVG in assets/logo/). The API returns a
 * monochrome SVG (preferred) or color SVG URL; the download lands at
 * assets/logo/brandmark.svg as committed collateral.
 */
const { randomUUID } = require('node:crypto');
const chalk = require('chalk').default;
const jetpack = require('fs-jetpack');
const { FirestoreREST, loadServiceAccount } = require('../../../lib/firestore-rest.js');
const { createAuthAdmin } = require('../../../lib/auth-admin.js');
const { ensureProductUser } = require('../../../lib/product-create.js');
const { createPasswordResolver } = require('../../account/lib/resolve-password.js');

// MrLogo's LIVE production route (the old-world /backend-manager path IS its
// api). Env override is a test/staging seam, not brand config.
const MRLOGO_API_URL = 'https://api.mrlogo.ai/backend-manager/logos';
const MRLOGO_URL = 'https://mrlogo.ai';

function apiUrl() {
  return process.env.MRLOGO_API_URL || MRLOGO_API_URL;
}

/**
 * Resolve the logo API's Bearer credential down the product ladder, or null
 * when no tier is configured. The SA tier ensures the brand's own MrLogo
 * product user and uses ITS api.privateKey — BEM auth accepts a privateKey
 * and an ID token through the same Authorization header.
 *
 * @param {object} spec
 * @param {object} spec.brandConfig - Merged brand config
 * @param {string} spec.brandRoot - Brand root (SA paths + password channels)
 * @param {object} [spec.db] - FirestoreREST test seam (with authAdmin)
 * @param {object} [spec.authAdmin] - auth-admin test seam
 * @param {function} spec.log - line logger
 * @returns {Promise<{ token: string, source: string }|null>}
 */
async function resolveLogoAuth({ brandConfig, brandRoot, db, authAdmin, log }) {
  // Tier 1 — operator SA: mint/reuse the brand's own product user
  if (!db) {
    const envPath = process.env.MRLOGO_SERVICE_ACCOUNT;
    if (envPath) {
      const serviceAccount = loadServiceAccount(envPath, brandRoot);
      db = new FirestoreREST(serviceAccount);
      authAdmin = createAuthAdmin(serviceAccount);
    }
  }

  if (db && authAdmin) {
    const brand = brandConfig.brand || {};
    const email = brand.contact?.email;
    if (!email) {
      throw new Error('MRLOGO_SERVICE_ACCOUNT is set but brand.contact.email is missing — the brand\'s product user needs it');
    }

    const { uid } = await ensureProductUser({
      db,
      authAdmin,
      email,
      resolvePassword: createPasswordResolver({
        brandRoot,
        domain: new URL(brand.url || 'https://invalid.test').hostname,
        brand,
        dryRun: false,
      }),
      log,
    });

    const userDoc = await db.getDoc(`users/${uid}`);
    const privateKey = userDoc?.api?.privateKey;
    if (!privateKey) {
      throw new Error(`MrLogo user ${email} (${uid}) has no api.privateKey in its user doc`);
    }
    return { token: privateKey, source: 'MRLOGO_SERVICE_ACCOUNT' };
  }

  // Tier 2 — an existing account's api.privateKey, used directly
  if (process.env.MRLOGO_API_KEY) {
    return { token: process.env.MRLOGO_API_KEY, source: 'MRLOGO_API_KEY' };
  }

  // Tier 3 — pasted Firebase ID token (expires hourly)
  if (process.env.LOGO_API_ID_TOKEN) {
    return { token: process.env.LOGO_API_ID_TOKEN, source: 'LOGO_API_ID_TOKEN' };
  }

  return null;
}

/**
 * Generate the brandmark via the logo API and write it to brandmarkPath.
 *
 * @returns {boolean} whether the SVG landed
 */
async function generateBrandmark({ brandConfig, brandmarkPath, direction, token }) {
  const response = await fetch(apiUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      brandName: brandConfig.brand.name,
      mode: 'brandmark',
      style: 'flat',
      mood: 'professional',
      industry: brandConfig.brand.tagline || '',
      description: [brandConfig.brand.description || '', direction].filter(Boolean).join('. '),
      colors: ['#000000'],
      id: randomUUID(),
    }),
    signal: AbortSignal.timeout(120000),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`logo API responded ${response.status}: ${text}`);
  }

  const result = await response.json();
  const files = result.iteration?.files || {};
  const svgUrl = files.monoSvg?.url || files.colorSvg?.url;

  if (!svgUrl) {
    console.log(`    ${chalk.yellow('⚠')} No SVG in the logo API response — check the provider's logs`);
    return false;
  }

  const svgResponse = await fetch(svgUrl, { signal: AbortSignal.timeout(30000) });
  if (!svgResponse.ok) {
    throw new Error(`failed to download the SVG (${svgResponse.status})`);
  }

  jetpack.write(brandmarkPath, await svgResponse.text());
  console.log(`    ${chalk.green('✓')} Generated ${chalk.cyan('assets/logo/brandmark.svg')} via MrLogo`);
  return true;
}

module.exports = { resolveLogoAuth, generateBrandmark, MRLOGO_URL };
