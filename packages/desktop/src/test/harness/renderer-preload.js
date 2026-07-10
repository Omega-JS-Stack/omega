// Renderer test-harness preload. Bridges between the harness BrowserWindow and the parent
// main-process harness via two channels:
//
//   __emTest:ready   — renderer signals it's ready to receive suites
//   __emTest:result  — renderer emits per-test results / suite-start / fatal
//   __emTest:suites  — main sends serialized renderer suites for execution
//
// Also exposes the production-style `window.em` surface (mirrors src/preload.js so renderer
// test suites can assert on it).

const { contextBridge, ipcRenderer } = require('electron');

// Mirror the production preload's forwarding logger so renderer-layer tests can
// verify that logger.log/warn/error actually emits 'desktop:log:forward' to main.
// Kept minimal — same channel name as production (src/preload.js).
function makeForwardingLogger() {
  const FORWARD_CHANNEL = 'desktop:log:forward';
  const methods = ['log', 'info', 'warn', 'error', 'debug'];
  const out = {};
  for (const m of methods) {
    const fileLevel = m === 'log' ? 'info' : m;
    out[m] = function () {
      const args = ['[em]', ...Array.from(arguments)];
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

contextBridge.exposeInMainWorld('__emTest', {
  // Signal main that the harness page is loaded and ready to accept suites.
  ready: () => ipcRenderer.send('__emTest:ready'),
  // Forward a result event up to main, which prints it.
  emit:  (evt) => ipcRenderer.send('__emTest:result', evt),
  // Subscribe to incoming suite payloads.
  onSuites: (handler) => {
    ipcRenderer.on('__emTest:suites', (_e, suites) => handler(suites));
  },
});

// Expose a thin bridge to the actual renderer Manager so renderer-layer tests can
// assert on its cross-context helpers (isDevelopment / isProduction / isTesting /
// getVersion / getEnvironment / getApiUrl / getFunctionsUrl / getWebsiteUrl). We
// instantiate the renderer Manager here in the preload (before contextIsolation
// closes off `require`) and forward each helper as a sync contextBridge function.
// We deliberately do NOT call `manager.initialize()` — that touches @omega.js/client /
// firebase / IPC, which is heavy + flaky for a helper-shape assertion. Instead we
// stub `manager.config` from a built-time-injected blob so config-dependent
// helpers (getEnvironment fallback, getWebsiteUrl prod path) have something to read.
let testManager;
try {
  // The renderer test harness loads the renderer Manager by absolute dist path
  // injected by the boot harness. In its absence, fall back to require-by-name
  // (works when the harness is run from a consumer with @omega.js/desktop in node_modules).
  const RendererManager = process.env.EM_TEST_RENDERER_MANAGER_PATH
    ? require(process.env.EM_TEST_RENDERER_MANAGER_PATH)
    : require('@omega.js/desktop/renderer');
  testManager = new RendererManager();
  // Seed config so getApiUrl / getFunctionsUrl / getWebsiteUrl have something to
  // read in their prod branches. Tests can mutate this via __emTestManager.config.set().
  testManager.config = {
    em:    { environment: 'production' },
    brand: { url: 'https://example.com' },
    firebaseConfig: { projectId: 'demo-app', authDomain: 'demo-app.firebaseapp.com' },
  };
} catch (e) {
  console.warn('[renderer-preload] Could not instantiate renderer Manager for tests:', e.message);
}

// Wire the renderer Manager's DOM enhancements (FontAwesome auto-render +
// Bootstrap tooltip auto-init) against THIS document. In production these run
// in the page world (the consumer's webpack bundle); here the preload world
// stands in — the DOM is shared, so injected SVGs / tooltip tips are visible
// to page-world test suites. The Manager reads `window.em.ipc` which only
// exists in the page world, so hand it the preload's ipcRenderer directly.
try {
  if (testManager) {
    testManager.ipc = {
      invoke: (channel, payload) => ipcRenderer.invoke(channel, payload),
    };
    testManager._wireFontAwesome();
    testManager._wireTooltips();
  }
} catch (e) {
  console.warn('[renderer-preload] Could not wire DOM enhancements:', e.message);
}

// Tooltip instances live in the preload world (page world can't reach the
// bootstrap namespace across the contextIsolation boundary) — expose a probe so
// page-world suites can assert instance lifecycle by element id. `error()`
// surfaces WHY the Bootstrap bundle failed to load (renderer.js swallows the
// require error into a logger.warn that the harness can't see).
contextBridge.exposeInMainWorld('__emTestTooltip', {
  available: () => Boolean(testManager?.bootstrap?.Tooltip),
  // Lazy — by call time the DOM exists, so a require failure here is the real
  // reason the bundle can't load (not just "no documentElement yet").
  error: () => {
    try {
      if (process.env.EM_TEST_RENDERER_MANAGER_PATH) {
        const path = require('path');
        require(path.join(path.dirname(process.env.EM_TEST_RENDERER_MANAGER_PATH), 'assets', 'themes', 'bootstrap', 'js', 'bootstrap.bundle.js'));
      }
      return null;
    } catch (e) {
      return e.message;
    }
  },
  hasInstance: (id) => {
    const el = document.getElementById(id);
    return Boolean(el && testManager?.bootstrap?.Tooltip?.getInstance(el));
  },
  // Show the tooltip from the PRELOAD world. Synthetic mouse events dispatched
  // by page-world test code don't cross the contextIsolation boundary to the
  // preload world's Bootstrap listeners, so hover can't be simulated from a
  // suite — real single-world hover behavior is covered by consumer boot
  // suites. Returns true or the error message.
  showDirect: (id) => {
    try {
      testManager.bootstrap.Tooltip.getOrCreateInstance(document.getElementById(id)).show();
      return true;
    } catch (e) {
      return e.message;
    }
  },
});

contextBridge.exposeInMainWorld('__emTestManager', {
  isDevelopment:  () => testManager?.isDevelopment(),
  isProduction:   () => testManager?.isProduction(),
  isTesting:      () => testManager?.isTesting(),
  getVersion:     () => testManager?.getVersion(),
  getEnvironment: () => testManager?.getEnvironment(),
  getApiUrl:      (env) => testManager?.getApiUrl(env),
  getFunctionsUrl:(env) => testManager?.getFunctionsUrl(env),
  getWebsiteUrl:  (env) => testManager?.getWebsiteUrl(env),
  // Mutator used by tests to flip config flags between assertions.
  setConfig:      (path, value) => {
    if (!testManager) return;
    const parts = path.split('.');
    let obj = testManager.config;
    for (let i = 0; i < parts.length - 1; i++) {
      obj[parts[i]] = obj[parts[i]] || {};
      obj = obj[parts[i]];
    }
    obj[parts[parts.length - 1]] = value;
  },
});

// Mirror the production preload surface so renderer test suites can assert against it.
contextBridge.exposeInMainWorld('em', {
  ipc: {
    invoke: (channel, payload) => ipcRenderer.invoke(channel, payload),
    on:     (channel, handler) => ipcRenderer.on(channel, (_, payload) => handler(payload)),
    send:   (channel, payload) => ipcRenderer.send(channel, payload),
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
  // matchMedia — the real mechanism, since themeSource flips prefers-color-scheme).
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
});
