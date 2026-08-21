/**
 * renderer — the Electron renderer entry (#380). Lifted from
 * @omega.js/desktop's lib/sentry/renderer.js.
 *
 * Window `error` and `unhandledrejection` events are captured by the SDK
 * itself. No bundle filter runs here: a desktop renderer loads OUR pages only,
 * so every script in it is framework or brand code — the client-side filter is
 * for the open web, where the page shares a global with anything.
 */

const { resolveConfig, normalizeUser, releaseTag } = require('./core.js');
const { readGates } = require('./env.js');
const { createLogger } = require('./logger.js');

const logger = createLogger('renderer');

const renderer = {
  _initialized: false,
  _enabled:     false,
  _options:     null,
  _Sentry:      null,

  /**
   * @param {object} host - the desktop Manager: { config, getVersion() }
   */
  initialize(host) {
    renderer._initialized = true;

    const { shouldEnable, options, reason } = resolveConfig(host && host.config && host.config.monitoring, readGates());
    renderer._options = options;

    if (!shouldEnable) {
      logger.log(`disabled — ${reason}`);
      renderer._enabled = false;
      return;
    }

    let Sentry;
    try {
      Sentry = require('@sentry/electron/renderer');
    } catch (e) {
      logger.warn(`@sentry/electron is not installed — reporting disabled. (${e.message})`);
      renderer._enabled = false;
      return;
    }

    // Same tag main builds — one release, both processes.
    const release = releaseTag({ id: host.config?.brand?.id, version: host.getVersion() });

    Sentry.init({
      dsn:              options.dsn,
      environment:      options.environment,
      release,
      sampleRate:       options.sampleRate,
      tracesSampleRate: options.tracesSampleRate,
    });

    renderer._Sentry = Sentry;
    renderer._enabled = true;
    logger.log(`initialized — env=${options.environment} release=${release}`);
  },

  setUser(user) {
    if (!renderer._enabled) return;
    renderer._Sentry.setUser(normalizeUser(user, renderer._options));
  },

  captureException(error, extra) {
    if (!renderer._enabled) return;
    renderer._Sentry.captureException(error, extra ? { extra } : undefined);
  },

  captureMessage(message, level) {
    if (!renderer._enabled) return;
    renderer._Sentry.captureMessage(message, level);
  },

  // Used by tests to reset state between cases.
  shutdown() {
    renderer._initialized = false;
    renderer._enabled     = false;
    renderer._options     = null;
    renderer._Sentry      = null;
  },
};

module.exports = renderer;
