/**
 * GA4 identity has exactly ONE owner
 * ([#328](https://github.com/Omega-JS-Stack/omega/issues/328)).
 *
 * Two modules set an identity on the same page. `@omega.js/client`'s
 * `setUserId()` sends the DERIVED id (`uuidv5(uid, namespace)`) — the same value
 * the backend's Measurement Protocol and the desktop singleton emit for that
 * account, which is the only reason a person is one person across surfaces. Web
 * core's `identify()` used to send the RAW uid under the same `user_id` key, on
 * the same page, from the same auth transition: last writer wins, and when it
 * won, GA4 held an id nothing else in the ecosystem would ever send again.
 *
 * So `user_id` belongs to the client, and `identify()` keeps only what the
 * client does not set: the GA4 user properties, and the Meta/TikTok identity
 * settings, where the RAW uid is correct (`external_id` is each platform's own
 * key, hashed and matched on their side — it is not GA4's `user_id`).
 *
 * The real module through esbuild, the real client analytics module under it —
 * the convention analytics-blocked.test.js sets.
 */
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');

const PKG = path.join(__dirname, '..');
const ROOT = path.resolve(PKG, '..', '..');
const CORE_DIR = path.join(PKG, 'core');
const CORE_JS = path.join(CORE_DIR, 'js');
const ENTRY = path.join(CORE_JS, 'libs', 'analytics.js');

// The client's built module — the door web core reaches the analytics package through.
const CLIENT_ANALYTICS = path.join(ROOT, 'packages', 'client', 'dist', 'modules', 'analytics.js');

const BUNDLE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-analytics-identity-'));
const BUNDLE = path.join(BUNDLE_DIR, 'analytics.cjs');

const PIXEL_ID = '_TEST_META_PIXEL';
// A uid the way one actually looks — Firebase's alphabet is case-SENSITIVE —
// carrying the padding a stored id can pick up. A fixture that was already trim
// and lowercase would let a lowercasing or an untrimmed digest pass on either
// half, and the two halves would stop meeting on a live pixel.
const USER = { uid: '  AYVZezRcE9CsyI ', email: 'buyer@example.com' };
const USER_WITH_PHONE = { ...USER, phoneNumber: '+14155550142' };

// FIXED vectors, computed independently of the implementation — a normalizer
// that changes what it feeds the hash fails here instead of quietly matching
// nobody on a live pixel. Meta's spec hashes bare digits, TikTok's E.164.
const EMAIL_HASH = '6a6c26195c3682faa816966af789717c3bfa834eee6c599d667d2b3429c27cfd';
const META_PHONE_HASH = '61c16289716534ac3a5992f613d7a9fefa5e9c12b8fd27f187387da9efeafd8c';
const TIKTOK_PHONE_HASH = 'abbf04d6f629b136344993dfb197f1fd9296f712eaf103ebc22b1cc29fb0f135';

