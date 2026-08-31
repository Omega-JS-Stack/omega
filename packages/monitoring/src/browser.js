/**
 * browser — the web-bundle entry (#380). @omega.js/client's sentry module is
 * its only host, which puts one policy on every browser surface the client
 * ships into (@omega.js/web pages and @omega.js/extension views alike).
 *
 * The doctrine this file enforces (Ian, 2026-08-20): client-side, ONLY errors
 * from our own framework code report. A web page shares its global with
 * everything — user-land inline scripts, ad and chat widgets, browser
 * extensions injecting into the DOM — and none of that is ours to answer for.
 * So the send gate is a stack-frame check against our bundle URLs, on top of
 * the environment gates (development, Lighthouse, automated browsers) the
 * client already ran.
 *
 * No `process` and no `require` of an SDK: this file is BUNDLED into a page.
 * The host imports @sentry/browser itself (dynamically, to keep it out of the
 * initial chunk) and passes the module in.
 */

const { DEFAULTS, normalizeUser, createBundleFilter } = require('./core.js');
const { createLogger } = require('./logger.js');

const logger = createLogger('browser');

/** Lighthouse audits every error it can provoke — none of it is a real user's. */
function isLighthouse() {
  try {
    return typeof navigator !== 'undefined' && navigator.userAgent?.includes('Lighthouse');
  } catch (e) {
    return false;
  }
}

/** Selenium/Puppeteer/Playwright — an e2e run's errors are the run's, not production's. */
function isAutomatedBrowser() {
  try {
    return typeof navigator !== 'undefined' && navigator.webdriver === true;
  } catch (e) {
    return false;
  }
}

/**
 * The url params that ARE a credential (#661): `?authPrivateKey` is a durable
 * key and `?authCustomToken` signs in whoever holds it. A module constant, not
 * config — a page cannot be allowed to opt its own credentials back into an
 * event. Not exhaustive by design: only params the framework's own auth lanes
 * put in an address bar.
 */
const SENSITIVE_AUTH_PARAMS = ['authPrivateKey', 'authCustomToken'];

// Any absolute url parses against a base too, so ONE parse serves both shapes;
// the host below only ever names it back out of a relative input.
const SCRUB_BASE = 'https://scrub.invalid';

/**
 * Drop the credential params from a url string. The SDK reads the address bar
 * in two places we cannot reach from a catch block — the navigation breadcrumb
 * it records around `history.replaceState`, and the request url `httpContext`
 * attaches at capture time — so the scrub belongs on this seam, once, rather
 * than in every lane that handles a key.
 *
 * A url carrying none of them comes back untouched (never re-serialized), and a
 * same-origin breadcrumb url stays relative, the way the SDK recorded it.
 *
 * @param {string} url - an absolute or root-relative url
 * @returns {string} the url without the credential params
 */
function scrubAuthParams(url) {
  if (typeof url !== 'string' || !SENSITIVE_AUTH_PARAMS.some((param) => url.includes(param))) {
    return url;
  }

  let parsed;
  let relative = false;

  try {
    parsed = new URL(url);
  } catch (e) {
    relative = true;
  }

  if (relative) {
    try {
      parsed = new URL(url, SCRUB_BASE);
    } catch (e) {
      // Not a url at all — better a param name in a breadcrumb than a mangled one.
      return url;
    }
  }

  SENSITIVE_AUTH_PARAMS.forEach((param) => parsed.searchParams.delete(param));

  return relative ? `${parsed.pathname}${parsed.search}${parsed.hash}` : parsed.toString();
}

/**
 * Build the @sentry/browser init options: integrations plus the one beforeSend
 * that decides what leaves the page.
 *
 * @param {object} params
 * @param {object} params.Sentry - the imported @sentry/browser module
 * @param {object} [params.config] - the resolved Sentry settings for this surface
 *   (the build maps `monitoring.providers.sentry` into the client's `sentry.config`)
 * @param {string} [params.release] - the host's release tag (core.releaseTag)
 * @param {string} [params.environment]
 * @param {() => boolean} [params.isDevelopment] - the host's dev signal, read per event
 * @param {() => object} [params.getUser] - the signed-in user, read per event
 * @param {() => object} [params.getTags] - extra tags, read per event
 * @returns {object} the options object to hand Sentry.init()
 */
