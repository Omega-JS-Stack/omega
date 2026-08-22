/**
 * TikTok Business API client (v1.3) — the advertiser account's pixels.
 * Named-method surface over fetch, normalized to the same { id, name } shape
 * as the Meta client so one provisioning flow drives both
 * (lib/pixel-provision.js). TikTok's "pixel code" IS the public pixel id the
 * frontends embed, so it fills the `id` slot.
 *
 * Auth: TIKTOK_ACCESS_TOKEN in the brand .env (the `Access-Token` header) —
 * the developer-app token, the same key @omega.js/backend's Events API
 * sender reads.
 *
 * SCAFFOLD (#417, Ian 2026-08-21): the endpoints below are the documented
 * v1.3 pixel shapes, never yet exercised against the live API — Ian's TikTok
 * app is not provisioned, so no brand carries the token and the ensure step
 * cannot reach this client. Treat a first live run as the proving run.
 */
const API_BASE = 'https://business-api.tiktok.com/open_api/v1.3';

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

module.exports = { TikTokBusinessAPI };