// external_id is per provider too: TikTok's Events API REQUIRES the digest and
// its pixel takes "Unhashed or hashed SHA-256", Meta's spec only RECOMMENDS
// hashing and its Pixel example sends a bare id
// ([#410](https://github.com/Omega-JS-Stack/omega/issues/410)). The digest is
// the shasum of the TRIMMED, case-preserved uid — the server's
// `identity.tiktokExternalIdHash` for the same person, or the two halves of one
// conversion stop meeting.
const TIKTOK_EXTERNAL_ID_HASH = '12266491d7fe2f07c833999f4d011444564df71cfd7aaafb346f0edf473572b4';

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
        build.onResolve({ filter: /^@omega\.js\/client\/modules\/analytics\.js$/ }, () => {
          return { path: CLIENT_ANALYTICS };
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

/** The page globals as recorders; hand back the module plus every call each one took. */
async function boot() {
  await bundleOnce();

  const calls = { gtag: [], fbq: [], ttq: [] };

  globalThis.__omegaClient = {
    config: { analytics: { providers: { meta: { id: PIXEL_ID } } } },
    storage: () => ({ get: (key, fallback) => fallback }),
  };
  globalThis.gtag = (...args) => calls.gtag.push(args);
  globalThis.fbq = (...args) => calls.fbq.push(args);
  globalThis.ttq = { identify: (...args) => calls.ttq.push(args) };

  delete require.cache[require.resolve(BUNDLE)];

  return { analytics: require(BUNDLE), calls };
}

test('#328: identify() leaves GA4 user_id to @omega.js/client and still sets the user properties', async () => {
  const { analytics, calls } = await boot();

  await analytics.identify(USER);

  const sets = calls.gtag.filter(([command]) => command === 'set');

  assert.strictEqual(sets.length, 1, 'identity is one `set` call');
  assert.deepStrictEqual(sets[0][1], {
    user_properties: { email_domain: 'example.com' },
  }, 'the properties survive; `user_id` is the client\'s to send, and sending the RAW uid here would clobber the derived one');
});

test('#328: reset() leaves GA4 alone too — the client clears the id it set', async () => {
  const { analytics, calls } = await boot();

  analytics.reset();

  assert.deepStrictEqual(
    calls.gtag.filter(([command]) => command === 'set'),
    [],
    'a `user_id: null` here would race the client\'s own null on sign-out, for no gain',
  );
});

test('#328: Meta takes the raw uid, TikTok the hashed one — each spec\'s own external_id', async () => {
  const { analytics, calls } = await boot();

  await analytics.identify(USER);

  assert.deepStrictEqual(calls.fbq, [[
    'init',
    PIXEL_ID,
    { external_id: USER.uid, em: EMAIL_HASH },
  ]], 'advanced matching is re-init-ed with the raw uid and a HASHED email');

  assert.deepStrictEqual(calls.ttq, [[
    { external_id: TIKTOK_EXTERNAL_ID_HASH, email: EMAIL_HASH },
  ]], '#410: TikTok requires the digest on its Events API half, so the pixel half sends the same one');
});

test('#328: an account with a phone gets each platform\'s OWN normalization', async () => {
  const { analytics, calls } = await boot();

  await analytics.identify(USER_WITH_PHONE);

  // The same number, two different digests: Meta's spec is bare digits, TikTok's
  // is E.164. Sending either one's key to the other matches nobody.
  assert.deepStrictEqual(calls.fbq, [[
    'init',
    PIXEL_ID,
    { external_id: USER.uid, em: EMAIL_HASH, ph: META_PHONE_HASH },
  ]]);

  assert.deepStrictEqual(calls.ttq, [[
    { external_id: TIKTOK_EXTERNAL_ID_HASH, email: EMAIL_HASH, phone_number: TIKTOK_PHONE_HASH },
  ]]);
});

test('#328: no phone on the account sends no phone key at all', async () => {
  const { analytics, calls } = await boot();

  await analytics.identify(USER);

  assert.strictEqual('ph' in calls.fbq[0][2], false, 'a `ph: null` reads as a key we tried and failed to send');
  assert.strictEqual('phone_number' in calls.ttq[0][0], false);
});

test('#328: a digest that fails still identifies — external_id falls back to the raw uid', async () => {
  const { analytics, calls } = await boot();
  const real = Object.getOwnPropertyDescriptor(globalThis, 'crypto');

  // A page whose digest is gone or refuses: the HASHED keys are what is lost,
  // never the identity itself. Meta's `external_id` is the raw uid and needs
  // nothing computed; TikTok's pixel documents the field as "Unhashed or hashed
  // SHA-256", so it takes the raw uid too rather than nothing at all (#410).
  // The platforms match on it — the same call the server's match data makes
  // when it has nothing else.
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: { subtle: { digest: () => Promise.reject(new Error('no digest on this origin')) } },
  });

  try {
    await analytics.identify(USER_WITH_PHONE);
  } finally {
    Object.defineProperty(globalThis, 'crypto', real);
  }

  assert.deepStrictEqual(calls.fbq, [['init', PIXEL_ID, { external_id: USER.uid }]], 'Meta still learns who this is');
  assert.deepStrictEqual(calls.ttq, [[{ external_id: USER.uid }]], 'and so does TikTok');
});

test('#328: identify(null) is a reset — nothing is attributed to a signed-out visitor', async () => {
  const { analytics, calls } = await boot();

  await analytics.identify(null);

  assert.deepStrictEqual(calls.gtag.filter(([command]) => command === 'set'), []);
  assert.deepStrictEqual(calls.fbq, [['init', PIXEL_ID, {}]], 'the pixel is re-init-ed with no match keys');
  assert.deepStrictEqual(calls.ttq, [[{}]]);
});
