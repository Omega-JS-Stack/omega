// Restart Manager protocol v1 — the shared contract SSOT.
//
// BOTH sides of the Restart Manager system import this file:
//   - EM's own lib (src/lib/restart-manager/index.js) — the registering side that
//     every EM app runs.
//   - The Restart Manager app itself (an EM consumer) via the sanctioned deep
//     require: require('electron-manager/lib/restart-manager/protocol').
//
// NEVER copy these constants into another repo — this file is the single
// authoritative definition of the wire protocol, the shared filesystem layout,
// and the payload shapes. Bump PROTOCOL_VERSION on any breaking change.
//
// Deliberately pure Node: no electron import, no EM imports, no I/O. Everything
// takes plain values so it's testable at the build layer and bundles anywhere.
//
// The shared root (`<appData>/restart-manager/`) is NEUTRAL ground — it is NOT
// any app's userData dir, so EM's dev/test userData suffixing never moves it:
//   runtime.json    — written atomically by the RM app while its HTTP server is
//                     listening; removed on graceful quit. The pid inside is the
//                     liveness truth check — a stale file is harmless.
//   app/            — the installed RM app on mac/linux (owned by EM's install
//                     machinery). Windows installs via silent NSIS instead, so
//                     the exe lives in %LOCALAPPDATA%\Programs\ (see
//                     getInstalledAppPath) — NSIS is what lets RM self-update
//                     through electron-updater on Windows.
//   install.lock    — advisory lock so two EM apps can't run installers concurrently.
//
// Updates: RM updates ITSELF via EM's standard autoUpdater (registrations are
// storage-persisted, so they survive the update relaunch). EM's lib only ever
// installs RM when it's missing.
//
// Full reference: docs/restart-manager.md.

const path = require('path');

const PROTOCOL_VERSION = 1;

const SHARED_DIR_NAME = 'restart-manager';
const RUNTIME_FILE    = 'runtime.json';
const APP_DIR         = 'app';
const LOCK_FILE       = 'install.lock';

// HTTP endpoints served by the RM app on 127.0.0.1:<runtime.json port>.
const ENDPOINTS = Object.freeze({
  health:     '/v1/health',        // GET  → { ok, version, protocolVersion, uptime, apps }  (apps = COUNT)
  register:   '/v1/register',      // POST → { ok }  (idempotent upsert keyed by id)
  deregister: '/v1/deregister',    // POST → { ok }  (idempotent; unknown id still ok)
  apps:       '/v1/apps',          // GET  → { ok, apps: [...] }
});

// Installed-app entry per platform. mac/linux live inside `<sharedRoot>/app/`;
// Windows is an NSIS per-user install under %LOCALAPPDATA%\Programs\<productName>\
// (electron-builder's default one-click location — required for electron-updater
// self-updates).
const RM_APP_NAMES = Object.freeze({
  darwin: 'Restart Manager.app',
  win32:  'Restart Manager.exe',
  linux:  'Restart-Manager.AppImage',
});

const WIN_INSTALL_DIR_NAME = 'Restart Manager';   // %LOCALAPPDATA%\Programs\<this>\

const ENVIRONMENTS = Object.freeze(['development', 'testing', 'production']);

/**
 * Resolve the shared root directory both sides agree on.
 * `EM_RM_ROOT` is the cross-repo isolation seam: tests (and parallel dev setups)
 * set it to keep dev/test runs away from the real `<appData>/restart-manager`.
 *
 * @param {string} appDataPath - `app.getPath('appData')` (the PARENT of userData dirs).
 * @param {object} [env] - environment map, defaults to process.env.
 * @returns {string} absolute shared-root path.
 */
function resolveSharedRoot(appDataPath, env) {
  const e = env || process.env;
  return e.EM_RM_ROOT || path.join(appDataPath, SHARED_DIR_NAME);
}

/**
 * @param {string} root - shared root from resolveSharedRoot().
 * @returns {string} path to runtime.json.
 */
function getRuntimePath(root) {
  return path.join(root, RUNTIME_FILE);
}

/**
 * @param {string} root
 * @returns {string} path to the app/ install dir (mac/linux installs).
 */
function getAppDir(root) {
  return path.join(root, APP_DIR);
}

/**
 * @param {string} root
 * @returns {string} path to the advisory install lock file.
 */
function getLockPath(root) {
  return path.join(root, LOCK_FILE);
}

/**
 * Canonical installed-app path per platform — THE existence check target.
 * mac/linux: inside the shared root's app/ dir. Windows: the NSIS per-user
 * install location (%LOCALAPPDATA%\Programs\Restart Manager\Restart Manager.exe).
 *
 * @param {string} root - shared root (used for mac/linux).
 * @param {string} platform - process.platform value ('darwin' | 'win32' | 'linux').
 * @param {object} [env] - environment map (win32 only), defaults to process.env.
 * @returns {string} absolute path to the installed RM app entry.
 */
