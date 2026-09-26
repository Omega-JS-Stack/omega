// The ONE build snapshot (#743): `/build.js` is written by the bundle task and
// packaged with the artifact, and a classic MV3 service worker loads it the way
// every OMEGA worker does. First line on purpose, so `self.OMEGA_BUILD_JSON` is
// there before anything below reads it.
importScripts('/build.js');

// Libraries
import extension from './lib/extension.js';
import LoggerLite from './lib/logger-lite.js';
import { Omega as BaseOmega } from './omega.js';
import { BackgroundAuth } from './lib/background-auth.js';
import { createRequest } from '@omega.js/client/modules/request.js';

// Variables
const serviceWorker = self;

// Install-lane logger. MODULE level, not an instance property: the install
// listener is registered by setupGlobalHandlers(), which runs bare at top
// level before the instance exists, so `this` is undefined in there.
const installLogger = new LoggerLite('install');

// Cache warming is DISABLED (same call as the web SW: page speed wins,
// nothing reads it): this cache is write-only, one caches.open, zero reads
// anywhere in the extension, and no context even sends 'update-cache' today.
// The machinery stays wired (updateCache + the message command) so this
// single flag re-enables it if an offline lane ever lands.
const CACHE_WARMING_ENABLED = false;

// ⚠️⚠️⚠️ CRITICAL: Setup global listeners BEFORE any async operations ⚠️⚠️⚠️
// https://stackoverflow.com/questions/78270541/cant-catch-fcm-notificationclick-event-in-service-worker-using-firebase-messa
// Note: ES6 static imports above are fine - they're hoisted and bundled by the build.
setupGlobalHandlers();

/**
 * The background service worker's runtime: the extension base plus the auth
 * source of truth (`auth`, a BackgroundAuth), the API fetch (`request()`), the
 * worker's own message event, the page cache and livereload.
 */
class Omega extends BaseOmega {
  constructor() {
    super('background');

    // The service worker global
    this.serviceWorker = serviceWorker;

    // Defaults
    this.brand = this.config.brand || { name: 'unknown' };
    this.brand.id = this.config.brand?.id || 'extension';
    const breaker = this.config.buildTime || new Date().getTime();
    this.cache = {
      breaker,
      name: `${this.brand.id}-${breaker}`,
    };

    // Background's own Firebase app and session: the source of truth
    this.auth = new BackgroundAuth(this);

    // The harmonized API fetch (omega.request), the page contexts' own shape:
    // a fresh Bearer token from this worker's session when signed in
    this._request = createRequest({
      getApiUrl: () => this.getApiUrl(),
      getIdToken: (force) => this.auth.getIdToken(force),
    });
  }

  // Make an API request: `omega.request('/omega/user/token', { method: 'POST', body: {} })`,
  // with @omega.js/client's options (`auth: false`, `output: 'complete'`, `wakeup: true`)
  request(url, options) {
    return this._request(url, options);
  }

  /**
   * Settle `ready`, then wire the worker: its message event, the auth lane,
   * and livereload.
   * @returns {Promise<Omega>} the instance.
   */
  async initialize() {
    await super.initialize();

    // Setup instance-specific message handlers
    this.setupInstanceHandlers();

    // The auth lane: the page contexts' sync and sign-out messages, the
    // website sign-in redirect, the persisted session
    this.auth.initialize();

    // Setup livereload
    this.setupLiveReload();

    // Log
    this.logger.log('Initialized!', this.version, this.cache.name, this);
    this.logger.log('Config loaded from OMEGA_BUILD_JSON:', this.config);

    return this;
  }

  // Setup instance-specific message handlers: the service worker's own
  // `message` event (the page contexts talk to background over the messenger)
  setupInstanceHandlers() {
    // Send messages: https://stackoverflow.com/questions/35725594/how-do-i-pass-data-like-a-user-id-to-a-web-worker-for-fetching-additional-push
    // more messaging: http://craig-russell.co.uk/2016/01/29/background-messaging.html#.XSKpRZNKiL8
    serviceWorker.addEventListener('message', (event) => {
      // Get the data
      const data = event.data || {};

      // Parse the data
      const command = data.command || '';
      const payload = data.payload || {};

      // Quit if no command
      if (!command) return;

      // Log
      this.logger.log('message', command, payload, event);

      // Handle commands
      if (command === 'update-cache') {
        const pages = payload.pages || [];
        this.updateCache(pages)
          .then(() => {
            event.ports[0]?.postMessage({ status: 'success' });
          })
          .catch(error => {
            event.ports[0]?.postMessage({ status: 'error', error: error.message });
          });
      }
    });

    // Log
    this.logger.log('Set up message handlers');
  }

