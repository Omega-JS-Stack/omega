// Boot-layer theme test: the bundled fixture consumer, its production preload and
// a framework-templated page. The preload stamps `<html data-bs-theme>` with the
// RESOLVED appearance and follows main's source flips live. `run` bodies are
// serialized to the spawned Electron process: each is self-contained.

const defineCases = require('@omega.js/devkit/test/define-cases');

module.exports = defineCases({
  type: 'group',
  layer: 'boot',
  description: 'theme — resolved appearance applied to the live page (real bundle)',
  tests: [
    {
      name: 'page boots with data-bs-theme equal to the resolved appearance',
      run: async (ctx) => {
        const { BrowserWindow } = require('electron');

        ctx.expect(ctx.omega.theme._initialized).toBe(true);
        ctx.expect(['light', 'dark'].includes(ctx.omega.theme.resolved())).toBe(true);

        // Wait for the fixture's main window + view, then for the applier to land
        // (it applies at DOMContentLoaded).
        let attr = null;
        for (let i = 0; i < 50; i++) {
          const win = ctx.omega.windows.get('main') || BrowserWindow.getAllWindows()[0];
          if (win && !win.isDestroyed() && win.webContents.getURL().includes('/views/main/')) {
            attr = await win.webContents.executeJavaScript('document.documentElement.getAttribute("data-bs-theme")').catch(() => null);
            if (attr === ctx.omega.theme.resolved()) break;
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        ctx.expect(attr).toBe(ctx.omega.theme.resolved());
      },
    },

    {
      name: 'main-side theme.set() updates the live page attribute (no reload)',
      run: async (ctx) => {
        const { BrowserWindow } = require('electron');
        const win = ctx.omega.windows.get('main') || BrowserWindow.getAllWindows()[0];
        ctx.expect(Boolean(win && !win.isDestroyed())).toBe(true);

        const original = ctx.omega.theme.get();
        const target = ctx.omega.theme.resolved() === 'dark' ? 'light' : 'dark';

        ctx.omega.theme.set(target);

        let attr = null;
        for (let i = 0; i < 50; i++) {
          attr = await win.webContents.executeJavaScript('document.documentElement.getAttribute("data-bs-theme")').catch(() => null);
          if (attr === target) break;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        // Restore before asserting so a failure can't strand the flipped state.
        ctx.omega.theme.set(original);
        ctx.omega.storage.delete('theme.appearance');

        ctx.expect(attr).toBe(target);
      },
    },
  ],
});
