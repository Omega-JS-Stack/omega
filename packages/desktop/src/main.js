// Main-process Manager singleton.
// Consumer entry: `new (require('@omegajs/desktop/main'))().initialize()` — config auto-loads (config/omega.json5).
// Boot sequence below — each step delegates to a `lib/*.js` module. Stubs today, real impls land in pass 2.

const LoggerLite = require('./lib/logger-lite.js');

const storage      = require('./lib/storage.js');
const theme        = require('./lib/theme.js');
const fontawesome  = require('./lib/fontawesome.js');
const sentry       = require('./lib/sentry/index.js');
const protocol     = require('./lib/protocol.js');
const deepLink     = require('./lib/deep-link.js');
const authFlow     = require('./lib/auth-flow.js');
const appState     = require('./lib/app-state.js');
const ipc          = require('./lib/ipc.js');
const autoUpdater  = require('./lib/auto-updater.js');
const tray         = require('./lib/tray.js');
const menu         = require('./lib/menu.js');
const ctxMenu      = require('./lib/context-menu.js');
const startup      = require('./lib/startup.js');
const wmBridge     = require('./lib/web-manager-bridge.js');
const windows      = require('./lib/window-manager.js');
const context      = require('./lib/context.js');
const usage        = require('./lib/usage.js');
const remoteConfig   = require('./lib/remote-config.js');
const remoteScripts  = require('./lib/remote-scripts.js');
const analytics      = require('./lib/analytics.js');
const restartManager = require('./lib/restart-manager/index.js');

function Manager() {
  const self = this;

  self.config = null;
  self.logger = new LoggerLite('main');

  // Quit-vs-hide gating. The window-manager `close` handler checks `_allowQuit` /
  // `_isQuitting` before deciding whether to actually close (=quit) or to swallow
  // the event and just hide the window. Set true via `manager.quit({ force: true })`,
  // by `app.on('before-quit')` (any user-initiated quit), and by the auto-updater
  // when it's about to call `quitAndInstall()`.
  self._allowQuit  = false;
  self._isQuitting = false;

  // Public lib references (consumer code can call them by name)
  self.storage     = storage;
  self.theme       = theme;
  self.fontawesome = fontawesome;
  self.sentry      = sentry;
  self.protocol    = protocol;
  self.deepLink    = deepLink;
  self.authFlow    = authFlow;
  self.appState    = appState;
  self.ipc         = ipc;
  self.autoUpdater = autoUpdater;
  self.tray        = tray;
  self.menu        = menu;
  self.contextMenu = ctxMenu;
  self.startup     = startup;
  self.webManager  = wmBridge;
  self.windows     = windows;
  self.context     = context;
  self.usage       = usage;
  self.remoteConfig  = remoteConfig;
  self.remoteScripts = remoteScripts;
  self.analytics     = analytics;
  self.restartManager = restartManager;

  return self;
}

// Open the sign-in round trip in the user's default browser (lib/auth-flow.js).
// Resolves once launched; completion arrives via the auth/token deep-link route →
// webManager.handleAuthToken → the desktop:auth:sign-in-with-token broadcast.
Manager.prototype.openAuthFlow = function (options) {
  return authFlow.open(options);
};

// Force a real quit, bypassing per-window `hideOnClose`. Use this anywhere the
// app legitimately wants to exit (tray Quit, Cmd+Q from menu role:'quit',
// auto-updater install). Without `{ force: true }`, the close events still get
// trapped by hide-on-close handlers and the app stays running.
Manager.prototype.quit = function (options) {
  const self = this;
  options = options || {};

  if (options.force) {
    self._allowQuit = true;
  }

  try {
    require('electron').app.quit();
  } catch (e) { /* electron not available — no-op in test/headless */ }
};

// Force a relaunch — same gating as quit, but tells electron to start back up
// after exit. If an update has been downloaded, prefers `quitAndInstall()` so
// the user lands on the new version instead of the old one.
Manager.prototype.relaunch = function (options) {
  const self = this;
  options = options || {};

  if (options.force) {
    self._allowQuit = true;
  }

  const electron = require('electron');

  // If updater downloaded a fresh build, install + relaunch via electron-updater
  // (which calls `app.quit()` internally with the right post-quit script). Falls
  // back to plain relaunch if updater hasn't downloaded anything.
  const updaterStatus = self.autoUpdater.getStatus();
  if (updaterStatus.code === 'downloaded') {
    return self.autoUpdater.installNow();
  }

  electron.app.relaunch();
  electron.app.quit();
};

