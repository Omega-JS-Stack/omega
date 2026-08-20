/**
 * The provider gate (`core/js/core/analytics-loader.js`, #383).
 *
 * The bug this replaces was structural: `core/foot.html` emitted the GA4, Meta
 * and TikTok snippets whenever an id was configured, so every visitor was
 * counted before the banner rendered, and the banner's Accept changed nothing.
 * Two things are pinned here — the chrome no longer ships a loader at all, and
 * the runtime injects one only for a category the visitor's consent allows.
 *
 * Google Consent Mode is the other half: the `consent default` command has to be
 * in dataLayer BEFORE gtag.js could ever read it, and a later change has to push
 * an `update` even when nothing loads (a denial still has to be told).
 *
 * Browser code behind two bundler aliases, so the harness drives the REAL files
 * through esbuild — ONE entry exposing the loader and the consent state, so a
 * grant in the test reaches the same module instance the loader subscribed to
 * (the shared-chunk guarantee a real split build gives).
 */
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');
const { get: _get, set: _set } = require('lodash');

const CORE_DIR = path.join(__dirname, '..', 'core');
const CORE_JS = path.join(CORE_DIR, 'js');

const BUNDLE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-consent-gating-'));
const BUNDLE = path.join(BUNDLE_DIR, 'analytics-loader.cjs');

const IDS = { google: 'G-TEST123', meta: '1234567890', tiktok: 'TTTEST' };

let building = null;

function bundleOnce() {
  building ||= esbuild.build({
    stdin: {
      contents: [
        `export { default } from './core/analytics-loader.js';`,
        `export { setTrackingConsent, getTrackingConsent } from './libs/tracking-consent.js';`,
      ].join('\n'),
      resolveDir: CORE_JS,
      loader: 'js',
    },
    outfile: BUNDLE,
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    plugins: [{
      name: 'harness-aliases',
      setup(build) {
        build.onResolve({ filter: /^__main_assets__\// }, (args) => {
          return { path: path.join(CORE_DIR, args.path.slice('__main_assets__/'.length)) };
        });
        build.onResolve({ filter: /^@omega\.js\/client$/ }, () => {
          return { path: 'client', namespace: 'omega-client-stub' };
        });
        build.onLoad({ filter: /.*/, namespace: 'omega-client-stub' }, () => {
          return { contents: 'export default globalThis.__omegaClient;' };
        });
      },
    }],
  });

  return building;
}

/**
 * Boot the real loader in one region with one set of configured ids, and hand
 * back the seams: what was injected, and what was queued for gtag.
 */
async function boot({ timeZone, ids = IDS, storage = {} } = {}) {
  await bundleOnce();

  process.env.TZ = timeZone || 'America/New_York';

  const injected = [];

  globalThis.window = {};
  globalThis.__omegaClient = {
    config: {
      analytics: {
        providers: {
          google: ids.google ? { id: ids.google } : {},
          meta: ids.meta ? { id: ids.meta } : {},
          tiktok: ids.tiktok ? { id: ids.tiktok } : {},
        },
      },
    },
    dom: () => ({
      loadScript: (options) => {
        injected.push(options.src);
        return Promise.resolve({});
      },
    }),
    storage: () => ({
      get: (keyPath, defaultValue) => _get(storage, keyPath, defaultValue),
      set: (keyPath, value) => _set(storage, keyPath, value),
      remove: (keyPath) => _set(storage, keyPath, undefined),
    }),
  };

  delete require.cache[require.resolve(BUNDLE)];
  const bundle = require(BUNDLE);

  bundle.default();

  return {
    injected,
    storage,
    setTrackingConsent: bundle.setTrackingConsent,
    // dataLayer holds `arguments` objects, exactly as the real snippet pushes.
    dataLayer: () => (globalThis.window.dataLayer || []).map((entry) => Array.from(entry)),
    consentCommands: () => (globalThis.window.dataLayer || [])
      .map((entry) => Array.from(entry))
      .filter(([command]) => command === 'consent'),
    // Which provider each injected src belongs to.
    loaded: () => injected.map((src) => {
      if (src.includes('googletagmanager')) return 'google';
      if (src.includes('connect.facebook.net')) return 'meta';
      if (src.includes('analytics.tiktok.com')) return 'tiktok';
      return src;
    }),
  };
}

const ORIGINAL_TZ = process.env.TZ;

test.after(() => {
  process.env.TZ = ORIGINAL_TZ;
  delete globalThis.window;
});

