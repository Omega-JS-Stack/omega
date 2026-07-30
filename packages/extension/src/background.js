// Libraries
import extension from './lib/extension.js';
import LoggerLite from './lib/logger-lite.js';
import { attachTo as attachModeHelpers } from './utils/mode-helpers.js';
import { attachTo as attachUrlHelpers } from './utils/url-helpers.js';
import { createRequest } from '@omega.js/client/modules/request.js';

// Firebase (static imports - dynamic import() doesn't work in service workers with webpack chunking)
import { initializeApp, getApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, onAuthStateChanged, connectAuthEmulator } from 'firebase/auth';

// Variables
const serviceWorker = self;

// Install-lane logger. MODULE level, not an instance property: the install
// listener is registered by setupGlobalHandlers(), which runs bare at top
// level before any Manager exists — `this` is undefined in there.
const installLogger = new LoggerLite('install');

// Cache warming is DISABLED (same call as the web SW — page speed wins,
// nothing reads it): this cache is write-only — one caches.open, zero reads
// anywhere in the extension, and no context even sends 'update-cache' today.
// The machinery stays wired (updateCache + the message command) so this
// single flag re-enables it if an offline lane ever lands.
const CACHE_WARMING_ENABLED = false;

// Auth emulator port for TESTING builds. An extension context has no
// `process.env`, so a bumped port can't reach here — the auth-emulator lane
// pins the classic default (mirrors url-helpers' classic-5002 hosting note).
const AUTH_EMULATOR_PORT = 9099;

// Import build config at the top level (synchronous)
importScripts('/build.js');

// ⚠️⚠️⚠️ CRITICAL: Setup global listeners BEFORE any async operations ⚠️⚠️⚠️
// https://stackoverflow.com/questions/78270541/cant-catch-fcm-notificationclick-event-in-service-worker-using-firebase-messa
// Note: ES6 static imports above are fine - they're hoisted and bundled by webpack.
// The issue is with importScripts() calls which must be synchronous at top-level.
setupGlobalHandlers();

// Class
class Manager {
  constructor() {
    // Properties
    this.extension = null;
    this.logger = null;
    this.authLogger = null;
    this.serviceWorker = null;

    // Load config from build.js
    this.config = serviceWorker.OMEGA_BUILD_JSON?.config || {};

    // Defaults
    this.version = this.config?.version || 'unknown';
    this.brand = this.config?.brand || { name: 'unknown' };
    this.brand.id = this.config?.brand?.id || 'extension';
    this.environment = this.config?.omega?.environment || 'production';
    this.libraries = {
      firebase: null,
      firebaseAuth: null,
      messaging: false,
      promoServer: false,
    };
    this.cache = {
      breaker: this.config?.omega?.cache_breaker || new Date().getTime(),
      name: ''
    };
  }

  // Initialize
  async initialize() {
    // Set properties
    this.extension = extension;
    this.logger = new LoggerLite('background');
    this.authLogger = new LoggerLite('auth');
    this.serviceWorker = serviceWorker;

    // Parse config file
    this.parseConfiguration();

    // Setup instance-specific message handlers
    this.setupInstanceHandlers();

    // Initialize Firebase
    this.initializeFirebase();

    // Setup auth token listener (for cross-runtime auth)
    this.setupAuthTokenListener();

    // Initialize Firebase auth on startup (restores persisted session if any)
    this.initializeAuth();

    // Setup livereload
    this.setupLiveReload();

    // Log
    this.logger.log('Initialized!', this.version, this.cache.name, this);
    this.logger.log('Config loaded from OMEGA_BUILD_JSON:', this.config);

    // Return manager instance
    return this;
  }

  // Parse configuration
  parseConfiguration() {
    try {
      // Set cache name
      this.cache.name = `${this.brand.id}-${this.cache.breaker}`;
    } catch (e) {
      this.logger.error('Error parsing configuration', e);
    }
  }

  // Setup instance-specific message handlers
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

