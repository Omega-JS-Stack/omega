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
      dev.event('app_launch');
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

      // user_id = uuidv5(uid, ns) — the raw uid never leaves the device.
      // The fires below run on `b`, the host that init'd LAST: the facade holds
      // one transport per process, so the most recent host owns it. A runtime
      // has exactly one client singleton, so only a test ever has two.
      b.setUserId('firebase-uid-1');
      assert.strictEqual(b.userId, uuidv5('firebase-uid-1', ns));
      assert.notStrictEqual(b.userId, 'firebase-uid-1');

      sent.length = 0;
      b.event('app_launch');
      assert.strictEqual(sent.length, 1, 'production event posts');
      assert.strictEqual(sent[0].body.user_id, uuidv5('firebase-uid-1', ns), 'payload carries the hashed user_id');
      assert.strictEqual(sent[0].body.client_id, b.clientId);

      // Logout clears it
      b.setUserId(null);
      assert.strictEqual(b.userId, null);

      // user properties ride wrapped as { value }
      b.setUserProperties({ plan: 'premium' });
      sent.length = 0;
      b.event('app_launch');
      assert.deepStrictEqual(sent[0].body.user_properties, { plan: { value: 'premium' } });
    } finally {
      global.fetch = realFetch;
      delete global.localStorage;
    }
  });

  it('the device id is the shared derivation, storage-backed, always a real UUID (#396)', async () => {
    const Analytics = (await import(SOURCE_PATH)).default;

    // The wiring: one derivation for every surface, and the only thing this
    // runtime supplies is where it persists (no machine seed exists on a page).
    assert(SOURCE.includes('core.deriveDeviceId'), 'the client hosts the shared derivation');
    assert(!SOURCE.includes('crypto.randomUUID'), 'the local generator is gone');
    assert(!SOURCE.includes('Math.random'), 'the weak non-UUID fallback is gone');

    const store = new Map();
    global.localStorage = {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, value),
    };
    global.window = global.window || { location: { pathname: '/t', href: 'http://t/t' } };
    global.document = global.document || { title: 't' };

    // An insecure origin: `crypto.getRandomValues` is there, `crypto.randomUUID`
    // is NOT — where the old fallback minted `<base36>.<timestamp>` (#396)
    const realCrypto = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', {
      value: { getRandomValues: (array) => realCrypto.getRandomValues(array) },
      configurable: true,
    });

    try {
      const manager = {
        utilities: () => ({ getRuntime: () => 'web' }),
        isDevelopment: () => false,
      };

      const first = new Analytics(manager);
      first.init({ projectId: 'proj-x' });

      const deviceId = store.get('_omega_device_id');
      assert.match(
        deviceId,
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        'a UUID even with no crypto.randomUUID to make one',
      );

      // Persisted, so the next boot on this browser is the same GA client
      const second = new Analytics(manager);
      second.init({ projectId: 'proj-x' });
      assert.strictEqual(store.get('_omega_device_id'), deviceId, 'the stored id is never re-derived');
      assert.strictEqual(second.clientId, first.clientId);
    } finally {
      Object.defineProperty(globalThis, 'crypto', { value: realCrypto, configurable: true });
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
    // The page global as a browser has it: `window.gtag` IS the bare `gtag` the
    // guarded transport checks for.
    globalThis.gtag = (...args) => calls.push(args);
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

      web.event('vert_click', { vert_id: 'omega-promo', vert_lane: 'promo' });

      assert.strictEqual(fetchCalls.length, 0, 'web must never post to the Measurement Protocol');
      assert.strictEqual(calls.length, 1, 'the event reaches the page gtag');
      const [command, name, params] = calls[0];
      assert.strictEqual(command, 'event');
      assert.strictEqual(name, 'vert_click', 'the catalog decides the native name');
      assert.strictEqual(params.vert_id, 'omega-promo', 'caller params ride along');
      assert.strictEqual(params.page_location, global.window.location.href, 'page data merges in');

      // A secret handed in anyway is dropped on the floor, never stored
      const withSecret = new Analytics({
        utilities: () => ({ getRuntime: () => 'web' }),
        isDevelopment: () => false,
      });
      withSecret.init({ id: 'G-TESTONLY', secret: 'test-secret' });
      assert.strictEqual(withSecret.secret, null, 'the api_secret is never read on web');

      // gtag absent (blocked, or consent not granted so the loader never
      // injected it) → silent no-op, never a throw and never a fallback
      delete globalThis.gtag;
      web.event('vert_click');
      assert.strictEqual(fetchCalls.length, 0, 'a missing gtag never falls back to the fetch path');
    } finally {
      global.fetch = realFetch;
      delete globalThis.gtag;
    }
  });

  it('the manager initializes web analytics with no provider config (the vert_click chain)', async () => {
    const Manager = getManager();

    const calls = [];
    globalThis.gtag = (...args) => calls.push(args);

    try {
      await Manager.initialize(TEST_CONFIG);
      assert.strictEqual(Manager.analytics().initialized, true, 'web analytics initializes on a brand with no google id');

      Manager.analytics().event('vert_click', { vert_lane: 'promo' });
      const events = calls.filter((entry) => entry[0] === 'event' && entry[1] === 'vert_click');
      assert.strictEqual(events.length, 1, 'vert_click reaches gtag through the manager');
      assert.strictEqual(events[0][2].vert_lane, 'promo');
    } finally {
      delete globalThis.gtag;
    }
  });

});

