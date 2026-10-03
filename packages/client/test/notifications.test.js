/**
 * notifications tests — the push module's support gates, permission flow,
 * VAPID resolution, and the localStorage reconciliation that decides whether
 * a browser is really subscribed.
 *
 * Driven through a REAL Omega instance (`omega.notifications`) against the
 * REAL Storage module, so the stale-subscription paths are proven against
 * actual localStorage round-trips. The only stand-ins are the browser APIs
 * Node does not ship (`Notification`, `PushManager`), the Firebase app, the
 * messaging loader's answer and the service-worker registration, which are
 * exactly the surfaces the module treats as injected.
 */
const { describe, it, before, beforeEach, afterEach } = require('node:test');
const { getOmega, TEST_CONFIG, assert } = require('./helpers.js');

// The shared harness (test/setup.js) installs the mock `navigator` — Node's
// own is a getter-only global, so it is defined there with defineProperty and
// `serviceWorker` is a declared key on it. This suite just uses it.

// The Notification platform API, steerable per test.
function installNotification(permission, { onRequest } = {}) {
  const stub = function Notification() {};
  stub.permission = permission;
  stub.requestPermission = async () => {
    if (onRequest) onRequest();
    return stub.permission;
  };
  global.Notification = stub;
  global.window.Notification = stub;
  return stub;
}

function removeNotification() {
  delete global.Notification;
  delete global.window.Notification;
}

// A browser with push support and Firebase configured, which here means the
// app exists: under its getter and its field, as the real instance holds it.
// The messaging loader resolves an instance until a test says otherwise.
function configureFirebase(omega) {
  const app = { name: '[DEFAULT]' };

  global.window.PushManager = function PushManager() {};
  omega._firebaseApp = app;
  Object.defineProperty(omega, 'firebaseApp', { value: app, configurable: true });
  messagingResolves(omega, {});
}

function unconfigureFirebase(omega) {
  delete global.window.PushManager;
  delete omega.firebaseApp;
  omega._firebaseApp = undefined;
}

// What the messaging loader resolves: an instance, or null where it has none.
function messagingResolves(omega, handle) {
  omega.loadFirebaseMessaging = async () => handle;
}

