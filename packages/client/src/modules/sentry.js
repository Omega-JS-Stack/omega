import { createLogger } from './logger.js';

const logger = createLogger('sentry');

// Helper functions
function isLighthouse() {
  try {
    return typeof navigator !== 'undefined' && navigator.userAgent?.includes('Lighthouse');
  } catch (e) {
    return false;
  }
}

function isAutomatedBrowser() {
  try {
    return typeof navigator !== 'undefined' && navigator.webdriver === true;
  } catch (e) {
    return false;
  }
}

class mod {
  constructor(manager) {
    this.manager = manager;
    this.initialized = false;
    this.Sentry = null;
    this.config = null;
    // Session-hours baseline for beforeSend — no config key carries a page
    // start time (config.page was a legacy read nothing wrote).
    this._startTime = Date.now();
  }

  /**
   * Initialize Sentry error tracking
   * @param {Object} config - Sentry configuration object
   * @returns {Promise} Resolves when initialization is complete
   */
  init(config = {}) {
    return new Promise((resolve, reject) => {
      // Dynamically import Sentry to reduce initial bundle size
      import('@sentry/browser')
        .then((mod) => {
          // Store reference and expose globally
          this.Sentry = mod;

          // Add to window if window is defined
          if (typeof window !== 'undefined') {
            window.Sentry = mod;
          }

          // Build configuration with our defaults
          this.config = this._buildConfig(config);

          // Initialize Sentry
          this.Sentry.init(this.config);
          this.initialized = true;

          resolve({ initialized: true });
        })
        .catch((error) => {
          logger.error('Failed to initialize:', error);
          reject(error);
        });
    });
  }

  /**
   * Build Sentry configuration with defaults and integrations
   * @private
   */
  _buildConfig(userConfig) {
    const config = { ...userConfig };
    const manager = this.manager;

    // Set release version and environment
    config.release = `${manager.config.brand.id}@${manager.config.buildTime}`;
    config.environment = manager.config.environment || 'production';
    config.integrations = config.integrations || [];

    // Add browser tracing integration if not already present
    if (!config.integrations.some(i => i.name === 'BrowserTracing')) {
      config.integrations.push(this.Sentry.browserTracingIntegration());
    }

    // Add replay integration if sample rates are configured
    const hasReplays = (config.replaysSessionSampleRate > 0) ||
                      (config.replaysOnErrorSampleRate > 0);

    if (hasReplays && !config.integrations.some(i => i.name === 'Replay')) {
      config.integrations.push(this.Sentry.replayIntegration({
        maskAllText: false,
        blockAllMedia: false,
      }));
    }

    // Configure beforeSend to enrich events with user data and session info
    config.beforeSend = (event, hint) => {
      const hoursSinceStart = (Date.now() - this._startTime) / (1000 * 3600);
      const storage = this.manager.storage();

      // Add custom tags
      event.tags = {
        ...event.tags,
        'process.type': 'browser',
        'usage.session.hours': hoursSinceStart.toFixed(2),
      };

      // Add user info from storage
      event.user = {
        ...event.user,
        email: storage.get('auth.user.email', ''),
        uid: storage.get('auth.user.uid', ''),
      };

      // Log error to console for debugging
      logger.error('Caught error:', {
        message: event.message || (event.exception?.values?.[0]?.value) || 'Unknown error',
        level: event.level,
        tags: event.tags,
        user: event.user,
        hint
      });

      // Block sending in development mode
      if (this.manager.isDevelopment()) {
        logger.log('Development mode - not sending to Sentry');
        return null;
      }

      // Block sending if Lighthouse is running
      if (isLighthouse()) {
        logger.log('Lighthouse detected - not sending to Sentry');
        return null;
      }

      // Block sending if automated browser (Selenium, Puppeteer, etc.)
      if (isAutomatedBrowser()) {
        logger.log('Automated browser detected - not sending to Sentry');
        return null;
      }

      return event;
    };

    return config;
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

  // /**
  //  * Capture a message and send to Sentry
  //  * Safe to call even if Sentry is not initialized
  //  * @param {string} message - The message to capture
  //  * @param {string} level - Severity level (debug, info, warning, error, fatal)
  //  * @param {Object} captureContext - Additional context for the message
  //  * @returns {string|null} Event ID if successful, null otherwise
  //  */
  // captureMessage(message, level = 'info', captureContext) {
  //   if (!message) {
  //     logger.warn('captureMessage called with no message');
  //     return null;
  //   }

  //   logger.log(`Capturing message (${level}):`, message);

  //   // Safe to call - won't throw if not initialized
  //   if (!this.initialized || !this.Sentry) {
  //     logger.log('Not initialized, skipping capture');
  //     return null;
  //   }

  //   try {
  //     return this.Sentry.captureMessage(message, level, captureContext);
  //   } catch (captureError) {
  //     logger.error('Failed to capture message:', captureError);
  //     return null;
  //   }
  // }
}

export default mod;
