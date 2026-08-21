/**
 * preload — the Electron preload entry (#380). Lifted from
 * @omega.js/desktop's lib/sentry/preload.js.
 *
 * Minimal on purpose: the renderer SDK takes over the moment the renderer
 * initializes, and the preload scope is small and short-lived. No SDK boots
 * here — this is only a surface the preload script can call to report a setup
 * error thrown before the renderer loads.
 */

const { resolveConfig } = require('./core.js');
const { readGates } = require('./env.js');
const { createLogger } = require('./logger.js');

const logger = createLogger('preload');

const preload = {
  _enabled: false,

  /**
   * @param {object} host - the desktop Manager: { config }
   */
  initialize(host) {
    const { shouldEnable, reason } = resolveConfig(host && host.config && host.config.monitoring, readGates());
    preload._enabled = shouldEnable;
    if (!shouldEnable) logger.log(`disabled — ${reason}`);
  },

  // Forward to the renderer SDK when it exists in this context (it does, once
  // the renderer module has initialized). Otherwise a no-op — preload is short-lived.
  captureException(error) {
    if (!preload._enabled) return;
    try {
      const Sentry = require('@sentry/electron/renderer');
      Sentry.captureException(error);
    } catch (e) { /* the SDK is not available in this context */ }
  },

  // Used by tests to reset state between cases.
  shutdown() {
    preload._enabled = false;
  },
};

module.exports = preload;