describe("Analytics in desktop's renderer (#411: one sender, reached over IPC)", () => {

  it('a bridged renderer forwards every event to main and never sends one itself', async () => {
    const Analytics = (await import(SOURCE_PATH)).default;

    global.window = global.window || { location: { pathname: '/t', href: 'http://t/t' } };
    global.document = global.document || { title: 't' };

    const fetchCalls = [];
    const realFetch = global.fetch;
    global.fetch = (url) => {
      fetchCalls.push(url);
      return Promise.resolve({ ok: true });
    };

    // The preload's surface: fire-and-forget IPC into the main process, whose
    // sender owns the device id, the session id and the engagement time.
    const forwarded = [];
    const properties = [];
    const bridge = {
      event: (name, params) => forwarded.push({ name, params }),
      setUserProperties: (props) => properties.push(props),
    };

    try {
      // An Electron window sets no config.runtime, so a desktop renderer
      // resolves as the WEB runtime — the bridge, not the runtime name, is
      // what makes this client a forwarder.
      const renderer = new Analytics({
        utilities: () => ({ getRuntime: () => 'web' }),
        isDevelopment: () => false,
      });
      renderer.init({ id: 'G-TESTONLY', secret: 'test-secret', projectId: 'proj-x', bridge });

      assert.strictEqual(renderer.initialized, true, 'a bridged renderer initializes');
      assert.strictEqual(renderer.secret, null, 'the Measurement Protocol secret is never held in a renderer');
      assert.strictEqual(renderer.clientId, null, 'and no second device id is ever minted here');

      renderer.event('vert_click', { vert_id: 'omega-promo' });
      assert.strictEqual(forwarded.length, 1, 'the event forwards exactly once');
      assert.deepStrictEqual(
        forwarded[0],
        { name: 'vert_click', params: { vert_id: 'omega-promo' } },
        'the canonical name and the caller params are all that cross — main owns the page context',
      );
      assert.strictEqual(fetchCalls.length, 0, 'a bridged renderer never posts to the Measurement Protocol');

      renderer.setUserProperties({ plan: 'premium' });
      assert.deepStrictEqual(properties, [{ plan: 'premium' }], 'user properties ride the same bridge, unwrapped');

      // Main's auth bridge fires login/logout off the same Firebase user, so a
      // bridged renderer firing its own would double-count every sign-in.
      forwarded.length = 0;
      renderer.handleAuthChange({ uid: 'uid-1', providerId: 'google' });
      assert.deepStrictEqual(forwarded, [], 'login stays main\'s to fire');

      // The drop is the BRIDGE's doing, not web's: an electron-runtime client
      // handed credentials keeps neither, so the guard holds wherever a host
      // wires the bridge.
      const electron = new Analytics({
        utilities: () => ({ getRuntime: () => 'electron' }),
        isDevelopment: () => false,
      });
      electron.init({ id: 'G-TESTONLY', secret: 'test-secret', projectId: 'proj-x', bridge });

      assert.strictEqual(electron.secret, null, 'a bridged electron client drops the api_secret too');
      assert.strictEqual(electron.clientId, null, 'and mints no device id of its own');

      fetchCalls.length = 0;
      forwarded.length = 0;
      electron.event('vert_click');
      assert.strictEqual(fetchCalls.length, 0, 'it never reaches the Measurement Protocol');
      assert.strictEqual(forwarded.length, 1, 'it forwards instead');
    } finally {
      global.fetch = realFetch;
    }
  });

  it('a forward never throws at the caller, and an unknown name never leaves the renderer', async () => {
    const Analytics = (await import(SOURCE_PATH)).default;

    const forwarded = [];
    const bridge = {
      event: (name, params) => forwarded.push({ name, params }),
      setUserProperties: () => {},
    };
    // What an IPC bridge does when handed something structured clone cannot
    // carry (a DOM node, a function): it throws where the caller stands.
    const uncloneable = {
      event: () => { throw new Error('An object could not be cloned.'); },
      setUserProperties: () => { throw new Error('An object could not be cloned.'); },
    };

    // An uncatalogued name is a PROGRAMMER error, and it is the renderer's
    // programmer: it must surface at this call site in development, not as a
    // warn in the main process's log with nothing to blame.
    const dev = new Analytics({
      utilities: () => ({ getRuntime: () => 'web' }),
      isDevelopment: () => true,
    });
    dev.init({ projectId: 'proj-x', bridge });

    assert.throws(() => dev.event('signup-completed!'), /Unknown analytics event/, 'dev throws at the call site');
    assert.strictEqual(forwarded.length, 0, 'and nothing crossed to main');

    const prod = new Analytics({
      utilities: () => ({ getRuntime: () => 'web' }),
      isDevelopment: () => false,
    });
    prod.init({ projectId: 'proj-x', bridge });

    forwarded.length = 0;
    prod.event('signup-completed!');
    assert.strictEqual(forwarded.length, 0, 'production skips it instead of shipping junk to main');

    const broken = new Analytics({
      utilities: () => ({ getRuntime: () => 'web' }),
      isDevelopment: () => false,
    });
    broken.init({ projectId: 'proj-x', bridge: uncloneable });

    broken.event('vert_click', { vert_id: 'x' });
    broken.setUserProperties({ plan: 'premium' });
  });

  it('the seam is the host\'s injected config value alone — a global can never bridge a page', async () => {
    const Manager = getManager();
    const savedConfig = Manager.config;

    const calls = [];
    globalThis.gtag = (...args) => calls.push(args);

    try {
      const injected = { event: () => {} };

      Manager.config = { analyticsBridge: injected };
      assert.strictEqual(Manager._resolveAnalyticsBridge(), injected, 'the injected surface IS the seam');

      Manager.config = {};
      assert.strictEqual(Manager._resolveAnalyticsBridge(), null, 'a host that injects nothing gets no bridge');

      // The global is inert BY CONSTRUCTION now: a page carrying a
      // `window.desktop.analytics` (a brand's own script, an extension, a
      // stray global) bridges nothing, so a brand's analytics can never be
      // silently routed into a void.
      global.window.desktop = { analytics: { event: () => { throw new Error('a global must never bridge'); } } };
      assert.strictEqual(Manager._resolveAnalyticsBridge(), null, 'a planted window.desktop is not a seam');

      // A host that injects a broken surface is a broken host — loud, never a
      // quiet fall back to the sender a desktop renderer must not have.
      Manager.config = { analyticsBridge: { pageview: () => {} } };
      assert.throws(() => Manager._resolveAnalyticsBridge(), /carries no event\(\)/, 'a malformed injection raises');

      // And web is untouched with that same global still planted: no bridge was
      // injected, so the event goes to the page's gtag exactly as before.
      const Analytics = (await import(SOURCE_PATH)).default;
      const web = new Analytics({
        utilities: () => ({ getRuntime: () => 'web' }),
        isDevelopment: () => false,
      });
      web.init({ projectId: 'proj-x' });

      calls.length = 0;
      web.event('vert_click', { vert_lane: 'promo' });
      assert.strictEqual(calls.length, 1, 'the event still reaches the page gtag');
      assert.strictEqual(calls[0][1], 'vert_click');
    } finally {
      Manager.config = savedConfig;
      delete global.window.desktop;
      delete globalThis.gtag;
    }
  });

});

