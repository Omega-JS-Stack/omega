const fetch = require('wonderful-fetch');
const env = require('./env.js');

/**
 * Print Google's verdict for a REJECTED token — never the token, never the secret.
 *
 * A rejection turns into a 403 the caller cannot explain on its own: wrong
 * secret, wrong domain, low score and expired token all look identical
 * downstream. This is the one line that names the reason.
 *
 * @param {object} data - The siteverify response
 */
function logRejection(data) {
  const codes = (data['error-codes'] || []).join(',') || 'none';

  console.warn(`[@omega.js/backend:recaptcha] verify() rejected: error-codes=${codes} score=${data.score ?? 'none'} action=${data.action || 'none'} hostname=${data.hostname || 'none'}`);
}

/**
 * Verify a Google reCAPTCHA token
 * @param {string} token - The reCAPTCHA response token
 * @param {object} [options] - Options
 * @param {number} [options.minScore=0.5] - Minimum score threshold (v3)
 * @returns {Promise<boolean>} Whether the token is valid
 */
async function verify(token, options) {
  const minScore = options?.minScore || 0.5;

  if (!env.has('RECAPTCHA_SECRET_KEY')) {
    return true;
  }

  if (!token) {
    return false;
  }

  try {
    const data = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'post',
      response: 'json',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `secret=${env.get('RECAPTCHA_SECRET_KEY')}&response=${token}`,
    });

    const passed = data.success && (data.score === undefined || data.score >= minScore);

    if (!passed) {
      logRejection(data);
    }

    return passed;
  } catch (e) {
    console.error('reCAPTCHA verification error:', e);
    return false;
  }
}

module.exports = { verify };
