const { describe, it } = require('node:test');
const { getManager, TEST_CONFIG, assert } = require('./helpers.js');

// The release tag every browser surface reports under. `init()` builds the
// @sentry/browser options for real and only THEN hands them to the SDK, whose
// boot needs a live browser (globalThis event targets, web-vitals listeners) —
// so the boot is allowed to fail here and the options it was handed are what
// gets asserted. The tag itself is @omega.js/monitoring's: `brand.id@version`.
async function initOptions(config) {
  const manager = getManager();
  await manager.initialize({ ...TEST_CONFIG, ...config });

  const sentry = manager.sentry();
  await sentry.init({ provider: 'sentry', dsn: 'https://key@o1.ingest.sentry.io/1' }).catch(() => {});

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
