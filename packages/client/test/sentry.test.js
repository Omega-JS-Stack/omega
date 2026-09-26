const { describe, it } = require('node:test');
const { getOmega, TEST_CONFIG, assert } = require('./helpers.js');

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

describe('Sentry release tagging', () => {

  it('should tag the release brand.id@version when the host blob carries a version', async () => {
    // @omega.js/extension's build bakes the app's package version into the blob.
    const options = await initOptions({ version: '1.2.3', buildTime: 1755648000000 });
    assert.strictEqual(options.release, 'test@1.2.3');
  });

  it('should fall back to the build stamp on a host whose blob carries no version', async () => {
    // @omega.js/web and the @omega.js/desktop renderer ship no version yet.
    const options = await initOptions({ buildTime: 1755648000000 });
    assert.strictEqual(options.release, 'test@1755648000000');
  });
});

// #817: the environment an event is tagged with comes from the ONE environment
// surface, the same module every OMEGA target answers from, never off
// `config.environment` by hand.
describe('Sentry environment tagging', () => {

  it('should tag the environment the one surface answers', async () => {
    const options = await initOptions({ environment: 'development' });
    assert.strictEqual(options.environment, 'development');
  });

  it('should refuse to initialize by name when the artifact baked no environment', async () => {
    const omega = getOmega();
    const { environment, ...withoutEnvironment } = TEST_CONFIG;

    // A build that baked no environment is a broken artifact, so the reporter
    // says which fact is missing instead of tagging every event `undefined`.
    await omega.initialize({ ...withoutEnvironment, serviceWorker: { enabled: false } });

    await assert.rejects(
      () => omega.sentry.init({ dsn: 'https://key@o1.ingest.sentry.io/1' }),
      /OMEGA_ENVIRONMENT/,
    );
  });
});
