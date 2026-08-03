const { describe, it } = require('node:test');
const fs = require('fs');
const path = require('path');
const { assert, getManager, TEST_CONFIG } = require('./helpers.js');

const SOURCE_PATH = path.join(__dirname, '..', 'src', 'modules', 'analytics.js');
const SOURCE = fs.readFileSync(SOURCE_PATH, 'utf8');
const INDEX_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');

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

describe('Analytics on web (#159: gtag delegation)', () => {

  it('web events delegate to the page gtag; the Measurement Protocol stays off web', async () => {
    const Analytics = (await import(SOURCE_PATH)).default;

    const calls = [];
    const fetchCalls = [];
    const realFetch = global.fetch;
    global.window.gtag = (...args) => calls.push(args);
    global.fetch = (url) => {
      fetchCalls.push(url);
      return Promise.resolve({ ok: true });
    };

    try {
      const web = new Analytics({
        utilities: () => ({ getRuntime: () => 'web' }),
        isDevelopment: () => false,
      });

      // No measurement id, no secret: the gtag config is page-side (web core
      // foot.html emits it), and the api_secret must never reach a page
      web.init({ projectId: 'proj-x' });
      assert.strictEqual(web.initialized, true, 'web initializes without an id or a secret');
      assert.strictEqual(calls.length, 0, 'the page gtag config already fired the page_view, so no second one');

      web.event('vert-click!', { vert_id: 'omega-promo', vert_lane: 'promo' });

      assert.strictEqual(fetchCalls.length, 0, 'web must never post to the Measurement Protocol');
      assert.strictEqual(calls.length, 1, 'the event reaches the page gtag');
      const [command, name, params] = calls[0];
      assert.strictEqual(command, 'event');
      assert.strictEqual(name, 'vert_click', 'the name normalizes through analytics-core');
      assert.strictEqual(params.vert_id, 'omega-promo', 'caller params ride along');
      assert.strictEqual(params.page_location, global.window.location.href, 'page data merges in');

      // A secret handed in anyway is dropped on the floor, never stored
      const withSecret = new Analytics({
        utilities: () => ({ getRuntime: () => 'web' }),
        isDevelopment: () => false,
      });
      withSecret.init({ id: 'G-TESTONLY', secret: 'test-secret' });
      assert.strictEqual(withSecret.secret, null, 'the api_secret is never read on web');

      // gtag absent (analytics unconfigured) → logged no-op, never a throw
      delete global.window.gtag;
      web.event('vert_click');
      assert.strictEqual(fetchCalls.length, 0, 'a missing gtag never falls back to the fetch path');
    } finally {
      global.fetch = realFetch;
      delete global.window.gtag;
    }
  });

  it('the manager initializes web analytics with no provider config (the vert_click chain)', async () => {
    const Manager = getManager();

    const calls = [];
    global.window.gtag = (...args) => calls.push(args);

    try {
      await Manager.initialize(TEST_CONFIG);
      assert.strictEqual(Manager.analytics().initialized, true, 'web analytics initializes on a brand with no google id');

      Manager.analytics().event('vert_click', { vert_lane: 'promo' });
      const events = calls.filter((entry) => entry[0] === 'event' && entry[1] === 'vert_click');
      assert.strictEqual(events.length, 1, 'vert_click reaches gtag through the manager');
      assert.strictEqual(events[0][2].vert_lane, 'promo');
    } finally {
      delete global.window.gtag;
    }
  });

});

describe('Analytics event-name normalization (wave-4 F7)', () => {

  it('event() normalizes names through analytics-core — same rule as desktop', async () => {
    const Analytics = (await import(SOURCE_PATH)).default;

    global.window = global.window || { location: { pathname: '/t', href: 'http://t/t' } };
    global.document = global.document || { title: 't' };

    const bodies = [];
    const realFetch = global.fetch;
    global.fetch = (url, options) => {
      bodies.push(JSON.parse(options.body));
      return Promise.resolve({ ok: true });
    };

    try {
      const prod = new Analytics({
        utilities: () => ({ getRuntime: () => 'electron' }),
        isDevelopment: () => false,
      });
      prod.init({ id: 'G-TESTONLY', secret: 'test-secret' });
      bodies.length = 0;

      prod.event('signup-completed!');
      const names = bodies.flatMap((b) => (b.events || []).map((e) => e.name));
      assert(names.includes('signup_completed'), `GA4-invalid chars must normalize (got: ${names.join(', ')})`);

      // A name that normalizes to nothing is dropped, not posted raw
      bodies.length = 0;
      prod.event('!!!');
      assert.strictEqual(bodies.length, 0, 'unusable names must be dropped');
    } finally {
      global.fetch = realFetch;
    }
  });
});
