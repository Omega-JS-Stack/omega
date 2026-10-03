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
const defineCases = require('@omega.js/devkit/test/define-cases');
const { getOmega, TEST_CONFIG, createOmega, clearStorage, disposeOmega } = require('./helpers.js');

const beforeEachHook = clearStorage;

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

module.exports = defineCases({
  type: 'group',
  description: 'notifications',
  setup: createOmega,
  cleanup: disposeOmega,
  tests: [
    ...(() => {
      const cases = [];
      let omega;
      let notifications;
      let quiet;

      let beforeHookRun;
      const beforeHook = (ctx) => (beforeHookRun ||= Promise.resolve().then(() => (async () => {
        omega = getOmega();
        await omega.initialize(TEST_CONFIG);
        notifications = omega.notifications;
      })()));

      const beforeEachHook2 = () => {
        // The module narrates every step; keep the suite output readable.
        quiet = { log: console.log, error: console.error };
        console.log = () => {};
        console.error = () => {};
      };

      const afterEachHook = () => {
        console.log = quiet.log;
        console.error = quiet.error;
        removeNotification();
        unconfigureFirebase(omega);
        delete omega.loadFirebaseMessaging;
        omega.state.serviceWorker = null;
        notifications._requestInProgress = false;
        omega.storage.remove('notifications');
      };

      cases.push(
        {
          name: 'Notifications Module > support gate > needs Notification, a service worker, AND Firebase configured',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            beforeEachHook2();
            ctx.after(afterEachHook);
            // serviceWorker is a declared key on the suite's navigator.
            installNotification('default');
            ctx.expect(notifications.isSupported(), 'no Firebase app').toBe(false);

            configureFirebase(omega);
            ctx.expect(notifications.isSupported(), 'the browser and the app are support enough').toBe(true);

            removeNotification();
            ctx.expect(notifications.isSupported(), 'no Notification API').toBe(false);
          },
        },
        {
          name: 'Notifications Module > support gate > isSubscribed is false without support, and tracks the permission otherwise',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            beforeEachHook2();
            ctx.after(afterEachHook);
            ctx.expect(await notifications.isSubscribed()).toBe(false);

            configureFirebase(omega);
            installNotification('granted');
            ctx.expect(await notifications.isSubscribed()).toBe(true);

            installNotification('denied');
            ctx.expect(await notifications.isSubscribed()).toBe(false);

            installNotification('default');
            ctx.expect(await notifications.isSubscribed()).toBe(false);
          },
        },
      );

      cases.push(
        {
          name: 'Notifications Module > requestPermission > returns true only when the browser grants',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            beforeEachHook2();
            ctx.after(afterEachHook);
            configureFirebase(omega);

            installNotification('granted');
            ctx.expect(await notifications.requestPermission()).toBe(true);

            installNotification('denied');
            ctx.expect(await notifications.requestPermission()).toBe(false);
          },
        },
        {
          name: 'Notifications Module > requestPermission > returns false rather than throwing when unsupported',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            beforeEachHook2();
            ctx.after(afterEachHook);
            ctx.expect(await notifications.requestPermission()).toBe(false);
          },
        },
      );

      cases.push(
        ...(() => {
          const cases = [];
          let savedConfig;

          const beforeEachHook3 = () => { savedConfig = omega.config; };
          const afterEachHook2 = () => { omega.config = savedConfig; };

          cases.push({
            name: 'Notifications Module > initialize > reads the VAPID key from cloud.messaging first',
            run: async (ctx) => {
              await beforeHook(ctx);
              await beforeEachHook();
              beforeEachHook2();
              beforeEachHook3();
              ctx.after(afterEachHook);
              ctx.after(afterEachHook2);
              omega.config = {
                cloud: { messaging: { vapidKey: 'CLOUD_KEY' } },
                firebase: { messaging: { config: { vapidKey: 'BRIDGE_KEY' } } },
              };
              installNotification('default');

              notifications.initialize({});

              ctx.expect(notifications._vapidKey).toBe('CLOUD_KEY');
            },
          });

          cases.push({
            name: 'Notifications Module > initialize > falls back to the firebase.messaging bridge shape, then to null',
            run: async (ctx) => {
              await beforeHook(ctx);
              await beforeEachHook();
              beforeEachHook2();
              beforeEachHook3();
              ctx.after(afterEachHook);
              ctx.after(afterEachHook2);
              installNotification('default');

              omega.config = { firebase: { messaging: { config: { vapidKey: 'BRIDGE_KEY' } } } };
              notifications.initialize({});
              ctx.expect(notifications._vapidKey).toBe('BRIDGE_KEY');

              omega.config = {};
              notifications.initialize({});
              ctx.expect(notifications._vapidKey).toBe(null);
            },
          });

          cases.push({
            name: 'Notifications Module > initialize > clears a stored subscription the browser no longer backs',
            run: async (ctx) => {
              await beforeHook(ctx);
              await beforeEachHook();
              beforeEachHook2();
              beforeEachHook3();
              ctx.after(afterEachHook);
              ctx.after(afterEachHook2);
              const storage = omega.storage;
              omega.config = {};
              storage.set('notifications', { subscribed: true, token: 'stale-token-12345678' });
              installNotification('denied');

              notifications.initialize({});

              ctx.expect(storage.get('notifications')).toEqual({ subscribed: false, token: null });
            },
          });

          cases.push({
            name: 'Notifications Module > initialize > leaves a granted subscription alone',
            run: async (ctx) => {
              await beforeHook(ctx);
              await beforeEachHook();
              beforeEachHook2();
              beforeEachHook3();
              ctx.after(afterEachHook);
              ctx.after(afterEachHook2);
              const storage = omega.storage;
              omega.config = {};
              storage.set('notifications', { subscribed: true, token: 'live-token-12345678' });
              installNotification('granted');

              notifications.initialize({});

              ctx.expect(storage.get('notifications').subscribed).toBe(true);
              ctx.expect(storage.get('notifications').token).toBe('live-token-12345678');
            },
          });

          cases.push({
            name: 'Notifications Module > initialize > arms the click-gated auto-request only when autoRequest is positive',
            run: async (ctx) => {
              await beforeHook(ctx);
              await beforeEachHook();
              beforeEachHook2();
              beforeEachHook3();
              ctx.after(afterEachHook);
              ctx.after(afterEachHook2);
              const listeners = [];
              const original = global.document.addEventListener;
              global.document.addEventListener = (event, handler) => listeners.push([event, handler]);

              try {
                omega.config = {};
                installNotification('default');

                notifications.initialize({ autoRequest: 5000 });
                ctx.expect(listeners.map(([event]) => event)).toEqual(['click']);

                notifications.initialize({});
                notifications.initialize({ autoRequest: 0 });
                ctx.expect(listeners.length, 'no autoRequest means no listener').toBe(1);
              } finally {
                global.document.addEventListener = original;
              }
            },
          });
          return cases;
        })(),
      );

      cases.push(
        {
          name: 'Notifications Module > subscribe > refuses when push is unsupported',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            beforeEachHook2();
            ctx.after(afterEachHook);
            await ctx.expect((() => notifications.subscribe())()).rejects.toThrow(/Push notifications are not supported/);
          },
        },
        {
          name: 'Notifications Module > subscribe > refuses a second concurrent request',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            beforeEachHook2();
            ctx.after(afterEachHook);
            configureFirebase(omega);
            installNotification('granted');
            notifications._requestInProgress = true;

            await ctx.expect((() => notifications.subscribe())()).rejects.toThrow(/Subscription request already in progress/);
          },
        },
        {
          name: 'Notifications Module > subscribe > refuses without a messaging handle, and releases the in-progress latch',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            beforeEachHook2();
            ctx.after(afterEachHook);
            configureFirebase(omega);
            messagingResolves(omega, null);
            omega.state.serviceWorker = { scope: '/' };
            installNotification('granted');

            // Everything else is in place, so the loader's null is the one refusal,
            // and it says messaging is what is missing
            await ctx.expect((() => notifications.subscribe())()).rejects.toThrow(/messaging/i);
            ctx.expect(notifications._requestInProgress, 'a failure never wedges the latch').toBe(false);
          },
        },
        {
          name: 'Notifications Module > subscribe > refuses without a registered service worker',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            beforeEachHook2();
            ctx.after(afterEachHook);
            configureFirebase(omega);
            omega.state.serviceWorker = null;
            installNotification('granted');

            await ctx.expect((() => notifications.subscribe())()).rejects.toThrow(/Service Worker not registered/);
          },
        },
        {
          name: 'Notifications Module > subscribe > refuses when the browser has already denied',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            beforeEachHook2();
            ctx.after(afterEachHook);
            configureFirebase(omega);
            omega.state.serviceWorker = { scope: '/' };
            installNotification('denied');

            await ctx.expect((() => notifications.subscribe())()).rejects.toThrow(/Notification permission denied/);
          },
        },
        {
          name: 'Notifications Module > subscribe > asks on first run, and refuses when the answer is not a grant',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            beforeEachHook2();
            ctx.after(afterEachHook);
            let asked = 0;
            configureFirebase(omega);
            omega.state.serviceWorker = { scope: '/' };
            const stub = installNotification('default', { onRequest: () => { asked += 1; } });
            stub.requestPermission = async () => { asked += 1; return 'denied'; };

            await ctx.expect((() => notifications.subscribe())()).rejects.toThrow(/Notification permission denied/);
            ctx.expect(asked, 'the prompt is shown exactly once').toBe(1);
          },
        },
      );

      cases.push(
        {
          name: 'Notifications Module > unsubscribe > returns false when push is unsupported',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            beforeEachHook2();
            ctx.after(afterEachHook);
            ctx.expect(await notifications.unsubscribe()).toBe(false);
          },
        },
      );

      cases.push(
        {
          name: 'Notifications Module > syncSubscription > clears localStorage when the permission is gone',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            beforeEachHook2();
            ctx.after(afterEachHook);
            const storage = omega.storage;
            storage.set('notifications', { subscribed: true, token: 'stale-token-12345678' });
            installNotification('denied');

            ctx.expect(await notifications.syncSubscription()).toBe(false);
            ctx.expect(storage.get('notifications')).toEqual({ subscribed: false, token: null });
          },
        },
        {
          name: 'Notifications Module > syncSubscription > does nothing when the permission is gone and nothing was stored',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            beforeEachHook2();
            ctx.after(afterEachHook);
            const storage = omega.storage;
            installNotification('default');

            ctx.expect(await notifications.syncSubscription()).toBe(false);
            ctx.expect(storage.get('notifications')).toBe(undefined);
          },
        },
        {
          name: 'Notifications Module > syncSubscription > clears localStorage when the token can no longer be fetched',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            beforeEachHook2();
            ctx.after(afterEachHook);
            const storage = omega.storage;
            storage.set('notifications', { subscribed: true, token: 'gone-token-12345678' });
            installNotification('granted');
            // Granted permission but the loader has no messaging, so getToken() answers null
            configureFirebase(omega);
            messagingResolves(omega, null);

            ctx.expect(await notifications.syncSubscription()).toBe(false);
            ctx.expect(storage.get('notifications')).toEqual({ subscribed: false, token: null });
          },
        },
      );

      cases.push(
        {
          name: 'Notifications Module > getToken > answers null instead of throwing when unsupported or unwired',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            beforeEachHook2();
            ctx.after(afterEachHook);
            ctx.expect(await notifications.getToken()).toBe(null);

            installNotification('granted');
            configureFirebase(omega);
            messagingResolves(omega, null);
            ctx.expect(await notifications.getToken()).toBe(null);
          },
        },
      );

      cases.push(
        {
          name: 'Notifications Module > onMessage > answers a no-op unsubscriber when unsupported or unwired',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            beforeEachHook2();
            ctx.after(afterEachHook);
            const unsupported = await notifications.onMessage(() => {});
            ctx.expect(typeof unsupported).toBe('function');
            ctx.expect(unsupported()).toBe(undefined);

            installNotification('granted');
            configureFirebase(omega);
            messagingResolves(omega, null);
            const unwired = await notifications.onMessage(() => {});
            ctx.expect(typeof unwired).toBe('function');
          },
        },
      );
      return cases;
    })(),
  ],
});
