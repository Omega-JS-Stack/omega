/**
 * node — the server-side entry (#380). @omega.js/backend's Cloud Functions
 * process boots reporting through here.
 *
 * Server errors ALWAYS report: routes, cron, and event triggers are our code by
 * definition, so there is no bundle filter on this side — the capture SEAMS
 * decide (RouteContext.report()'s 5xx rule, the event-trigger catch). What this
 * file owns is the boot: resolve, guard, init, hand back the SDK.
 *
 * The SDK is required ONLY when the resolved config says to report, so a brand
 * with no `monitoring.providers.sentry.dsn` never loads @sentry/node at all.
 */

const { resolveConfig, releaseTag, normalizeUser } = require('./core.js');
const { readGates } = require('./env.js');
const { createLogger } = require('./logger.js');

const logger = createLogger('node');

/**
 * Boot the node SDK.
 *
 * @param {object} options
 * @param {object} options.config - the omega.json5 `monitoring` section
 * @param {object} [options.release] - { id, version } — the host's version identity
 * @param {boolean} [options.isProduction] - the host's runtime production signal
 * @param {boolean} [options.allowInDev] - report from a non-production run anyway
 * @param {() => object} [options.tags] - per-event tags, read at capture time
 * @returns {object|null} the @sentry/node module when reporting is live, else null
 */
function initialize(options) {
  options = options || {};

  const { shouldEnable, options: resolved, reason } = resolveConfig(options.config, readGates(options));
  if (!shouldEnable) {
    logger.log(`disabled — ${reason}`);
    return null;
  }

  let Sentry;
  try {
    Sentry = require('@sentry/node');
  } catch (e) {
    logger.warn(`@sentry/node is not installed — reporting disabled. (${e.message})`);
    return null;
  }

  const release = releaseTag(options.release);
  const readTags = typeof options.tags === 'function' ? options.tags : null;

  Sentry.init({
    dsn:              resolved.dsn,
    release,
    environment:      resolved.environment,
    sampleRate:       resolved.sampleRate,
    tracesSampleRate: resolved.tracesSampleRate,
    beforeSend(event) {
      // Tags are read HERE, not at init: a Cloud Functions process serves many
      // invocations, so the function name/type belong to the event, not the boot.
      if (readTags) {
        event.tags = { ...event.tags, ...readTags() };
      }
      return event;
    },
  });

  logger.log(`initialized — env=${resolved.environment} release=${release}`);

  return Sentry;
}

module.exports = { initialize, normalizeUser, releaseTag };
