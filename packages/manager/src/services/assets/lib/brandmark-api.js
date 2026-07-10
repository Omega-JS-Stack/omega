/**
 * AI brandmark generation via a logo API (ITW's instance is MrLogo) —
 * the interactive fallback when a brand has no assets/logo/brandmark.svg
 * yet. Config supplies the endpoint, de-ITW'd from omega-manager's
 * hardcoded mrlogo constants:
 *
 *   assets: {
 *     brandmark: {
 *       apiUrl: 'https://api.mrlogo.ai/omega/logos',
 *       providerBrand: 'mrlogo',        // sibling brand hosting the API
 *       adminEmail: 'admin@company.com' // its Firebase admin user
 *     }
 *   }
 *
 * Auth is a Firebase ID token for the provider's admin user. Resolution
 * order: LOGO_API_ID_TOKEN from the env chain (escape hatch), else mint
 * one through the provider brand — located via the company marker →
 * discoverBrands, using its .omega/state.json web API key + its
 * .omega/secrets/service-account.json (custom token signed locally by
 * lib/auth-admin, exchanged at the public signInWithCustomToken
 * endpoint — the same chain the account service uses).
 *
 * The API returns a monochrome SVG (preferred) or color SVG URL; the
 * download lands at assets/logo/brandmark.svg as committed collateral.
 */
const { join } = require('node:path');
const { randomUUID } = require('node:crypto');
const chalk = require('chalk').default;
const jetpack = require('fs-jetpack');
const { createAuthAdmin } = require('../../../lib/auth-admin.js');
const { readCompanyMarker, discoverBrands } = require('../../../lib/company.js');

const SIGN_IN_URL = 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken';

/**
 * The brandmark-generation spec from config, or null when not configured.
 */
function resolveBrandmarkSpec(brandConfig) {
  const spec = brandConfig.assets?.brandmark;
  if (!spec?.apiUrl) {
    return null;
  }
  return spec;
}

/**
 * Resolve the logo API's Bearer token: env override first, else mint via
 * the provider brand. Throws with the exact gap when neither works.
 */
async function resolveLogoApiToken(spec, brandRoot) {
  if (process.env.LOGO_API_ID_TOKEN) {
    return process.env.LOGO_API_ID_TOKEN;
  }

  if (!spec.providerBrand || !spec.adminEmail) {
    throw new Error('set LOGO_API_ID_TOKEN in the env chain, or assets.brandmark.providerBrand + adminEmail to mint one');
  }

  const marker = readCompanyMarker(brandRoot);
  if (!marker || marker.stale) {
    throw new Error(`provider brand "${spec.providerBrand}" needs the company workspace (no usable .omega/company.json marker)`);
  }

  const { brands } = discoverBrands(marker.companyRoot);
  const provider = brands.find((b) => b.id === spec.providerBrand);
  if (!provider) {
    throw new Error(`provider brand "${spec.providerBrand}" not found in the company workspace`);
  }

  const state = jetpack.read(join(provider.root, '.omega', 'state.json'), 'json');
  const apiKey = state?.firebase?.sdkConfig?.apiKey;
  if (!apiKey) {
    throw new Error(`no web API key in ${spec.providerBrand}'s state — run its firebase service first`);
  }

  const serviceAccount = jetpack.read(join(provider.root, '.omega', 'secrets', 'service-account.json'), 'json');
  if (!serviceAccount) {
    throw new Error(`no service account at ${spec.providerBrand}/.omega/secrets/service-account.json`);
  }

  const auth = createAuthAdmin(serviceAccount);
  const user = await auth.getUserByEmail(spec.adminEmail);
  if (!user) {
    throw new Error(`admin user ${spec.adminEmail} not found on the ${spec.providerBrand} project`);
  }

  const customToken = auth.createCustomToken(user.uid);
  const response = await fetch(`${SIGN_IN_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    throw new Error(`custom-token exchange failed (${response.status})`);
  }

  const { idToken } = await response.json();
  return idToken;
}

/**
 * Generate the brandmark via the logo API and write it to brandmarkPath.
 *
 * @returns {boolean} whether the SVG landed
 */
async function generateBrandmark({ spec, brandConfig, brandmarkPath, direction, token }) {
  const response = await fetch(spec.apiUrl, {
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
  console.log(`    ${chalk.green('✓')} Generated ${chalk.cyan('assets/logo/brandmark.svg')} via the logo API`);
  return true;
}

module.exports = { resolveBrandmarkSpec, resolveLogoApiToken, generateBrandmark };
