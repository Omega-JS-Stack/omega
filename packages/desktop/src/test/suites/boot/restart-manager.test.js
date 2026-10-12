// Boot-layer test for lib/restart-manager: the split lib dir survives esbuild
// bundling into a real consumer bundle and bails cleanly as 'testing' in the
// consumer's real boot path. `run` bodies are serialized to the spawned
// Electron process: no closures over module scope.

const defineCases = require('@omega.js/devkit/test/define-cases');

module.exports = defineCases({
  type: 'group',
  layer: 'boot',
  description: 'restart-manager — bundled lib boots and bails cleanly',
  tests: [
    {
      name: 'restartManager wired, bailed as testing, nothing scheduled',
      run: async (ctx) => {
        const rm = ctx.omega.restartManager;
        ctx.expect(Boolean(rm)).toBe(true);
        for (const fn of ['register', 'unregister', 'ensureInstalled', 'ensureRunning', 'getStatus', 'shutdown']) {
          ctx.expect(typeof rm[fn]).toBe('function');
        }

        const status = rm.getStatus();
        ctx.expect(status.bailed).toBe(true);
        ctx.expect(status.bailReason).toBe('testing');
        ctx.expect(rm._registerTimer).toBe(null);
        ctx.expect(rm._quitWired).toBe(false);

        // Isolated root under the testing userData — never the real appData root.
        const { app } = require('electron');
        ctx.expect(status.root.startsWith(app.getPath('userData'))).toBe(true);
      },
    },
  ],
});
