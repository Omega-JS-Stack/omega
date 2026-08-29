/**
 * TikTok Business API client (v1.3) — the advertiser account's pixels.
 * Named-method surface over fetch, normalized to the same { id, name } shape
 * as the Meta client so one provisioning flow drives both
 * (lib/pixel-provision.js). TikTok's "pixel code" IS the public pixel id the
 * frontends embed, so it fills the `id` slot.
 *
 * Auth: TIKTOK_ACCESS_TOKEN in the brand .env (the `Access-Token` header) —
 * the long-lived token the portal authorization mints (#448, lib/tiktok-auth.js),
 * the same key @omega.js/backend's Events API sender reads. The exchange that
 * MINTS it lives here too, as a free function: it is the one call that runs
 * without a token, so it can never be a method on the authenticated client.
 *
 * SCAFFOLD (#417, Ian 2026-08-21): the endpoints below are the documented
 * v1.3 pixel shapes, never yet exercised against the live API — Ian's TikTok
 * app is not provisioned, so no brand carries the token and the ensure step
 * cannot reach this client. Treat a first live run as the proving run.
 */
const API_BASE = 'https://business-api.tiktok.com/open_api/v1.3';
// Where a developer app (and so its app id) is created — the page the setup
// walks to when a brand has no `analytics.providers.tiktok.appId` yet (#635).
const TIKTOK_APPS_URL = 'https://business-api.tiktok.com/portal/apps';

/**
 * The app's own page in the developer portal. Its Basic Information shows the
 * "Advertiser authorization URL" TikTok built for the app (app id, state, and
 * the redirect URI configured ON the app), so the setup opens THIS page and the
 * human clicks that link there (Ian 2026-08-27): the redirect URI is the app's
 * setting, never brand config, and manage never asks for it.
 *
 * @param {string} appId - The TikTok developer app id (public config).
 * @returns {string} The app page URL.
 */
// The portal's authorization endpoint — what the app page's "Advertiser
// authorization URL" starts with. Only used to check a pasted URL is that link.
const TIKTOK_AUTH_BASE = 'https://business-api.tiktok.com/portal/auth';

/**
 * Whether a pasted URL is the app's own advertiser authorization link.
 *
 * @param {string} url - The pasted URL.
 * @param {string} appId - The app id it must carry.
 * @returns {boolean}
 */
function isAuthUrlFor(url, appId) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}` === TIKTOK_AUTH_BASE && parsed.searchParams.get('app_id') === String(appId);
  } catch {
    return false;
  }
}

/**
 * The auth_code out of a pasted redirect URL, or the bare code when the human
 * pasted just that.
 *
 * @param {string} pasted - A redirect URL carrying `auth_code`, or the code.
 * @returns {string} The code, or '' when neither.
 */
function parseAuthCode(pasted) {
  if (!pasted) {
    return '';
  }
  try {
    return new URL(pasted).searchParams.get('auth_code') || '';
  } catch {
    // Not a URL: the bare code
    return pasted;
  }
}

function TIKTOK_APP_URL(appId) {
  return `${TIKTOK_APPS_URL}/${encodeURIComponent(appId)}`;
}

/**
 * Exchange a portal `auth_code` for the long-lived access token (#448). The
 * app secret is a MINT-TIME credential — it is passed here and never stored.
 *
 * @param {object} params - { appId, secret, authCode }.
 * @param {Function} [fetchImpl] - Test seam; defaults to global fetch.
 * @returns {Promise<string>} The long-lived access token.
 */
async function exchangeAuthCode({ appId, secret, authCode }, fetchImpl = fetch) {
  const response = await fetchImpl(`${API_BASE}/oauth2/access_token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, secret, auth_code: authCode }),
  });

  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  // Same rule as the client: TikTok answers 200 with a non-zero `code`
  if (!response.ok || (body && body.code !== 0)) {
    throw new Error(`TikTok API error (${body?.code ?? response.status}): ${body?.message || response.statusText}`);
  }

  const token = body?.data?.access_token;
  if (!token) {
    // A 200 with code 0 and no token means the response shape moved —
    // persisting `undefined` would poison the brand .env
    throw new Error(`TikTok token exchange returned no access_token (${JSON.stringify(body?.data)})`);
  }

  return token;
}

class TikTokBusinessAPI {
  constructor(options = {}) {
    this.accessToken = options.accessToken || process.env.TIKTOK_ACCESS_TOKEN;
  }

  async makeRequest(endpoint, options = {}) {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers: {
        'Access-Token': this.accessToken,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    const text = await response.text();
    const body = text ? JSON.parse(text) : null;

    // TikTok answers HTTP 200 with a non-zero `code` for real failures, so
    // the status alone never proves success
    if (!response.ok || (body && body.code !== 0)) {
      throw new Error(`TikTok API error (${body?.code ?? response.status}): ${body?.message || response.statusText}`);
    }

    return body?.data || null;
  }

  /** Pixels on the advertiser account, normalized to { id, name }. */
  async listPixels(advertiserId) {
    const data = await this.makeRequest(`/pixel/list/?advertiser_id=${encodeURIComponent(advertiserId)}`);
    return (data?.pixels || []).map((pixel) => ({ id: pixel.pixel_code, name: pixel.pixel_name }));
  }

  /** Create a pixel on the advertiser account. */
  async createPixel(advertiserId, name) {
    const created = await this.makeRequest('/pixel/create/', {
      method: 'POST',
      body: JSON.stringify({
        advertiser_id: String(advertiserId),
        pixel_name: name,
        pixel_mode: 'STANDARD_MODE',
      }),
    });
    return { id: created?.pixel_code, name: created?.pixel_name || name };
  }
}

module.exports = { TikTokBusinessAPI, exchangeAuthCode, TIKTOK_APP_URL, TIKTOK_APPS_URL, TIKTOK_AUTH_BASE, isAuthUrlFor, parseAuthCode };