describe('Analytics rides the shared catalog (#328 stage E)', () => {

  it('the catalog decides the name, and an unknown one is never posted', async () => {
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

      // A canonical name posts under the GA4 mapping's NATIVE name
      prod.event('screen_view', { screen_name: 'settings' });
      const names = bodies.flatMap((b) => (b.events || []).map((e) => e.name));
      assert(names.includes('screen_view'), `the catalog's GA4 name rides the payload (got: ${names.join(', ')})`);

      // A name no catalog entry declares is a programmer error: production logs
      // and skips it rather than shipping junk into the property
      bodies.length = 0;
      prod.event('signup-completed!');
      assert.strictEqual(bodies.length, 0, 'an uncatalogued name is never posted');
    } finally {
      global.fetch = realFetch;
    }
  });

  it('login/logout fire off auth change on the runtimes that own them', async () => {
    const Analytics = (await import(SOURCE_PATH)).default;

    const bodies = [];
    const realFetch = global.fetch;
    global.fetch = (url, options) => {
      bodies.push(JSON.parse(options.body));
      return Promise.resolve({ ok: true });
    };

    const namesOf = () => bodies.flatMap((b) => (b.events || []).map((e) => e.name));

    try {
      const extension = new Analytics({
        utilities: () => ({ getRuntime: () => 'browser-extension' }),
        isDevelopment: () => false,
      });
      extension.init({ id: 'G-TESTONLY', secret: 'test-secret', projectId: 'proj-x' });

      bodies.length = 0;
      extension.handleAuthChange({ uid: 'uid-1', providerId: 'google' });
      assert.deepStrictEqual(namesOf(), ['login'], 'signing in fires login');

      bodies.length = 0;
      extension.handleAuthChange({ uid: 'uid-1', providerId: 'google' });
      assert.deepStrictEqual(namesOf(), [], 'a repeat callback for the same session fires nothing');

      // `logout` is in the catalog with NO provider mapping — a logout is not
      // an ad signal, and GA4 reads the session end on its own — so the proof
      // that it FIRED is the facade's dev line, not a delivery.
      const dev = new Analytics({
        utilities: () => ({ getRuntime: () => 'browser-extension' }),
        isDevelopment: () => true,
      });
      dev.init({ id: 'G-TESTONLY', secret: 'test-secret', projectId: 'proj-x' });

      const lines = [];
      const realLog = console.log;
      console.log = (...args) => lines.push(args.join(' '));
      try {
        dev.handleAuthChange({ uid: 'uid-1', providerId: 'google' });
        dev.handleAuthChange(null);
      } finally {
        console.log = realLog;
      }

      assert(lines.some((line) => line.includes('login → ')), 'the login fire logs its walk');
      assert(lines.some((line) => line.includes('logout → ')), 'signing out fires logout');
      assert.strictEqual(dev.userId, null, 'and the identity is cleared');

      // Web's auth pages own login (they know the METHOD), so the shared
      // wiring stays out of their way — identity still follows auth.
      const calls = [];
      globalThis.gtag = (...args) => calls.push(args);

      const web = new Analytics({
        utilities: () => ({ getRuntime: () => 'web' }),
        isDevelopment: () => false,
      });
      web.init({ projectId: 'proj-x' });

      bodies.length = 0;
      calls.length = 0;
      web.handleAuthChange({ uid: 'uid-1', providerId: 'google' });

      assert.deepStrictEqual(namesOf(), [], 'web never posts to the Measurement Protocol');
      assert.deepStrictEqual(
        calls.filter(([command, name]) => command === 'event' && name === 'login'),
        [],
        'and never double-fires the login the auth page already counted',
      );
      assert.deepStrictEqual(calls[0], ['set', { user_id: web.userId }], 'the identity is sent (#159)');
    } finally {
      global.fetch = realFetch;
      delete globalThis.gtag;
    }
  });
});
