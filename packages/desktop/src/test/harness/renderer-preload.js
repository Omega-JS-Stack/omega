// Renderer test-harness preload. Bridges between the harness BrowserWindow and the parent
// main-process harness via three channels:
//
//   __omegaTest:ready   : renderer signals it's ready to receive suites
//   __omegaTest:result  : renderer emits per-test results / suite-start / fatal
//   __omegaTest:suites  : main sends serialized renderer suites for execution
//
// Also exposes the production-style `window.desktop` surface (mirrors src/preload.js so renderer
// test suites can assert on it), and builds the REAL renderer instance in this world.

const { contextBridge, ipcRenderer } = require('electron');

// Mirror the production preload's forwarding logger so renderer-layer tests can
// verify that logger.log/warn/error actually emits 'desktop:log:forward' to main.
// Kept minimal: same channel name as production (src/preload.js).
function makeForwardingLogger() {
  const FORWARD_CHANNEL = 'desktop:log:forward';
  const methods = ['log', 'info', 'warn', 'error', 'debug'];
  const out = {};
  for (const m of methods) {
    const fileLevel = m === 'log' ? 'info' : m;
    out[m] = function () {
      const args = ['[omega]', ...Array.from(arguments)];
      const fn = console[m] || console.log;
      try { fn.apply(console, args); } catch (_) { /* ignore */ }
      try {
        ipcRenderer.send(FORWARD_CHANNEL, {
          name:  'renderer',
          level: fileLevel,
          args:  Array.from(arguments).map((a) => {
            if (a instanceof Error) return { __error: true, message: a.message, stack: a.stack };
            try { JSON.stringify(a); return a; } catch (_) { return String(a); }
          }),
        });
      } catch (_) { /* ignore */ }
    };
  }
  return out;
}

contextBridge.exposeInMainWorld('__omegaTest', {
  // Signal main that the harness page is loaded and ready to accept suites.
  ready: () => { instanceBuilt.then(() => ipcRenderer.send('__omegaTest:ready')); },
  // Forward a result event up to main, which prints it.
  emit:  (evt) => ipcRenderer.send('__omegaTest:result', evt),
  // Subscribe to incoming suite payloads.
  onSuites: (handler) => {
    ipcRenderer.on('__omegaTest:suites', (_e, suites) => handler(suites));
  },
});

// Mirror the production preload surface so renderer test suites can assert against it.
const desktopSurface = {
  ipc: {
    invoke: (channel, payload) => ipcRenderer.invoke(channel, payload),
    // Mirror production preload (wave-5 F4): returns an unsubscribe fn.
    on: (channel, handler) => {
      const wrapped = (_, payload) => handler(payload);
      ipcRenderer.on(channel, wrapped);
      return () => ipcRenderer.removeListener(channel, wrapped);
    },
    send: (channel, payload) => ipcRenderer.send(channel, payload),
  },
  storage: {
    get:    (key, def) => ipcRenderer.invoke('desktop:storage:get',    { key, def }),
    set:    (key, val) => ipcRenderer.invoke('desktop:storage:set',    { key, val }),
    delete: (key)      => ipcRenderer.invoke('desktop:storage:delete', { key }),
    has:    (key)      => ipcRenderer.invoke('desktop:storage:has',    { key }),
    clear:  ()         => ipcRenderer.invoke('desktop:storage:clear'),
    // Mirror production preload's onChange so renderer-layer tests can verify
    // change-broadcasts round-trip across IPC.
    onChange: (key, handler) => {
      const wrapped = (_, payload) => {
        if (key === '*' || payload?.key === key) handler(payload);
      };
      ipcRenderer.on('desktop:storage:change', wrapped);
      return () => ipcRenderer.removeListener('desktop:storage:change', wrapped);
    },
  },
  // Mirror production preload's theme surface (get/set via IPC; onChange via
  // matchMedia, the real mechanism, since themeSource flips prefers-color-scheme).
  theme: {
    get: ()       => ipcRenderer.invoke('desktop:theme:get'),
    set: (source) => ipcRenderer.invoke('desktop:theme:set', { source }),
    onChange: (handler) => {
      const media = window.matchMedia('(prefers-color-scheme: dark)');
      const wrapped = (e) => handler({ resolved: e.matches ? 'dark' : 'light' });
      media.addEventListener('change', wrapped);
      return () => media.removeEventListener('change', wrapped);
    },
  },
  // Mirror production preload's fontawesome surface (bundled-icon lookup).
  fontawesome: {
    get: (name, style) => ipcRenderer.invoke('desktop:fontawesome:get', { name, style }).then((r) => r?.svg ?? null),
  },
  logger: makeForwardingLogger(),
  autoUpdater: {
    getStatus:  ()  => ipcRenderer.invoke('desktop:auto-updater:status'),
    checkNow:   ()  => ipcRenderer.invoke('desktop:auto-updater:check-now'),
    installNow: ()  => ipcRenderer.invoke('desktop:auto-updater:install-now'),
    onStatus: (handler) => {
      const wrapped = (_, payload) => handler(payload);
      ipcRenderer.on('desktop:auto-updater:status', wrapped);
      return () => ipcRenderer.removeListener('desktop:auto-updater:status', wrapped);
    },
  },
  // Mirror production preload's analytics/context/usage/remoteConfig so renderer-layer
  // tests can verify their IPC behavior end-to-end.
  analytics: {
    event:             (name, params) => ipcRenderer.send('desktop:analytics:event', { name, params }),
    pageview:          (path)         => ipcRenderer.send('desktop:analytics:event', { name: 'page_view',   params: path ? { page_path: path } : {} }),
    screenview:        (screenName)   => ipcRenderer.send('desktop:analytics:event', { name: 'screen_view', params: screenName ? { screen_name: screenName } : {} }),
    setUserProperties: (props)        => ipcRenderer.send('desktop:analytics:set-user-properties', props),
    getStatus:         ()             => ipcRenderer.invoke('desktop:analytics:status'),
  },
  context: {
    get: () => ipcRenderer.invoke('desktop:context:get'),
  },
  usage: {
    get: () => ipcRenderer.invoke('desktop:usage:get'),
  },
  remoteConfig: {
    get:        (path) => ipcRenderer.invoke('desktop:remote-config:get', path),
    refreshNow: ()     => ipcRenderer.invoke('desktop:remote-config:refresh-now'),
    onUpdate: (handler) => {
      const wrapped = (_, payload) => handler(payload);
      ipcRenderer.on('desktop:remote-config:update', wrapped);
      return () => ipcRenderer.removeListener('desktop:remote-config:update', wrapped);
    },
  },
};

