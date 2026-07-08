/**
 * App Store Connect API client — ES256 JWT auth over node:crypto + global
 * fetch (omega-manager used jsonwebtoken + wonderful-fetch; the port needs
 * neither). Exposes request() (JSON, throws on non-2xx with Apple's error
 * text) and paginate() (follows links.next).
 *
 * Apple's "agreements expired" 403 gets a printed fix-it (accept the
 * pending agreements at the developer site) — omega-manager auto-opened
 * the browser; the port prints the URL and stays non-interactive.
 */
const jetpack = require('fs-jetpack');
const chalk = require('chalk').default;

const { signJwt } = require('../../../lib/jwt.js');

const API_BASE = 'https://api.appstoreconnect.apple.com/v1';

// Universal Apple Developer landing — pending agreements surface here as a
// banner (the per-team agreement URL is unique per developer account).
const APPLE_AGREEMENTS_URL = 'https://developer.apple.com/account/';

const TOKEN_TTL_SECONDS = 20 * 60; // Apple max — 20 minutes
const TOKEN_REFRESH_BUFFER_SECONDS = 5 * 60; // Refresh 5 min before expiry

// Print the agreements guidance once per process — multiple API calls
// hitting the same 403 shouldn't repeat it.
let agreementsNoticePrinted = false;

/**
 * Detect Apple's "agreements expired" 403 from an error message.
 */
function isAgreementsError(errorMessage) {
  return /FORBIDDEN\.REQUIRED_AGREEMENTS_MISSING_OR_EXPIRED/i.test(errorMessage || '');
}

function printAgreementsNotice() {
  if (agreementsNoticePrinted) {
    return;
  }
  agreementsNoticePrinted = true;
  console.log('');
  console.log(`      ${chalk.yellow('⚠')} ${chalk.bold('Apple Developer Program agreements need to be accepted')}`);
  console.log(`      ${chalk.gray('→')} Visit ${chalk.cyan(APPLE_AGREEMENTS_URL)}, accept all pending agreements (Paid Apps, Free Apps, Developer Program License), then re-run`);
  console.log('');
}

/**
 * Build an authenticated App Store Connect client.
 *
 * @param {Object} secrets - { issuerId, keyId, privateKeyPath }
 * @returns {{ request: Function, paginate: Function }}
 */
function createAppleClient(secrets) {
  const privateKey = jetpack.read(secrets.privateKeyPath);
  if (!privateKey) {
    throw new Error(`Failed to read App Store Connect private key from ${secrets.privateKeyPath}`);
  }

  let cachedToken = null;
  let tokenExpiresAt = 0;

  function getToken() {
    const now = Math.floor(Date.now() / 1000);
    if (!cachedToken || now >= tokenExpiresAt - TOKEN_REFRESH_BUFFER_SECONDS) {
      cachedToken = signJwt(
        { alg: 'ES256', kid: secrets.keyId, typ: 'JWT' },
        { iss: secrets.issuerId, iat: now, exp: now + TOKEN_TTL_SECONDS, aud: 'appstoreconnect-v1' },
        privateKey,
      );
      tokenExpiresAt = now + TOKEN_TTL_SECONDS;
    }
    return cachedToken;
  }

  /**
   * JSON request to the App Store Connect API. Returns the parsed body
   * (null for 204/allowed-404). Throws with Apple's error text otherwise.
   *
   * @param {string} url - Full URL
   * @param {Object} [options] - { method, body, allow404 }
   */
  async function request(url, options = {}) {
    const { method = 'GET', body, allow404 = false } = options;

    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${getToken()}`,
        'Content-Type': 'application/json',
      },
      body: body || undefined,
      signal: AbortSignal.timeout(60000),
    });

    if (response.status === 404 && allow404) {
      return null;
    }
    if (response.status === 204) {
      return null;
    }

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      const message = (data?.errors || [])
        .map((e) => `${e.title}: ${e.detail || e.code || ''}`.trim())
        .join('; ')
        || `HTTP ${response.status}`;

      if (isAgreementsError(message)) {
        printAgreementsNotice();
      }

      throw new Error(`Apple API request failed (${method} ${url}): ${message}`);
    }

    return data;
  }

  /**
   * Paginated GET — follows `links.next` until exhausted and returns the
   * concatenated `data` array.
   */
  async function paginate(url) {
    let all = [];
    let nextUrl = url;
    while (nextUrl) {
      const data = await request(nextUrl);
      all = all.concat(data?.data || []);
      nextUrl = data?.links?.next || null;
    }
    return all;
  }

  return { request, paginate };
}

module.exports = { API_BASE, createAppleClient, isAgreementsError };
