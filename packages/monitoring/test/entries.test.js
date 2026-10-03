/**
 * Entry tests — the platform wrappers (#380).
 *
 * The load-bearing one: when the config says off, the SDK is never require()d
 * at all. That is the standard @omega.js/desktop set (a brand with no DSN must
 * not pay for a dependency it never uses), and it is checked against the real
 * require cache, not a stub.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');

const node = require('../src/node.js');
const main = require('../src/main.js');
const renderer = require('../src/renderer.js');
const preload = require('../src/preload.js');

// Silence the disabled-reason log lines these entries print.
function quiet(fn) {
  const saved = { log: console.log, warn: console.warn };
  console.log = () => {};
  console.warn = () => {};
  try {
    return fn();
  } finally {
    Object.assign(console, saved);
  }
}

function sentryModulesLoaded() {
  return Object.keys(require.cache).filter((file) => file.includes(`${require('node:path').sep}@sentry${require('node:path').sep}`));
}

// The electron SDK is the ONE thing stubbed here: booting @sentry/electron in a
// bare Node process (no app, no ipc) would take the run down. Everything the
// test asserts — the gates, the identity read, the tag — is the real code path.
function withStubbedElectronSDK(entry, run) {
  const saved = { ...process.env };
  const stubbed = [];

  for (const request of ['@sentry/electron/main', '@sentry/electron/renderer']) {
    const file = require.resolve(request);
    require.cache[file] = { id: file, filename: file, loaded: true, exports: { init: (options) => { stubbed.init = options; } } };
    stubbed.push(file);
  }

  // A packaged production artifact: nothing kills reporting, and the process
  // names no environment, so the gates read the environment the BUILD baked
  // into the host's config (#817) the way a renderer bundle does.
  delete process.env.OMEGA_SENTRY_ENABLED;
  delete process.env.OMEGA_ENVIRONMENT;

  try {
    quiet(run);
    return stubbed.init;
  } finally {
    entry.shutdown();
    for (const file of stubbed) delete require.cache[file];
    for (const key of ['OMEGA_SENTRY_ENABLED', 'OMEGA_ENVIRONMENT']) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

module.exports = defineCases({
  type: 'group',
  description: 'entries',
  tests: [
    {
      name: 'an off config never loads an SDK — not @sentry/node, not @sentry/electron',
      run: (ctx) => {
        ctx.expect(sentryModulesLoaded(), 'nothing is loaded before the first initialize').toEqual([]);

        // A production process: only the off config keeps the SDK out.
        const saved = process.env.OMEGA_ENVIRONMENT;
        process.env.OMEGA_ENVIRONMENT = 'production';
        try {
          quiet(() => {
            ctx.expect(node.initialize({ config: { providers: { sentry: { dsn: '' } } }, isProduction: false }), 'the node entry hands back no SDK').toBe(null);
            main.initialize({ config: { environment: 'testing', monitoring: { providers: { sentry: { dsn: '' } } } }, getVersion: () => '1.0.0' });
            preload.initialize({ config: { environment: 'testing', monitoring: { providers: { sentry: { dsn: '' } } } } });
          });
        } finally {
          if (saved === undefined) delete process.env.OMEGA_ENVIRONMENT;
          else process.env.OMEGA_ENVIRONMENT = saved;
        }

        ctx.expect(main._enabled).toBe(false);
        ctx.expect(preload._enabled).toBe(false);
        ctx.expect(sentryModulesLoaded(), 'and still nothing is loaded after').toEqual([]);
      },
    },

    {
      name: 'a disabled main captures nothing and throws nothing',
      run: (ctx) => {
        quiet(() => {
          main.shutdown();
          main.captureException(new Error('never reported'));
          main.captureMessage('never reported');
          main.setUser({ uid: 'abc' });
          preload.shutdown();
          preload.captureException(new Error('never reported'));
        });
      },
    },

    {
      name: 'the node entry runs its host gates: a test run reports nothing',
      run: (ctx) => {
        const saved = process.env.OMEGA_ENVIRONMENT;
        process.env.OMEGA_ENVIRONMENT = 'testing';
        try {
          const Sentry = quiet(() => node.initialize({
            config: { providers: { sentry: { dsn: 'https://key@o1.ingest.sentry.io/1' } } },
            isProduction: true,
          }));
          ctx.expect(Sentry).toBe(null);
          ctx.expect(sentryModulesLoaded(), 'a killed run never loads the SDK either').toEqual([]);
        } finally {
          if (saved === undefined) delete process.env.OMEGA_ENVIRONMENT;
          else process.env.OMEGA_ENVIRONMENT = saved;
        }
      },
    },

    {
      name: 'the package entry resolves to the main-process module outside a renderer',
      run: (ctx) => {
        ctx.expect(require('../src/index.js')).toBe(main);
      },
    },

    {
      name: 'the electron entries tag the release brand.id@version, the one format every target uses',
      run: (ctx) => {
        const host = {
          // The environment is the artifact's own baked fact (#817): it is what the
          // gates read on a surface that passes no runtime production signal, and
          // reporting is live here because that fact says production.
          config:     { environment: 'production', brand: { id: 'paperloom' }, monitoring: { providers: { sentry: { dsn: 'https://key@o1.ingest.sentry.io/1' } } } },
          getVersion: () => '1.4.2',
        };

        const mainInit = withStubbedElectronSDK(main, () => main.initialize(host));
        ctx.expect(mainInit.release, 'main tags the app version under the brand id').toBe('paperloom@1.4.2');

        const rendererInit = withStubbedElectronSDK(renderer, () => renderer.initialize(host));
        ctx.expect(rendererInit.release, 'the renderer reports the same release as its main process').toBe('paperloom@1.4.2');
      },
    },
  ],
});
