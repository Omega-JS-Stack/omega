/**
 * The client runtime's error reporting — a HOST of `@omega.js/monitoring`,
 * never a second copy of its policy (#380).
 *
 * What lives here is what only the client can know: when to load the SDK, which
 * release tag this page is (`brand.id@version`), where the signed-in user
 * comes from (the auth storage keys), and the public surface every consumer
 * calls — `omega.sentry().captureException(err)`.
 *
 * Everything else — the send gate, the @omega.js-bundle filter, the PII scrub,
 * the integrations — is the package's, shared with the backend and the desktop
 * main process so no surface can drift.
 */

import monitoring from '@omega.js/monitoring/browser';
import monitoringCore from '@omega.js/monitoring/core';
import { createLogger } from './logger.js';

const logger = createLogger('sentry');

class mod {
  constructor(manager) {
    this.manager = manager;
    this.initialized = false;
    this.Sentry = null;
    this.config = null;
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
            id: this.manager.config.brand?.id,
            // The host blob's app version when it carries one (@omega.js/extension
            // bakes it, and it is the same key device stats read) — the build stamp
            // is the fallback for a surface that ships no version yet.
            version: this.manager.config.version || this.manager.config.buildTime,
          }),
          environment: this.manager.config.environment,
          isDevelopment: () => this.manager.isDevelopment(),
          getUser: () => {
            const storage = this.manager.storage();
            return {
              uid: storage.get('auth.user.uid', ''),
              email: storage.get('auth.user.email', ''),
            };
          },
        });

        sdk.init(this.config);
        this.initialized = true;

        return { initialized: true };
      })
      .catch((error) => {
        logger.error('Failed to initialize:', error);
        throw error;
      });
  }

  /**
   * Capture an exception and send to Sentry
   * Safe to call even if Sentry is not initialized
   * @param {Error} error - The error to capture
   * @param {Object} captureContext - Additional context for the error
   * @returns {string|null} Event ID if successful, null otherwise
   */
  captureException(error, captureContext) {
    // Log the error
    logger.error('Capturing exception:', error);

    // Safe to call - won't throw if not initialized
    if (!this.initialized) {
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

export default mod;