    // Listen for runtime messages (from popup, options, pages, etc.)
    this.extension.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      // Handle auth sync requests - contexts ask background for auth state on load
      if (message.command === 'omega:syncAuth') {
        this.handleSyncAuth(message, sendResponse);
        return true; // Keep channel open for async response
      }

      // Handle sign-out requests from contexts
      if (message.command === 'omega:signOut') {
        this.handleSignOut(sendResponse);
        return true; // Keep channel open for async response
      }
    });

    // Log
    this.logger.log('Set up message handlers');
  }

  // Handle auth sync request from other contexts (popup, page, options, sidepanel)
  // Compares context's UID with background's UID and provides fresh token only if different
  async handleSyncAuth(message, sendResponse) {
    try {
      const contextUid = message.contextUid || null; // UID from asking context (or null)

      // Get or initialize Firebase auth
      const auth = this.getFirebaseAuth();
      const bgUser = auth.currentUser;
      const bgUid = bgUser?.uid || null;

      this.authLogger.log('syncAuth: Comparing UIDs - context:', contextUid, 'background:', bgUid);

      // Already in sync (both null, or same UID)
      if (contextUid === bgUid) {
        this.authLogger.log('syncAuth: Already in sync');
        sendResponse({ needsSync: false });
        return;
      }

      // Context is signed in but background is not → context should sign out
      if (!bgUser && contextUid) {
        this.authLogger.log('syncAuth: Background signed out, telling context to sign out');
        sendResponse({ needsSync: true, signOut: true });
        return;
      }

      // Background is signed in, context is not (or different user) → provide token
      this.authLogger.log('syncAuth: Fetching fresh custom token for context...', bgUser.email);

      // Fetch a fresh custom token from the /user/token route via the shared
      // request layer (uid defaults server-side to the authenticated caller).
      // getApiUrl() throws when brand.url is missing — a misconfigured
      // brand should fail loudly, never call a foreign host.
      const request = createRequest({
        getApiUrl: () => this.getApiUrl(),
        getIdToken: (force) => bgUser.getIdToken(force),
      });
      const data = await request('/omega/user/token', { method: 'POST', body: {} });

      // Check for token in response ({ token } at the top level)
      if (!data.token) {
        throw new Error('No token in server response');
      }

      this.authLogger.log('syncAuth: Got fresh custom token, sending to context');

      // Send user info and fresh custom token
      sendResponse({
        needsSync: true,
        customToken: data.token,
        user: {
          uid: bgUser.uid,
          email: bgUser.email,
          displayName: bgUser.displayName,
          photoURL: bgUser.photoURL,
          emailVerified: bgUser.emailVerified,
        },
      });

    } catch (error) {
      this.authLogger.error('syncAuth error:', error.message);
      sendResponse({ needsSync: false, error: error.message });
    }
  }

  // Handle sign-out request from a context
  // Signs out background's Firebase and broadcasts to all other contexts
  async handleSignOut(sendResponse) {
    try {
      this.authLogger.log('handleSignOut: Signing out background Firebase...');

      // Sign out background's Firebase
      if (this.libraries.firebaseAuth?.currentUser) {
        await this.libraries.firebaseAuth.signOut();
      }

      // Broadcast to all contexts
      await this.broadcastSignOut();

      this.authLogger.log('handleSignOut: Complete');
      sendResponse({ success: true });
    } catch (error) {
      this.authLogger.error('handleSignOut error:', error.message);
      sendResponse({ success: false, error: error.message });
    }
  }

  // Broadcast sign-out to all open extension contexts
  async broadcastSignOut() {
    try {
      const clients = await self.clients.matchAll({ type: 'all' });

      this.authLogger.log(`Broadcasting sign-out to ${clients.length} clients...`);

      for (const client of clients) {
        client.postMessage({ command: 'omega:signOut' });
      }

      this.authLogger.log('Sign-out broadcast complete');
    } catch (error) {
      this.authLogger.error('Error broadcasting sign-out:', error.message);
    }
  }

  // Initialize Firebase
  initializeFirebase() {
    // Get Firebase config
    const firebaseConfig = this.config?.cloud?.config;

    // Check if Firebase config is available
    if (!firebaseConfig) {
      this.logger.log('Firebase config not available yet, skipping Firebase initialization');
      return;
    }

    // Check if already initialized
    if (this.libraries.firebase) {
      this.logger.log('Firebase already initialized');
      return;
    }

    // Log
    this.logger.log('Initializing Firebase');

    // Initialize app (libraries were already imported at the top if uncommented)
    // firebase.initializeApp(firebaseConfig);

    // Initialize messaging
    // this.libraries.messaging = firebase.messaging();

    // Attach firebase to Manager
    // this.libraries.firebase = firebase;
  }

  // Update cache — disabled by CACHE_WARMING_ENABLED (see top of file)
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

  // Setup auth token listener (monitors tabs for auth tokens from website)
  setupAuthTokenListener() {
    // DEBUG: Log the full config to see what we have
    this.authLogger.log('setupAuthTokenListener called');
    this.authLogger.log('this.config:', this.config);
    this.authLogger.log('OMEGA_BUILD_JSON:', serviceWorker.OMEGA_BUILD_JSON);

    // The sign-in round trip lands on the BRAND site (/token redirects with
    // ?authToken=…), so match the brand.url host — never authDomain, which
    // is an auth concern that must stay free to change independently.
    const brandUrl = this.config?.brand?.url;

    // Skip if no brand url configured
    if (!brandUrl) {
      this.authLogger.log('No brand.url configured, skipping auth token listener');
      return;
    }

    const brandHost = new URL(brandUrl).hostname;

    // Log
    this.authLogger.log(`Setting up auth token listener for domain: ${brandHost}`);

    // Listen for tab URL changes
    this.extension.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      // Only process when URL changes and is complete
      if (changeInfo.status !== 'complete' || !tab.url) {
        return;
      }

      // Parse the URL
      let tabUrl;
      try {
        tabUrl = new URL(tab.url);
      } catch (e) {
        return;
      }

      // Log every tab update for auth domain matching
      this.authLogger.log(`Tab updated: ${tabUrl.hostname} (looking for: ${brandHost})`);

      // Check if this is our brand site
      if (tabUrl.hostname !== brandHost) {
        return;
      }

      // Log - we found our domain
      this.authLogger.log(`Auth domain matched! Checking for authToken param...`);

      // Check for authToken param
      const authToken = tabUrl.searchParams.get('authToken');
      if (!authToken) {
        this.authLogger.log(`No authToken param found in URL: ${tabUrl.href}`);
        return;
      }

      // Get source tab ID to restore after auth
      const authSourceTabId = tabUrl.searchParams.get('authSourceTabId');

      // Log
      this.authLogger.log('Auth token detected in tab:', tabId);

      // Handle the auth token
      this.handleAuthToken(authToken, tabId, authSourceTabId ? parseInt(authSourceTabId, 10) : null);
    });
  }

  // Initialize Firebase auth on startup
  // Firebase Auth persists sessions in IndexedDB - we just need to initialize it
  initializeAuth() {
    // Get Firebase config
    const firebaseConfig = this.config?.cloud?.config;
    if (!firebaseConfig) {
      this.authLogger.log('Firebase config not available, skipping auth initialization');
      return;
    }

    // Initialize Firebase auth - it will auto-restore from IndexedDB if session exists
    this.authLogger.log('Initializing Firebase Auth (will restore persisted session if any)...');
    const auth = this.getFirebaseAuth();

    // Check if already signed in (Firebase restored from IndexedDB)
    if (auth.currentUser) {
      this.authLogger.log('Firebase restored session from persistence:', auth.currentUser.email);
    } else {
      this.authLogger.log('No persisted Firebase session found');
    }
  }

  // Get or initialize Firebase auth (reuse existing instance)
  getFirebaseAuth() {
    // Return existing instance if available
    if (this.libraries.firebaseAuth) {
      return this.libraries.firebaseAuth;
    }

    // Get Firebase config
    const firebaseConfig = this.config?.cloud?.config;
    if (!firebaseConfig) {
      throw new Error('Firebase config not available');
    }

    // Try to get existing app or create new one
    try {
      this.libraries.firebase = getApp('omega-auth');
    } catch (e) {
      this.libraries.firebase = initializeApp(firebaseConfig, 'omega-auth');
    }

    // Get auth and set up state listener (only once)
    this.libraries.firebaseAuth = getAuth(this.libraries.firebase);

    // A TESTING build talks to the LOCAL stack, never real auth — the same
    // call getApiUrl() makes when it maps testing to localhost, and the same
    // move @omega.js/client makes for emulator runs. Only a build baked with
    // OMEGA_TEST_MODE=true reaches here; dev and production are untouched.
    if (this.isTesting()) {
      this.authLogger.log(`Testing build — connecting auth to the emulator on :${AUTH_EMULATOR_PORT}`);
      connectAuthEmulator(this.libraries.firebaseAuth, `http://localhost:${AUTH_EMULATOR_PORT}`, { disableWarnings: true });
    }

    // Set up auth state change listener (background is source of truth)
    onAuthStateChanged(this.libraries.firebaseAuth, (user) => {
      this.handleAuthStateChange(user);
    });

    return this.libraries.firebaseAuth;
  }

  // Handle Firebase auth state changes (source of truth for all contexts)
  // No storage operations - Web Manager handles auth state internally
  handleAuthStateChange(user) {
    this.authLogger.log('Auth state changed:', user?.email || 'signed out');
    // Nothing else to do - contexts sync via messages, @omega.js/client handles UI
  }

  // Handle auth token from website (custom token from /token page)
  async handleAuthToken(token, tabId, authSourceTabId = null) {
    try {
      // Log
      this.authLogger.log('Processing auth token...');

      // Get or initialize Firebase auth
      const auth = this.getFirebaseAuth();

      // Sign in with custom token
      this.authLogger.log('Calling signInWithCustomToken...');
      const userCredential = await signInWithCustomToken(auth, token);
      const user = userCredential.user;

      // Log
      this.authLogger.log('Signed in successfully:', user.email);

      // Broadcast token to all open extension contexts so they can sign in immediately
      // Token is NOT stored - it expires in 1 hour and is only needed for initial sign-in
      this.broadcastAuthToken(token);

      // Note: onAuthStateChanged will fire and store user info (without token) in storage
      // This allows UI to show auth state, but token is never persisted

      // Close the auth tab
      await this.extension.tabs.remove(tabId);
      this.authLogger.log('Auth tab closed');

      // Reactivate the source tab if provided
      if (authSourceTabId) {
        try {
          await this.extension.tabs.update(authSourceTabId, { active: true });
          this.authLogger.log('Restored source tab:', authSourceTabId);
        } catch (e) {
          // Tab may have been closed, ignore
          this.authLogger.log('Could not restore source tab (may be closed):', authSourceTabId);
        }
      }

    } catch (error) {
      this.authLogger.error('Error handling auth token:', error);
    }
  }

  // Broadcast auth token to all open extension contexts
  // Used during initial sign-in to immediately sync all open popups, pages, etc.
  async broadcastAuthToken(token) {
    try {
      // Get all clients (extension pages, popups, etc.)
      const clients = await self.clients.matchAll({ type: 'all' });

      this.authLogger.log(`Broadcasting token to ${clients.length} clients...`);

      // Send token to each client
      for (const client of clients) {
        client.postMessage({
          command: 'omega:signInWithToken',
          token: token,
        });
      }

      this.authLogger.log('Token broadcast complete');
    } catch (error) {
      this.authLogger.error('Error broadcasting token:', error.message);
    }
  }

  // Setup livereload
  setupLiveReload() {
    // Dev-only feature — skip in testing and production (environment is one of
    // 'development' | 'testing' | 'production').
    if (this.environment !== 'development') return;

    // Get port from config or use default
    const port = this.config?.omega?.liveReloadPort || 35729;

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

// Cross-context helpers — Manager.isTesting() / isDevelopment() / getApiUrl() / etc.
attachModeHelpers(Manager);
attachUrlHelpers(Manager);

// Export
export default Manager;
