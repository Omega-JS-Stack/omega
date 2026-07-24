// Renderer-layer suite — asserts the `window.desktop` surface exposed by preload is shaped
// correctly and that the storage proxy round-trips through IPC into the main store.
//
// Runs inside a hidden BrowserWindow spawned by the test harness. The renderer harness
// reconstructs each `run` function via `new Function('ctx', body)` so the function bodies
// here can only reference `ctx` and `window` — no closures over module scope.

module.exports = {
  type: 'suite',
  layer: 'renderer',
  description: 'window.desktop surface + storage proxy roundtrip',
  tests: [
    {
      name: 'window.desktop is exposed and is an object',
      run: (ctx) => {
        ctx.expect(typeof window.desktop).toBe('object');
        ctx.expect(window.desktop).toBeTruthy();
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
        const off = window.desktop.ipc.on('em-test:noop-channel', () => {});
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
        const key = '__em_renderer_test_value';
        await window.desktop.storage.set(key, { hello: 'world', n: 42 });
        const value = await window.desktop.storage.get(key);
        ctx.expect(value).toEqual({ hello: 'world', n: 42 });
        await window.desktop.storage.delete(key);
      },
    },
    {
      name: 'storage.has reports correctly',
      run: async (ctx) => {
        const key = '__em_renderer_has_test';
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
        const key = '__em_renderer_delete_test';
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
};