contextBridge.exposeInMainWorld('desktop', desktopSurface);

// The REAL renderer instance, built here in the preload world (before contextIsolation
// closes off `require`): the same module a view's entry requires. Its constructor
// reads `window.desktop`, which contextBridge exposes to the PAGE world only, so this
// world gets the same surface first. Suites assert on it through the probes below.
//
// initialize() is deliberately NOT called: it boots Firebase and the auth bridge,
// which is heavy + flaky for a helper-shape assertion. The config is seeded the way a
// real BUILD bakes it instead:
//   `environment` is the build fact every OMEGA surface bakes
//   ([#817](https://github.com/Omega-JS-Stack/omega/issues/817)), which is
//   what a real renderer (no process.env) answers from.
//   `dev.ports` is the resolved local map, whose floor is @omega.js/config's
//   classic numbers ([#834](https://github.com/Omega-JS-Stack/omega/issues/834)):
//   nothing carries a browser-side copy of them any more, so an artifact
//   without the map cannot reach a localhost port at all.
//   `advertising` configures AdSense ON PURPOSE and no inhouse source: the
//   house-lane pin is exactly what must keep the provider lane (remote script)
//   from ever being attempted, and a source-less house render collapses
//   deterministically with zero network.
//   `analyticsBridge` is INJECTED exactly the way src/renderer.js injects it in
//   production ([#411](https://github.com/Omega-JS-Stack/omega/issues/411)): the
//   preload's own analytics surface, handed over as config.
let testOmega;
let buildError = null;

// The ESM modules renderer.js requires. Electron's preload loader has no
// require(esm) (a production renderer is esbuild-bundled, so it never needs one):
// each is loaded through import() first and seated in require's cache, and
// renderer.js's own require() then finds it there.
const RENDERER_ESM = ['@omega.js/client', '@omega.js/client/modules/request.js', './assets/js/core/app-shell.js'];

async function buildInstance() {
  const Module = require('module');
  const { pathToFileURL } = require('url');

  window.desktop = desktopSurface;

  // The main harness hands over the renderer's absolute dist path. In its absence,
  // fall back to resolve-by-name (a consumer with @omega.js/desktop in node_modules).
  const rendererPath = process.env.OMEGA_TEST_RENDERER_PATH || require.resolve('@omega.js/desktop/renderer');
  const rendererRequire = Module.createRequire(rendererPath);

  for (const specifier of RENDERER_ESM) {
    const file = rendererRequire.resolve(specifier);
    if (require.cache[file]) continue;
    const seated = new Module(file);
    seated.filename = file;
    seated.exports = await import(pathToFileURL(file).href);
    seated.loaded = true;
    require.cache[file] = seated;
  }

  testOmega = require(rendererPath);

  testOmega.config = {
    environment: 'production',
    dev:   { ports: { ...require('@omega.js/config').CLASSIC_PORTS } },
    brand: { url: 'https://example.com' },
    cloud: { provider: 'firebase', config: { projectId: 'demo-app', authDomain: 'demo-app.firebaseapp.com' } },
    advertising: {
      providers: { adsense: { client: 'ca-pub-test' } },
    },
    analyticsBridge: desktopSurface.analytics,
  };

  // Wire the instance's DOM enhancements (FontAwesome auto-render, Bootstrap tooltip
  // auto-init, the verts auto-bind) against THIS document. In production these run in
  // the page world (the consumer's esbuild bundle); here the preload world stands in:
  // the DOM is shared, so injected SVGs / tooltip tips / bound verts are visible to
  // page-world test suites.
  testOmega.enableFontAwesome();
  testOmega._wireTooltips();
  testOmega._wireAds();

  // Analytics, BRIDGED: the real client resolves the injected bridge and forwards
  // every event over IPC to main's ONE sender. Same `analytics.init()` call
  // initialize() makes; the rest of initialize (firebase, auth) stays out.
  // Credentials are handed in ON PURPOSE, the mistake desktop's build must never
  // make: a bridged renderer has to DROP them (the `analytics-bridge` renderer suite
  // pins that it holds neither).
  testOmega.analytics.init({
    id:        'G-RENDERER1',
    secret:    'harness-renderer-secret',
    projectId: 'demo-app',
    bridge:    testOmega._resolveAnalyticsBridge(),
  });
}

