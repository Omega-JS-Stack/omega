// Runtime-side logger. Prints the ONE identity tag, `[@omega.js/desktop:<name>]`,
// with NO timestamp on the console — devtools stamps renderer lines and the file
// transport carries its own timestamp
// ([#12](https://github.com/Omega-JS-Stack/omega/issues/12)).
//
// Same per-name `new LoggerLite('foo')` API the rest of @omega.js/desktop has always used. Adds a
// file transport when running inside Electron (main process) so consumers can read
// runtime logs from disk without remoting into the running app.
//
// File location:
//   - Dev (app.isPackaged === false)  : <projectRoot>/logs/runtime.log
//   - Prod (app.isPackaged === true)  : app.getPath('logs')/runtime.log
//                                        i.e. ~/Library/Logs/<AppName>/runtime.log on macOS,
//                                             %APPDATA%\<AppName>\logs\runtime.log on Windows,
//                                             ~/.config/<AppName>/logs/runtime.log on Linux.
//
// Renderer / preload don't have direct file access — they emit logs via IPC to main,
// which writes them through the same single file transport. So all logs (main +
// renderer + preload) converge in one file, ordered by arrival.
//
// Outside Electron entirely (e.g. when build/CLI code requires this module — should
// be rare; build/CLI use `lib/logger.js` instead) it falls back to console-only.

// The package segment of the identity tag — this file IS @omega.js/desktop.
const PACKAGE = '@omega.js/desktop';

// Channel used by renderer/preload to forward log calls to main. Public for the
// preload contextBridge to attach to.
const FORWARD_CHANNEL = 'desktop:log:forward';

// Detect context. In renderer bundles (target: 'web'), Node modules like 'electron'
// don't exist — all detection returns false, and the logger becomes console-only +
// IPC forwarding to main. No top-level `require('electron')` — that would get bundled
// by esbuild and crash in the browser-like renderer context.
//
// We lazy-load Node modules (path, fs, electron, electron-log) inside the functions
// that actually need them (ensureMainFileTransport, tryForwardToMain) so esbuild's
// renderer bundle never sees them.
const _isBrowser = typeof window !== 'undefined' && typeof require === 'undefined';
let _electron = null;
let _isElectron = false;
let _isMain = false;

if (!_isBrowser) {
  try {
    _electron = require('electron');
    _isElectron = !!(_electron && typeof _electron === 'object');
    _isMain = !!(_isElectron && _electron.app && typeof _electron.app.getPath === 'function');
  } catch (_) {
    // Not in an Electron context (plain Node CLI, etc.)
  }
}

// Public aliases for backward compat (exposed via _internals).
const isElectron = _isElectron;
const isMain = _isMain;

// Cache the resolved electron-log module + its file transport's path so we can
// expose `getLogFilePath()` synchronously without re-resolving.
let _electronLog = null;
let _logFilePath = null;
let _initAttempted = false;

// With the single-instance lock off, several launches append to one runtime.log,
// so every file line carries its process id. Main sets this once the config resolves.
let _lockOff = false;

function fileFormat() {
  const pid = _lockOff ? ` [pid ${process.pid}]` : '';
  return `[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}]${pid} {scope} {text}`;
}

// runtime.log's size before this launch wrote to it: the bytes past it are this
// launch's own, which the lock holder keeps when it clears earlier launches.
let _bootSize = 0;

function recordBootSize() {
  try {
    _bootSize = require('fs').statSync(_logFilePath).size;
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    _bootSize = 0;
  }
}

