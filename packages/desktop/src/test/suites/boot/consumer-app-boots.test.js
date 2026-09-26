// Boot-layer self-test — @omega.js/desktop's analog of "does the extension load?" /
// "does the site boot?". The boot runner esbuild-builds the bundled fixture consumer
// (src/test/fixtures/consumer-app) into a real main.bundle.js, spawns Electron with
// it (the actual production boot path — bundled, not the unbundled lib code that the
// `main` layer exercises), then runs these inspects against the live omega instance.
//
// In @omega.js/desktop's own test run, OMEGA_TEST_BOOT_PROJECT points at the fixture (auto-set in
// src/commands/test.js when the cwd is the @omega.js/desktop repo). In a real consumer's
// `npx omega test` run, the framework boot/ suites are excluded entirely (runner.js
// discovery skips boot/** unless isFrameworkSelfTest) — consumers write their own
// boot tests under <cwd>/test/boot/.
//
// NOTE: inspect bodies are serialized to the spawned Electron process — no closures over
// module scope. `require`, `process`, and `Buffer` are injected; { omega, expect,
// projectRoot, appRoot, frameworkDistRoot, distSnapshotBefore } is the inspect argument
// (projectRoot = the fixture root; appRoot = the staged target root holding the build).

const defineCases = require('@omega.js/devkit/test/define-cases');

module.exports = defineCases({
  type: 'group',
  layer: 'boot',
  description: 'fixture consumer app — boots end-to-end (real bundle)',
  timeout: 30000,
  tests: [
    {
      description: 'omega initialized with all core libs wired',
      inspect: async ({ omega, expect }) => {
        expect(omega).toBeTruthy();
        expect(omega._initialized).toBe(true);
        for (const lib of ['storage', 'ipc', 'windows', 'tray', 'menu', 'contextMenu', 'auth']) {
          expect(Boolean(omega[lib])).toBe(true);
        }
      },
    },

    {
      description: 'the fixture main.js created the main window and loaded the built view',
      inspect: async ({ omega, expect }) => {
        const { BrowserWindow } = require('electron');

        // windows.create() runs inside the consumer's initialize().then(); poll for it.
        let url = '';
        for (let i = 0; i < 40; i++) {
          const win = omega.windows.get('main') || BrowserWindow.getAllWindows()[0];
          if (win && !win.isDestroyed()) {
            url = win.webContents.getURL();
            if (url.includes('/views/main/')) break;
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        expect(Boolean(omega.windows.get('main'))).toBe(true);
        expect(url.includes('/views/main/')).toBe(true);
      },
    },

    {
      description: 'test stealth: app activation suppressed — dock hidden (macOS)',
      inspect: async ({ omega, expect }) => {
        if (process.platform !== 'darwin') {
          return; // accessory activation policy / dock is macOS-only
        }
        // omega.initialize step 1a hides the dock under the stealth predicate,
        // so the spawned consumer app never activates and never steals keyboard
        // focus from the developer's editor.
        const { app } = require('electron');
        expect(app.dock.isVisible()).toBe(false);
        expect(omega.isTesting()).toBe(true);
      },
    },

    {
      description: 'the bundle task produced the real production bundle + view on disk',
      inspect: async ({ expect, appRoot }) => {
        const fs = require('fs');
        const path = require('path');
        expect(fs.existsSync(path.join(appRoot, 'dist', 'main.bundle.js'))).toBe(true);
        expect(fs.existsSync(path.join(appRoot, 'dist', 'views', 'main', 'index.html'))).toBe(true);
      },
    },

    {
      // #111 — the fixture's renderer entry imports the vendored app-shell
      // module through the `__main_assets__` alias. Its declarative contract
      // showing up in the built bundle proves the chain: esbuild alias →
      // @omega.js/desktop's vendored dist asset.
      description: 'renderer bundle carries the vendored app-shell module via __main_assets__',
      inspect: async ({ expect, appRoot }) => {
        const fs = require('fs');
        const path = require('path');
        const bundle = fs.readFileSync(path.join(appRoot, 'dist', 'assets', 'js', 'components', 'main.bundle.js'), 'utf8');

        expect(bundle.includes('data-shell-toggle')).toBe(true);
        expect(bundle.includes('data-shell-dismiss')).toBe(true);
      },
    },

    {
      // #925: the lane spawns this child with OMEGA_ENVIRONMENT=testing and the
      // artifact it boots was BUILT production, so the booted app used to answer
      // `production` and every isTesting() gate in it was silently off. The proof
      // is a gate that writes to the log: auth persistence resolves to `none` in a
      // test run alone, and that is the line the booted app records. (The emulator
      // line the bridge logs next is out of reach here, because the fixture's
      // `cloud.config` is empty and this boot never initializes Firebase auth.)
      description: 'the booted app runs in the lane environment, not the one baked into its bundle (#925)',
      inspect: async ({ omega, expect, projectRoot }) => {
        const fs = require('fs');
        const path = require('path');

        expect(omega.isTesting()).toBe(true);
        expect(omega.config.environment).toBe('production');   // the artifact IS a production build

        const log = fs.readFileSync(path.join(projectRoot, 'logs', 'runtime.log'), 'utf8');
        expect(log.includes('auth persistence: none (test mode)')).toBe(true);
      },
    },

    {
      // #925: a page has no `process`, so its instance reads the baked word. The
      // preload hands the running one over on `window.desktop`, and the renderer
      // bootstrap applies it, so this window answers what main answers.
      description: 'the main window renderer answers the lane environment too (#925)',
      inspect: async ({ omega, expect }) => {
        const { BrowserWindow } = require('electron');

        // The window is created in the consumer's initialize().then(), and its
        // bootstrap sets the config a moment later; poll for both, the way the
        // view test above polls for the window.
        let answer = null;
        let win = null;
        for (let i = 0; i < 40; i++) {
          win = omega.windows.get('main') || BrowserWindow.getAllWindows()[0];
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

        expect(baked).toBe('production');     // what the build baked
        expect(bridged).toBe('testing');      // what the preload read off the lane
        expect(answer).toBe('testing');       // what the renderer's instance answers
      },
    },

    {
      // The renderer builds `omega.shell` from ITSELF with the vendored app
      // shell's createShell(omega), exactly as web builds it; the fixture binds
      // the same export through the `__main_assets__` alias (#111).
      description: 'the main window renderer carries omega.shell, built by createShell(omega)',
      inspect: async ({ omega, expect }) => {
        const { BrowserWindow } = require('electron');

        let probe = null;
        for (let i = 0; i < 40; i++) {
          const win = omega.windows.get('main') || BrowserWindow.getAllWindows()[0];
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

        expect(probe).toEqual({ createShell: 'function', isCollapsed: 'function', toggleOpen: 'function', desktopIsBridge: true });
      },
    },
  ],
});
