const defineCases = require('@omega.js/devkit/test/define-cases');
const { getOmega, TEST_CONFIG, createOmega, clearStorage, disposeOmega } = require('./helpers.js');

const beforeEachHook = clearStorage;

// The release tag every browser surface reports under. `init()` builds the
// @sentry/browser options for real and only THEN hands them to the SDK, whose
// boot needs a live browser (globalThis event targets, web-vitals listeners) —
// so the boot is allowed to fail here and the options it was handed are what
// gets asserted. The tag itself is @omega.js/monitoring's: `brand.id@version`.
async function initOptions(config) {
  const omega = getOmega();
  await omega.initialize({ ...TEST_CONFIG, ...config });

  const sentry = omega.sentry;
  // The flat SENTRY PROVIDER block the build maps from monitoring.providers.sentry (#425)
  await sentry.init({ dsn: 'https://key@o1.ingest.sentry.io/1' }).catch(() => {});

  return sentry.config;
}

module.exports = defineCases({
  type: 'group',
  description: 'sentry',
  setup: createOmega,
  cleanup: disposeOmega,
  tests: [
    {
      name: 'Sentry release tagging > should tag the release brand.id@version when the host blob carries a version',
      run: async (ctx) => {
        await beforeEachHook();
        // @omega.js/extension's build bakes the app's package version into the blob.
        const options = await initOptions({ version: '1.2.3', buildTime: 1755648000000 });
        ctx.expect(options.release).toBe('test@1.2.3');
      },
    },

    {
      name: 'Sentry release tagging > should fall back to the build stamp on a host whose blob carries no version',
      run: async (ctx) => {
        await beforeEachHook();
        // @omega.js/web and the @omega.js/desktop renderer ship no version yet.
        const options = await initOptions({ buildTime: 1755648000000 });
        ctx.expect(options.release).toBe('test@1755648000000');
      },
    },

    // #817: the environment an event is tagged with comes from the ONE environment
    // surface, the same module every OMEGA target answers from, never off
    // `config.environment` by hand.
    {
      name: 'Sentry environment tagging > should tag the environment the one surface answers',
      run: async (ctx) => {
        await beforeEachHook();
        const options = await initOptions({ environment: 'development' });
        ctx.expect(options.environment).toBe('development');
      },
    },

    {
      name: 'Sentry environment tagging > should refuse to initialize by name when the artifact baked no environment',
      run: async (ctx) => {
        await beforeEachHook();
        const omega = getOmega();
        const { environment, ...withoutEnvironment } = TEST_CONFIG;

        // A build that baked no environment is a broken artifact, so the reporter
        // says which fact is missing instead of tagging every event `undefined`.
        await omega.initialize({ ...withoutEnvironment, serviceWorker: { enabled: false } });

        await ctx.expect((() => omega.sentry.init({ dsn: 'https://key@o1.ingest.sentry.io/1' }))()).rejects.toThrow(/OMEGA_ENVIRONMENT/);
      },
    },
  ],
});