// Settled before the page tells main it is ready, so no suite runs ahead of the instance
const instanceBuilt = buildInstance().catch((e) => {
  buildError = e.stack || e.message;
  console.warn('[renderer-preload] Could not build the renderer instance for tests:', e.message);
});

// Page-world probe for the bridged client analytics: `event()` is the call a
// renderer's own code makes (`omega.analytics.event(...)`), `state()` reads
// back what the module holds so a suite can pin that no second sender exists.
contextBridge.exposeInMainWorld('__omegaTestClientAnalytics', {
  event: (name, params) => testOmega?.analytics.event(name, params),
  state: () => {
    const a = testOmega?.analytics;
    return {
      initialized: Boolean(a?.initialized),
      bridged:     Boolean(a?.bridge),
      secret:      a?.secret ?? null,
      clientId:    a?.clientId ?? null,
    };
  },
});

// Tooltip instances live in the preload world (page world can't reach the
// bootstrap namespace across the contextIsolation boundary): expose a probe so
// page-world suites can assert instance lifecycle by element id. `error()`
// surfaces WHY the Bootstrap bundle failed to load (renderer.js swallows the
// require error into a logger.warn that the harness can't see).
contextBridge.exposeInMainWorld('__omegaTestTooltip', {
  available: () => Boolean(testOmega?.bootstrap?.Tooltip),
  // Lazy: by call time the DOM exists, so a require failure here is the real
  // reason the bundle can't load (not just "no documentElement yet").
  error: () => {
    try {
      if (process.env.OMEGA_TEST_RENDERER_PATH) {
        const path = require('path');
        require(path.join(path.dirname(process.env.OMEGA_TEST_RENDERER_PATH), 'assets', 'js', 'bootstrap.bundle.js'));
      }
      return null;
    } catch (e) {
      return e.message;
    }
  },
  hasInstance: (id) => {
    const el = document.getElementById(id);
    return Boolean(el && testOmega?.bootstrap?.Tooltip?.getInstance(el));
  },
  // Show the tooltip from the PRELOAD world. Synthetic mouse events dispatched
  // by page-world test code don't cross the contextIsolation boundary to the
  // preload world's Bootstrap listeners, so hover can't be simulated from a
  // suite; real single-world hover behavior is covered by consumer boot
  // suites. Returns true or the error message.
  showDirect: (id) => {
    try {
      testOmega.bootstrap.Tooltip.getOrCreateInstance(document.getElementById(id)).show();
      return true;
    } catch (e) {
      return e.message;
    }
  },
});

// The instance's own surface, for the page world: the environment helpers, the URL
// helpers, and what `omega.desktop` is. Each is forwarded as a sync contextBridge
// function.
contextBridge.exposeInMainWorld('__omegaTestInstance', {
  built:          () => Boolean(testOmega),
  // WHY the instance did not build (the console.warn above lands where the runner can't see it)
  error:          () => buildError,
  isDevelopment:  () => testOmega?.isDevelopment(),
  isProduction:   () => testOmega?.isProduction(),
  isTesting:      () => testOmega?.isTesting(),
  getVersion:     () => testOmega?.getVersion(),
  getEnvironment: () => testOmega?.getEnvironment(),
  getApiUrl:      (env) => testOmega?.getApiUrl(env),
  getFunctionsUrl:(env) => testOmega?.getFunctionsUrl(env),
  getWebsiteUrl:  (env) => testOmega?.getWebsiteUrl(env),
  // `omega.desktop` IS the preload's bridge object, under main's names
  desktopIsBridge: () => Boolean(testOmega) && testOmega.desktop === window.desktop,
  desktopKeys:     () => (testOmega ? Object.keys(testOmega.desktop).sort() : []),
  // The client's page store stays `omega.storage`; the app store is `omega.desktop.storage`
  storageIsPageStore: () => Boolean(testOmega) && testOmega.storage !== testOmega.desktop.storage,
  // Mutator used by tests to flip config flags between assertions.
  setConfig:      (path, value) => {
    if (!testOmega) return;
    const parts = path.split('.');
    let obj = testOmega.config;
    for (let i = 0; i < parts.length - 1; i++) {
      obj[parts[i]] = obj[parts[i]] || {};
      obj = obj[parts[i]];
    }
    obj[parts[parts.length - 1]] = value;
  },
});
