// Main-process tests for lib/app-state.js — storage-backed launch flags + crash sentinel.
//
// The harness already booted omega once, which incremented launchCount and seeded
// state. We test by calling appState.reset() then re-initializing with crafted
// storage state to simulate first-launch / repeat-launch / crash-recovery / upgrade.

const defineCases = require('@omega.js/devkit/test/define-cases');

const STORAGE_KEY = 'appState';

module.exports = defineCases({
  type: 'suite',
  layer: 'main',
  description: 'app-state (main)',
  cleanup: async (ctx) => {
    // Restore a sane state for any later suites that look at appState.
    ctx.omega.appState.reset();
    // Mark _initialized=false so we can re-init cleanly.
    ctx.omega.appState._initialized = false;
    await ctx.omega.appState.initialize(ctx.omega);
  },
  tests: [
    {
      name: 'initialize ran during boot',
      run: (ctx) => {
        ctx.expect(ctx.omega.appState._initialized).toBe(true);
      },
    },
    {
      name: 'first launch: flags + counters seeded correctly',
      run: async (ctx) => {
        ctx.omega.appState.reset();
        ctx.omega.appState._initialized = false;
        await ctx.omega.appState.initialize(ctx.omega);

        ctx.expect(ctx.omega.appState.isFirstLaunch()).toBe(true);
        ctx.expect(ctx.omega.appState.getLaunchCount()).toBe(1);
        ctx.expect(ctx.omega.appState.getInstalledAt()).toBeInstanceOf(Date);
        ctx.expect(ctx.omega.appState.getLastLaunchAt()).toBeNull();
        ctx.expect(ctx.omega.appState.recoveredFromCrash()).toBe(false);
      },
    },
    {
      name: 'second launch: not first, count incremented, lastLaunchAt populated',
      run: async (ctx) => {
        ctx.omega.appState.reset();
        ctx.omega.appState._initialized = false;
        await ctx.omega.appState.initialize(ctx.omega);

        // Simulate a graceful quit from the first launch.
        const after1 = ctx.omega.storage.get(STORAGE_KEY);
        after1.sentinel  = false;
        after1.lastQuitAt = Date.now();
        ctx.omega.storage.set(STORAGE_KEY, after1);

        // Boot again.
        ctx.omega.appState._initialized = false;
        await ctx.omega.appState.initialize(ctx.omega);

        ctx.expect(ctx.omega.appState.isFirstLaunch()).toBe(false);
        ctx.expect(ctx.omega.appState.getLaunchCount()).toBe(2);
        ctx.expect(ctx.omega.appState.getLastLaunchAt()).toBeInstanceOf(Date);
        ctx.expect(ctx.omega.appState.recoveredFromCrash()).toBe(false);
      },
    },
    {
      name: 'crash detection: previous launch left sentinel and no quit timestamp',
      run: async (ctx) => {
        // Seed storage with a "we were running and never gracefully quit" state.
        ctx.omega.storage.set(STORAGE_KEY, {
          installedAt:  Date.now() - 10000,
          launchCount:  3,
          lastLaunchAt: Date.now() - 1000,
          lastQuitAt:   null,                 // never quit gracefully
          sentinel:     true,                 // was running
          version:      '1.0.0',
        });

        ctx.omega.appState._initialized = false;
        await ctx.omega.appState.initialize(ctx.omega);

        ctx.expect(ctx.omega.appState.recoveredFromCrash()).toBe(true);
        ctx.expect(ctx.omega.appState.getLaunchCount()).toBe(4);
      },
    },
    {
      name: 'graceful quit: sentinel cleared on next boot, no crash flag',
      run: async (ctx) => {
        ctx.omega.storage.set(STORAGE_KEY, {
          installedAt:  Date.now() - 10000,
          launchCount:  5,
          lastLaunchAt: Date.now() - 1000,
          lastQuitAt:   Date.now() - 500,    // graceful quit happened
          sentinel:     false,
          version:      '1.0.0',
        });

        ctx.omega.appState._initialized = false;
        await ctx.omega.appState.initialize(ctx.omega);

        ctx.expect(ctx.omega.appState.recoveredFromCrash()).toBe(false);
        ctx.expect(ctx.omega.appState.getLaunchCount()).toBe(6);
      },
    },
    {
      name: 'version upgrade: previousVersion populated when version changes',
      run: async (ctx) => {
        ctx.omega.storage.set(STORAGE_KEY, {
          installedAt:  Date.now() - 10000,
          launchCount:  10,
          lastLaunchAt: Date.now() - 1000,
          lastQuitAt:   Date.now() - 500,
          sentinel:     false,
          version:      '0.9.0',     // previous version
        });

        // Force the omega instance's reported version to differ.
        const origConfig = ctx.omega.config.app;
        ctx.omega.config.app = { ...origConfig, version: '1.0.0' };

        try {
          ctx.omega.appState._initialized = false;
          await ctx.omega.appState.initialize(ctx.omega);

          ctx.expect(ctx.omega.appState.getVersion()).toBe('1.0.0');
          ctx.expect(ctx.omega.appState.getPreviousVersion()).toBe('0.9.0');
          ctx.expect(ctx.omega.appState.wasUpgraded()).toBe(true);
        } finally {
          ctx.omega.config.app = origConfig;
        }
      },
    },
    {
      name: 'no version change: wasUpgraded false, previousVersion preserved',
      run: async (ctx) => {
        // Seed with a previousVersion that should NOT be overwritten when version doesn't change.
        ctx.omega.storage.set(STORAGE_KEY, {
          installedAt:     Date.now() - 10000,
          launchCount:     20,
          lastLaunchAt:    Date.now() - 1000,
          lastQuitAt:      Date.now() - 500,
          sentinel:        false,
          version:         '1.0.0',
          previousVersion: '0.9.0',
        });

        const origConfig = ctx.omega.config.app;
        ctx.omega.config.app = { ...origConfig, version: '1.0.0' };

        try {
          ctx.omega.appState._initialized = false;
          await ctx.omega.appState.initialize(ctx.omega);

          ctx.expect(ctx.omega.appState.wasUpgraded()).toBe(false);
          // Should preserve the historical previousVersion rather than nuking it.
          ctx.expect(ctx.omega.appState.getPreviousVersion()).toBe('0.9.0');
        } finally {
          ctx.omega.config.app = origConfig;
        }
      },
    },
    {
      name: 'launchedFromDeepLink: defaults false, set/cleared via setter',
      run: (ctx) => {
        ctx.expect(ctx.omega.appState.launchedFromDeepLink()).toBe(false);
        ctx.omega.appState.setLaunchedFromDeepLink(true);
        ctx.expect(ctx.omega.appState.launchedFromDeepLink()).toBe(true);
        ctx.omega.appState.setLaunchedFromDeepLink(false);
        ctx.expect(ctx.omega.appState.launchedFromDeepLink()).toBe(false);
      },
    },
    {
      name: 'launchedAtLogin returns a boolean',
      run: (ctx) => {
        ctx.expect(typeof ctx.omega.appState.launchedAtLogin()).toBe('boolean');
      },
    },
    {
      name: 'getLastQuitAt reads live storage (returns null when sentinel is active)',
      run: async (ctx) => {
        ctx.omega.appState.reset();
        ctx.omega.appState._initialized = false;
        await ctx.omega.appState.initialize(ctx.omega);
        // After init, sentinel=true and lastQuitAt=null.
        ctx.expect(ctx.omega.appState.getLastQuitAt()).toBeNull();
      },
    },
    {
      name: 'reset() wipes persisted state',
      run: (ctx) => {
        ctx.expect(ctx.omega.storage.has(STORAGE_KEY)).toBe(true);
        ctx.omega.appState.reset();
        ctx.expect(ctx.omega.storage.has(STORAGE_KEY)).toBe(false);
      },
    },
  ],
});
