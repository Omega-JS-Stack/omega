// Boot-layer theme test — the REAL pipeline end-to-end: bundled fixture consumer,
// production preload, framework-templated page. Verifies the preload's theme applier stamps
// `<html data-bs-theme>` with the RESOLVED appearance and updates it LIVE when main
// flips the source (nativeTheme.themeSource → prefers-color-scheme → applier).
//
// NOTE: inspect bodies are serialized to the spawned Electron process — no closures
// over module scope; each inspect is self-contained.

const defineCases = require('@omega.js/devkit/test/define-cases');

module.exports = defineCases({
  type: 'group',
  layer: 'boot',
  description: 'theme — resolved appearance applied to the live page (real bundle)',
  timeout: 30000,
  tests: [
    {
      description: 'page boots with data-bs-theme equal to the resolved appearance',
      inspect: async ({ omega, expect }) => {
        const { BrowserWindow } = require('electron');

        expect(omega.theme._initialized).toBe(true);
        expect(['light', 'dark'].includes(omega.theme.resolved())).toBe(true);

        // Wait for the fixture's main window + view, then for the applier to land
        // (it applies at DOMContentLoaded).
        let attr = null;
        for (let i = 0; i < 50; i++) {
          const win = omega.windows.get('main') || BrowserWindow.getAllWindows()[0];
          if (win && !win.isDestroyed() && win.webContents.getURL().includes('/views/main/')) {
            attr = await win.webContents.executeJavaScript('document.documentElement.getAttribute("data-bs-theme")').catch(() => null);
            if (attr === omega.theme.resolved()) break;
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        expect(attr).toBe(omega.theme.resolved());
      },
    },

    {
      description: 'main-side theme.set() updates the live page attribute (no reload)',
      inspect: async ({ omega, expect }) => {
        const { BrowserWindow } = require('electron');
        const win = omega.windows.get('main') || BrowserWindow.getAllWindows()[0];
        expect(Boolean(win && !win.isDestroyed())).toBe(true);

        const original = omega.theme.get();
        const target = omega.theme.resolved() === 'dark' ? 'light' : 'dark';

        omega.theme.set(target);

        let attr = null;
        for (let i = 0; i < 50; i++) {
          attr = await win.webContents.executeJavaScript('document.documentElement.getAttribute("data-bs-theme")').catch(() => null);
          if (attr === target) break;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        // Restore before asserting so a failure can't strand the flipped state.
        omega.theme.set(original);
        omega.storage.delete('theme.appearance');

        expect(attr).toBe(target);
      },
    },
  ],
});
