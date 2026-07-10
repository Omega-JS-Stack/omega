// Restart Manager — the framework-side client of the external guardian app that
// relaunches this app if it crashes.
//
// Why an external helper? On all three OSes there are restart edge cases
// (crashed-then-relaunch, post-update install, hidden-mode rehydrate) where you
// can't reliably restart yourself from inside your own dying process. RM lives
// outside our process tree, watches our pid, and relaunches us when we vanish
// without saying goodbye.
//
// Protocol v1 (SSOT: ./protocol.js — the RM app imports the same file via
// `require('@omega.js/desktop/lib/restart-manager/protocol')`):
//   - RM serves loopback HTTP (127.0.0.1, ephemeral port) and advertises it in
//     `<sharedRoot>/runtime.json` ({ protocolVersion, port, pid, version, ... }).
//   - We POST /v1/register ({ id, name, pid, path, version, environment }) after
//     boot, re-POST every 60s (idempotent upsert — doubles as the "revive RM if
//     it died" loop), and POST /v1/deregister on graceful quit so RM never
//     relaunches an app the user actually closed.
//   - Crash = our pid dies while still registered. RM's grace window (2 ticks)
//     lets a slightly-late deregister win, so the quit flush below only has to
//     be best-effort-plus.
//
// Install ownership: WE install RM when it's missing — silently on every
// platform (mac: zip → <sharedRoot>/app/; win: NSIS one-click run with /S,
// per-user, no admin, no UI; linux: AppImage → app/ + chmod). UPDATES are
// RM's own job: it runs @omega.js/desktop's standard autoUpdater like any other @omega.js/desktop app
// (NSIS on win is exactly what makes that possible), and its registrations
// are storage-persisted so they survive the update relaunch. Watched apps'
// 60s heartbeats reconnect through the fresh runtime.json afterwards.
//
// Bail conditions (any one → the lib schedules nothing):
//   - manager.isTesting() — tests drive the public methods explicitly against
//     an isolated root; nothing may fire on its own, and install/spawn paths
//     stay dead so tests never touch network or real OS state.
//   - brand.id === 'restart-manager' (RM doesn't manage itself)
//   - config.restartManager.enabled === false
//   - non-production without OMEGA_RESTART_MANAGER_DEV=1 (dev noise guard)
//
// Full reference: docs/restart-manager.md.

const path       = require('path');
const fs         = require('fs');
const http       = require('http');
const { spawn }  = require('child_process');
const jetpack    = require('fs-jetpack');
const LoggerLite = require('../logger-lite.js');
const protocol   = require('./protocol.js');
const install    = require('./install.js');

const logger = new LoggerLite('restart-manager');

// Default release feed — RM publishes through @omega.js/desktop's standard pipeline, so the
// feed lives on the restart-manager org's update-server releases. Consumers
// can override via config.restartManager.feed ({ owner, repo } or full { url }).
const DEFAULT_FEED = Object.freeze({
  owner: 'restart-manager',
  repo:  'update-server',
  url:   '',
});

const REGISTER_DELAY_PROD_MS  = 15000;
const REGISTER_DELAY_DEV_MS   = 3000;
const HEARTBEAT_MS            = 60000;
const HEALTH_TIMEOUT_MS       = 1500;
const REQUEST_TIMEOUT_MS      = 3000;
const SPAWN_POLL_TIMEOUT_MS   = 15000;
const SPAWN_POLL_INTERVAL_MS  = 500;
const QUIT_FLUSH_CAP_MS       = 1000;
const MAX_REGISTER_ATTEMPTS   = 3;
const INSTALL_COOLDOWN_MS     = 60 * 60 * 1000;        // failed install → back off 1h

