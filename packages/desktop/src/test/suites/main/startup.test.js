// Main-process tests for lib/startup.js — launch mode + open-at-login.
//
// Note: in tests the harness passes skipWindowCreation:true, so the main.js
// `applyEarly` and `windows.createNamed` calls aren't exercised — those paths
// are smoke-tested separately via boot-sequence.test.js. Here we test the
// startup module's own surface.

const defineCases = require('@omega.js/devkit/test/define-cases');

module.exports = defineCases({
  type: 'suite',
  layer: 'main',
  description: 'startup (main)',
  cleanup: (ctx) => {
    // Restore default mode so no later suite is affected.
    if (ctx.omega.config?.startup) {
      ctx.omega.config.startup.mode = 'normal';
    }
  },
  tests: [
    {
      name: 'initialize ran during boot',
      run: (ctx) => {
        ctx.expect(ctx.omega.startup._initialized).toBe(true);
      },
    },
    {
      name: 'getMode returns "normal" by default',
      run: (ctx) => {
        ctx.omega.config.startup.mode = 'normal';
        ctx.expect(ctx.omega.startup.getMode()).toBe('normal');
      },
    },
    {
      name: 'getMode honors valid values',
      run: (ctx) => {
        for (const mode of ['normal', 'hidden']) {
          ctx.omega.config.startup.mode = mode;
          ctx.expect(ctx.omega.startup.getMode()).toBe(mode);
        }
      },
    },
    {
      name: 'getMode falls back to "normal" for unknown values',
      run: (ctx) => {
        ctx.omega.config.startup.mode = 'banana';
        ctx.expect(ctx.omega.startup.getMode()).toBe('normal');
      },
    },
    {
      name: 'getMode rejects deprecated tray-only as unknown (falls back to normal)',
      run: (ctx) => {
        // tray-only was folded into hidden; it's no longer a valid mode.
        ctx.omega.config.startup.mode = 'tray-only';
        ctx.expect(ctx.omega.startup.getMode()).toBe('normal');
      },
    },
    {
      name: 'isLaunchHidden true for hidden, false for normal',
      run: (ctx) => {
        ctx.omega.config.startup.mode = 'normal';
        ctx.expect(ctx.omega.startup.isLaunchHidden()).toBe(false);
        ctx.omega.config.startup.mode = 'hidden';
        ctx.expect(ctx.omega.startup.isLaunchHidden()).toBe(true);
      },
    },
    {
      name: 'applyEarly is a no-op outside hidden mode',
      run: (ctx) => {
        ctx.omega.config.startup.mode = 'normal';
        // Just confirm it doesn't throw.
        ctx.omega.startup.applyEarly();
        ctx.expect(true).toBe(true);
      },
    },
    {
      name: 'applyEarly does not throw for hidden mode',
      run: (ctx) => {
        ctx.omega.config.startup.mode = 'hidden';
        ctx.omega.startup.applyEarly();
        ctx.expect(true).toBe(true);
      },
    },
    {
      name: 'isOpenAtLogin returns a boolean (or null on platforms without support)',
      run: (ctx) => {
        const v = ctx.omega.startup.isOpenAtLogin();
        ctx.expect(v === null || typeof v === 'boolean').toBe(true);
      },
    },
    {
      name: 'setOpenAtLogin runs without throwing',
      run: (ctx) => {
        // Set to false to avoid actually registering the test harness for login on the dev box.
        ctx.omega.startup.setOpenAtLogin(false);
        ctx.expect(true).toBe(true);
      },
    },
    {
      name: 'setOpenAtLogin accepts the object form { enabled, mode }',
      run: (ctx) => {
        // Object form should not throw and should round-trip the args/openAsHidden flags.
        ctx.omega.startup.setOpenAtLogin({ enabled: false, mode: 'normal' });
        ctx.omega.startup.setOpenAtLogin({ enabled: true,  mode: 'hidden' });
        // Restore to disabled at end so we don't leave the test harness as a login item.
        ctx.omega.startup.setOpenAtLogin(false);
        ctx.expect(true).toBe(true);
      },
    },
    {
      name: 'wasLaunchedAtLogin returns a boolean',
      run: (ctx) => {
        ctx.expect(typeof ctx.omega.startup.wasLaunchedAtLogin()).toBe('boolean');
      },
    },
    {
      name: 'dev mode never registers open-at-login (and clears prior registration)',
      run: (ctx) => {
        // The harness runs unpackaged, so initialize() must have force-OFF'd the login item.
        // Confirm the current OS state reflects that — getLoginItemSettings should report
        // openAtLogin: false. (Note: returns null on platforms without LoginItemSettings.)
        const live = ctx.omega.startup.isOpenAtLogin();
        if (live !== null) {
          ctx.expect(live).toBe(false);
        }
      },
    },
  ],
});
