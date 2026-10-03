/**
 * The client runtime's error reporting — a HOST of `@omega.js/monitoring`,
 * never a second copy of its policy (#380).
 *
 * What lives here is what only the client can know: when to load the SDK, which
 * release tag this page is (`brand.id@version`), where the signed-in user
 * comes from (the auth storage keys), and the public surface every consumer
 * calls — `omega.sentry.captureException(err)`.
 *
 * Everything else — the send gate, the @omega.js-bundle filter, the PII scrub,
 * the integrations — is the package's, shared with the backend and the desktop
 * main process so no surface can drift.
 */

import monitoring from '@omega.js/monitoring/browser';
import monitoringCore from '@omega.js/monitoring/core';
import { createLogger } from './logger.js';
import { whenSettled } from './dom.js';

const logger = createLogger('sentry');

// How long an idle wait may take: the idle callback's deadline, and the timer
// a browser with no requestIdleCallback waits instead
const IDLE_WAIT_MS = 3000;

// What a replayed event was caught by, marked the way the SDK's own global
// handlers mark theirs: unhandled, never a deliberate capture
const EARLY_ERROR_MECHANISMS = {
  error: 'auto.browser.global_handlers.onerror',
  unhandledrejection: 'auto.browser.global_handlers.onunhandledrejection',
};

// The page's early-error buffer, when one was installed (reporting is on)
function earlyErrorBuffer() {
  return typeof window !== 'undefined' ? window.__OMEGA_EARLY_ERRORS : null;
}

class Sentry {
  constructor(omega) {
    this.omega = omega;
    this.initialized = false;
    this.Sentry = null;
    this.config = null;
    this._earlyErrorsClosed = false;
  }

  /**
   * Start error tracking off the boot path: install the early-error buffer
   * now, and load the SDK once the page is idle.
   * @param {Object} config - the resolved Sentry settings for this surface
   */
  schedule(config) {
    monitoring.installEarlyErrorBuffer(window);

    // init() logs its own failure; a scheduled start has no caller to rethrow to.
    // Where requestIdleCallback is missing, a timer stands in for it.
    whenSettled(() => this.init(config).catch(() => {}), {
      doc: window.document,
      timeout: IDLE_WAIT_MS,
      fallbackDelay: IDLE_WAIT_MS,
    });
  }

  /**
   * Initialize Sentry error tracking
   * @param {Object} config - the resolved Sentry settings for this surface
   *   (the build maps `monitoring.providers.sentry` into `config.sentry.config`)
   * @returns {Promise} Resolves when initialization is complete
   */
  init(config = {}) {
    // Dynamically imported to keep the SDK out of the initial chunk — and
    // never reached at all when the config carries no DSN (index.js gates on
    // `config.sentry.enabled`, which the build maps from
    // `monitoring.providers.sentry.dsn`).
    return import('@sentry/browser')
      .then((sdk) => {
        this.Sentry = sdk;

        // Expose globally so page code and devtools can reach the same SDK
        if (typeof window !== 'undefined') {
          window.Sentry = sdk;
        }

        this.config = monitoring.buildInitOptions({
          Sentry: sdk,
          config,
          release: monitoringCore.releaseTag({
            id: this.omega.config.brand?.id,
            // The host blob's app version when it carries one (@omega.js/extension
            // bakes it, and it is the same key device stats read) — the build stamp
            // is the fallback for a surface that ships no version yet.
            version: this.omega.config.version || this.omega.config.buildTime,
          }),
          // The ONE environment surface (#817), never the raw baked fact: the
          // instance's getEnvironment() is the same module every other OMEGA
          // target answers from, so an artifact that baked no environment
          // throws by name here instead of tagging every event `undefined`.
          environment: this.omega.getEnvironment(),
          isDevelopment: () => this.omega.isDevelopment(),
          getUser: () => {
            // The stored auth state holds the User as its stored document
            // (User.toJSON), so identity sits under the document's `auth` branch
            const storage = this.omega.storage;
            return {
              uid: storage.get('auth.user.auth.uid', ''),
              email: storage.get('auth.user.auth.email', ''),
            };
          },
        });

        sdk.init(this.config);
        this.initialized = true;
        this._replayEarlyErrors();

        return { initialized: true };
      })
      .catch((error) => {
        logger.error('Failed to initialize:', error);
        // No SDK will ever replay the buffer: let go of it rather than grow it
        this._closeEarlyErrors();
        throw error;
      });
  }

  /**
   * Hand everything the early-error buffer kept to the SDK's capture path, so
   * the filters apply: from here on the SDK's own handlers capture, and each
   * error is captured once.
   */
  _replayEarlyErrors() {
    this._closeEarlyErrors().forEach((entry) => {
      if (entry.type === 'capture') {
        this.Sentry.captureException(entry.error, entry.context);
        return;
      }

      const error = entry.type === 'unhandledrejection' ? entry.reason : (entry.error || entry.message);
      this.Sentry.captureException(error, { mechanism: { handled: false, type: EARLY_ERROR_MECHANISMS[entry.type] } });
    });
  }

  /**
   * Stop the early-error buffer's listeners and empty it, for good: after a
   * replay, or after an SDK load that failed.
   * @returns {Array} the entries it held
   */
  _closeEarlyErrors() {
    const buffer = earlyErrorBuffer();
    this._earlyErrorsClosed = true;

    if (!buffer) {
      return [];
    }

    buffer.stop();
    return buffer.splice(0);
  }

  /**
   * Capture an exception and send to Sentry
   * Safe to call even if Sentry is not initialized: before the SDK has loaded,
   * the capture waits in the early-error buffer (when reporting is on)
   * @param {Error} error - The error to capture
   * @param {Object} captureContext - Additional context for the error
   * @returns {string|null} Event ID if successful, null otherwise
   */
  captureException(error, captureContext) {
    // Log the error
    logger.error('Capturing exception:', error);

    // Safe to call - won't throw if not initialized
    if (!this.initialized) {
      const buffer = this._earlyErrorsClosed ? null : earlyErrorBuffer();

      if (buffer) {
        logger.log('Not initialized, buffered for replay');
        buffer.push({ type: 'capture', error, context: captureContext });
        return null;
      }

      logger.log('Not initialized, skipping capture');
      return null;
    }

    // Call Sentry to capture the exception
    try {
      return this.Sentry.captureException(error, captureContext);
    } catch (captureError) {
      logger.error('Failed to capture exception:', captureError);
      return null;
    }
  }
}

export default Sentry;
