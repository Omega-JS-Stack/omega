const defineCases = require('@omega.js/devkit/test/define-cases');
const { getOmega, TEST_CONFIG, createOmega, clearStorage, disposeOmega } = require('./helpers.js');

const beforeEachHook = clearStorage;

module.exports = defineCases({
  type: 'group',
  description: 'storage',
  setup: createOmega,
  cleanup: disposeOmega,
  tests: [
    ...(() => {
      const cases = [];
      let beforeHookRun;
      const beforeHook = (ctx) => (beforeHookRun ||= Promise.resolve().then(() => (async () => {
        await getOmega().initialize(TEST_CONFIG);
      })()));

      cases.push({
        name: 'Storage Module > should set and get values',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          const storage = getOmega().storage;
          storage.set('testKey', 'testValue');
          ctx.expect(storage.get('testKey')).toBe('testValue');
        },
      });

      cases.push({
        name: 'Storage Module > should handle nested dot-notation paths',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          const storage = getOmega().storage;
          storage.set('user.profile.name', 'John Doe');
          ctx.expect(storage.get('user.profile.name')).toBe('John Doe');
        },
      });

      cases.push({
        name: 'Storage Module > should return default when key missing',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          const storage = getOmega().storage;
          ctx.expect(storage.get('nonexistent', 'fallback')).toBe('fallback');
        },
      });

      cases.push({
        name: 'Storage Module > should return entire storage when no path given',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          const storage = getOmega().storage;
          storage.set('a', 1);
          const all = storage.get();
          ctx.expect(typeof all).toBe('object');
          ctx.expect(all.a).toBe(1);
        },
      });

      cases.push({
        name: 'Storage Module > should remove a key',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          const storage = getOmega().storage;
          storage.set('removeMe', 'value');
          ctx.expect(storage.get('removeMe')).toBe('value');
          storage.remove('removeMe');
          ctx.expect(storage.get('removeMe')).toBe(undefined);
        },
      });

      cases.push({
        name: 'Storage Module > should clear all storage',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          const storage = getOmega().storage;
          storage.set('key1', 'a');
          storage.set('key2', 'b');
          storage.clear();
          const all = storage.get();
          ctx.expect(all).toEqual({});
        },
      });

      cases.push({
        name: 'Storage Module > should work with session storage',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          const session = getOmega().storage.session;
          session.set('sessionKey', 'sessionValue');
          ctx.expect(session.get('sessionKey')).toBe('sessionValue');
        },
      });

      cases.push({
        name: 'Storage Module > should remove session storage key',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          const session = getOmega().storage.session;
          session.set('temp', 'data');
          session.remove('temp');
          ctx.expect(session.get('temp')).toBe(undefined);
        },
      });

      cases.push({
        name: 'Storage Module > should clear session storage',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          const session = getOmega().storage.session;
          session.set('a', 1);
          session.set('b', 2);
          session.clear();
          ctx.expect(session.get()).toEqual({});
        },
      });
      return cases;
    })(),
  ],
});