Manager.prototype.initialize = async function (consumerConfig, options) {
  const self = this;

  // Accept either an already-RESOLVED config object, a string path to a consumer
  // project dir, or nothing. Default resolution order (when called with no arg):
  //   1. EM_BUILD_JSON.config — injected at build time by webpack DefinePlugin. This is
  //      authoritative in packaged apps because config/omega.json5 is inside the asar —
  //      not loadable from disk. It's the RESOLVED config (Manager.getConfig() output —
  //      shared sections + targets.desktop overlaid) snapshotted at build time.
  //   2. <appRoot>/config/omega.json5 — resolved via @omegajs/config for dev mode where
  //      @omegajs/desktop is loaded directly (no webpack bundling). appRoot = the consumer project dir.
  if (typeof consumerConfig === 'string') {
    consumerConfig = loadResolvedConfig(consumerConfig);
  } else if (!consumerConfig) {
    // Try EM_BUILD_JSON (set by DefinePlugin in packaged builds) first.
    if (typeof EM_BUILD_JSON !== 'undefined' && EM_BUILD_JSON?.config) {
      consumerConfig = EM_BUILD_JSON.config;
    } else {
      const appRoot = require('./utils/app-root.js')();
      consumerConfig = loadResolvedConfig(appRoot);
    }
  }

  self.config = consumerConfig || {};
  self._options = options || {};

  {
    const fs = require('fs');
    const _path = require('path');
    const _app = require('electron').app;

    const _productName = self.config.app?.productName || self.config.brand?.name;
    if (_productName) {
      _app.setName(_productName);
    }
    const _logPath = _app.isPackaged
      ? _path.join(_app.getPath('logs'), 'runtime.log')
      : _path.join(process.cwd(), 'logs', 'runtime.log');
    try { fs.writeFileSync(_logPath, ''); } catch (e) {}
  }

  self.logger.log(`Initializing @omegajs/desktop (main)... pid=${process.pid} platform=${process.platform} arch=${process.arch} packaged=${require('electron').app.isPackaged} argv=${JSON.stringify(process.argv.slice(1))}`);

  try { if (require('electron').app.isPackaged) {
    const { execFile } = require('child_process');
    if (process.platform === 'darwin') {
      const _appIdx = process.execPath.indexOf('.app');
      if (_appIdx === -1) throw new Error('no .app in execPath');
      const _appPath = process.execPath.substring(0, _appIdx + 4);
      execFile('codesign', ['--verify', '--deep', '--strict', _appPath], (err) => {
        if (err) {
          self.logger.warn(`signing: NOT signed (${err.message.split('\n')[0]})`);
        } else {
          execFile('codesign', ['-dv', _appPath], { encoding: 'utf8' }, (e2, stdout, stderr) => {
            const authority = (stderr || '').match(/Authority=(.+)/);
            const adhoc = (stderr || '').includes('Signature=adhoc');
            const label = adhoc ? 'ad-hoc' : (authority ? authority[1] : 'unknown');
            self.logger.log(`signing: signed (${label})`);
          });
        }
      });
    } else if (process.platform === 'win32') {
      execFile('powershell', ['-NoProfile', '-Command', `(Get-AuthenticodeSignature '${process.execPath}').Status`], { encoding: 'utf8' }, (err, stdout) => {
        const status = (stdout || '').trim();
        if (err || status === 'NotSigned') {
          self.logger.warn(`signing: NOT signed`);
        } else {
          self.logger.log(`signing: signed (${status})`);
        }
      });
    } else {
      self.logger.log('signing: n/a (Linux — no OS-level code signing)');
    }
  } } catch (e) { self.logger.warn(`signing: check failed (${e.message})`); }

  // Schema validation. Hard-fail boot if required fields are missing — same rules as
  // gulp/audit (single source of truth in @omegajs/config: shared schema + the desktop
  // target refinements). We do this before any lib initializes so a misconfigured app
  // fails loud + early instead of partway through boot with a confusing stack trace.
  {
    const { validateConfig, formatErrors } = require('@omegajs/config');
    const { errors } = validateConfig(self.config, { target: 'desktop' });
    if (errors.length > 0) {
      throw new Error(`@omegajs/desktop: config validation failed — fix the following in config/omega.json5:\n${formatErrors(errors)}`);
    }
  }

  // electron is a peer dep — main process only (we're in main.js, always defined).
  const electron = require('electron');
  const app = electron.app;

  // Lifecycle event logging. These are the high-signal app-level events worth tracing
  // when something goes wrong — quit reasons, window-all-closed, will-finish-launching,
  // ready, render-process-gone, child-process-gone. All cheap to log; one line each.
  app.on('before-quit', () => {
    self._isQuitting = true;
    self.logger.log('app event: before-quit (entering quit sequence — close events bypass hide-on-close)');
  });
  app.on('will-quit', () => self.logger.log('app event: will-quit'));
  app.on('quit', (_e, exitCode) => self.logger.log(`app event: quit code=${exitCode}`));
  app.on('window-all-closed', () => self.logger.log('app event: window-all-closed'));
  app.on('render-process-gone', (_e, webContents, details) => self.logger.warn(`app event: render-process-gone reason=${details.reason} exitCode=${details.exitCode}`));
  app.on('child-process-gone', (_e, details) => self.logger.warn(`app event: child-process-gone type=${details.type} reason=${details.reason} exitCode=${details.exitCode}`));
  app.on('activate', () => self.logger.log('app event: activate (macOS — dock click or app re-launch)'));
  app.on('open-url', (_e, url) => self.logger.log(`app event: open-url url=${url}`));
  app.on('open-file', (_e, p) => self.logger.log(`app event: open-file path=${p}`));

  // Process-level signals that bypass Electron's app events. Catches uncaught exceptions
  // so we never crash silently — combined with electron-log file transport, this means
  // ANY unhandled throw lands in runtime.log rather than disappearing into stderr.
  process.on('uncaughtException', (e) => {
    // EPIPE = stdout/stderr pipe closed (CLI consumer hung up). Logging it would
    // write to console, which triggers another EPIPE, cascading into thousands of
    // identical log entries. Exit cleanly — standard Unix behavior.
    if (e?.code === 'EPIPE') {
      process.exit(0);
      return;
    }
    self.logger.error(`uncaughtException: ${e?.stack || e?.message || String(e)}`);
  });
  process.on('unhandledRejection', (reason) => {
    self.logger.error(`unhandledRejection: ${reason?.stack || reason?.message || String(reason)}`);
  });
  process.on('exit', (code) => {
    // electron-log's file transport flushes synchronously, so this last line lands.
    self.logger.log(`process exit code=${code}`);
  });

  // 1. Apply early startup-mode hide. For `mode: 'hidden'` we call app.dock.hide() *before*
  //    anything else so macOS spends as little time animating the dock entry as possible.
  //    In packaged builds the Info.plist's LSUIElement (injected by gulp/build-config when
  //    startup.mode === 'hidden') prevents the bounce entirely.
  self.startup._manager = self;
  self.startup._electron = electron || null;
  self.startup.applyEarly();

  // 1a. Test stealth: suppress app-level activation on macOS. Launching a regular-
  //     policy app activates it — menu bar + keyboard focus switch away from whatever
  //     the developer is typing in — even though stealth windows surface via
  //     showInactive() (see lib/window-manager.js). The accessory policy (the same
  //     switch app.dock.hide() flips, and what LSUIElement bakes for packaged
  //     hidden-mode apps) keeps the test process from ever activating; windows still
  //     render normally. Must run before app ready — activation happens when the app
  //     finishes launching. EM_TEST_SHOW=1 restores normal activation along with
  //     visible windows.
  if (process.platform === 'darwin' && require('./utils/test-stealth.js')(self)) {
    app.dock.hide();
    self.logger.log('test stealth: app activation suppressed (dock hidden / accessory policy) — launch will not steal focus');
  }

  // 1a-ii. Test stealth for EVERY BrowserWindow — including RAW ones created with
  //        `new BrowserWindow()` that never pass through lib/window-manager (e.g.
  //        a consumer's automation popup). Window-manager stealths only its own
  //        named windows via _surface(); this hook closes the gap so no window
  //        can flash or steal focus during a test run. The predicate is evaluated
  //        PER WINDOW so EM_TEST_SHOW=1 keeps working even when flipped mid-run
  //        (the window-manager suite does exactly that).
  if (self.isTesting()) {
    app.on('browser-window-created', (_event, win) => {
      if (!require('./utils/test-stealth.js')(self)) return;
      require('./utils/stealth-window.js').applyStealth(win);
    });
    // webContents.focus() is NOT covered by the window stealth above — it's a
    // different object whose focus() reaches the native window directly,
    // making the invisible window KEY: the test app grabs the keyboard from
    // whatever the developer is typing in (the accessory policy from 1a does
    // not prevent key-window steals, only launch activation). Consumers call
    // it legitimately (address-bar focus on tab select, overlay dismiss
    // hand-back), so no-op it per-contents under the same predicate —
    // synthetic input (executeJavaScript, sendInputEvent, CDP) targets a
    // specific webContents and never depends on OS key status.
    app.on('web-contents-created', (_event, wc) => {
      if (!require('./utils/test-stealth.js')(self)) return;
      wc.focus = () => {};
    });
    self.logger.log('test stealth: every BrowserWindow (raw ones included) surfaces invisible + unfocusable, webContents.focus() suppressed (EM_TEST_SHOW=1 to watch)');
  }

  // 1b. Isolate the userData path per environment. MUST run before
  //     storage.initialize() because electron-store reads `app.getPath('userData')`
  //     at construction time.
  //       production  → <name>                 (untouched)
  //       development → <name> (Development)   (dev runs never touch installed-app data)
  //       testing     → <name> (Testing)       (wiped at boot — every test run starts
  //                                             from a clean slate; post-run state stays
  //                                             on disk for inspection until the next run.
  //                                             Set EM_TEST_KEEP_USERDATA=1 to skip the wipe.)
  if (self.isTesting()) {
    const before = app.getPath('userData');
    const after  = `${before} (Testing)`;
    const keep   = process.env.EM_TEST_KEEP_USERDATA === '1';
    if (!keep) {
      require('fs').rmSync(after, { recursive: true, force: true });
    }
    app.setPath('userData', after);
    self.logger.log(`userData path: ${before} -> ${after} (testing mode, ${keep ? 'kept' : 'wiped at boot'})`);
  } else if (!self.isProduction()) {
    const before = app.getPath('userData');
    const after  = `${before} (Development)`;
    app.setPath('userData', after);
    self.logger.log(`userData path: ${before} -> ${after} (dev mode)`);
  } else {
    self.logger.log(`userData path: ${app.getPath('userData')} (production)`);
  }

  // 1c. Set the global user agent fallback. Default template applied to every @omegajs/desktop app so
  //     web requests (BrowserWindow loads, fetch, electron-updater downloads) carry a
  //     branded UA — Mozilla parsers see a normal Chrome UA + we tag with the app's
  //     name/version for our own server-side telemetry. Legacy @omegajs/desktop did the
  //     same; merge tags now use node-powertools.template (single-curly syntax).
  {
    const { template } = require('node-powertools');
    const ctx = {
      brand: {
        name: self.config.brand.name,
        id:   self.config.brand.id,
      },
      app: {
        version: self.getVersion(),
      },
      chrome:   process.versions.chrome,
      electron: process.versions.electron,
      node:     process.versions.node,
      platform: process.platform,
      arch:     process.arch,
    };
    const templates = {
      darwin: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) {brand.name}/{app.version} Chrome/{chrome} Safari/537.36',
      win32:  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) {brand.name}/{app.version} Chrome/{chrome} Safari/537.36',
      linux:  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) {brand.name}/{app.version} Chrome/{chrome} Safari/537.36',
    };
    const tmpl = templates[process.platform] || templates.linux;
    const ua = template(tmpl, ctx);
    app.userAgentFallback = ua;
    self.logger.log(`userAgent: ${ua}`);
  }

  // 2. IPC bus online first — storage and other libs register handlers on it
  self.ipc.initialize(self);

  // 3. Storage (precedes sentry + auth so opt-out + persisted session are honored)
  await self.storage.initialize(self);

  // 3b. Theme — sets nativeTheme.themeSource from the persisted override / config
  //     default, so every renderer (and native UI) resolves the right appearance
  //     from its very first paint. Needs storage (override) + ipc (handlers) only.
  self.theme.initialize(self);

  // 3c. FontAwesome — serves the bundled icon SVGs to renderers over IPC
  //     (desktop:fontawesome:get). Needs ipc only.
  self.fontawesome.initialize(self);

  // 4. Sentry (earliest catchable global handler)
  self.sentry.initialize(self);

  // 5. Protocol (single-instance lock + custom URL scheme)
  self.protocol.initialize(self);

  if (!self.protocol.hasSingleInstanceLock()) {
    // Quit the duplicate AND halt the boot: returning normally would resolve
    // initialize(), letting the consumer's .then() run its whole main.js (servers,
    // shared files, IPC) against a dying Electron — the duplicate must go quietly.
    // The returned promise intentionally never settles; the process exits first.
    self.logger.warn('Single-instance lock lost. Quitting this duplicate instance.');
    app.quit();
    return new Promise(() => {});
  }

  // 6. Deep links (parse cold-start argv, install second-instance handler)
  self.deepLink.initialize(self);

  // 6b. Auth flow (the getAuthUrl sign-in round trip — external browser always;
  //     dev/test return via a loopback listener since the scheme isn't OS-registered)
  self.authFlow.initialize(self);

  // 7. App state (first-launch / crash / startup-context flags)
  await self.appState.initialize(self);

  // 7b. Runtime context — session id, deviceId, OS info, async geolocation fetch.
  // Must run AFTER storage (writes deviceId + cached geolocation to storage) and
  // BEFORE analytics (which reads context.session.deviceId). Async but the geolocation
  // fetch is fire-and-forget so this returns quickly.
  await self.context.initialize(self);

  // 7c. Usage tracking — opens / hours-total / hours-this-session. Reads/writes
  // storage.usage and registers a before-quit handler to record session duration.
  self.usage.initialize(self);

  // 8. Wait for app readiness before any UI
  await app.whenReady();

  // 9. Auto-updater (queues check, never blocks UI)
  self.autoUpdater.initialize(self);

  // 10. Tray + menu + context menu
  self.tray.initialize(self);
  self.menu.initialize(self);
  self.contextMenu.initialize(self);

  // 11. Open-at-login + hide-on-startup state sync
  self.startup.initialize(self);

  // 12. Web-manager bridge (main-side Firebase Auth source of truth, IPC handlers for renderers)
  await self.webManager.initialize(self);

  // 12b. Remote config — fetches `<brand.url>/data/resources/main.json` for hot
  // config flips (force-update gate, default user agents, etc.). Polls hourly.
  // Wired AFTER auto-updater so it can inherit feedCheckIntervalMs from there.
  self.remoteConfig.initialize(self);

  // 12c. Remote scripts — fetches `<brand.url>/data/scripts/main.json` for
  // emergency hotfixes (force-update, storage patches, etc.) when the normal
  // update pipeline is broken. Same polling cadence as remote-config.
  self.remoteScripts.initialize(self);

  // 12d. Analytics — GA4 via Measurement Protocol. Wired AFTER web-manager-bridge
  // so it can subscribe to onAuthChange and flip user_id automatically.
  self.analytics.initialize(self);

  // 12e. Restart Manager — external guardian app that relaunches us if we crash.
  // Registers over RM's loopback HTTP protocol (runtime.json advertises the port),
  // heartbeats every 60s, deregisters on graceful quit, and silently installs RM
  // when missing (mac zip / win silent NSIS / linux AppImage — RM then self-updates
  // via its own @omegajs/desktop autoUpdater). Skips itself when this app IS restart-manager, in
  // dev (unless EM_RESTART_MANAGER_DEV=1), or when restartManager.enabled=false.
  // See docs/restart-manager.md.
  self.restartManager.initialize(self);

  // 13. Initialize the windows lib — registers app-level handlers (window-all-closed, etc.)
  //     but does NOT create any windows. Consumers are responsible for calling
  //     `manager.windows.create('main')` (or any other named window) from their main.js
  //     when they want to surface UI. This makes hidden / agent-app patterns trivial:
  //     just don't call create() until something (tray click, deep link, IPC) warrants it.
  self.windows.initialize(self);

  self._initialized = true;
  self.logger.log('@omegajs/desktop (main) initialized.');

  // Boot test harness — runs against the live manager AFTER all libs are up. Test runner
  // sets EM_TEST_BOOT=1 + EM_TEST_BOOT_HARNESS=<absolute path> + EM_TEST_BOOT_SPEC=<path>
  // before spawning electron. The harness emits __EM_TEST__ JSON lines on stdout (parsed
  // by runners/boot.js) then app.exit()s.
  //
  // We use a runtime env-var path (not a static `require('./test/harness/...')`) because
  // @omegajs/desktop is webpacked into the consumer's bundle, and a static require would either get
  // inlined (bundling test code into production) or dead-code-eliminated. An env-var
  // path stays external and can only resolve when the runner sets it.
  if (process.env.EM_TEST_BOOT === '1') {
    global.__em_manager = self;
    const harnessPath = process.env.EM_TEST_BOOT_HARNESS;
    if (harnessPath) {
      // Defer the harness so the consumer's `manager.initialize().then(() => { ... })`
      // callback gets a chance to run first. @omegajs/desktop doesn't auto-create any windows; the
      // consumer's main.js does it inside .then(). If we ran the harness synchronously
      // here, that callback wouldn't have fired yet and `manager.windows.get('main')`
      // would be null. setImmediate flushes the microtask queue (where promise callbacks
      // live) before our boot harness inspects state.
      setImmediate(() => {
        try {
          // __non_webpack_require__ is webpack's magic escape hatch — preserves a runtime
          // require() that webpack won't try to inline. In plain Node it's undefined, so
          // `typeof` gates the branch without ReferenceError.
          // eslint-disable-next-line import/no-dynamic-require, global-require, no-undef
          const realRequire = (typeof __non_webpack_require__ !== 'undefined') ? __non_webpack_require__ : require;
          const harness = realRequire(harnessPath);
          harness.run(self);
        } catch (e) {
          const { app } = require('electron');
          process.stdout.write(`__EM_TEST__${JSON.stringify({ event: 'fatal', message: `boot harness failed to load: ${e.message}` })}\n`);
          app.exit(1);
        }
      });
    } else {
      const { app } = require('electron');
      process.stdout.write(`__EM_TEST__${JSON.stringify({ event: 'fatal', message: 'EM_TEST_BOOT=1 but EM_TEST_BOOT_HARNESS not set' })}\n`);
      app.exit(1);
    }
  }

  return self;
};