describe('Notifications Module', () => {
  let omega;
  let notifications;
  let quiet;

  before(async () => {
    omega = getOmega();
    await omega.initialize(TEST_CONFIG);
    notifications = omega.notifications;
  });

  beforeEach(() => {
    // The module narrates every step; keep the suite output readable.
    quiet = { log: console.log, error: console.error };
    console.log = () => {};
    console.error = () => {};
  });

  afterEach(() => {
    console.log = quiet.log;
    console.error = quiet.error;
    removeNotification();
    unconfigureFirebase(omega);
    delete omega.loadFirebaseMessaging;
    omega.state.serviceWorker = null;
    notifications._requestInProgress = false;
    omega.storage.remove('notifications');
  });

  describe('support gate', () => {
    it('needs Notification, a service worker, AND Firebase configured', () => {
      // serviceWorker is a declared key on the suite's navigator.
      installNotification('default');
      assert.strictEqual(notifications.isSupported(), false, 'no Firebase app');

      configureFirebase(omega);
      assert.strictEqual(notifications.isSupported(), true, 'the browser and the app are support enough');

      removeNotification();
      assert.strictEqual(notifications.isSupported(), false, 'no Notification API');
    });

    it('isSubscribed is false without support, and tracks the permission otherwise', async () => {
      assert.strictEqual(await notifications.isSubscribed(), false);

      configureFirebase(omega);
      installNotification('granted');
      assert.strictEqual(await notifications.isSubscribed(), true);

      installNotification('denied');
      assert.strictEqual(await notifications.isSubscribed(), false);

      installNotification('default');
      assert.strictEqual(await notifications.isSubscribed(), false);
    });
  });

  describe('requestPermission', () => {
    it('returns true only when the browser grants', async () => {
      configureFirebase(omega);

      installNotification('granted');
      assert.strictEqual(await notifications.requestPermission(), true);

      installNotification('denied');
      assert.strictEqual(await notifications.requestPermission(), false);
    });

    it('returns false rather than throwing when unsupported', async () => {
      assert.strictEqual(await notifications.requestPermission(), false);
    });
  });

  describe('initialize', () => {
    let savedConfig;

    beforeEach(() => { savedConfig = omega.config; });
    afterEach(() => { omega.config = savedConfig; });

    it('reads the VAPID key from cloud.messaging first', () => {
      omega.config = {
        cloud: { messaging: { vapidKey: 'CLOUD_KEY' } },
        firebase: { messaging: { config: { vapidKey: 'BRIDGE_KEY' } } },
      };
      installNotification('default');

      notifications.initialize({});

      assert.strictEqual(notifications._vapidKey, 'CLOUD_KEY');
    });

    it('falls back to the firebase.messaging bridge shape, then to null', () => {
      installNotification('default');

      omega.config = { firebase: { messaging: { config: { vapidKey: 'BRIDGE_KEY' } } } };
      notifications.initialize({});
      assert.strictEqual(notifications._vapidKey, 'BRIDGE_KEY');

      omega.config = {};
      notifications.initialize({});
      assert.strictEqual(notifications._vapidKey, null);
    });

    it('clears a stored subscription the browser no longer backs', () => {
      const storage = omega.storage;
      omega.config = {};
      storage.set('notifications', { subscribed: true, token: 'stale-token-12345678' });
      installNotification('denied');

      notifications.initialize({});

      assert.deepStrictEqual(storage.get('notifications'), { subscribed: false, token: null });
    });

    it('leaves a granted subscription alone', () => {
      const storage = omega.storage;
      omega.config = {};
      storage.set('notifications', { subscribed: true, token: 'live-token-12345678' });
      installNotification('granted');

      notifications.initialize({});

      assert.strictEqual(storage.get('notifications').subscribed, true);
      assert.strictEqual(storage.get('notifications').token, 'live-token-12345678');
    });

    it('arms the click-gated auto-request only when autoRequest is positive', () => {
      const listeners = [];
      const original = global.document.addEventListener;
      global.document.addEventListener = (event, handler) => listeners.push([event, handler]);

      try {
        omega.config = {};
        installNotification('default');

        notifications.initialize({ autoRequest: 5000 });
        assert.deepStrictEqual(listeners.map(([event]) => event), ['click']);

        notifications.initialize({});
        notifications.initialize({ autoRequest: 0 });
        assert.strictEqual(listeners.length, 1, 'no autoRequest means no listener');
      } finally {
        global.document.addEventListener = original;
      }
    });
  });

  describe('subscribe', () => {
    it('refuses when push is unsupported', async () => {
      await assert.rejects(
        () => notifications.subscribe(),
        /Push notifications are not supported/,
      );
    });

    it('refuses a second concurrent request', async () => {
      configureFirebase(omega);
      installNotification('granted');
      notifications._requestInProgress = true;

      await assert.rejects(
        () => notifications.subscribe(),
        /Subscription request already in progress/,
      );
    });

    it('refuses without a messaging handle, and releases the in-progress latch', async () => {
      configureFirebase(omega);
      messagingResolves(omega, null);
      omega.state.serviceWorker = { scope: '/' };
      installNotification('granted');

      // Everything else is in place, so the loader's null is the one refusal,
      // and it says messaging is what is missing
      await assert.rejects(() => notifications.subscribe(), /messaging/i);
      assert.strictEqual(notifications._requestInProgress, false, 'a failure never wedges the latch');
    });

    it('refuses without a registered service worker', async () => {
      configureFirebase(omega);
      omega.state.serviceWorker = null;
      installNotification('granted');

      await assert.rejects(
        () => notifications.subscribe(),
        /Service Worker not registered/,
      );
    });

    it('refuses when the browser has already denied', async () => {
      configureFirebase(omega);
      omega.state.serviceWorker = { scope: '/' };
      installNotification('denied');

      await assert.rejects(
        () => notifications.subscribe(),
        /Notification permission denied/,
      );
    });

    it('asks on first run, and refuses when the answer is not a grant', async () => {
      let asked = 0;
      configureFirebase(omega);
      omega.state.serviceWorker = { scope: '/' };
      const stub = installNotification('default', { onRequest: () => { asked += 1; } });
      stub.requestPermission = async () => { asked += 1; return 'denied'; };

      await assert.rejects(
        () => notifications.subscribe(),
        /Notification permission denied/,
      );
      assert.strictEqual(asked, 1, 'the prompt is shown exactly once');
    });
  });

  describe('unsubscribe', () => {
    it('returns false when push is unsupported', async () => {
      assert.strictEqual(await notifications.unsubscribe(), false);
    });
  });

  describe('syncSubscription', () => {
    it('clears localStorage when the permission is gone', async () => {
      const storage = omega.storage;
      storage.set('notifications', { subscribed: true, token: 'stale-token-12345678' });
      installNotification('denied');

      assert.strictEqual(await notifications.syncSubscription(), false);
      assert.deepStrictEqual(storage.get('notifications'), { subscribed: false, token: null });
    });

    it('does nothing when the permission is gone and nothing was stored', async () => {
      const storage = omega.storage;
      installNotification('default');

      assert.strictEqual(await notifications.syncSubscription(), false);
      assert.strictEqual(storage.get('notifications'), undefined);
    });

    it('clears localStorage when the token can no longer be fetched', async () => {
      const storage = omega.storage;
      storage.set('notifications', { subscribed: true, token: 'gone-token-12345678' });
      installNotification('granted');
      // Granted permission but the loader has no messaging, so getToken() answers null
      configureFirebase(omega);
      messagingResolves(omega, null);

      assert.strictEqual(await notifications.syncSubscription(), false);
      assert.deepStrictEqual(storage.get('notifications'), { subscribed: false, token: null });
    });
  });

  describe('getToken', () => {
    it('answers null instead of throwing when unsupported or unwired', async () => {
      assert.strictEqual(await notifications.getToken(), null);

      installNotification('granted');
      configureFirebase(omega);
      messagingResolves(omega, null);
      assert.strictEqual(await notifications.getToken(), null);
    });
  });

  describe('onMessage', () => {
    it('answers a no-op unsubscriber when unsupported or unwired', async () => {
      const unsupported = await notifications.onMessage(() => {});
      assert.strictEqual(typeof unsupported, 'function');
      assert.strictEqual(unsupported(), undefined);

      installNotification('granted');
      configureFirebase(omega);
      messagingResolves(omega, null);
      const unwired = await notifications.onMessage(() => {});
      assert.strictEqual(typeof unwired, 'function');
    });
  });
});
