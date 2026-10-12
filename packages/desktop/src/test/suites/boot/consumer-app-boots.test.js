// Boot-layer self-test: the bundled fixture consumer (src/test/fixtures/consumer-app)
// built into a real main.bundle.js and booted in Electron, the production boot path.
// Framework boot/ suites join discovery on a self-test only. Each `run` body is
// serialized into the booted app's main process: no closures; `require`, `process`
// and `Buffer` are injected, and ctx carries `omega`, `projectRoot`, `appRoot`
// (the staged test-app root), `frameworkDistRoot` and `distSnapshotBefore`.

const defineCases = require('@omega.js/devkit/test/define-cases');

module.exports = defineCases({
  type: 'group',
  layer: 'boot',
  description: 'fixture consumer app — boots end-to-end (real bundle)',
  tests: [
    {
      name: 'omega initialized with all core libs wired',
      run: async (ctx) => {
        ctx.expect(ctx.omega).toBeTruthy();
        ctx.expect(ctx.omega._initialized).toBe(true);
        for (const lib of ['storage', 'ipc', 'windows', 'tray', 'menu', 'contextMenu', 'auth']) {
          ctx.expect(Boolean(ctx.omega[lib])).toBe(true);
        }
      },
    },

    {
      name: 'the fixture main.js created the main window and loaded the built view',
      run: async (ctx) => {
        const { BrowserWindow } = require('electron');

        // windows.create() runs inside the consumer's initialize().then(); poll for it.
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
      name: 'test stealth: app activation suppressed, dock hidden (macOS)',
      run: async (ctx) => {
        if (process.platform !== 'darwin') {
          return; // accessory activation policy / dock is macOS-only
        }
        // omega.initialize step 1a hides the dock under the stealth predicate,
        // so the spawned consumer app never activates and never steals keyboard
        // focus from the developer's editor.
        const { app } = require('electron');
        ctx.expect(app.dock.isVisible()).toBe(false);
        ctx.expect(ctx.omega.isTesting()).toBe(true);
      },
    },

    {
      name: 'the bundle task produced the real production bundle + view on disk',
      run: async (ctx) => {
        const fs = require('fs');
        const path = require('path');
        ctx.expect(fs.existsSync(path.join(ctx.appRoot, 'dist', 'main.bundle.js'))).toBe(true);
        ctx.expect(fs.existsSync(path.join(ctx.appRoot, 'dist', 'views', 'main', 'index.html'))).toBe(true);
      },
    },

    {
      // #111 — the fixture's renderer entry imports the vendored app-shell
      // module through the `__main_assets__` alias. Its declarative contract
      // showing up in the built bundle proves the chain: esbuild alias →
      // @omega.js/desktop's vendored dist asset.
      name: 'renderer bundle carries the vendored app-shell module via __main_assets__',
      run: async (ctx) => {
        const fs = require('fs');
        const path = require('path');
        const bundle = fs.readFileSync(path.join(ctx.appRoot, 'dist', 'assets', 'js', 'components', 'main.bundle.js'), 'utf8');

        ctx.expect(bundle.includes('data-shell-toggle')).toBe(true);
        ctx.expect(bundle.includes('data-shell-dismiss')).toBe(true);
      },
    },

    {
      // The lane spawns this child with OMEGA_ENVIRONMENT=testing, and the artifact
      // it boots was BUILT production. The proof is a gate that writes to the log:
      // main.js moves userData to its `(Testing)` path in a test run alone, and
      // records the move as `(testing mode, ...)`.
      name: 'the booted app runs in the lane environment, not the one baked into its bundle (#925)',
      run: async (ctx) => {
        const fs = require('fs');
        const path = require('path');

        ctx.expect(ctx.omega.isTesting()).toBe(true);
        ctx.expect(ctx.omega.config.environment).toBe('production');   // the artifact IS a production build

        const log = fs.readFileSync(path.join(ctx.projectRoot, 'logs', 'runtime.log'), 'utf8');
        ctx.expect(log.includes('(testing mode, ')).toBe(true);
      },
    },

    {
      // The fixture's `cloud.config` carries no apiKey: a brand with no cloud.
      // Auth skips Firebase there, so the booted app's log holds no error from it.
      name: 'a boot with no cloud apiKey writes no error line from auth',
      run: async (ctx) => {
        const fs = require('fs');
        const path = require('path');

        const log = fs.readFileSync(path.join(ctx.projectRoot, 'logs', 'runtime.log'), 'utf8');
        const authErrors = log.split('\n').filter((line) => /\[error\]\s+\(auth\)/.test(line));
        ctx.expect(authErrors).toEqual([]);
      },
    },

    {
      // #925: a page has no `process`, so its instance reads the baked word. The
      // preload hands the running one over on `window.desktop`, and the renderer
      // bootstrap applies it, so this window answers what main answers.
      name: 'the main window renderer answers the lane environment too (#925)',
      run: async (ctx) => {
        const { BrowserWindow } = require('electron');

        // The window is created in the consumer's initialize().then(), and its
        // bootstrap sets the config a moment later; poll for both, the way the
        // view test above polls for the window.
        let answer = null;
        let win = null;
        for (let i = 0; i < 40; i++) {
          win = ctx.omega.windows.get('main') || BrowserWindow.getAllWindows()[0];
          if (win && !win.isDestroyed() && !win.webContents.isLoading()) {
            answer = await win.webContents.executeJavaScript(
              'window.__omegaInstance && window.__omegaInstance.config.environment ? window.__omegaInstance.getEnvironment() : null',
            );
            if (answer) break;
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        const baked = await win.webContents.executeJavaScript('window.OMEGA_BUILD_JSON.config.environment');
        const bridged = await win.webContents.executeJavaScript('window.desktop.environment');

        ctx.expect(baked).toBe('production');     // what the build baked
        ctx.expect(bridged).toBe('testing');      // what the preload read off the lane
        ctx.expect(answer).toBe('testing');       // what the renderer's instance answers
      },
    },

    {
      // The renderer builds `omega.shell` from ITSELF with the vendored app
      // shell's createShell(omega), exactly as web builds it; the fixture binds
      // the same export through the `__main_assets__` alias (#111).
      name: 'the main window renderer carries omega.shell, built by createShell(omega)',
      run: async (ctx) => {
        const { BrowserWindow } = require('electron');

        let probe = null;
        for (let i = 0; i < 40; i++) {
          const win = ctx.omega.windows.get('main') || BrowserWindow.getAllWindows()[0];
          if (win && !win.isDestroyed() && !win.webContents.isLoading()) {
            probe = await win.webContents.executeJavaScript(`(() => {
              const instance = window.__omegaInstance;
              if (!instance || !instance.shell) return null;
              return {
                createShell: typeof window.__omegaCreateShell,
                isCollapsed: typeof instance.shell.isCollapsed,
                toggleOpen: typeof instance.shell.toggleOpen,
                desktopIsBridge: instance.desktop === window.desktop,
              };
            })()`);
            if (probe) break;
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        ctx.expect(probe).toEqual({ createShell: 'function', isCollapsed: 'function', toggleOpen: 'function', desktopIsBridge: true });
      },
    },

    {
      name: 'case-165 a run(ctx) boot case reads ctx.omega, ctx.appRoot and ctx.distSnapshotBefore',
      run: async (ctx) => {
        const path = require('path');

        ctx.expect(ctx.omega._initialized).toBe(true);
        ctx.expect(ctx.appRoot).toBe(path.join(ctx.projectRoot, '.omega', 'test-app'));
        ctx.expect(typeof ctx.distSnapshotBefore).toBe('string');
      },
    },
  ],
});
