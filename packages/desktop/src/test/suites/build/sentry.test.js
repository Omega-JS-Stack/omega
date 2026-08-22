// Build-layer tests for the desktop's error-reporting WIRING (#380).
//
// The policy itself — config gating, the dev/kill switches, user normalization,
// release tagging — is @omega.js/monitoring's, proven by its own suite
// (packages/monitoring/test/). What belongs here is the desktop half: the
// package entry resolves in a main-process context, the manager's `sentry`
// surface is the one every lib calls, and a brand with no DSN gets a silent
// no-op instead of a crash.

const path = require('path');

const FRAMEWORK_ROOT = path.join(__dirname, '..', '..', '..', '..');

module.exports = {
  type: 'suite',
  layer: 'build',
  description: 'sentry — the @omega.js/monitoring wiring',
  tests: [
    {
      name: 'the package entry resolves to the main-process module outside a renderer',
      run: (ctx) => {
        const sentry = require('@omega.js/monitoring');
        ctx.expect(sentry).toBe(require('@omega.js/monitoring/main'));
        ctx.expect(typeof sentry.initialize).toBe('function');
        ctx.expect(typeof sentry.captureException).toBe('function');
        ctx.expect(typeof sentry.captureMessage).toBe('function');
        ctx.expect(typeof sentry.setUser).toBe('function');
      },
    },
    {
      name: 'a desktop config with no DSN initializes to disabled',
      run: (ctx) => {
        const main = require('@omega.js/monitoring/main');
        main.shutdown();
        main.initialize({ config: { monitoring: { providers: { sentry: { dsn: '' } } } }, getVersion: () => '1.0.0' });
        ctx.expect(main._initialized).toBe(true);
        ctx.expect(main._enabled).toBe(false);
      },
    },
    {
      name: 'every call on a disabled sentry is a no-op, never a throw',
      run: (ctx) => {
        const main = require('@omega.js/monitoring/main');
        main.shutdown();
        let threw;
        try {
          main.captureException(new Error('test'));
          main.captureMessage('test');
          // client-bridge calls this on every auth change — a documented no-op when off.
          main.setUser({ uid: 'abc', email: 'user@example.com' });
        } catch (e) {
          threw = e;
        }
        ctx.expect(threw).toBeUndefined();
      },
    },
    {
      // The renderer's @omega.js/client tags every report `<brand.id>@<version>`
      // and falls back to the build stamp with no version. The bake is the
      // renderer's ONLY channel and it hands the client `buildJson.config`
      // alone — so the app's version has to ride INSIDE that object, not only
      // in the sibling `package` key.
      name: 'the webpack bake folds the app version into the config the renderer hands the client',
      run: (ctx) => {
        const { composeBuildConfig } = require(path.join(FRAMEWORK_ROOT, 'src', 'gulp', 'tasks', 'webpack.js'));

        const packaged = composeBuildConfig({ brand: { id: 'paperloom' } }, null, { version: '3.1.4' });
        ctx.expect(packaged.version).toBe('3.1.4');
        ctx.expect(packaged.brand.id).toBe('paperloom');
        ctx.expect(packaged.dev).toBeUndefined();

        // A dev build carries the resolved local-stack map beside it (#300).
        const local = composeBuildConfig({ brand: { id: 'paperloom' } }, { ports: { auth: 9099 } }, { version: '3.1.4' });
        ctx.expect(local.version).toBe('3.1.4');
        ctx.expect(local.dev.ports.auth).toBe(9099);
      },
    },
    {
      name: 'the preload surface is reachable and silent when disabled',
      run: (ctx) => {
        const preload = require('@omega.js/monitoring/preload');
        preload.initialize({ config: { monitoring: { providers: { sentry: { dsn: '' } } } } });
        ctx.expect(preload._enabled).toBe(false);
        preload.captureException(new Error('test'));
      },
    },
  ],
};
