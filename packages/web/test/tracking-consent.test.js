/**
 * The TRACKING consent record (`core/js/libs/tracking-consent.js`, #383) — what
 * the banner writes and every gate reads.
 *
 * Three promises hold here: the region default when nobody has answered yet
 * (granted outside the EEA, nothing granted inside it), a stored answer honored
 * on every later load, and a version bump that re-prompts instead of quietly
 * carrying an old answer into new categories.
 *
 * A fourth, load-bearing one: it lives under `trackingConsent`, NOT `consent` —
 * that key is already the signup form's LEGAL consent (`libs/auth/forms.js`,
 * `{ legal, marketing }`, read by the backend signup route). Sharing the key
 * would have read a tracking answer as a revoked terms agreement.
 *
 * Browser code behind the `@omega.js/client` bundler alias, so the harness
 * drives the REAL file through esbuild with the client stubbed — the convention
 * dev-palette.test.js set. A fresh require IS a fresh page load: the module
 * re-reads the same storage object the previous one wrote.
 */
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');
const { get: _get, set: _set } = require('lodash');

const CORE_DIR = path.join(__dirname, '..', 'core');
const ENTRY = path.join(CORE_DIR, 'js', 'libs', 'tracking-consent.js');

const BUNDLE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-tracking-consent-'));
const BUNDLE = path.join(BUNDLE_DIR, 'tracking-consent.cjs');

let building = null;

