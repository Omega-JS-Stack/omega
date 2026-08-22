/**
 * Classic reCAPTCHA client. Classic reCAPTCHA has no key-management API —
 * the only documented endpoint is siteverify, which doubles as a secret-key
 * validity check: verifying a throwaway token answers invalid-input-response
 * for a good secret and invalid-input-secret for a bad one.
 */

const VERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';

class RecaptchaAPI {
  constructor({ secretKey = process.env.RECAPTCHA_SECRET_KEY } = {}) {
    this.secretKey = secretKey;
  }

  /**
   * Verify a response token against the secret key.
   *
   * @param {string} response - The reCAPTCHA response token to verify
   * @returns {Promise<Object>} - Parsed siteverify JSON ({ success, 'error-codes' })
   */
  async verify(response) {
    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: this.secretKey, response }),
    });

    if (!res.ok) {
      throw new Error(`reCAPTCHA siteverify failed: HTTP ${res.status}`);
    }

    return await res.json();
  }
}

module.exports = { RecaptchaAPI };
