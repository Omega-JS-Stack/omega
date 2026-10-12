/**
 * Boot-layer test: this project's REAL built bundle boots and everything this
 * project wires is live in it. The build and renderer layers cover the config
 * and the page in isolation; neither proves `src/main.js` and the three files
 * under `src/integrations/` survive esbuild and run inside a real Electron.
 *
 * NOTE: `run` bodies are serialized to the spawned Electron process, so they
 * close over nothing from this module. `require` and `process` are injected;
 * ctx carries `omega`, `projectRoot`, `appRoot`, `distSnapshotBefore` and
 * `frameworkDistRoot`.
 */

const { defineCases } = require('@omega.js/desktop/test');

module.exports = defineCases({
  type: 'group',
  layer: 'boot',
  description: 'the playground desktop app boots (real bundle)',
  timeout: 30000,
  tests: [
    {
      name: 'omega initialized with the libs this app destructures in src/main.js',
      run: async (ctx) => {
        ctx.expect(ctx.omega._initialized).toBe(true);

        // The exact set src/main.js pulls off omega: a lib that stopped
        // being wired would throw there, not here, and only at runtime.
        for (const lib of ['logger', 'ipc', 'storage', 'windows', 'tray', 'menu', 'contextMenu', 'deepLink', 'autoUpdater', 'auth', 'appState', 'sentry', 'startup']) {
          ctx.expect(Boolean(ctx.omega[lib])).toBe(true);
        }
      },
    },

    {
      name: 'src/main.js created the main window on the built main view',
      run: async (ctx) => {
        const { BrowserWindow } = require('electron');

        // windows.create() runs inside this project's initialize().then(), so poll.
        let url = '';
        for (let i = 0; i < 40; i++) {
          const win = ctx.omega.windows.get('main') || BrowserWindow.getAllWindows()[0];
          if (win && !win.isDestroyed()) {
            url = win.webContents.getURL();
            if (url.includes('/views/main/')) break;
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        ctx.expect(Boolean(ctx.omega.windows.get('main'))).toBe(true);
        ctx.expect(url.includes('/views/main/')).toBe(true);
      },
    },

    {
      name: 'the three integrations under src/integrations/ loaded',
      run: async (ctx) => {
        // tray/index.js and menu/index.js both call useDefaults(), so the default
        // items being addressable is the proof the definitions ran and rendered.
        ctx.expect(ctx.omega.tray.has('open')).toBe(true);
        ctx.expect(ctx.omega.tray.has('quit')).toBe(true);

        ctx.expect(ctx.omega.menu.isRendered()).toBe(true);
        ctx.expect(ctx.omega.menu.has('edit/copy')).toBe(true);

        // context-menu/index.js is per-event, so nothing is rendered at boot:
        // a loaded consumer definition plus a live menu is the whole surface.
        ctx.expect(ctx.omega.contextMenu.hasCustomDefinition()).toBe(true);
        ctx.expect(ctx.omega.contextMenu.isDisabled()).toBe(false);
      },
    },

    {
      name: 'this boot never asked the OS keychain: auth persistence resolved to none',
      run: async (ctx) => {
        const path = require('path');
        const fs = require('fs');

        // This project declares no `omega.authPersistence`, so a real launch takes the
        // safeStorage default and reads the OS vault. A test run must not: the boot
        // lane spawns an unsigned Electron, which has no keychain ACL and parks the
        // whole run behind a SecurityAgent prompt (#907). The booted app's own log is
        // the proof, written by the bundle under test.
        const log = fs.readFileSync(path.join(ctx.projectRoot, 'logs', 'runtime.log'), 'utf8');

        ctx.expect(log.includes('auth persistence: none (test mode)')).toBe(true);
        ctx.expect(log.includes('strategy "safeStorage" active')).toBe(false);
      },
    },

    {
      name: 'the boot build left this project\'s real dist/ byte-for-byte unchanged',
      run: async (ctx) => {
        const path = require('path');
        const distSnapshot = require(path.join(ctx.frameworkDistRoot, 'test', 'utils', 'dist-snapshot.js'));

        // `npm start`'s watcher owns dist/; the boot build belongs in
        // .omega/test-app/. The runner fingerprints dist/ before the build and
        // ships it here, so this re-fingerprint from inside the booted app is
        // the proof, taken across the real run.
        const before = ctx.distSnapshotBefore.split('\n').filter(Boolean);
        const after  = distSnapshot(path.join(ctx.projectRoot, 'dist')).split('\n').filter(Boolean);

        // Both directions, so a deletion counts as a touch too, and the failure
        // names the files rather than printing two enormous fingerprints.
        const beforeSet = new Set(before);
        const afterSet  = new Set(after);
        const touched   = [...after.filter((line) => !beforeSet.has(line)), ...before.filter((line) => !afterSet.has(line))]
          .map((line) => line.split('\t')[0]);

        ctx.expect([...new Set(touched)].sort().join(', ')).toBe('');
      },
    },
  ],
});