// Attempt to wire up the file transport. Lazy + idempotent — first log() call from
// main triggers init. Renderer skips this entirely.
function ensureMainFileTransport() {
  if (_initAttempted) return;
  _initAttempted = true;

  if (!_isMain) return;

  let log;
  try {
    log = require('electron-log/main');
  } catch (e) {
    return;
  }

  // Lazy-load Node modules — only runs in main process, never bundled into renderer.
  const path = require('path');
  const fs   = require('fs');
  const { app } = _electron;

  // Resolve the target log file path based on packaged state. See module header.
  const isPackaged = app.isPackaged === true;
  let logsDir;
  if (isPackaged) {
    // Standard Electron user-data location. app.getPath('logs') resolves per-OS:
    // mac:   ~/Library/Logs/<AppName>
    // win:   %APPDATA%\<AppName>\logs
    // linux: ~/.config/<AppName>/logs
    logsDir = app.getPath('logs');
  } else {
    // In dev, write to the consumer project's logs/ dir alongside dev.log + build.log.
    // process.cwd() is the consumer project root when launched via `npm start`.
    logsDir = path.join(process.cwd(), 'logs');
  }

  try {
    fs.mkdirSync(logsDir, { recursive: true });
  } catch (e) {
    // If we can't even create the dir, electron-log uses its default path internally.
  }

  _logFilePath = path.join(logsDir, 'runtime.log');
  recordBootSize();

  // Configure electron-log:
  //   - file transport writes to runtime.log (resolved above)
  //   - console transport keeps existing stderr/stdout output during dev
  //   - log level: 'silly' captures everything; consumers can dial down via env
  log.transports.file.resolvePathFn = () => _logFilePath;
  log.transports.file.level = process.env.OMEGA_LOG_LEVEL_FILE || 'silly';
  log.transports.console.level = process.env.OMEGA_LOG_LEVEL_CONSOLE || 'silly';
  log.transports.file.maxSize = 10 * 1024 * 1024; // 10 MB → rotates to runtime.old.log

  // Time format: 24-hour HH:MM:SS.ms — readable + grep-friendly. electron-log
  // accepts moment-style tokens; this matches what we already print interactively.
  log.transports.file.format    = fileFormat();
  log.transports.console.format = '[{h}:{i}:{s}.{ms}] [{level}] {scope} {text}';

  // Listen for renderer/preload log forwards. The preload-side LoggerLite sends an
  // `desktop:log:forward` message and we replay it through the same transport, so all
  // logs (main + renderer + preload) end up in one file with one timestamp source.
  if (_electron.ipcMain && typeof _electron.ipcMain.on === 'function') {
    _electron.ipcMain.on(FORWARD_CHANNEL, (event, payload) => {
      // payload = { name, level, args }
      try {
        if (!payload || typeof payload !== 'object') return;
        const scoped = log.scope(String(payload.name || 'renderer'));
        const method = scoped[payload.level] || scoped.info;
        method.apply(scoped, Array.isArray(payload.args) ? payload.args : [String(payload.args)]);
      } catch (e) {
        // Don't let renderer log forwards crash main.
      }
    });
  }

  _electronLog = log;
}

// Renderer/preload-side: attempt to forward to main. Returns true if the IPC channel
// was reachable, false otherwise (caller falls back to plain console).
//
// Two paths to reach main:
//   1. Direct ipcRenderer access (preload, or renderer with contextIsolation off).
//   2. Via window.desktop.ipc.send (renderer with contextIsolation on — preload exposes
//      a contextBridge surface that proxies to ipcRenderer).
// We try both; whichever works first wins.
function tryForwardToMain(name, level, args) {
  // Path 1: direct.
  if (_electron) {
    try {
      if (_electron.ipcRenderer && typeof _electron.ipcRenderer.send === 'function') {
        _electron.ipcRenderer.send(FORWARD_CHANNEL, { name, level, args: serializeArgs(args) });
        return true;
      }
    } catch (e) {
      // contextIsolation / sandbox can block ipcRenderer access in some configs.
    }
  }
  // Path 2: contextBridge-exposed window.desktop.ipc.send (renderer in isolated context).
  try {
    if (typeof window !== 'undefined' && window.desktop && window.desktop.ipc && typeof window.desktop.ipc.send === 'function') {
      window.desktop.ipc.send(FORWARD_CHANNEL, { name, level, args: serializeArgs(args) });
      return true;
    }
  } catch (e) {
    // ignore
  }
  return false;
}

