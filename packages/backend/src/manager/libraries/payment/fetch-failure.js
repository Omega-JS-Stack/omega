const isAlreadyGone = require('./provider-errors.js');

/**
 * The ONE way a provider library reports a lookup it could not answer.
 *
 * `fetchResource()` used to swallow its own failure and hand back the payload the
 * WEBHOOK carried, flagged stale — so an unverified object supplied by whoever
 * posted the event drove real subscription state and real conversions. The
 * provider's own answer is the only trusted source, so a lookup that fails
 * produces no resource at all ([#506](https://github.com/Omega-JS-Stack/omega/issues/506)).
 *
 * What the caller still needs is WHICH failure it was, because the two have
 * opposite outcomes:
 *
 * - **not found** (`notFound: true`) — the provider affirmatively does not have
 *   this resource. Nothing will ever make it processable, so the pipeline refuses
 *   the event and acknowledges it rather than redelivering forever.
 * - **unreachable** (`notFound: false`) — a timeout, a 5xx, an expired key. The
 *   answer exists; this attempt could not read it. The pipeline defers, and the
 *   retry ladder is the reconciliation mechanism.
 *
 * The split itself is [provider-errors.js](provider-errors.js), so every provider
 * classifies by the same rule instead of each naming its own not-found shape.
 */

/**
 * Wrap a failed provider lookup as the classified error the pipeline branches on
 *
 * @param {Error} error - The error the provider call threw
 * @param {object} options
 * @param {string} options.provider - Provider name (e.g. 'stripe')
 * @param {string} options.resourceType - Resource type that was being fetched
 * @param {string} options.resourceId - Resource ID that was being fetched
 * @param {string} [options.consequence] - What the failed call did NOT do (e.g. an uncaptured capture)
 * @returns {Error} The error to throw, carrying `notFound` plus what it was about
 */
function fetchFailure(error, { provider, resourceType, resourceId, consequence }) {
  const notFound = isAlreadyGone(error);
  const verdict = notFound
    ? `${provider} does not have ${resourceType} ${resourceId}`
    : `${provider} could not be reached for ${resourceType} ${resourceId}`;
  const suffix = consequence ? ` — ${consequence}` : '';

  const failure = new Error(`${provider} fetchResource(${resourceType}/${resourceId}) failed — ${verdict}: ${error?.message || error}${suffix}`);

  failure.notFound = notFound;
  failure.provider = provider;
  failure.resourceType = resourceType;
  failure.resourceId = resourceId;
  failure.cause = error;

  return failure;
}

module.exports = fetchFailure;
