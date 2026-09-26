/**
 * Storage: the process service behind `omega.storage(options)`, a small local
 * JSON store per name (lowdb), built on first use and memoized per name.
 *
 * The store answers a lowdb v1-compatible surface (`get(path, default).value()`,
 * `set(path, value).write()`, `getState()`, `setState()`), so a caller needs no
 * lodash of its own. `temporary` stores live under the OS tmpdir, the rest under
 * `./.data/`; both are namespaced by `uniqueAppName`.
 */
const jetpack = require('fs-jetpack');
const { get: _get, set: _set } = require('lodash');

/**
 * The named local stores of one process.
 */
class Storage {
  /**
   * @param {object} omega - the Omega instance (its logger, environment and uniqueAppName).
   */
  constructor(omega) {
    this.omega = omega;
    this.stores = {};
  }

  /**
   * The store for a name, built on first use.
   * @param {object} [options] - { name: 'main', temporary: false, clear: true, log: false, clearInvalid: true }
   * @returns {object} the store.
   */
  get(options) {
    const self = this;
    const omega = self.omega;

    options = options || {};
    options.name = options.name || 'main';

    if (self.stores[options.name]) {
      return self.stores[options.name];
    }

    options.temporary = typeof options.temporary === 'undefined' ? false : options.temporary;
    options.clear = typeof options.clear === 'undefined' ? true : options.clear;
    options.log = typeof options.log === 'undefined' ? false : options.log;

    // Set path
    const subfolder = `storage/${omega.options.uniqueAppName || 'primary'}/${options.name}`;

    // Setup lowdb
    const { LowSync } = require('lowdb');
    const { JSONFileSync } = require('lowdb/node');
    const location = options.temporary
      ? `${require('os').tmpdir()}/${subfolder}.json`
      : `./.data/${subfolder}.json`;

    // Log
    if (options.log) {
      omega.logger.log('storage(): Location', location);
    }

    // Clear temporary storage
    if (
      options.temporary
      && omega.isDevelopment()
      && options.clear
    ) {
      omega.logger.log('Removed temporary file @', location);
      jetpack.remove(location);
    }

    // Setup options
    options.clearInvalid = typeof options.clearInvalid === 'undefined'
      ? true
      : options.clearInvalid;

    function _setup() {
      if (!jetpack.exists(location)) {
        jetpack.write(location, {});
      }
      const db = new LowSync(new JSONFileSync(location), {});
      db.read();

      // Wrap lowdb in a v1-compatible API so consumers don't need lodash
      self.stores[options.name] = {
        _db: db,
        _location: location,
        get(path, defaultValue) {
          const result = _get(db.data, path, defaultValue);
          return { value() { return result; } };
        },
        set(path, value) { _set(db.data, path, value); return this; },
        write() { db.write(); return this; },
        getState() { return db.data; },
        setState(data) { db.data = data; return this; },
      };
    }

    try {
      _setup();
    } catch (e) {
      omega.logger.error(`Could not setup storage: ${location}`, e);

      try {
        if (options.clearInvalid) {
          omega.logger.log(`Clearing invalid storage: ${location}`);
          jetpack.write(location, {});
        }
        _setup();
      } catch (e) {
        omega.logger.error(`Failed to clear invalid storage: ${location}`, e);
      }
    }

    return self.stores[options.name];
  }
}

module.exports = Storage;
