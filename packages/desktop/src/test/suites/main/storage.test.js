// Main-process tests for lib/storage.js — round-trip, dot-notation, persistence, broadcast.
//
// ctx.omega is a fully-initialized @omega.js/desktop main instance (skipWindowCreation: true).

const defineCases = require('@omega.js/devkit/test/define-cases');

module.exports = defineCases({
  type: 'suite',
  layer: 'main',
  description: 'storage (main)',
  cleanup: async (ctx) => {
    ctx.omega.storage.clear();
  },
  tests: [
    {
      name: 'set + get round-trip',
      run: (ctx) => {
        ctx.omega.storage.set('hello', 'world');
        ctx.expect(ctx.omega.storage.get('hello')).toBe('world');
      },
    },
    {
      name: 'get returns default when missing',
      run: (ctx) => {
        ctx.expect(ctx.omega.storage.get('nope', 'fallback')).toBe('fallback');
        ctx.expect(ctx.omega.storage.get('nope')).toBeUndefined();
      },
    },
    {
      name: 'has reflects presence',
      run: (ctx) => {
        ctx.omega.storage.set('present', 1);
        ctx.expect(ctx.omega.storage.has('present')).toBe(true);
        ctx.expect(ctx.omega.storage.has('absent')).toBe(false);
      },
    },
    {
      name: 'delete removes the key',
      run: (ctx) => {
        ctx.omega.storage.set('temp', 'x');
        ctx.omega.storage.delete('temp');
        ctx.expect(ctx.omega.storage.has('temp')).toBe(false);
      },
    },
    {
      name: 'dot-notation nested paths',
      run: (ctx) => {
        ctx.omega.storage.set('window.main.bounds', { x: 10, y: 20, w: 800, h: 600 });
        ctx.expect(ctx.omega.storage.get('window.main.bounds')).toEqual({ x: 10, y: 20, w: 800, h: 600 });
        ctx.expect(ctx.omega.storage.get('window.main.bounds.w')).toBe(800);
      },
    },
    {
      name: 'onChange fires for the watched key',
      run: async (ctx) => {
        const calls = [];
        const unsub = ctx.omega.storage.onChange('watched', (value, previous) => {
          calls.push({ value, previous });
        });
        ctx.omega.storage.set('watched', 'first');
        ctx.omega.storage.set('watched', 'second');
        unsub();
        ctx.omega.storage.set('watched', 'third'); // should NOT fire after unsub
        ctx.expect(calls.length).toBe(2);
        ctx.expect(calls[0].value).toBe('first');
        ctx.expect(calls[1].value).toBe('second');
        ctx.expect(calls[1].previous).toBe('first');
      },
    },
    {
      name: 'clear empties the store',
      run: (ctx) => {
        ctx.omega.storage.set('a', 1);
        ctx.omega.storage.set('b', 2);
        ctx.omega.storage.clear();
        ctx.expect(ctx.omega.storage.has('a')).toBe(false);
        ctx.expect(ctx.omega.storage.has('b')).toBe(false);
      },
    },
    {
      name: 'getPath returns the on-disk file location',
      run: (ctx) => {
        const p = ctx.omega.storage.getPath();
        ctx.expect(typeof p).toBe('string');
        ctx.expect(p).toMatch(/omega-storage\.json$/);
      },
    },
  ],
});
