/**
 * The OMEGA service worker manager — the master-service-worker successor.
 * Bundled (esbuild iife) from the consumer's src/service-worker.js entry
 * (or the packaged default) to dist root /service-worker.js.
 *
 * Config transport: the build emits /build.js (`self.OMEGA_BUILD_JSON = {…}`)
 * with the brand id, environment, version, cacheBreaker, main asset URLs and
 * firebase config — imported synchronously below, BEFORE the class reads it.
 * Because the registration uses `updateViaCache: 'none'`, a changed /build.js
 * (new build, or a DIFFERENT project on the same localhost port) makes the
 * browser install this worker fresh: skipWaiting + clients.claim take the
 * scope over immediately, and initialize() evicts every cache that doesn't
 * carry this brand+build's name. One project per origin, self-healing.
 */
const sw = self;

// Build config — synchronous, top-level (importScripts cannot run later)
importScripts('/build.js');

// ⚠️ Global listeners BEFORE the Firebase imports — firebase-messaging
// registers its own notificationclick handler, and ours must come first:
// https://stackoverflow.com/questions/78270541
setupGlobalHandlers();

// Firebase compat libraries for background messaging (FCM push). The version
// is pinned at build time to @omega.js/client's own firebase dependency.
importScripts(
  `https://www.gstatic.com/firebasejs/${__OMEGA_FIREBASE_VERSION__}/firebase-app-compat.js`,
  `https://www.gstatic.com/firebasejs/${__OMEGA_FIREBASE_VERSION__}/firebase-messaging-compat.js`,
);

// Manager Class
class Manager {
  constructor() {
    // Properties
    this.serviceWorker = null;

    // Load config from the emitted /build.js
    this.config = sw.OMEGA_BUILD_JSON || {};

    // Defaults
    this.brand = this.config.brand || 'default';
    this.environment = this.config.environment || 'production';
    this.cache = {
      breaker: this.config.cacheBreaker || new Date().getTime(),
    };
    this.cache.name = `${this.brand}-${this.cache.breaker}`;

    // Libraries
    this.libraries = {
      firebase: false,
      messaging: false,
    };
  }

  // Initialize
  async initialize() {
    // Properties
    this.serviceWorker = sw;

    // Setup instance-specific message handlers
    this.setupInstanceHandlers();

    // Initialize Firebase
    this.initializeFirebase();

    // Evict caches that don't belong to this brand+build — a previous build's
    // caches, or a DIFFERENT project's caches left on this origin (the
    // localhost:4000 case). Then warm this build's cache.
    await this.cleanCaches();
    this.updateCache();

    // Log
    console.log(`[service-worker] Initialized: ${this.cache.name} (${this.environment})`, sw.location.pathname);

    // Return
    return sw;
  }

  // Setup instance-specific message handlers
  setupInstanceHandlers() {
    sw.addEventListener('message', (event) => {
      // Get the data
      const data = event.data || {};

      // Parse the data
      const command = data.command || '';
      const payload = data.payload || {};

      // Quit if no command
      if (!command) {
        return;
      }

      // Log
      console.log('[service-worker] message', command, payload);

      // Handle commands
      if (command === 'update-cache') {
        const pages = payload.pages || [];
        this.updateCache(pages)
          .then(() => {
            event.ports[0]?.postMessage({ status: 'success' });
          })
          .catch((error) => {
            event.ports[0]?.postMessage({ status: 'error', error: error.message });
          });
      }
    });
  }

  // Setup Firebase init
  initializeFirebase() {
    // Get Firebase config
    const firebaseConfig = this.config.firebase;

    // Check if Firebase config is available
    if (!firebaseConfig) {
      console.log('[service-worker] Firebase config not available, skipping Firebase initialization');
      return;
    }

    // Check if already initialized
    if (this.libraries.firebase) {
      return;
    }

    // Initialize app (libraries were already imported at the top)
    firebase.initializeApp(firebaseConfig);

    // Initialize messaging
    this.libraries.messaging = firebase.messaging();

    // Handle background push messages (when the page is not focused)
    this.libraries.messaging.onBackgroundMessage((payload) => {
      console.log('[service-worker] Background message received:', payload);

      const notification = payload.notification || {};
      const data = payload.data || {};

      const title = notification.title || 'New notification';
      const options = {
        body: notification.body || '',
        icon: notification.icon || notification.image || '/assets/images/favicon/favicon-192x192.png',
        data: payload,
      };

      if (data.click_action) {
        options.data.click_action = data.click_action;
      }

      sw.registration.showNotification(title, options);
    });

    // Attach firebase to the manager
    this.libraries.firebase = firebase;
  }

  // Delete every cache on this origin that isn't THIS brand+build's cache
  cleanCaches() {
    return caches.keys()
      .then((names) => {
        const stale = names.filter((name) => name !== this.cache.name);
        return Promise.all(stale.map((name) => caches.delete(name)))
          .then(() => {
            if (stale.length > 0) {
              console.log('[service-worker] Evicted stale caches:', stale);
            }
          });
      })
      .catch((error) => console.error('[service-worker] Failed to clean caches:', error));
  }

  // Setup cache update
  updateCache(pages) {
    // Set default resources to cache: the home page + the main bundles
    // (their URLs ride /build.js — hashed names in production builds)
    const defaults = ['/', this.config.assets?.js, this.config.assets?.css].filter(Boolean);

    // Ensure pages is an array
    pages = pages || [];

    // Merge with additional pages
    const pagesToCache = [...new Set([...defaults, ...pages])];

    // Open cache and add pages
    return caches.open(this.cache.name)
      .then((cache) => cache.addAll(pagesToCache))
      .then(() => console.log('[service-worker] Cached resources:', pagesToCache))
      .catch((error) => console.error('[service-worker] Failed to cache resources:', error));
  }
}

// Helper: Setup global listeners
// Called at top-level before the Firebase imports so these register first
function setupGlobalHandlers() {
  // Force this service worker to take the scope over immediately — the
  // cross-project takeover depends on it
  sw.addEventListener('install', () => {
    sw.skipWaiting();
  });

  sw.addEventListener('activate', (event) => {
    event.waitUntil(sw.clients.claim());
  });

  // Handle clicks on notifications
  // ⚠️ MUST be registered before the Firebase imports
  sw.addEventListener('notificationclick', (event) => {
    // Get the properties of the notification
    const notification = event.notification;
    const data = (notification.data && notification.data.FCM_MSG ? notification.data.FCM_MSG.data : null) || {};
    const payload = (notification.data && notification.data.FCM_MSG ? notification.data.FCM_MSG.notification : null) || {};

    // Get the click action
    const clickAction = payload.click_action || data.click_action || '/';

    // Log
    console.log('[service-worker] notificationclick', clickAction, event);

    // Handle the click
    event.waitUntil(
      sw.clients.openWindow(clickAction)
    );

    // Close the notification
    notification.close();
  });
}

// Export
export default Manager;
