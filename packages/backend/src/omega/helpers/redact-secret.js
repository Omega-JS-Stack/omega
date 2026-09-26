/**
 * Presence + last-4 rendering for a secret that has to appear in a log line.
 *
 * Backend log lines land in Cloud Logging and stay there for the retention
 * window, so a credential printed once is a credential stored. Every line that
 * has to acknowledge a secret (the authenticator's lanes, the middleware's
 * request/headers trace) renders it through here: enough to tell that a key was
 * sent and to match it against a known key, never the key itself.
 */

/**
 * @param {*} value - The secret (anything stringifiable).
 * @returns {string} `***<last 4> (<length> chars)`, or `(empty)`.
 */
function redactSecret(value) {
  const string = `${value || ''}`;

  if (!string) {
    return '(empty)';
  }

  return `***${string.slice(-4)} (${string.length} chars)`;
}

module.exports = redactSecret;
