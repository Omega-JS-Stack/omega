// Auth Persistence — pluggable MAIN-process storage for the Firebase auth session.
//
// Every browser context (renderers here, popup/options/background in BXM) gets Firebase
// session persistence for free via IndexedDB. Main is the one Node context — Firebase
// defaults to in-memory there, so sign-in died with the process and the bridge's
// authority rule signed every renderer out on the next boot.
//
// This module gives main a real vault through a PLUGGABLE STRATEGY (Ian: adaptable —
// storage only; distribution to renderers stays the bridge's IPC sync protocol):
//
//   strategy interface: {
//     name,
//     async available()        → bool (checked once at auth boot)
//     async setItem(key, str)  → persist plaintext string `str` under `key`
//     async getItem(key)       → the string, or null
//     async removeItem(key)    → forget `key`
//   }
//
// Built-ins:
//   'safeStorage' (DEFAULT) — Electron safeStorage (OS keychain: macOS Keychain,
//        Windows DPAPI, kwallet/gnome-keyring). Values are encrypted BEFORE they
//        touch disk ({userData}/em-auth-session.json holds base64 ciphertext only).
//        This is the same os_crypt machinery Chromium uses for its cookie jar —
//        browser IndexedDB/localStorage are plaintext LevelDB, so this is STRONGER
//        than "store it in a browser session".
//   'none' — explicit opt-out; Firebase stays in-memory (pre-1.12 behavior).
//
// Select via config `webManager.authPersistence` ('safeStorage' | 'none' | a custom
// registered name). Register custom strategies BEFORE manager.initialize():
//   require('@omegajs/desktop/lib/auth-persistence').register('keytar', {...})
//
// The firebase adapter mirrors firebase's own getReactNativePersistence(): a class
// implementing the internal Persistence surface (_set/_get/_remove) over an
// AsyncStorage-shaped backend — here, the active strategy.

const LoggerLite = require('./logger-lite.js');

const logger = new LoggerLite('auth-persistence');

const FILE_NAME = 'em-auth-session.json';

// ── safeStorage strategy ─────────────────────────────────────────────────────
// One JSON file mapping firebase persistence keys → base64(safeStorage ciphertext).
// Reads/writes go through fs.promises; a corrupt file or failed decrypt degrades to
// "no session" (warn + start signed out) — never a boot crash.
const safeStorageStrategy = {
  name: 'safeStorage',

  _filePath() {
    const { app } = require('electron');
    const path = require('path');
    return path.join(app.getPath('userData'), FILE_NAME);
  },

  async _readMap() {
    const fs = require('fs').promises;
    try {
      return JSON.parse(await fs.readFile(safeStorageStrategy._filePath(), 'utf8')) || {};
    } catch (e) {
      if (e.code !== 'ENOENT') logger.warn('session file unreadable — starting empty:', e.message);
      return {};
    }
  },

  async _writeMap(map) {
    const fs = require('fs').promises;
    await fs.writeFile(safeStorageStrategy._filePath(), JSON.stringify(map), 'utf8');
  },

  async available() {
    const { app, safeStorage } = require('electron');
    await app.whenReady(); // safeStorage needs the ready app (keychain access)
    return !!safeStorage?.isEncryptionAvailable?.();
  },

  async setItem(key, str) {
    const { safeStorage } = require('electron');
    const map = await safeStorageStrategy._readMap();
    map[key] = safeStorage.encryptString(str).toString('base64');
    await safeStorageStrategy._writeMap(map);
  },

  async getItem(key) {
    const { safeStorage } = require('electron');
    const map = await safeStorageStrategy._readMap();
    const b64 = map[key];
    if (!b64) return null;
    try {
      return safeStorage.decryptString(Buffer.from(b64, 'base64'));
    } catch (e) {
      logger.warn(`decrypt failed for "${key}" (keychain changed?) — treating as signed out:`, e.message);
      return null;
    }
  },

  async removeItem(key) {
    const map = await safeStorageStrategy._readMap();
    if (!(key in map)) return;
    delete map[key];
    await safeStorageStrategy._writeMap(map);
  },
};

// ── 'none' strategy — explicit in-memory opt-out ─────────────────────────────
const noneStrategy = {
  name: 'none',
  async available() { return false; },
  async setItem() {},
  async getItem() { return null; },
  async removeItem() {},
};

const authPersistence = {
  _initialized: false,
  _manager:     null,
  _strategies: {
    safeStorage: safeStorageStrategy,
    none:        noneStrategy,
  },
  _active: null,   // the strategy resolve() settled on (null until resolved)

  // Lib-shape conformance — the real work happens in resolve(), called by the
  // web-manager bridge at auth boot (it needs the async availability check).
  initialize(manager) {
    if (authPersistence._initialized) {
      return;
    }
    authPersistence._manager = manager;
    authPersistence._initialized = true;
  },

  // Consumers add custom strategies before manager.initialize().
  register(name, strategy) {
    if (!name || typeof strategy?.getItem !== 'function') {
      throw new Error('auth-persistence.register: strategy must implement getItem/setItem/removeItem/available');
    }
    authPersistence._strategies[name] = { ...strategy, name };
  },

  // Pick + availability-check the configured strategy. Returns the active strategy
  // or null (→ caller falls back to firebase's in-memory default).
  async resolve(manager) {
    const wanted = manager.config?.webManager?.authPersistence || 'safeStorage';
    const strategy = authPersistence._strategies[wanted];

    if (!strategy) {
      logger.warn(`unknown authPersistence strategy "${wanted}" — session will not persist.`);
      authPersistence._active = null;
      return null;
    }

    try {
      if (await strategy.available()) {
        authPersistence._active = strategy;
        logger.log(`strategy "${strategy.name}" active.`);
        return strategy;
      }
      if (strategy.name !== 'none') {
        logger.warn(`strategy "${strategy.name}" unavailable on this system — session will not persist.`);
      }
    } catch (e) {
      logger.warn(`strategy "${strategy.name}" availability check threw — session will not persist:`, e.message);
    }

    authPersistence._active = null;
    return null;
  },

  getActive() {
    return authPersistence._active;
  },

  // Build the firebase-auth Persistence class over a strategy — the exact shape
  // firebase's getReactNativePersistence() returns for AsyncStorage backends.
  buildFirebasePersistence(strategy) {
    return class EmMainPersistence {
      static get type() { return 'LOCAL'; }

      constructor() {
        this.type = 'LOCAL';
      }

      async _isAvailable() {
        try { return await strategy.available(); }
        catch (e) { return false; }
      }

      async _set(key, value) {
        await strategy.setItem(key, JSON.stringify(value));
      }

      async _get(key) {
        const json = await strategy.getItem(key);
        return json ? JSON.parse(json) : null;
      }

      async _remove(key) {
        await strategy.removeItem(key);
      }

      _addListener() { /* external change notifications unsupported — single writer */ }
      _removeListener() { /* ditto */ }
    };
  },
};

module.exports = authPersistence;