function buildInitOptions(params) {
  const { Sentry, release, environment, isDevelopment, getUser, getTags } = params || {};

  const options = { ...DEFAULTS, ...((params && params.config) || {}) };

  const isFrameworkEvent = createBundleFilter(options.bundlePatterns);

  // Session-hours baseline: the page's own clock starts when reporting boots.
  const startTime = Date.now();

  const integrations = [];
  if (typeof Sentry.browserTracingIntegration === 'function') {
    integrations.push(Sentry.browserTracingIntegration());
  }
  // Replay costs bandwidth and captures the DOM — strictly opt-in via sample rates.
  const hasReplays = (options.replaysSessionSampleRate > 0) || (options.replaysOnErrorSampleRate > 0);
  if (hasReplays && typeof Sentry.replayIntegration === 'function') {
    integrations.push(Sentry.replayIntegration({ maskAllText: false, blockAllMedia: false }));
  }

  return {
    dsn:              options.dsn,
    release,
    environment:      environment || options.environment || 'production',
    sampleRate:       options.sampleRate,
    tracesSampleRate: options.tracesSampleRate,
    ...(options.replaysSessionSampleRate > 0 ? { replaysSessionSampleRate: options.replaysSessionSampleRate } : {}),
    ...(options.replaysOnErrorSampleRate > 0 ? { replaysOnErrorSampleRate: options.replaysOnErrorSampleRate } : {}),
    integrations,

    beforeBreadcrumb(breadcrumb) {
      // The SDK patches history.replaceState, so the very call that STRIPS a key
      // from the address bar records the pre-strip url as `data.from` — and the
      // breadcrumb then rides with every later event on that page load (#661).
      if (breadcrumb && breadcrumb.category === 'navigation' && breadcrumb.data) {
        ['from', 'to'].forEach((key) => {
          if (typeof breadcrumb.data[key] === 'string') {
            breadcrumb.data[key] = scrubAuthParams(breadcrumb.data[key]);
          }
        });
      }

      return breadcrumb;
    },

    beforeSend(event, hint) {
      // The console line lands FIRST, before any gate: a dropped event is still
      // an error the developer wants to see in devtools.
      logger.error('Caught error:', {
        message: event.message || (event.exception?.values?.[0]?.value) || 'Unknown error',
        level:   event.level,
        hint,
      });

      if (isDevelopment && isDevelopment()) {
        logger.log('Development mode — not sending');
        return null;
      }
      if (isLighthouse()) {
        logger.log('Lighthouse detected — not sending');
        return null;
      }
      if (isAutomatedBrowser()) {
        logger.log('Automated browser detected — not sending');
        return null;
      }
      if (!isFrameworkEvent(event)) {
        logger.log('Not from an @omega.js bundle — not sending');
        return null;
      }

      event.tags = {
        ...event.tags,
        'process.type':        'browser',
        'usage.session.hours': ((Date.now() - startTime) / (1000 * 3600)).toFixed(2),
        ...(getTags ? getTags() : {}),
      };

      // The other half of the #661 scrub: httpContext attaches the address bar
      // as the request url when the event is CAPTURED, key and all.
      if (typeof event.request?.url === 'string') {
        event.request.url = scrubAuthParams(event.request.url);
      }

      // PII: the uid is the join key to the account and rides; the email is
      // scrubbed unless `monitoring.providers.sentry.scrubEmail: false` opts in.
      const user = normalizeUser(getUser ? getUser() : null, options);
      if (user) {
        event.user = { ...event.user, ...user };
      }

      return event;
    },
  };
}

module.exports = { buildInitOptions, isLighthouse, isAutomatedBrowser, scrubAuthParams };
