// #360 — the service worker under a URL-path mount (#355). The worker has no
// document to read the `data-omega-path-prefix` stamp from, so @omega.js/client
// hands the value over on the script URL's query string; every site URL the
// worker builds is mounted under it. The unprefixed default must stay exactly
// what it is today.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SW_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'sw', 'manager.js'), 'utf8');

// Evaluate the worker the way a browser does — as a script against a worker
// global — since it ships as an esbuild iife bundle. The ONLY edit is the
// trailing `export default` (esbuild's job), swapped for the completion value
// so the harness gets the class back — plus, for the cache-warming pin, the
// `CACHE_WARMING_ENABLED` constant flipped on: the flag ships OFF (page speed
// wins) and the machinery behind it still has to be right when it flips.
function loadWorker(scriptUrl, { cacheWarming = false } = {}) {
  const importedScripts = [];
  const notifications = [];
  const opened = [];
  const cached = [];
  const listeners = {};
  let backgroundMessage = null;

  const sw = {
    location: new URL(scriptUrl),
    addEventListener: (type, handler) => { listeners[type] = handler; },
    skipWaiting: () => {},
    clients: {
      claim: async () => {},
      openWindow: async (url) => { opened.push(url); },
    },
    registration: {
      showNotification: (title, options) => { notifications.push({ title, options }); },
    },
  };

  const context = {
    self: sw,
    console: { log: () => {}, warn: () => {}, error: () => {} },
    URLSearchParams,
    caches: {
      keys: async () => [],
      delete: async () => true,
      open: async () => ({ addAll: async (urls) => { cached.push(...urls); } }),
    },
    // esbuild define + the compat CDN libraries, both stubbed
    __OMEGA_FIREBASE_VERSION__: '12.14.0',
    firebase: {
      initializeApp: () => {},
      messaging: () => ({ onBackgroundMessage: (handler) => { backgroundMessage = handler; } }),
    },
    importScripts: (...urls) => {
      importedScripts.push(...urls);
      // What the emitted /build.js does: assign the config transport.
      if (urls.some((url) => url.endsWith('build.js'))) {
        sw.OMEGA_BUILD_JSON = {
          brand: 'test',
          environment: 'test',
          cacheBreaker: 1,
          firebase: { projectId: 'test' },
        };
      }
    },
  };

  let source = SW_SOURCE.replace(/export default Manager;\s*$/, 'Manager;');
  if (cacheWarming) {
    source = source.replace('const CACHE_WARMING_ENABLED = false;', 'const CACHE_WARMING_ENABLED = true;');
  }
  const Manager = vm.runInNewContext(source, context, { filename: 'sw/manager.js' });
  const manager = new Manager();

  manager.initializeFirebase();

  return {
    importedScripts,
    notifications,
    opened,
    cached,
    updateCache: (pages) => manager.updateCache(pages),
    pushBackgroundMessage: (payload) => backgroundMessage(payload),
    notificationClick: (clickAction) => listeners.notificationclick({
      notification: { data: { FCM_MSG: { data: clickAction ? { click_action: clickAction } : {}, notification: {} } }, close: () => {} },
      waitUntil: () => {},
    }),
  };
}

test('service worker at the domain root: today’s URLs, unchanged', () => {
  const worker = loadWorker('https://example.com/service-worker.js');

  assert.equal(worker.importedScripts[0], '/build.js', 'the config transport is fetched root-relative');

  worker.pushBackgroundMessage({ notification: { title: 'Hello' } });
  assert.equal(worker.notifications[0].options.icon, '/assets/images/favicon/favicon-192x192.png');

  worker.notificationClick();
  assert.deepEqual(worker.opened, ['/']);
});

test('service worker under a mount: every site URL it builds carries the prefix', () => {
  const worker = loadWorker('https://example.com/workkit/service-worker.js?omega-path-prefix=%2Fworkkit');

  assert.equal(worker.importedScripts[0], '/workkit/build.js', 'the config transport lives under the mount');

  worker.pushBackgroundMessage({ notification: { title: 'Hello' } });
  assert.equal(worker.notifications[0].options.icon, '/workkit/assets/images/favicon/favicon-192x192.png');

  worker.notificationClick();
  assert.deepEqual(worker.opened, ['/workkit/'], 'the default click target is the mounted home page');
});

test('service worker under a mount: cache warming mounts the caller’s pages too', async () => {
  const worker = loadWorker('https://example.com/workkit/service-worker.js?omega-path-prefix=%2Fworkkit', { cacheWarming: true });

  // The shape the update-cache message carries: site-relative pages, the same
  // shape the defaults are written in.
  await worker.updateCache(['/pricing', '/blog/']);

  assert.deepEqual(worker.cached, ['/workkit/', '/workkit/pricing', '/workkit/blog/'], 'defaults AND caller pages live under the mount');
});

test('service worker under a mount: URLs the payload supplies pass through', () => {
  const worker = loadWorker('https://example.com/workkit/service-worker.js?omega-path-prefix=%2Fworkkit');

  worker.pushBackgroundMessage({ notification: { title: 'Hello', icon: 'https://cdn.example.com/icon.png' } });
  assert.equal(worker.notifications[0].options.icon, 'https://cdn.example.com/icon.png');

  worker.notificationClick('https://example.com/workkit/pricing');
  assert.deepEqual(worker.opened, ['https://example.com/workkit/pricing']);
});