function getInstalledAppPath(root, platform, env) {
  const name = RM_APP_NAMES[platform];
  if (!name) throw new Error(`restart-manager: unsupported platform "${platform}"`);
  if (platform === 'win32') {
    const e = env || process.env;
    if (!e.LOCALAPPDATA) throw new Error('restart-manager: LOCALAPPDATA not set');
    return path.join(e.LOCALAPPDATA, 'Programs', WIN_INSTALL_DIR_NAME, name);
  }
  return path.join(getAppDir(root), name);
}

// ─── Validators ───────────────────────────────────────────────────────────────
// All return { valid: boolean, errors: [{ field, message }] } and never throw.

function _isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function _isPositiveInt(value) {
  return Number.isInteger(value) && value > 0;
}

function _isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Validate a parsed runtime.json payload.
 *
 * @param {object} obj - parsed runtime.json contents.
 * @returns {{ valid: boolean, errors: Array<{field: string, message: string}> }}
 */
function validateRuntime(obj) {
  const errors = [];

  if (!_isPlainObject(obj)) {
    return { valid: false, errors: [{ field: '', message: 'runtime must be an object' }] };
  }

  if (obj.protocolVersion !== PROTOCOL_VERSION) {
    errors.push({ field: 'protocolVersion', message: `must be ${PROTOCOL_VERSION}` });
  }
  if (!_isPositiveInt(obj.port) || obj.port > 65535) {
    errors.push({ field: 'port', message: 'must be an integer 1-65535' });
  }
  if (!_isPositiveInt(obj.pid)) {
    errors.push({ field: 'pid', message: 'must be a positive integer' });
  }
  if (!_isNonEmptyString(obj.version)) {
    errors.push({ field: 'version', message: 'must be a non-empty string' });
  }
  if (!_isNonEmptyString(obj.environment)) {
    errors.push({ field: 'environment', message: 'must be a non-empty string' });
  }
  if (!obj.startedAt) {
    errors.push({ field: 'startedAt', message: 'is required' });
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a POST /v1/register body.
 *
 * @param {object} obj - candidate register payload.
 * @returns {{ valid: boolean, errors: Array<{field: string, message: string}> }}
 */
function validateRegisterPayload(obj) {
  const errors = [];

  if (!_isPlainObject(obj)) {
    return { valid: false, errors: [{ field: '', message: 'payload must be an object' }] };
  }

  if (obj.protocolVersion !== PROTOCOL_VERSION) {
    errors.push({ field: 'protocolVersion', message: `must be ${PROTOCOL_VERSION}` });
  }
  if (!_isNonEmptyString(obj.id)) {
    errors.push({ field: 'id', message: 'must be a non-empty string' });
  }
  if (!_isNonEmptyString(obj.name)) {
    errors.push({ field: 'name', message: 'must be a non-empty string' });
  }
  if (!_isPositiveInt(obj.pid)) {
    errors.push({ field: 'pid', message: 'must be a positive integer' });
  }
  // Same-machine protocol → path.isAbsolute is valid for the receiving side too.
  if (!_isNonEmptyString(obj.path) || !path.isAbsolute(obj.path)) {
    errors.push({ field: 'path', message: 'must be an absolute path string' });
  }
  if (!_isNonEmptyString(obj.version)) {
    errors.push({ field: 'version', message: 'must be a non-empty string' });
  }
  if (!ENVIRONMENTS.includes(obj.environment)) {
    errors.push({ field: 'environment', message: `must be one of ${ENVIRONMENTS.join(', ')}` });
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a POST /v1/deregister body.
 *
 * @param {object} obj - candidate deregister payload.
 * @returns {{ valid: boolean, errors: Array<{field: string, message: string}> }}
 */
function validateDeregisterPayload(obj) {
  const errors = [];

  if (!_isPlainObject(obj)) {
    return { valid: false, errors: [{ field: '', message: 'payload must be an object' }] };
  }

  if (!_isNonEmptyString(obj.id)) {
    errors.push({ field: 'id', message: 'must be a non-empty string' });
  }
  if (!_isPositiveInt(obj.pid)) {
    errors.push({ field: 'pid', message: 'must be a positive integer' });
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Build a register payload with the protocol version stamped.
 * Callers pass raw fields; this is the ONE place the wire shape is assembled.
 *
 * @param {{ id: string, name: string, pid: number, path: string, version: string, environment: string }} fields
 * @returns {object} wire-ready register payload.
 */
function buildRegisterPayload(fields) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    id:          fields.id,
    name:        fields.name,
    pid:         fields.pid,
    path:        fields.path,
    version:     fields.version,
    environment: fields.environment,
  };
}

module.exports = {
  PROTOCOL_VERSION,
  SHARED_DIR_NAME,
  RUNTIME_FILE,
  APP_DIR,
  LOCK_FILE,
  ENDPOINTS,
  RM_APP_NAMES,
  WIN_INSTALL_DIR_NAME,
  ENVIRONMENTS,
  resolveSharedRoot,
  getRuntimePath,
  getAppDir,
  getLockPath,
  getInstalledAppPath,
  validateRuntime,
  validateRegisterPayload,
  validateDeregisterPayload,
  buildRegisterPayload,
};
