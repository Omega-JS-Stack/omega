// Boot-layer test for lib/restart-manager — proves the split lib dir (index/
// protocol/install) survives webpack bundling into a real consumer bundle
// (js-yaml + the directory require are the packaging risks) and bails cleanly
// as 'testing' in the consumer's real boot path.
//
// NOTE: inspect bodies are serialized to the spawned Electron process — no
// closures over module scope.

module.exports = {
  type: 'group',
  layer: 'boot',
  description: 'restart-manager — bundled lib boots and bails cleanly',
  timeout: 30000,
  tests: [
    {
      description: 'restartManager wired, bailed as testing, nothing scheduled',
      inspect: async ({ manager, expect }) => {
        const rm = manager.restartManager;
        expect(Boolean(rm)).toBe(true);
        for (const fn of ['register', 'unregister', 'ensureInstalled', 'ensureRunning', 'getStatus', 'shutdown']) {
          expect(typeof rm[fn]).toBe('function');
        }

        const status = rm.getStatus();
        expect(status.bailed).toBe(true);
        expect(status.bailReason).toBe('testing');
        expect(rm._registerTimer).toBe(null);
        expect(rm._quitWired).toBe(false);

        // Isolated root under the testing userData — never the real appData root.
        const { app } = require('electron');
        expect(status.root.startsWith(app.getPath('userData'))).toBe(true);
      },
    },
  ],
};
