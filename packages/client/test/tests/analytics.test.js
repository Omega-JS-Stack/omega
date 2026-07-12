const fs = require('fs');
const path = require('path');
const { assert } = require('../helpers.js');

const SOURCE_PATH = path.join(__dirname, '..', '..', 'src', 'modules', 'analytics.js');
const SOURCE = fs.readFileSync(SOURCE_PATH, 'utf8');
const INDEX_SOURCE = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'index.js'), 'utf8');

describe('Analytics Module (C4 cp106a — de-ITW)', () => {

  it('carries ZERO baked-in GA4 credentials', () => {
    assert(!SOURCE.includes('DEV_CREDENTIALS'), 'dev-credentials table is gone');
    assert(!/G-[A-Z0-9]{6,}/.test(SOURCE), 'no measurement ids in source');
    assert(SOURCE.includes('config.measurementId || config.id'), 'ids come from config alone');
  });

  it('flat analytics handoff is dead — canonical providers shape only', () => {
    assert(!INDEX_SOURCE.includes('googleSecret'), 'flat googleSecret handoff gone from index.js');
    assert(INDEX_SOURCE.includes('analytics?.providers?.google'), 'index.js reads the canonical providers shape');
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

  it('identity: uuidv5 client_id/user_id in the project namespace (desktop convention)', async () => {
    const Analytics = (await import(SOURCE_PATH)).default;
    const { v5: uuidv5 } = require('uuid');

    // localStorage shim so the device id persists between instances
    const store = new Map();
    global.localStorage = {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, value),
    };
    global.window = global.window || { location: { pathname: '/t', href: 'http://t/t' } };
    global.document = global.document || { title: 't' };

    const sent = [];
    const realFetch = global.fetch;
    global.fetch = (url, options) => {
      sent.push({ url, body: JSON.parse(options.body) });
      return Promise.resolve({ ok: true });
    };

    try {
      const manager = {
        utilities: () => ({ getRuntime: () => 'electron' }),
        isDevelopment: () => false,
      };

      // Same device + same project → same client_id on every instance,
      // and it is exactly uuidv5(deviceId, uuidv5(projectId, URL-ns))
      const a = new Analytics(manager);
      a.init({ id: 'G-TESTONLY', secret: 's', projectId: 'proj-x' });
      const b = new Analytics(manager);
      b.init({ id: 'G-TESTONLY', secret: 's', projectId: 'proj-x' });

      const ns = uuidv5('proj-x', uuidv5.URL);
      assert.strictEqual(a.clientId, uuidv5(store.get('_omega_device_id'), ns), 'client_id = uuidv5(deviceId, ns)');
      assert.strictEqual(a.clientId, b.clientId, 'stable across instances');

      // user_id = uuidv5(uid, ns) — the raw uid never leaves the device
      a.setUserId('firebase-uid-1');
      assert.strictEqual(a.userId, uuidv5('firebase-uid-1', ns));
      assert.notStrictEqual(a.userId, 'firebase-uid-1');

      sent.length = 0;
      a.event('unit_identity');
      assert.strictEqual(sent.length, 1, 'production event posts');
      assert.strictEqual(sent[0].body.user_id, uuidv5('firebase-uid-1', ns), 'payload carries the hashed user_id');
      assert.strictEqual(sent[0].body.client_id, a.clientId);

      // Logout clears it
      a.setUserId(null);
      assert.strictEqual(a.userId, null);

      // user properties ride wrapped as { value }
      a.setUserProperties({ plan: 'premium' });
      sent.length = 0;
      a.event('unit_props');
      assert.deepStrictEqual(sent[0].body.user_properties, { plan: { value: 'premium' } });
    } finally {
      global.fetch = realFetch;
      delete global.localStorage;
    }
  });

});