// IPC message values must be structured-cloneable. Errors and circular refs aren't,
// so flatten them aggressively before sending. This is a "best-effort" stringify —
// the source-of-truth is still in the renderer's console for live debugging; the
// file is for post-mortem.
function serializeArgs(args) {
  return Array.from(args).map((a) => {
    if (a instanceof Error) return { __error: true, name: a.name, message: a.message, stack: a.stack };
    if (a === undefined)    return { __undefined: true };
    if (a === null)         return null;
    if (typeof a === 'function') return `[Function: ${a.name || 'anonymous'}]`;
    try {
      // Round-trip through JSON to drop circulars / non-serializable bits.
      return JSON.parse(JSON.stringify(a));
    } catch (e) {
      return String(a);
    }
  });
}

// Main constructor — same shape consumers have always used.
function Logger(name) {
  const self = this;
  self.name = name;
}

['log', 'error', 'warn', 'info', 'debug'].forEach((method) => {
  // electron-log's level naming: log/info/warn/error/debug/silly/verbose. Map our
  // 'log' to 'info' on the file transport (electron-log treats them equivalently
  // but 'info' is the canonical key).
  const fileLevel = method === 'log' ? 'info' : method;

  Logger.prototype[method] = function () {
    const self = this;

    // 1. Always write to console (dev visibility). The ONE identity tag, no
    //    timestamp — devtools/electron-log stamp runtime lines themselves (#12).
    const consoleArgs = [`[${PACKAGE}:${self.name}]`, ...Array.from(arguments)];
    if (typeof console[method] === 'function') {
      console[method].apply(console, consoleArgs);
    } else {
      console.log.apply(console, consoleArgs);
    }

    // 2. Branch based on process role:
    if (isMain) {
      // In main: lazily set up file transport, then write through it.
      ensureMainFileTransport();
      if (_electronLog) {
        const scoped = _electronLog.scope(self.name);
        const fn = scoped[fileLevel] || scoped.info;
        try {
          fn.apply(scoped, Array.from(arguments));
        } catch (e) {
          // Never let logging itself throw.
        }
      }
    } else {
      // In renderer/preload: forward to main. If forwarding fails, the console
      // call above is the fallback (no file write).
      tryForwardToMain(self.name, fileLevel, arguments);
    }
  };
});

// Public helper for tools that want to know where the file lives (e.g. `mgr logs`,
// or app code that wants to surface "send us your log" to users). Returns null
// before the file transport is set up (which only happens in main process).
Logger.getLogFilePath = function () {
  // Trigger init if we haven't yet — caller may invoke this before any log() call.
  ensureMainFileTransport();
  return _logFilePath;
};

// Main tells the logger the lock state once the config resolves (the answer of
// protocol.singleInstanceOff). A transport already set up takes the new format at once.
Logger.setSingleInstanceOff = function (off) {
  _lockOff = off;
  if (_electronLog) {
    _electronLog.transports.file.format = fileFormat();
  }
};

// Main calls this once the lock is answered. Lock on and held: this launch owns
// runtime.log, so earlier launches' lines go and its own, from boot on, stay.
// A duplicate (lock not held) or a lock-off launch leaves the file alone.
Logger.clearEarlierLaunches = function (lockHeld) {
  const filePath = Logger.getLogFilePath();
  if (_lockOff || !lockHeld || !_electronLog) return;

  // A missing logs folder means nothing to clear; any other failure is said.
  const fs = require('fs');
  try {
    const content = fs.readFileSync(filePath);
    // Shorter than the boot point: the file rotated since boot, so it is all this launch's
    const own = content.subarray(content.length < _bootSize ? 0 : _bootSize);
    // The transport's clear also resets its size count for rotation, and says its own failure
    if (_electronLog.transports.file.getFile().clear()) {
      fs.appendFileSync(filePath, own);
      _bootSize = 0;
    }
  } catch (e) {
    if (e.code !== 'ENOENT') {
      new Logger('logger-lite').warn(`runtime.log not cleared at boot: ${e.message}`);
    }
  }
};

// IPC channel name — exposed for tests + preload's contextBridge wiring.
Logger.FORWARD_CHANNEL = FORWARD_CHANNEL;

// Internal: exposed for tests so they can drive ensureMainFileTransport directly
// without simulating Electron startup.
Logger._internals = {
  ensureMainFileTransport,
  recordBootSize,
  serializeArgs,
  tryForwardToMain,
  isMain,
  isElectron,
};

module.exports = Logger;
