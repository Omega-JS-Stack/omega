/**
 * Test: omega.storage()
 * Unit tests for the lowdb-backed local JSON storage wrapper
 *
 * Run: npx omega test helpers/storage
 *
 * Covers:
 * - get/set/write operations
 * - Nested path access
 * - Default values
 * - setState/getState
 * - Persistence across reads
 * - Chaining API (.set().write(), .get().value())
 */
const path = require('path');
const jetpack = require('fs-jetpack');
const os = require('os');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

// Create a minimal omega mock with storage()
const STORAGE_DIR = path.join(os.tmpdir(), `backend-storage-test-${Date.now()}`);

function createStorage(name) {
  const _ = require('lodash');
  const { LowSync } = require('lowdb');
  const { JSONFileSync } = require('lowdb/node');
  const location = path.join(STORAGE_DIR, `${name}.json`);

  jetpack.write(location, {});

  const db = new LowSync(new JSONFileSync(location), {});
  db.read();

  return {
    _db: db,
    _location: location,
    get(p, defaultValue) {
      const result = _.get(db.data, p, defaultValue);
      return { value() { return result; } };
    },
    set(p, value) { _.set(db.data, p, value); return this; },
    write() { db.write(); return this; },
    getState() { return db.data; },
    setState(data) { db.data = data; return this; },
  };
}

module.exports = defineCases({
  description: 'omega.storage()',
  type: 'group',

  tests: [
    {
      name: 'set-and-get-simple',
      async run({ expect }) {
        const storage = createStorage('simple');
        storage.set('key', 'value').write();
        const result = storage.get('key').value();
        expect(result, 'Should get what was set').toBe('value');
      },
    },

    {
      name: 'get-returns-default-for-missing',
      async run({ expect }) {
        const storage = createStorage('defaults');
        const result = storage.get('nonexistent', 'fallback').value();
        expect(result, 'Should return default for missing key').toBe('fallback');
      },
    },

    {
      name: 'get-returns-undefined-without-default',
      async run({ expect }) {
        const storage = createStorage('nodefault');
        const result = storage.get('nonexistent').value();
        expect(result, 'Should return undefined without default').toBe(undefined);
      },
    },

    {
      name: 'set-nested-path',
      async run({ expect }) {
        const storage = createStorage('nested');
        storage.set('a.b.c', 42).write();
        const result = storage.get('a.b.c').value();
        expect(result, 'Should handle nested paths').toBe(42);
      },
    },

    {
      name: 'set-preserves-existing-data',
      async run({ expect }) {
        const storage = createStorage('preserve');
        storage.set('first', 1).write();
        storage.set('second', 2).write();
        expect(storage.get('first').value(), 'First key should still exist').toBe(1);
        expect(storage.get('second').value(), 'Second key should exist').toBe(2);
      },
    },

    {
      name: 'set-chaining',
      async run({ expect }) {
        const storage = createStorage('chain');
        storage.set('a', 1).set('b', 2).write();
        expect(storage.get('a').value(), 'First chained set').toBe(1);
        expect(storage.get('b').value(), 'Second chained set').toBe(2);
      },
    },

    {
      name: 'set-object-value',
      async run({ expect }) {
        const storage = createStorage('object');
        storage.set('user.usage', { daily: 5, monthly: 10 }).write();
        const usage = storage.get('user.usage', {}).value();
        expect(usage.daily, 'Should store object values').toBe(5);
        expect(usage.monthly, 'Should store nested object values').toBe(10);
      },
    },

    {
      name: 'getState-returns-all-data',
      async run({ expect }) {
        const storage = createStorage('getstate');
        storage.set('x', 1).set('y', 2).write();
        const state = storage.getState();
        expect(state.x, 'getState should include x').toBe(1);
        expect(state.y, 'getState should include y').toBe(2);
      },
    },

    {
      name: 'setState-replaces-all-data',
      async run({ expect }) {
        const storage = createStorage('setstate');
        storage.set('old', 'data').write();
        storage.setState({}).write();
        const result = storage.get('old').value();
        expect(result, 'setState({}) should clear all data').toBe(undefined);
      },
    },

    {
      name: 'write-persists-to-disk',
      async run({ expect }) {
        const storage = createStorage('persist');
        storage.set('persisted', true).write();

        // Read the file directly to verify
        const raw = JSON.parse(jetpack.read(storage._location));
        expect(raw.persisted, 'Data should be written to disk').toBe(true);
      },
    },

    {
      name: 'data-survives-re-read',
      async run({ expect }) {
        const _ = require('lodash');
        const { LowSync } = require('lowdb');
        const { JSONFileSync } = require('lowdb/node');

        // Write with one instance
        const storage1 = createStorage('reread');
        storage1.set('survivor', 'yes').write();

        // Read with a fresh instance from the same file
        const db2 = new LowSync(new JSONFileSync(storage1._location), {});
        db2.read();
        const result = _.get(db2.data, 'survivor');
        expect(result, 'Data should survive a fresh read').toBe('yes');
      },
    },

    {
      name: 'get-default-object-for-usage-pattern',
      async run({ expect }) {
        const storage = createStorage('usage-pattern');
        // Mimics usage.js: storage.get(`${path}.usage`, {}).value()
        const usage = storage.get('nonexistent-user.usage', {}).value();
        expect(typeof usage === 'object', 'Should return empty object default').toBeTruthy();
        expect(Object.keys(usage).length, 'Default object should be empty').toBe(0);
      },
    },

    {
      name: 'cleanup',
      async run() {
        // Clean up test files
        jetpack.remove(STORAGE_DIR);
      },
    },
  ],
});