const restartManager = {
  _initialized:  false,
  _manager:      null,
  _enabled:      true,
  _bailed:       false,
  _bailReason:   null,
  _root:         null,
  _feed:         DEFAULT_FEED,
  _registered:   false,
  _running:      false,
  _port:         null,
  _registerTimer:  null,
  _heartbeatTimer: null,
  _heartbeatBusy:  false,
  _quitWired:    false,
  _quitFlushed:  false,
  _installCooldownUntil: 0,
  _lastHeartbeatAt: null,
  _lastError:    null,

  initialize(manager) {
    if (restartManager._initialized) return;
    restartManager._initialized = true;
    restartManager._manager = manager;

    const cfg = manager.config.restartManager || {};
    restartManager._enabled = cfg.enabled !== false;
    restartManager._feed = { ...DEFAULT_FEED, ...(cfg.feed || {}) };

    const { app } = require('electron');

    // Root resolution. Testing gets an isolated root under the ` (Testing)`
    // userData (wiped every run) so explicit test calls never touch the real
    // neutral root; everything else shares `<appData>/restart-manager` (or the
    // OMEGA_RM_ROOT override — the cross-repo dev/test isolation seam).
    restartManager._root = manager.isTesting()
      ? path.join(app.getPath('userData'), protocol.SHARED_DIR_NAME)
      : protocol.resolveSharedRoot(app.getPath('appData'), process.env);

    // Bail #1: test mode. Nothing fires on its own — no timers, no quit hook
    // (a preventDefault in before-quit would wedge the harness's quit). Tests
    // drive register()/unregister()/ensureInstalled() explicitly.
    if (manager.isTesting()) {
      restartManager._bail('testing', 'skipping (test mode).');
      return;
    }

    // Bail #2: this app IS restart-manager. RM doesn't manage itself.
    if (manager.config.brand.id === 'restart-manager') {
      restartManager._bail('self', 'skipping (this app is restart-manager itself).');
      return;
    }

    // Bail #3: explicitly disabled by config.
    if (!restartManager._enabled) {
      restartManager._bail('disabled', 'restartManager.enabled=false — skipping.');
      return;
    }

    // Bail #4: dev mode unless explicitly opted in — avoids feed fetches and
    // spawn thrash during local dev where RM likely isn't installed.
    if (!manager.isProduction() && process.env.OMEGA_RESTART_MANAGER_DEV !== '1') {
      restartManager._bail('dev', 'skipping outside production (set OMEGA_RESTART_MANAGER_DEV=1 to test).');
      return;
    }

    // Schedule the first register after whenReady; single timer so re-init
    // guards don't pile up (tests shutdown() to clear).
    const delay = manager.isDevelopment() ? REGISTER_DELAY_DEV_MS : REGISTER_DELAY_PROD_MS;
    app.whenReady().then(() => {
      restartManager._registerTimer = setTimeout(() => {
        restartManager.register().catch((e) => logger.warn(`register failed: ${e.message}`));
      }, delay);
    });

    restartManager._wireQuit();

    logger.log(`initialized — register scheduled in ${delay}ms (root: ${restartManager._root}).`);
  },

  // ─── Public API ─────────────────────────────────────────────────────────────

  // Full registration flow: probe → (install + spawn if needed) → POST register.
  // Never throws; failures land in getStatus().lastError. Testing never installs
  // or spawns — a probe failure just returns false.
  async register() {
    if (restartManager._hardBailed()) return false;
    const manager = restartManager._manager;

    for (let attempt = 1; attempt <= MAX_REGISTER_ATTEMPTS; attempt++) {
      try {
        let probe = await restartManager._probeRunning();

        if (!probe.ok) {
          if (manager.isTesting()) {
            restartManager._lastError = 'restart-manager not running';
            return false;
          }
          await restartManager.ensureInstalled();
          const running = await restartManager.ensureRunning();
          if (!running) continue;
          probe = await restartManager._probeRunning();
          if (!probe.ok) continue;
        }

        const res = await restartManager._post(protocol.ENDPOINTS.register, restartManager._buildPayload());
        if (res && res.ok) {
          restartManager._registered = true;
          restartManager._lastError = null;
          restartManager._startHeartbeat();
          logger.log('registered with restart-manager.');
          return true;
        }
        restartManager._lastError = `register rejected: ${JSON.stringify(res)}`;
      } catch (e) {
        restartManager._lastError = e.message;
      }
    }

    logger.warn(`register gave up after ${MAX_REGISTER_ATTEMPTS} attempts (${restartManager._lastError}).`);
    return false;
  },

  // Best-effort deregister — RM's grace window covers a lost packet, and the
  // before-quit flush caps the wait so quitting never hangs on us.
  async unregister() {
    restartManager._stopHeartbeat();
    if (restartManager._hardBailed()) return false;

    try {
      const manager = restartManager._manager;
      const res = await restartManager._post(protocol.ENDPOINTS.deregister, {
        id:  manager.config.brand.id,
        pid: process.pid,
      });
      restartManager._registered = false;
      return Boolean(res && res.ok);
    } catch (e) {
      restartManager._lastError = e.message;
      restartManager._registered = false;
      return false;
    }
  },

  // Install RM into <root>/app/ when missing. Smart existence: the installed
  // app on disk short-circuits BEFORE any network so repeat boots cost one stat.
  async ensureInstalled() {
    const manager = restartManager._manager;
    const platform = process.platform;

    const appPath = protocol.getInstalledAppPath(restartManager._root, platform);
    if (fs.existsSync(appPath)) return true;

    // Tests never hit the network unless explicitly in extended mode.
    if (manager.isTesting() && !process.env.TEST_EXTENDED_MODE) return false;

    if (Date.now() < restartManager._installCooldownUntil) {
      logger.log('install on cooldown after a recent failure — skipping.');
      return false;
    }

    if (!install.acquireInstallLock(restartManager._root, { pid: process.pid, hostAppId: manager.config.brand.id })) {
      logger.log('another app holds the install lock — skipping (heartbeat retries).');
      return false;
    }

    try {
      const feed = await install.fetchFeed(restartManager._feed, platform);
      const artifactName = install.pickArtifact(feed, platform, process.arch);
      const downloadsDir = path.join(restartManager._root, 'downloads');
      jetpack.dir(downloadsDir);
      const artifactPath = path.join(downloadsDir, artifactName);

      logger.log(`downloading restart-manager v${feed.version} (${artifactName})`);
      await install.downloadFile(install.buildArtifactUrl(restartManager._feed, artifactName), artifactPath);
      await install.installArtifact({ root: restartManager._root, platform, artifactPath, version: feed.version });
      jetpack.remove(artifactPath);
      return true;
    } catch (e) {
      restartManager._lastError = e.message;
      restartManager._installCooldownUntil = Date.now() + INSTALL_COOLDOWN_MS;
      logger.warn(`install failed: ${e.message} (cooldown 1h)`);
      return false;
    } finally {
      install.releaseInstallLock(restartManager._root);
    }
  },

  // Make sure RM is actually serving: probe → spawn the installed app → poll.
  async ensureRunning() {
    const manager = restartManager._manager;

    const probe = await restartManager._probeRunning();
    if (probe.ok) return true;

    // Tests never spawn real binaries — the fixture server plays the running RM.
    if (manager.isTesting()) return false;

    const appPath = protocol.getInstalledAppPath(restartManager._root, process.platform);
    if (!fs.existsSync(appPath)) return false;

    try {
      restartManager._spawnRM(appPath);
    } catch (e) {
      restartManager._lastError = e.message;
      return false;
    }

    const deadline = Date.now() + SPAWN_POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(SPAWN_POLL_INTERVAL_MS);
      const p = await restartManager._probeRunning();
      if (p.ok) return true;
    }
    restartManager._lastError = 'restart-manager did not come up after spawn';
    return false;
  },

  getStatus() {
    const root = restartManager._root;
    let installed = false;
    try { installed = Boolean(root) && fs.existsSync(protocol.getInstalledAppPath(root, process.platform)); }
    catch (_) { /* unsupported platform / missing LOCALAPPDATA */ }

    return {
      enabled:         restartManager._enabled,
      bailed:          restartManager._bailed,
      bailReason:      restartManager._bailReason,
      root,
      installed,
      running:         restartManager._running,
      registered:      restartManager._registered,
      port:            restartManager._port,
      pid:             process.pid,
      lastHeartbeatAt: restartManager._lastHeartbeatAt,
      lastError:       restartManager._lastError,
    };
  },

  // Test teardown — idempotent, mirrors initialize()'s wiring.
  shutdown() {
    if (restartManager._registerTimer) {
      clearTimeout(restartManager._registerTimer);
      restartManager._registerTimer = null;
    }
    restartManager._stopHeartbeat();
    if (restartManager._quitWired) {
      try { require('electron').app.removeListener('before-quit', restartManager._handleBeforeQuit); } catch (_) { /* ignore */ }
      restartManager._quitWired = false;
    }
    restartManager._initialized  = false;
    restartManager._manager      = null;
    restartManager._enabled      = true;
    restartManager._bailed       = false;
    restartManager._bailReason   = null;
    restartManager._root         = null;
    restartManager._feed         = DEFAULT_FEED;
    restartManager._registered   = false;
    restartManager._running      = false;
    restartManager._port         = null;
    restartManager._quitFlushed  = false;
    restartManager._installCooldownUntil = 0;
    restartManager._lastHeartbeatAt = null;
    restartManager._lastError    = null;
  },

  // ─── Internals ──────────────────────────────────────────────────────────────

  _bail(reason, message) {
    restartManager._bailed = true;
    restartManager._bailReason = reason;
    logger.log(message);
  },

  // Bails that block even explicit calls. 'testing' is deliberately NOT here —
  // tests drive the public methods against the isolated root; the network/spawn
  // guards inside each method keep them side-effect free.
  _hardBailed() {
    return restartManager._bailed && restartManager._bailReason !== 'testing';
  },

  // Parse + validate runtime.json. null on missing/malformed/wrong version.
  _readRuntime() {
    try {
      const raw = fs.readFileSync(protocol.getRuntimePath(restartManager._root), 'utf8');
      const parsed = JSON.parse(raw);
      const check = protocol.validateRuntime(parsed);
      if (!check.valid) {
        logger.warn(`runtime.json invalid: ${check.errors.map((e) => `${e.field} ${e.message}`).join('; ')}`);
        return null;
      }
      return parsed;
    } catch (_) {
      return null;
    }
  },

  _pidAlive(pid) {
    return install.pidAlive(pid);
  },

  // Is RM actually serving? runtime.json → pid alive → GET /v1/health.
  async _probeRunning() {
    const runtime = restartManager._readRuntime();
    if (!runtime) {
      restartManager._running = false;
      return { ok: false };
    }
    if (!restartManager._pidAlive(runtime.pid)) {
      restartManager._running = false;
      return { ok: false, runtime };
    }

    try {
      const health = await restartManager._request(runtime.port, 'GET', protocol.ENDPOINTS.health, null, HEALTH_TIMEOUT_MS);
      const ok = Boolean(health && health.ok) && health.protocolVersion === protocol.PROTOCOL_VERSION;
      if (!ok) {
        logger.warn(`health mismatch (protocolVersion=${health && health.protocolVersion}) — treating as not running.`);
        restartManager._running = false;
        return { ok: false, runtime, health };
      }
      if (!restartManager._running) {
        logger.log(`connected to restart-manager v${health.version} (${runtime.environment}) on port ${runtime.port}.`);
      }
      restartManager._running = true;
      restartManager._port = runtime.port;
      return { ok: true, runtime, health };
    } catch (_) {
      restartManager._running = false;
      return { ok: false, runtime };
    }
  },

  // Raw loopback JSON request — plain node:http (wonderful-fetch is only for
  // the GitHub feed; loopback traffic stays dependency-free with a hard timeout).
  _request(port, method, endpoint, body, timeoutMs) {
    return new Promise((resolve, reject) => {
      const payload = body ? JSON.stringify(body) : null;
      const req = http.request({
        host: '127.0.0.1',
        port,
        method,
        path: endpoint,
        headers: payload
          ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }
          : {},
        timeout: timeoutMs || REQUEST_TIMEOUT_MS,
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch (_) { reject(new Error(`non-JSON response (HTTP ${res.statusCode})`)); }
        });
      });
      req.on('timeout', () => req.destroy(new Error('request timed out')));
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  },

  async _post(endpoint, body) {
    let port = restartManager._port;
    if (!port) {
      const runtime = restartManager._readRuntime();
      if (!runtime) throw new Error('restart-manager runtime.json not found');
      port = runtime.port;
    }
    return restartManager._request(port, 'POST', endpoint, body);
  },

  _buildPayload() {
    const manager = restartManager._manager;
    const { app } = require('electron');
    return protocol.buildRegisterPayload({
      id:          manager.config.brand.id,
      name:        app.getName(),
      pid:         process.pid,
      path:        app.getPath('exe'),
      version:     manager.getVersion(),
      environment: manager.getEnvironment(),
    });
  },

  _spawnRM(appPath) {
    logger.log(`spawning restart-manager: ${appPath}`);
    const child = process.platform === 'darwin'
      ? spawn('open', [appPath], { detached: true, stdio: 'ignore' })
      : spawn(appPath, [], { detached: true, stdio: 'ignore' });
    child.on('error', (e) => logger.warn(`spawn error: ${e.message}`));
    child.unref();
  },

  // ─── Heartbeat ──────────────────────────────────────────────────────────────
  // Re-POST register every minute. Idempotent upsert on RM's side; doubles as
  // the keep-alive loop — if RM died (or was updated away), the failure path
  // runs the full register() flow which re-spawns it. Cheap loopback POST.

  _startHeartbeat() {
    if (restartManager._heartbeatTimer) return;
    restartManager._heartbeatTimer = setInterval(() => {
      restartManager._heartbeatTick().catch((e) => logger.warn(`heartbeat failed: ${e.message}`));
    }, HEARTBEAT_MS);
    // Never hold the process open just to heartbeat.
    if (restartManager._heartbeatTimer.unref) restartManager._heartbeatTimer.unref();
  },

  _stopHeartbeat() {
    if (restartManager._heartbeatTimer) {
      clearInterval(restartManager._heartbeatTimer);
      restartManager._heartbeatTimer = null;
    }
  },

  async _heartbeatTick() {
    if (restartManager._heartbeatBusy) return;
    restartManager._heartbeatBusy = true;
    try {
      const res = await restartManager._post(protocol.ENDPOINTS.register, restartManager._buildPayload());
      if (res && res.ok) {
        restartManager._lastHeartbeatAt = Date.now();
        return;
      }
      throw new Error(`register rejected: ${JSON.stringify(res)}`);
    } catch (e) {
      logger.warn(`heartbeat lost restart-manager (${e.message}) — running full register flow.`);
      restartManager._registered = false;
      await restartManager.register();
    } finally {
      restartManager._heartbeatBusy = false;
    }
  },

  // ─── Quit flush ─────────────────────────────────────────────────────────────
  // A fire-and-forget deregister can lose the race against process exit, and RM
  // would then "relaunch" an app the user closed on purpose. So: prevent the
  // first quit, flush deregister with a hard 1s cap, then re-quit. All existing
  // before-quit listeners (main.js _isQuitting, appState sentinel, usage stamp)
  // are double-fire safe — verified before this design was chosen.

  _wireQuit() {
    if (restartManager._quitWired) return;
    require('electron').app.on('before-quit', restartManager._handleBeforeQuit);
    restartManager._quitWired = true;
  },

  _handleBeforeQuit(event) {
    const manager = restartManager._manager;
    if (restartManager._quitFlushed || !restartManager._registered) return;

    // Never intercept the auto-updater's quitAndInstall — its quit sequence
    // (especially Squirrel.Mac) must own the exit. The app relaunches via the
    // updater anyway; RM's deregister-wins grace window + @omega.js/desktop's single-instance
    // lock neutralize the tiny race.
    const updaterStatus = manager.autoUpdater.getStatus();
    if (manager._allowQuit && updaterStatus.code === 'downloaded') {
      restartManager._quitFlushed = true;
      restartManager.unregister().catch(() => { /* best-effort */ });
      return;
    }

    event.preventDefault();
    restartManager._quitFlushed = true;
    restartManager._quitFlush().finally(() => manager.quit({ force: true }));
  },

  async _quitFlush() {
    try {
      await Promise.race([restartManager.unregister(), sleep(QUIT_FLUSH_CAP_MS)]);
    } catch (_) { /* quitting regardless */ }
  },

};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = restartManager;