function bundleOnce() {
  building ||= esbuild.build({
    entryPoints: [ENTRY],
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
 * One page load in one region, over a storage object the caller keeps between
 * loads — exactly what a browser does with localStorage.
 */
async function pageLoad({ timeZone, storage = {} } = {}) {
  await bundleOnce();

  process.env.TZ = timeZone || 'America/New_York';

  // Lodash-pathed exactly like @omega.js/client's Storage, so a nested path
  // behaves the way it does in a browser.
  globalThis.__omegaClient = {
    storage: () => ({
      get: (keyPath, defaultValue) => _get(storage, keyPath, defaultValue),
      set: (keyPath, value) => _set(storage, keyPath, value),
      remove: (keyPath) => _set(storage, keyPath, undefined),
    }),
  };

  delete require.cache[require.resolve(BUNDLE)];

  return { module: require(BUNDLE), storage };
}

const ORIGINAL_TZ = process.env.TZ;

test.after(() => { process.env.TZ = ORIGINAL_TZ; });

test('no decision, opt-out region: both categories granted, and it is not a decision', async () => {
  const { module } = await pageLoad({ timeZone: 'America/New_York' });

  assert.strictEqual(module.hasTrackingDecision(), false, 'nobody has answered — the banner still shows');
  assert.deepStrictEqual(module.getTrackingConsent(), {
    analytics: true,
    marketing: true,
    region: 'opt-out',
    timestamp: null,
    version: 1,
  });
});

test('no decision, opt-in region: nothing is granted', async () => {
  const { module } = await pageLoad({ timeZone: 'Europe/Berlin' });

  assert.strictEqual(module.hasTrackingDecision(), false);
  assert.deepStrictEqual(module.getTrackingConsent(), {
    analytics: false,
    marketing: false,
    region: 'opt-in',
    timestamp: null,
    version: 1,
  });
});

test('a saved answer is stored whole and honored on the next load', async () => {
  const first = await pageLoad({ timeZone: 'Europe/Berlin' });

  const written = first.module.setTrackingConsent({ analytics: true, marketing: false });

  assert.strictEqual(written.analytics, true);
  assert.strictEqual(written.marketing, false);
  assert.strictEqual(written.region, 'opt-in', 'the record remembers where it was made');
  assert.strictEqual(written.version, 1);
  assert.match(written.timestamp, /^\d{4}-\d{2}-\d{2}T/, 'an ISO timestamp, not a Date object');

  // Stored under `trackingConsent`, which is the path other packages read.
  assert.deepStrictEqual(first.storage.trackingConsent, written);

  // The next page load reads it back instead of re-applying the region default,
  // which in an opt-in region would silently revoke what was just granted.
  const second = await pageLoad({ timeZone: 'Europe/Berlin', storage: first.storage });

  assert.strictEqual(second.module.hasTrackingDecision(), true);
  assert.deepStrictEqual(second.module.getTrackingConsent(), written);
});

test('an answer survives a region the visitor is no longer in', async () => {
  const first = await pageLoad({ timeZone: 'Europe/Berlin' });
  first.module.setTrackingConsent({ analytics: false, marketing: false });

  // Travelling does not re-grant anything: the ANSWER wins over the default.
  const second = await pageLoad({ timeZone: 'America/New_York', storage: first.storage });

  assert.strictEqual(second.module.hasTrackingDecision(), true);
  assert.strictEqual(second.module.getTrackingConsent().analytics, false);
  assert.strictEqual(second.module.getTrackingConsent().marketing, false);
});

test('a record from an older version is no decision at all', async () => {
  const storage = {
    trackingConsent: { analytics: true, marketing: true, region: 'opt-in', timestamp: '2026-01-01T00:00:00.000Z', version: 0 },
  };

  const { module } = await pageLoad({ timeZone: 'Europe/Berlin', storage });

  assert.strictEqual(module.hasTrackingDecision(), false, 'a version bump re-prompts');
  assert.strictEqual(module.getTrackingConsent().analytics, false, 'and grants nothing until it is answered again');
});

test('clearing the decision puts the region default back', async () => {
  const { module, storage } = await pageLoad({ timeZone: 'Europe/Berlin' });
  module.setTrackingConsent({ analytics: true, marketing: true });

  const now = module.clearTrackingDecision();

  assert.strictEqual(module.hasTrackingDecision(), false, 'reopening the banner is a fresh question');
  assert.strictEqual(now.analytics, false);
  assert.strictEqual(storage.trackingConsent, undefined);
});

test('listeners are told what is in effect, and one throwing never costs the others', async () => {
  const { module } = await pageLoad({ timeZone: 'Europe/Berlin' });

  const seen = [];
  module.onTrackingConsentChange(() => { throw new Error('a listener with a bug'); });
  module.onTrackingConsentChange((record) => seen.push(record));
  const unsubscribe = module.onTrackingConsentChange((record) => seen.push({ second: record.analytics }));

  module.setTrackingConsent({ analytics: true, marketing: false });

  assert.strictEqual(seen.length, 2, 'the throw did not stop the notification');
  assert.strictEqual(seen[0].analytics, true);
  assert.strictEqual(seen[0].marketing, false);
  assert.deepStrictEqual(seen[1], { second: true });

  unsubscribe();
  module.setTrackingConsent({ analytics: false, marketing: false });

  assert.strictEqual(seen.length, 3, 'an unsubscribed listener stops hearing');
  assert.strictEqual(seen[2].analytics, false);
});

test('the signup form\'s legal `consent` key is never touched', async () => {
  // The collision that made this key `trackingConsent`: captureSignupConsent
  // (libs/auth/forms.js) writes `consent: { legal, marketing }` and the backend
  // signup route interprets THAT shape. A tracking record written over it would
  // read as a revoked terms agreement.
  const storage = {
    consent: {
      legal: { granted: true, text: 'I agree to the Terms' },
      marketing: { granted: false, text: 'Send me email' },
    },
  };

  const { module } = await pageLoad({ timeZone: 'Europe/Berlin', storage });

  assert.strictEqual(module.hasTrackingDecision(), false, 'a legal consent is not a tracking decision');

  module.setTrackingConsent({ analytics: true, marketing: true });
  module.clearTrackingDecision();

  assert.deepStrictEqual(
    storage.consent,
    { legal: { granted: true, text: 'I agree to the Terms' }, marketing: { granted: false, text: 'Send me email' } },
    'writing AND clearing the tracking record leave the legal one exactly as it was',
  );
});
