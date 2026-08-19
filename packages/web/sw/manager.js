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
 *
 * ⚠️ NO fetch handler, ON PURPOSE (Ian 2026-07-18: page speed wins) — with
 * no fetch listener the browser skips SW startup for navigations entirely,
 * so pages load at full network speed. Adding offline caching means adding
 * a fetch handler, which taxes EVERY request through the worker; don't.
 */
const sw = self;

// The base path this site is mounted under (#355/#360). A worker has no
// document to read the `data-omega-path-prefix` stamp from, so @omega.js/client
// hands the value over on this script's query string at registration time —
// which also scopes the worker to `<prefix>/`. Empty means the domain root.
const PATH_PREFIX = new URLSearchParams(sw.location.search).get('omega-path-prefix') || '';

// Mount a root-relative site URL under that base path. A no-op at the domain
// root, and anything the payload supplies (absolute URLs from FCM) is left alone.
function sitePath(url) {
  if (!PATH_PREFIX || typeof url !== 'string') return url;
  if (!url.startsWith('/') || url.startsWith('//')) return url;

  return `${PATH_PREFIX}${url}`;
}

// Cache warming is DISABLED (Ian 2026-07-18: page speed wins — nothing reads
// the cache today, and no fetch handler exists to serve from it). The
// machinery stays wired (updateCache + the update-cache message command) so
// this single flag re-enables it if an offline/caching lane ever lands.
const CACHE_WARMING_ENABLED = false;

// Build config — synchronous, top-level (importScripts cannot run later)
importScripts(sitePath('/build.js'));

// ⚠️ Global listeners BEFORE the Firebase imports — firebase-messaging
// registers its own notificationclick handler, and ours must come first:
// https://stackoverflow.com/questions/78270541
setupGlobalHandlers();

// Firebase compat libraries for background messaging (FCM push). The version
// is pinned at build time to @omega.js/client's own firebase dependency.
// Skipped when the brand has no firebase config, and guarded either way — a
// failed CDN fetch (offline, CSP, blocked gstatic) must never abort script
// evaluation and take down the SW's cache-eviction/takeover role.
let firebaseScriptsLoaded = false;
if (sw.OMEGA_BUILD_JSON && sw.OMEGA_BUILD_JSON.firebase) {
  try {
    importScripts(
      `https://www.gstatic.com/firebasejs/${__OMEGA_FIREBASE_VERSION__}/firebase-app-compat.js`,
      `https://www.gstatic.com/firebasejs/${__OMEGA_FIREBASE_VERSION__}/firebase-messaging-compat.js`,
    );
    firebaseScriptsLoaded = true;
  } catch (e) {
    console.error('[service-worker] Firebase libraries failed to load; push messaging disabled:', e);
  }
}

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
    // localhost:4000 case). Then warm this build's cache (a no-op while
    // CACHE_WARMING_ENABLED is off — eviction still clears leftovers).
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

    // Check the libraries actually loaded (guarded top-level importScripts)
    if (!firebaseScriptsLoaded) {
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
        icon: notification.icon || notification.image || sitePath('/assets/images/favicon/favicon-192x192.png'),
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

  // Setup cache update — disabled by CACHE_WARMING_ENABLED (see top of file)
  updateCache(pages) {
    if (!CACHE_WARMING_ENABLED) {
      return Promise.resolve();
    }

    // Set default resources to cache: the home page + the main bundles
    // (their URLs ride /build.js — hashed names in production builds)
    const defaults = ['/', this.config.assets?.js, this.config.assets?.css].filter(Boolean).map(sitePath);

    // Ensure pages is an array, mounted the same way the defaults are: the
    // update-cache caller supplies SITE-relative pages (it knows nothing about
    // this worker's base path), so they ride sitePath() too
    pages = (pages || []).map(sitePath);

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
    const clickAction = payload.click_action || data.click_action || sitePath('/');

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
