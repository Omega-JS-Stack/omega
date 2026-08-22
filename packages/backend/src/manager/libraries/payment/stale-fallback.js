/**
 * The ONE way a provider library falls back to the raw webhook payload.
 *
 * Every provider's fetchResource() prefers the API's answer and falls back to the
 * payload the webhook carried when that call fails. The payload is by definition
 * older than the API's answer — and the API error that forced the fallback used to
 * be swallowed whole, so a fallback read downstream exactly like a fresh fetch.
 *
 * This marks the returned resource `_stale: true` (the caller logs it as a
 * stale-fallback instead of a fetch) and logs the swallowed error at the site that
 * swallowed it.
 */

/**
 * Log a swallowed fetchResource() failure and return the flagged fallback payload
 *
 * @param {object} rawFallback - The webhook payload being fallen back to
 * @param {object} options
 * @param {object} [options.ctx] - Route/event context (logs to its own file identity without one)
 * @param {string} options.provider - Provider name (e.g. 'stripe')
 * @param {string} options.resourceType - Resource type that was being fetched
 * @param {string} options.resourceId - Resource ID that was being fetched
 * @param {Error} options.error - The swallowed API error
 * @param {string} [options.consequence] - What the failed call did NOT do (e.g. an uncaptured capture)
 * @returns {object} A copy of the fallback payload flagged `_stale: true`
 */
function staleFallback(rawFallback, { ctx, provider, resourceType, resourceId, error, consequence }) {
  const suffix = consequence ? ` — ${consequence}` : '';
  const message = `${provider} fetchResource(${resourceType}/${resourceId}) failed — falling back to the STALE webhook payload: ${error?.message || error}${suffix}`;

  if (ctx?.error) {
    ctx.error(message, error);
  } else {
    console.error(`[@omega.js/backend:payment:stale-fallback] ${message}`, error);
  }

  // Copy: the fallback is the webhook doc's own raw payload — never brand it in place
  return { ...rawFallback, _stale: true };
}

module.exports = staleFallback;
