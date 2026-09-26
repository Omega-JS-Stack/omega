/**
 * The one-time secrets a connect is made of
 * ([#793](https://github.com/Omega-JS-Stack/omega/issues/793)): the CSRF token,
 * the PKCE pair, and the encrypted state that carries a leg across the trip to
 * the provider and back.
 *
 * One concern, one file: nothing here loads a provider or talks to one.
 */

const crypto = require('crypto');
const env = require('../../../libraries/env.js');

// How long an encrypted state is good for
const STATE_TTL_MINUTES = 10;

// Derive the connection state encryption key from OMEGA_ADMIN_KEY
const STATE_KEY = env.get('OMEGA_ADMIN_KEY')
  ? crypto.createHash('sha256').update(`connections-state:${env.get('OMEGA_ADMIN_KEY')}`).digest('hex')
  : null;

/**
 * A fresh CSRF token for one authorize leg.
 *
 * @returns {string} 32 random bytes, hex
 */
function generateCsrfToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * The PKCE challenge for a verifier — S256, the only method the lane mints
 * (RFC 7636 §4.2: base64url(sha256(verifier)), no padding).
 *
 * @param {string} verifier - The code verifier
 * @returns {string} The code challenge
 */
function pkceChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

/**
 * Mint one PKCE pair for an authorize leg
 * ([#771](https://github.com/Omega-JS-Stack/omega/issues/771)). The CHALLENGE
 * rides the authorize URL; the VERIFIER stays server-side beside the CSRF
 * token in `usage/<uid>` until the exchange proves it.
 *
 * @returns {{ verifier: string, challenge: string }} The pair
 */
function generatePkcePair() {
  const verifier = crypto.randomBytes(32).toString('base64url');

  return { verifier, challenge: pkceChallenge(verifier) };
}

/**
 * Encrypt one authorize leg's state (AES-256-GCM, our key).
 *
 * @param {object} data - The state to carry
 * @returns {string} `<iv>.<ciphertext>.<authTag>`, base64 each
 */
function encryptState(data) {
  if (!STATE_KEY) {
    throw new Error('OMEGA_ADMIN_KEY not configured');
  }

  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(STATE_KEY, 'hex'), iv);

  let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'base64');
  encrypted += cipher.final('base64');

  const authTag = cipher.getAuthTag().toString('base64');

  return `${iv.toString('base64')}.${encrypted}.${authTag}`;
}

/**
 * Read a state back, or throw — a tampered one never decrypts.
 *
 * @param {string} encryptedState - What the provider handed back
 * @returns {object} The state as it was written
 */
function decryptState(encryptedState) {
  if (!STATE_KEY) {
    throw new Error('OMEGA_ADMIN_KEY not configured');
  }

  const parts = encryptedState.split('.');

  if (parts.length !== 3) {
    throw new Error('Invalid state format');
  }

  const [ivB64, encryptedB64, authTagB64] = parts;

  const iv = Buffer.from(ivB64, 'base64');
  const encrypted = Buffer.from(encryptedB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');

  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(STATE_KEY, 'hex'), iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  return JSON.parse(decrypted);
}

module.exports = {
  STATE_TTL_MINUTES,
  STATE_KEY,
  generateCsrfToken,
  generatePkcePair,
  pkceChallenge,
  encryptState,
  decryptState,
};
