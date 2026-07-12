const fs = require('fs');
const path = require('path');
const { assert } = require('../helpers.js');

const SOURCE_PATH = path.join(__dirname, '..', '..', 'src', 'modules', 'analytics.js');
const SOURCE = fs.readFileSync(SOURCE_PATH, 'utf8');

describe('Analytics Module (C4 cp106a — de-ITW)', () => {

  it('carries ZERO baked-in GA4 credentials', () => {
    assert(!SOURCE.includes('DEV_CREDENTIALS'), 'dev-credentials table is gone');
    assert(!/G-[A-Z0-9]{6,}/.test(SOURCE), 'no measurement ids in source');
    assert(SOURCE.includes('config.measurementId || config.id'), 'ids come from config alone');
  });

  it('dev mode logs events without posting; production posts', async () => {
    const Analytics = (await import(SOURCE_PATH)).default;

    // Minimal browser surface for the module's page/event paths
    global.window = global.window || { location: { pathname: '/t', href: 'http://t/t' } };
    global.document = global.document || { title: 't' };

    const fetchCalls = [];
    const realFetch = global.fetch;
    global.fetch = (url, options) => {
      fetchCalls.push(url);
      return Promise.resolve({ ok: true });
    };

    try {
      // Dev: initializes with config creds, logs, never posts
      const dev = new Analytics({
        utilities: () => ({ getRuntime: () => 'electron' }),
        isDevelopment: () => true,
      });
      dev.init({ id: 'G-TESTONLY', secret: 'test-secret' });
      dev.event('unit_test');
      assert.strictEqual(fetchCalls.length, 0, 'dev mode must never hit the Measurement Protocol');

      // Production: same config posts for real
      const prod = new Analytics({
        utilities: () => ({ getRuntime: () => 'electron' }),
        isDevelopment: () => false,
      });
      prod.init({ id: 'G-TESTONLY', secret: 'test-secret' });
      assert(fetchCalls.length > 0, 'production posts via the Measurement Protocol');
      assert(fetchCalls[0].includes('measurement_id=G-TESTONLY'), 'config id rides the request');

      // No config at all → inert (no invented fallbacks)
      const bare = new Analytics({
        utilities: () => ({ getRuntime: () => 'electron' }),
        isDevelopment: () => true,
      });
      bare.init({});
      assert.strictEqual(bare.initialized, false, 'no config → no analytics, no fallback creds');
    } finally {
      global.fetch = realFetch;
    }
  });

});
