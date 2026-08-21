/**
 * main — the Electron main-process entry (#380). Lifted from
 * @omega.js/desktop's lib/sentry/main.js, which proved the shape.
 *
 * Uncaught exceptions and unhandled rejections are captured BY THE SDK: an
 * @sentry/electron/main init installs `onUncaughtExceptionIntegration` and
 * node's `onUnhandledRejectionIntegration` by default. The host's own
 * process handlers (@omega.js/desktop logs both to runtime.log) are additive —
 * never a second capture.
 *
 * setUser / captureException / captureMessage exist for explicit reporting from
 * seams the SDK can't see.
 */

const { resolveConfig, normalizeUser, releaseTag } = require('./core.js');
const { readGates } = require('./env.js');
const { createLogger } = require('./logger.js');

const logger = createLogger('main');

const main = {
  _initialized: false,
  _enabled:     false,
  _options:     null,
  _Sentry:      null,

  /**
   * @param {object} host - the desktop Manager: { config, getVersion() }
   */
  initialize(host) {
    main._initialized = true;

    const { shouldEnable, options, reason } = resolveConfig(host && host.config && host.config.monitoring, readGates());
    main._options = options;

    if (!shouldEnable) {
      logger.log(`disabled — ${reason}`);
      main._enabled = false;
      return;
    }

    let Sentry;
    try {
      Sentry = require('@sentry/electron/main');
    } catch (e) {
      logger.warn(`@sentry/electron is not installed — reporting disabled. (${e.message})`);
      main._enabled = false;
      return;
    }

    // The one release format: the brand id from the resolved config, the app
    // version from electron (main's `app.getVersion()` is authoritative).
    const release = releaseTag({ id: host.config?.brand?.id, version: host.getVersion() });

    Sentry.init({
      dsn:              options.dsn,
      environment:      options.environment,
      release,
      sampleRate:       options.sampleRate,
      tracesSampleRate: options.tracesSampleRate,
      attachScreenshot: options.attachScreenshot,
    });

    main._Sentry = Sentry;
    main._enabled = true;
    logger.log(`initialized — env=${options.environment} release=${release}`);
  },

  setUser(user) {
    if (!main._enabled) return;
    main._Sentry.setUser(normalizeUser(user, main._options));
  },

  captureException(error, extra) {
    if (!main._enabled) {
      logger.warn(`captureException (no-op, reporting disabled): ${error?.message || error}`);
      return;
    }
    main._Sentry.captureException(error, extra ? { extra } : undefined);
  },

  captureMessage(message, level) {
    if (!main._enabled) {
      logger.log(`captureMessage (no-op, reporting disabled): ${message}`);
      return;
    }
    main._Sentry.captureMessage(message, level);
  },

  // Used by tests to reset state between cases.
  shutdown() {
    main._initialized = false;
    main._enabled     = false;
    main._options     = null;
    main._Sentry      = null;
  },
};

module.exports = main;