const DENIED = { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied' };
const GRANTED = { ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted', analytics_storage: 'granted' };

test('opt-in region: nothing loads, and Consent Mode is denied by default', async () => {
  const gate = await boot({ timeZone: 'Europe/Berlin' });

  assert.deepStrictEqual(gate.loaded(), [], 'no provider script is injected before a grant');
  assert.deepStrictEqual(gate.consentCommands(), [['consent', 'default', DENIED]], 'the default is queued, denied');

  // Queued BEFORE anything else gtag-related, which is the whole point: gtag.js
  // reads the head of dataLayer when it loads.
  assert.strictEqual(gate.dataLayer()[0][1], 'default', 'the consent default is the first thing in dataLayer');
});

test('opt-in region: Accept injects the loaders and updates Consent Mode', async () => {
  const gate = await boot({ timeZone: 'Europe/Berlin' });

  gate.setTrackingConsent({ analytics: true, marketing: true });

  assert.deepStrictEqual(gate.loaded().sort(), ['google', 'meta', 'tiktok'], 'all three load, with no reload');
  assert.deepStrictEqual(
    gate.consentCommands(),
    [['consent', 'default', DENIED], ['consent', 'update', GRANTED]],
    'and the tag is told the flags flipped',
  );

  assert.ok(gate.injected.some((src) => src.includes(`id=${IDS.google}`)), 'gtag.js carries the configured id');
  assert.ok(gate.injected.some((src) => src.includes(`sdkid=${IDS.tiktok}`)), 'the TikTok pixel carries its sdkid');
  assert.ok(gate.dataLayer().some((entry) => entry[0] === 'config' && entry[1] === IDS.google), 'GA4 is configured');
  assert.deepStrictEqual(Array.from(globalThis.window.fbq.queue[0]), ['init', IDS.meta], 'the Meta pixel is initialized');
  assert.deepStrictEqual(Array.from(globalThis.window.fbq.queue[1]), ['track', 'PageView'], 'and counts the page view');
  assert.deepStrictEqual(globalThis.window.ttq[0], ['page'], 'the TikTok pixel counts the page view');
});

test('a category is gated on its OWN provider — analytics alone loads GA4 alone', async () => {
  const gate = await boot({ timeZone: 'Europe/Berlin' });

  gate.setTrackingConsent({ analytics: true, marketing: false });

  assert.deepStrictEqual(gate.loaded(), ['google'], 'the marketing pair stays unloaded');
  assert.deepStrictEqual(
    gate.consentCommands().at(-1),
    ['consent', 'update', { ...DENIED, analytics_storage: 'granted' }],
    'the ad_* flags stay denied; only analytics_storage flips',
  );
});

test('opt-out region: everything loads at boot and Consent Mode is granted', async () => {
  const gate = await boot({ timeZone: 'America/New_York' });

  assert.deepStrictEqual(gate.loaded().sort(), ['google', 'meta', 'tiktok'], 'no wait — the banner is informational here');
  assert.deepStrictEqual(gate.consentCommands(), [['consent', 'default', GRANTED]]);
});

test('opt-out region: a Customize opt-out updates Consent Mode, and never loads more', async () => {
  const gate = await boot({ timeZone: 'America/New_York' });

  gate.setTrackingConsent({ analytics: false, marketing: false });

  // Revoking cannot unload a running script — there is no such thing — so the
  // promise is the tag being TOLD, and nothing new arriving.
  assert.deepStrictEqual(gate.loaded().sort(), ['google', 'meta', 'tiktok'], 'no second injection');
  assert.deepStrictEqual(gate.consentCommands().at(-1), ['consent', 'update', DENIED], 'the tag is told to stop');
});

test('a stored decision is honored at boot, ahead of the region default', async () => {
  const storage = {
    trackingConsent: { analytics: false, marketing: false, region: 'opt-out', timestamp: '2026-08-19T00:00:00.000Z', version: 1 },
  };

  const gate = await boot({ timeZone: 'America/New_York', storage });

  assert.deepStrictEqual(gate.loaded(), [], 'a visitor who opted out stays opted out on every later page');
  assert.deepStrictEqual(gate.consentCommands(), [['consent', 'default', DENIED]]);
});

test('a re-grant of a loaded category never injects twice', async () => {
  const gate = await boot({ timeZone: 'Europe/Berlin' });

  gate.setTrackingConsent({ analytics: true, marketing: false });
  gate.setTrackingConsent({ analytics: true, marketing: false });
  gate.setTrackingConsent({ analytics: true, marketing: true });

  assert.deepStrictEqual(gate.loaded().sort(), ['google', 'meta', 'tiktok'], 'one script per provider, ever');
});

test('an unconfigured provider is never loaded, and no id means no queue at all', async () => {
  const partial = await boot({ timeZone: 'America/New_York', ids: { google: IDS.google } });
  assert.deepStrictEqual(partial.loaded(), ['google'], 'only the configured provider loads');

  const none = await boot({ timeZone: 'America/New_York', ids: {} });
  assert.deepStrictEqual(none.loaded(), []);
  assert.strictEqual(globalThis.window.dataLayer, undefined, 'nothing configured, nothing installed');
});

test('the chrome no longer ships a provider loader of its own', () => {
  // The regression that made the old banner decorative. The stubs for an
  // UNCONFIGURED provider stay (page code names the globals; #306 reads a stub
  // as present) — what may not come back is a loader.
  const foot = fs.readFileSync(path.join(CORE_DIR, '_includes', 'core', 'foot.html'), 'utf8');

  assert.ok(!foot.includes('googletagmanager.com/gtag/js'), 'no gtag.js tag in the chrome');
  assert.ok(!foot.includes('connect.facebook.net'), 'no Meta pixel snippet in the chrome');
  assert.ok(!foot.includes('analytics.tiktok.com'), 'no TikTok pixel snippet in the chrome');
  assert.ok(!foot.includes('facebook.com/tr?id='), 'and no ungated <noscript> tracking pixel');
});
