// Renderer-layer suite: asserts the `window.desktop` surface exposed by preload is shaped
// correctly, that the renderer instance carries it as `omega.desktop`, and that the
// storage proxy round-trips through IPC into the main store.
//
// Runs inside a hidden BrowserWindow spawned by the test harness. The renderer harness
// reconstructs each `run` function via `new Function('ctx', body)` so the function bodies
// here can only reference `ctx` and `window` — no closures over module scope.

const defineCases = require('@omega.js/devkit/test/define-cases');

module.exports = defineCases({
  type: 'suite',
  layer: 'renderer',
  description: 'window.desktop surface + omega.desktop + storage proxy roundtrip',
  tests: [
    {
      name: 'window.desktop is exposed and is an object',
      run: (ctx) => {
        ctx.expect(typeof window.desktop).toBe('object');
        ctx.expect(window.desktop).toBeTruthy();
      },
    },
    {
      // The preload global keeps its name and its shape: everything that
      // crosses to the main process, under main's names
      name: 'window.desktop carries the bridge namespaces, unchanged',
      run: (ctx) => {
        ctx.expect(Object.keys(window.desktop).sort()).toEqual(['analytics', 'autoUpdater', 'context', 'fontawesome', 'ipc', 'logger', 'remoteConfig', 'storage', 'theme', 'usage']);
      },
    },
    {
      // The renderer instance puts the SAME object under `omega.desktop`;
      // `omega.storage` stays the client's page store, the app store is
      // `omega.desktop.storage`
      name: 'the renderer instance\'s omega.desktop IS the preload bridge',
      run: (ctx) => {
        ctx.expect(window.__omegaTestInstance.desktopIsBridge()).toBe(true);
        ctx.expect(window.__omegaTestInstance.desktopKeys()).toEqual(Object.keys(window.desktop).sort());
        ctx.expect(window.__omegaTestInstance.storageIsPageStore()).toBe(true);
      },
    },
    {
      name: 'window.desktop.ipc has invoke / on / send',
      run: (ctx) => {
        ctx.expect(typeof window.desktop.ipc.invoke).toBe('function');
        ctx.expect(typeof window.desktop.ipc.on).toBe('function');
        ctx.expect(typeof window.desktop.ipc.send).toBe('function');
      },
    },
    {
      // wave-5 F4: ipc.on used to return ipcRenderer (stripped to a useless
      // object across the contextBridge) — docs/ipc.md promises an unsubscribe fn.
      name: 'ipc.on returns an unsubscribe function (docs contract)',
      run: (ctx) => {
        const off = window.desktop.ipc.on('omega-test:noop-channel', () => {});
        ctx.expect(typeof off).toBe('function');
        off(); // must not throw
      },
    },
    {
      name: 'window.desktop.storage has get / set / delete / has / clear',
      run: (ctx) => {
        ctx.expect(typeof window.desktop.storage.get).toBe('function');
        ctx.expect(typeof window.desktop.storage.set).toBe('function');
        ctx.expect(typeof window.desktop.storage.delete).toBe('function');
        ctx.expect(typeof window.desktop.storage.has).toBe('function');
        ctx.expect(typeof window.desktop.storage.clear).toBe('function');
      },
    },
    {
      name: 'window.desktop.logger has log / warn / error',
      run: (ctx) => {
        ctx.expect(typeof window.desktop.logger.log).toBe('function');
        ctx.expect(typeof window.desktop.logger.warn).toBe('function');
        ctx.expect(typeof window.desktop.logger.error).toBe('function');
      },
    },
    {
      name: 'window.desktop.autoUpdater has getStatus / checkNow / installNow',
      run: (ctx) => {
        ctx.expect(typeof window.desktop.autoUpdater.getStatus).toBe('function');
        ctx.expect(typeof window.desktop.autoUpdater.checkNow).toBe('function');
        ctx.expect(typeof window.desktop.autoUpdater.installNow).toBe('function');
      },
    },
    {
      name: 'storage.set + storage.get round-trips through IPC',
      run: async (ctx) => {
        const key = '__omega_renderer_test_value';
        await window.desktop.storage.set(key, { hello: 'world', n: 42 });
        const value = await window.desktop.storage.get(key);
        ctx.expect(value).toEqual({ hello: 'world', n: 42 });
        await window.desktop.storage.delete(key);
      },
    },
    {
      name: 'storage.has reports correctly',
      run: async (ctx) => {
        const key = '__omega_renderer_has_test';
        await window.desktop.storage.set(key, 'x');
        const yes = await window.desktop.storage.has(key);
        ctx.expect(yes).toBe(true);
        await window.desktop.storage.delete(key);
        const no = await window.desktop.storage.has(key);
        ctx.expect(no).toBe(false);
      },
    },
    {
      name: 'storage.delete removes the key',
      run: async (ctx) => {
        const key = '__omega_renderer_delete_test';
        await window.desktop.storage.set(key, 'gone');
        await window.desktop.storage.delete(key);
        const value = await window.desktop.storage.get(key, 'fallback');
        ctx.expect(value).toBe('fallback');
      },
    },
    {
      name: 'autoUpdater.getStatus returns a status object',
      run: async (ctx) => {
        const status = await window.desktop.autoUpdater.getStatus();
        ctx.expect(status).toBeDefined();
        ctx.expect(typeof status.code).toBe('string');
      },
    },
  ],
});