  // Update cache: disabled by CACHE_WARMING_ENABLED (see top of file)
  updateCache(pages) {
    if (!CACHE_WARMING_ENABLED) {
      return Promise.resolve();
    }

    // Set default pages to cache
    const defaults = [
      '/',
      '/assets/css/main.bundle.css',
      '/assets/js/main.bundle.js',
    ];

    // Ensure pages is an array
    pages = pages || [];

    // Merge with additional pages
    const pagesToCache = [...new Set([...defaults, ...pages])];

    // Open cache and add pages
    return caches.open(this.cache.name)
      .then(cache => cache.addAll(pagesToCache))
      .then(() => this.logger.log('Cached resources:', pagesToCache))
      .catch(error => this.logger.error('Failed to cache resources:', error));
  }

  // Setup livereload
  setupLiveReload() {
    // Dev-only feature: skip in testing and production, where no watcher
    // serves the reload socket
    if (!this.isDevelopment()) return;

    // Get port from config or use default
    const port = this.config.dev?.liveReloadPort || 35729;

    // Setup livereload
    const address = `ws://localhost:${port}/livereload`;
    let connection;
    let isReconnecting = false; // Flag to track reconnections

    // Log
    this.logger.log(`Setting up live reload on ${address}...`);

    // Function to establish a connection
    const connect = () => {
      connection = new WebSocket(address);

      // Log connection
      this.logger.log(`Reload connecting to ${address}...`);

      // Log connection errors
      connection.onerror = (e) => {
        this.logger.error('Reload connection got error:', e);
      };

      // Log when set up correctly
      connection.onopen = () => {
        this.logger.log('Reload connection set up!');

        // Reload the extension only on reconnections
        if (isReconnecting) {
          // reload();
        }

        // Reset the reconnection flag
        isReconnecting = false;
      };

      // Handle connection close and attempt to reconnect
      connection.onclose = () => {
        // Set time
        const seconds = 1;

        // Log
        this.logger.log(`Reload connection closed. Attempting to reconnect in ${seconds} second(s)...`);

        // Set the reconnection flag
        isReconnecting = true;

        // Reconnect
        setTimeout(connect, seconds * 1000); // Retry
      };

      // Handle incoming messages
      connection.onmessage = (event) => {
        if (!event.data) {
          return;
        }

        // Get data
        const data = JSON.parse(event.data);

        // Log
        this.logger.log('Reload connection got message:', data);

        // Handle reload command
        if (data && data.command === 'reload') {
          reload();
        }
      };
    };

    const reload = () => {
      this.logger.log('Reloading extension...');
      setTimeout(() => {
        this.extension.runtime.reload();
      }, 1000);
    };

    // Start the initial connection
    connect();
  }
}

// Helper: Setup global listeners
// This is called at top-level before any async operations to ensure listeners are registered first
function setupGlobalHandlers() {
  // Force service worker to use the latest version
  serviceWorker.addEventListener('install', (event) => {
    serviceWorker.skipWaiting();
  });

  // Handle extension install/update
  extension.runtime.onInstalled.addListener((details) => {
    // Only open tab on fresh install (not updates)
    if (details.reason !== 'install') {
      return;
    }

    // Get website URL from config
    const config = serviceWorker.OMEGA_BUILD_JSON?.config || {};
    const website = config?.brand?.url;

    // Skip if no website configured
    if (!website) {
      installLogger.log('No website configured, skipping install page');
      return;
    }

    // Open the installed page
    const installedUrl = `${website}/extension/installed`;
    installLogger.log('Opening install page:', installedUrl);

    extension.tabs.create({ url: installedUrl });
  });

  serviceWorker.addEventListener('activate', (event) => {
    event.waitUntil(serviceWorker.clients.claim());
  });

  // Handle clicks on notifications
  // ⚠️ MUST be registered before any async operations
  serviceWorker.addEventListener('notificationclick', (event) => {
    // Get the properties of the notification
    const notification = event.notification;
    const data = (notification.data && notification.data.FCM_MSG ? notification.data.FCM_MSG.data : null) || {};
    const payload = (notification.data && notification.data.FCM_MSG ? notification.data.FCM_MSG.notification : null) || {};

    // Get the click action
    const clickAction = payload.click_action || data.click_action || '/';

    // Log
    console.log('notificationclick event', event);
    console.log('notificationclick data', data);
    console.log('notificationclick payload', payload);
    console.log('notificationclick clickAction', clickAction);

    // Handle the click
    event.waitUntil(
      clients.openWindow(clickAction)
    );

    // Close the notification
    notification.close();
  });
}

const omega = new Omega();

export default omega;
export { Omega };
