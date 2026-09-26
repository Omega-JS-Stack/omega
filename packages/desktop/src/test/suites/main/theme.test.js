// Main-process tests for lib/theme.js — source/resolved round-trip, nativeTheme
// wiring, persistence, change events (with dedupe), IPC handlers, validation.
//
// ctx.omega is a fully-initialized @omega.js/desktop main instance. Every test that mutates the theme
// restores it; cleanup() resets to the pre-suite source and clears the persisted
// override so later suites (and re-runs) start clean.

const defineCases = require('@omega.js/devkit/test/define-cases');

let originalSource = null;

module.exports = defineCases({
  type: 'suite',
  layer: 'main',
  description: 'theme (main)',
  cleanup: async (ctx) => {
    if (originalSource) {
      ctx.omega.theme.set(originalSource);
    }
    ctx.omega.storage.delete('theme.appearance');
  },
  tests: [
    {
      name: 'omega.theme is initialized with the full API surface',
      run: (ctx) => {
        originalSource = ctx.omega.theme.get();
        ctx.expect(ctx.omega.theme._initialized).toBe(true);
        ctx.expect(typeof ctx.omega.theme.get).toBe('function');
        ctx.expect(typeof ctx.omega.theme.set).toBe('function');
        ctx.expect(typeof ctx.omega.theme.resolved).toBe('function');
        ctx.expect(typeof ctx.omega.theme.onChange).toBe('function');
      },
    },
    {
      name: 'get() returns a valid source and resolved() a concrete appearance',
      run: (ctx) => {
        ctx.expect(['system', 'light', 'dark'].includes(ctx.omega.theme.get())).toBe(true);
        ctx.expect(['light', 'dark'].includes(ctx.omega.theme.resolved())).toBe(true);
      },
    },
    {
      name: 'set("dark") drives nativeTheme.themeSource, resolution, and persistence',
      run: (ctx) => {
        const { nativeTheme } = require('electron');
        ctx.omega.theme.set('dark');
        ctx.expect(ctx.omega.theme.get()).toBe('dark');
        ctx.expect(ctx.omega.theme.resolved()).toBe('dark');
        ctx.expect(nativeTheme.themeSource).toBe('dark');
        ctx.expect(nativeTheme.shouldUseDarkColors).toBe(true);
        ctx.expect(ctx.omega.storage.get('theme.appearance')).toBe('dark');
      },
    },
    {
      name: 'set("light") flips the resolution',
      run: (ctx) => {
        ctx.omega.theme.set('light');
        ctx.expect(ctx.omega.theme.get()).toBe('light');
        ctx.expect(ctx.omega.theme.resolved()).toBe('light');
        ctx.expect(ctx.omega.storage.get('theme.appearance')).toBe('light');
      },
    },
    {
      name: 'set("system") returns to following the OS',
      run: (ctx) => {
        const { nativeTheme } = require('electron');
        ctx.omega.theme.set('system');
        ctx.expect(ctx.omega.theme.get()).toBe('system');
        ctx.expect(nativeTheme.themeSource).toBe('system');
        // In system mode the resolution is whatever the OS says — assert coherence,
        // not a specific value (the test machine's OS preference is not ours to pin).
        ctx.expect(ctx.omega.theme.resolved()).toBe(nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
      },
    },
    {
      name: 'set() throws on anything outside system|light|dark',
      run: (ctx) => {
        let threw = false;
        try {
          ctx.omega.theme.set('auto');
        } catch (e) {
          threw = true;
        }
        ctx.expect(threw).toBe(true);

        threw = false;
        try {
          ctx.omega.theme.set(undefined);
        } catch (e) {
          threw = true;
        }
        ctx.expect(threw).toBe(true);
      },
    },
    {
      name: 'onChange fires once per effective change (deduped) and unsubscribes',
      run: (ctx) => {
        ctx.omega.theme.set('light');

        const calls = [];
        const unsub = ctx.omega.theme.onChange((payload) => calls.push(payload));

        ctx.omega.theme.set('dark');   // change → fires
        ctx.omega.theme.set('dark');   // no-op → silent
        ctx.omega.theme.set('light');  // change → fires

        unsub();
        ctx.omega.theme.set('dark');   // unsubscribed → silent

        ctx.expect(calls.length).toBe(2);
        ctx.expect(calls[0]).toEqual({ source: 'dark', resolved: 'dark' });
        ctx.expect(calls[1]).toEqual({ source: 'light', resolved: 'light' });
      },
    },
    {
      name: 'desktop:theme:get / desktop:theme:set IPC handlers round-trip',
      run: async (ctx) => {
        const set = await ctx.omega.ipc.invoke('desktop:theme:set', { source: 'dark' });
        ctx.expect(set).toEqual({ source: 'dark', resolved: 'dark' });

        const got = await ctx.omega.ipc.invoke('desktop:theme:get');
        ctx.expect(got).toEqual({ source: 'dark', resolved: 'dark' });
      },
    },
    {
      name: 'desktop:theme:set rejects invalid sources',
      run: async (ctx) => {
        let threw = false;
        try {
          await ctx.omega.ipc.invoke('desktop:theme:set', { source: 'midnight' });
        } catch (e) {
          threw = true;
        }
        ctx.expect(threw).toBe(true);
      },
    },
  ],
});
