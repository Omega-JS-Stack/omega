// Verifies every lib was initialized during the main-process boot sequence.

const defineCases = require('@omega.js/devkit/test/define-cases');

// Every library src/main.js assigns, by its property name
const LIBS = [
  'storage', 'theme', 'fontawesome', 'sentry', 'protocol', 'deepLink', 'authFlow', 'appState',
  'ipc', 'autoUpdater', 'tray', 'menu', 'contextMenu', 'startup', 'auth', 'windows', 'context',
  'usage', 'remoteConfig', 'remoteScripts', 'analytics', 'restartManager',
];

module.exports = defineCases({
  type: 'group',
  layer: 'main',
  description: 'boot sequence (main)',
  tests: [
    {
      name: 'config was loaded',
      run: (ctx) => {
        ctx.expect(ctx.omega.config).toBeTruthy();
        ctx.expect(ctx.omega.config.brand.id).toBeTruthy();
      },
    },
    {
      // The 22 libraries, each a plain property of the one instance and each
      // brought up by initialize(). `auth` is the main-side auth (lib/auth.js);
      // the old `omega` property that held it is gone.
      name: 'every library is on the instance and initialized',
      run: (ctx) => {
        for (const name of LIBS) {
          ctx.expect(Boolean(ctx.omega[name])).toBe(true);
          if (ctx.omega[name]._initialized !== true) {
            throw new Error(`omega.${name} was not initialized by the boot`);
          }
        }
        ctx.expect(LIBS.length).toBe(22);
        ctx.expect(ctx.omega.omega).toBeUndefined();
      },
    },
    {
      // The one instance a consumer's main.js requires IS the one the harness booted
      name: 'the module exports ONE instance, and .Omega is its constructor',
      run: (ctx) => {
        const main = require('../../../main.js');
        ctx.expect(main).toBe(ctx.omega);
        ctx.expect(typeof main.Omega).toBe('function');
        ctx.expect(main).toBeInstanceOf(main.Omega);
        ctx.expect(main.constructor).toBe(main.Omega);
      },
    },
    {
      name: 'ready settled with the instance',
      run: async (ctx) => {
        ctx.expect(await ctx.omega.ready).toBe(ctx.omega);
      },
    },
    {
      name: 'getEnvironment returns testing under the test harness',
      run: (ctx) => {
        // The harness spawn names OMEGA_ENVIRONMENT=testing, the one input.
        ctx.expect(ctx.omega.getEnvironment()).toBe('testing');
      },
    },
  ],
});