function loadResolvedConfig(projectDir) {
  // @omegajs/config is vendored into dist (and bundled by webpack from there) — it
  // finds config/omega.json5 under the project dir and resolves the desktop target
  // (shared sections + targets.desktop overlaid, brand-monorepo walk-up included).
  const { hasOmegaConfig, loadConfig } = require('@omegajs/config');

  if (!hasOmegaConfig(projectDir)) {
    return {};
  }

  return loadConfig(projectDir, 'desktop').config;
}

// Cross-context helpers (isDevelopment/isProduction/isTesting + getFunctionsUrl/getApiUrl
// + getEnvironment) live in src/utils/mode-helpers.js + src/utils/url-helpers.js +
// src/build.js. All four Manager constructors mix them in via their respective
// `attachTo(Manager)` calls — see the bottom of this file.

// Require — lets consumer main-process code load @omegajs/desktop's bundled dependencies at runtime
// (e.g. `manager.require('fs-jetpack')`). Resolves from @omegajs/desktop's module context, not the
// consumer's. Mirrors @omegajs/backend's Manager.require(). For build-time (webpack) resolution,
// the webpack config's resolve.modules handles this automatically.
Manager.prototype.require = function (name) {
  return require(name);
};
Manager.require = function (name) {
  return require(name);
};

// Mix in shared cross-context helpers — same code path used in renderer, preload, build.
require('./utils/mode-helpers.js').attachTo(Manager);
require('./utils/url-helpers.js').attachTo(Manager);

module.exports = Manager;
