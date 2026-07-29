/**
 * notifications tests — the push module's support gates, permission flow,
 * VAPID resolution, and the localStorage reconciliation that decides whether
 * a browser is really subscribed.
 *
 * Driven through the REAL singleton (`Manager.notifications()`) against the
 * REAL Storage module, so the stale-subscription paths are proven against
 * actual localStorage round-trips. The only stand-ins are the browser APIs
 * Node does not ship — `Notification` and the messaging/service-worker
 * handles the module reads off the manager, which are exactly the surfaces
 * the module treats as injected.
 */
const { describe, it, before, beforeEach, afterEach } = require('node:test');
const { getManager, TEST_CONFIG, assert } = require('./helpers.js');

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

describe('Notifications Module', () => {
  let manager;
  let notifications;
  let quiet;

  before(async () => {
    manager = getManager();
    await manager.initialize(TEST_CONFIG);
    notifications = manager.notifications();
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
    manager._firebaseMessaging = undefined;
    manager.state.serviceWorker = null;
    notifications._requestInProgress = false;
    manager.storage().remove('notifications');
  });

  describe('support gate', () => {
    it('needs Notification, a service worker, AND firebase messaging', () => {
      // serviceWorker is a declared key on the suite's navigator.
      installNotification('default');
      manager._firebaseMessaging = undefined;
      assert.strictEqual(notifications.isSupported(), false, 'no messaging handle');

      manager._firebaseMessaging = null;
      assert.strictEqual(notifications.isSupported(), false, 'a null handle means messaging is disabled');

      removeNotification();
      assert.strictEqual(notifications.isSupported(), false, 'no Notification API');
    });

    it('isSubscribed is false without support, and tracks the permission otherwise', async () => {
      assert.strictEqual(await notifications.isSubscribed(), false);

      manager._firebaseMessaging = {};
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
      manager._firebaseMessaging = {};

      installNotification('granted');
      assert.strictEqual(await notifications.requestPermission(), true);

      installNotification('denied');
      assert.strictEqual(await notifications.requestPermission(), false);
    });

    it('returns false rather than throwing when unsupported', async () => {
      manager._firebaseMessaging = undefined;

      assert.strictEqual(await notifications.requestPermission(), false);
    });
  });

  describe('initialize', () => {
    let savedConfig;

    beforeEach(() => { savedConfig = manager.config; });
    afterEach(() => { manager.config = savedConfig; });

    it('reads the VAPID key from cloud.messaging first', () => {
      manager.config = {
        cloud: { messaging: { vapidKey: 'CLOUD_KEY' } },
        firebase: { messaging: { config: { vapidKey: 'BRIDGE_KEY' } } },
      };
      installNotification('default');

      notifications.initialize({});

      assert.strictEqual(notifications._vapidKey, 'CLOUD_KEY');
    });

    it('falls back to the firebase.messaging bridge shape, then to null', () => {
      installNotification('default');

      manager.config = { firebase: { messaging: { config: { vapidKey: 'BRIDGE_KEY' } } } };
      notifications.initialize({});
      assert.strictEqual(notifications._vapidKey, 'BRIDGE_KEY');

      manager.config = {};
      notifications.initialize({});
      assert.strictEqual(notifications._vapidKey, null);
    });

    it('clears a stored subscription the browser no longer backs', () => {
      const storage = manager.storage();
      manager.config = {};
      storage.set('notifications', { subscribed: true, token: 'stale-token-12345678' });
      installNotification('denied');

      notifications.initialize({});

      assert.deepStrictEqual(storage.get('notifications'), { subscribed: false, token: null });
    });

    it('leaves a granted subscription alone', () => {
      const storage = manager.storage();
      manager.config = {};
      manager._firebaseMessaging = undefined;
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
        manager.config = {};
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
      manager._firebaseMessaging = undefined;

      await assert.rejects(
        () => notifications.subscribe(),
        /Push notifications are not supported/,
      );
    });

    it('refuses a second concurrent request', async () => {
      manager._firebaseMessaging = {};
      installNotification('granted');
      notifications._requestInProgress = true;

      await assert.rejects(
        () => notifications.subscribe(),
        /Subscription request already in progress/,
      );
    });

    it('refuses without a messaging handle, and releases the in-progress latch', async () => {
      manager._firebaseMessaging = null;
      installNotification('granted');

      // A null handle now fails the support gate itself — the honest diagnostic.
      await assert.rejects(
        () => notifications.subscribe(),
        /Push notifications are not supported/,
      );
      assert.strictEqual(notifications._requestInProgress, false, 'a failure never wedges the latch');
    });

    it('refuses without a registered service worker', async () => {
      manager._firebaseMessaging = {};
      manager.state.serviceWorker = null;
      installNotification('granted');

      await assert.rejects(
        () => notifications.subscribe(),
        /Service Worker not registered/,
      );
    });

    it('refuses when the browser has already denied', async () => {
      manager._firebaseMessaging = {};
      manager.state.serviceWorker = { scope: '/' };
      installNotification('denied');

      await assert.rejects(
        () => notifications.subscribe(),
        /Notification permission denied/,
      );
    });

    it('asks on first run, and refuses when the answer is not a grant', async () => {
      let asked = 0;
      manager._firebaseMessaging = {};
      manager.state.serviceWorker = { scope: '/' };
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
      manager._firebaseMessaging = undefined;

      assert.strictEqual(await notifications.unsubscribe(), false);
    });
  });

  describe('syncSubscription', () => {
    it('clears localStorage when the permission is gone', async () => {
      const storage = manager.storage();
      storage.set('notifications', { subscribed: true, token: 'stale-token-12345678' });
      installNotification('denied');

      assert.strictEqual(await notifications.syncSubscription(), false);
      assert.deepStrictEqual(storage.get('notifications'), { subscribed: false, token: null });
    });

    it('does nothing when the permission is gone and nothing was stored', async () => {
      const storage = manager.storage();
      installNotification('default');

      assert.strictEqual(await notifications.syncSubscription(), false);
      assert.strictEqual(storage.get('notifications'), undefined);
    });

    it('clears localStorage when the token can no longer be fetched', async () => {
      const storage = manager.storage();
      storage.set('notifications', { subscribed: true, token: 'gone-token-12345678' });
      installNotification('granted');
      // Granted permission but no messaging handle — getToken() answers null.
      manager._firebaseMessaging = null;

      assert.strictEqual(await notifications.syncSubscription(), false);
      assert.deepStrictEqual(storage.get('notifications'), { subscribed: false, token: null });
    });
  });

  describe('getToken', () => {
    it('answers null instead of throwing when unsupported or unwired', async () => {
      manager._firebaseMessaging = undefined;
      assert.strictEqual(await notifications.getToken(), null);

      installNotification('granted');
      manager._firebaseMessaging = null;
      assert.strictEqual(await notifications.getToken(), null);
    });
  });

  describe('onMessage', () => {
    it('answers a no-op unsubscriber when unsupported or unwired', async () => {
      manager._firebaseMessaging = undefined;
      const unsupported = await notifications.onMessage(() => {});
      assert.strictEqual(typeof unsupported, 'function');
      assert.strictEqual(unsupported(), undefined);

      installNotification('granted');
      manager._firebaseMessaging = null;
      const unwired = await notifications.onMessage(() => {});
      assert.strictEqual(typeof unwired, 'function');
    });
  });
});
