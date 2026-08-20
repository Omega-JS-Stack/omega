/**
 * Landing attribution capture (`core/js/core/query-strings.js`) — the browser-side
 * module that reads the campaign context off every page load and folds it into the
 * `attribution` blob the signup/intent payloads carry to the backend.
 *
 * The contract under test is the touch model (#384, stage C of #302): `first` is
 * written ONCE on the first visit ever seen (organic and direct included, so every
 * user carries a landing url + referrer), `last` moves ONLY for a tagged visit (any
 * utm or click id), `affiliate` keeps its own top-level slot, and a pre-first/last
 * `{ utm }` blob migrates into the new shape once, idempotently.
 *
 * The module is browser code behind two bundler aliases (`@omega.js/client`,
 * `__main_assets__/*`), so the harness drives the REAL file through esbuild — the
 * convention auth-policy.test.js set — with window/document hand-rolled to the
 * minimum the module touches. Storage is NOT stubbed: @omega.js/client's real
 * Storage module runs against a Map-backed `window.localStorage`, so what a test
 * reads back is what a browser would actually have persisted.
 */
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');

const CORE_DIR = path.join(__dirname, '..', 'core');
const CAPTURE_ENTRY = path.join(CORE_DIR, 'js', 'core', 'query-strings.js');
const STORAGE_ENTRY = path.join(__dirname, '..', '..', 'client', 'src', 'modules', 'storage.js');

// The key @omega.js/client's Storage writes its whole blob under.
const STORAGE_KEY = '_manager';

const BUNDLE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-attribution-'));
const BUNDLE = path.join(BUNDLE_DIR, 'query-strings.cjs');
const STORAGE_BUNDLE = path.join(BUNDLE_DIR, 'storage.cjs');

let building = null;

function bundleModule(entryPoint, outfile) {
  return esbuild.build({
    entryPoints: [entryPoint],
    outfile,
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
}

function bundleOnce() {
  building ||= Promise.all([
    bundleModule(CAPTURE_ENTRY, BUNDLE),
    bundleModule(STORAGE_ENTRY, STORAGE_BUNDLE),
  ]);

  return building;
}

/** The minimum of localStorage the real Storage module touches. */
function makeLocalStorage() {
  const data = new Map();

  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: (key) => { data.delete(key); },
  };
}

/**
 * A browser that keeps its localStorage across visits — the whole point of the
 * touch model is what survives from one page load to the next.
 */
async function makeBrowser(seedAttribution) {
  await bundleOnce();

  const localStorage = makeLocalStorage();

  if (seedAttribution) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ attribution: seedAttribution }));
  }

  const Storage = require(STORAGE_BUNDLE).default;

  // Storage reads window.localStorage on every call, so the global has to exist
  // before it is constructed AND on every visit below.
  globalThis.window = { localStorage };
  const storage = new Storage();

  /** Load one page; returns the attribution blob as persisted afterwards. */
  async function visit({ url, referrer = '' }) {
    const parsed = new URL(url);

    globalThis.window = {
      localStorage,
      location: {
        href: url,
        search: parsed.search,
        pathname: parsed.pathname,
        origin: parsed.origin,
      },
    };

    globalThis.document = { referrer };

    globalThis.__omegaClient = {
      dom: () => ({ ready: () => Promise.resolve() }),
      storage: () => storage,
    };

    // require.resolve, not BUNDLE: the cache is keyed by the REAL path, and
    // macOS's tmpdir is a symlink (/var → /private/var).
    delete require.cache[require.resolve(BUNDLE)];
    require(BUNDLE).default();

    // The module runs behind dom().ready() — let the microtask land.
    await new Promise((resolve) => setImmediate(resolve));

    return read();
  }

  /** The raw persisted attribution — read through localStorage, not the module. */
  function read() {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}').attribution;
  }

  return { visit, read };
}

test('attribution capture: a tagged landing records every utm param, every click id, and the landing context', async () => {
  const { visit } = await makeBrowser();

  const attribution = await visit({
    url: 'https://brand.test/pricing?utm_source=meta&utm_medium=cpc&utm_campaign=launch&utm_term=omega&utm_content=hero'
      + '&fbclid=FB1&gclid=G1&gbraid=GB1&wbraid=WB1&ttclid=TT1&msclkid=MS1&twclid=TW1',
    referrer: 'https://facebook.com/',
  });

  assert.deepStrictEqual(attribution.first.tags, {
    utm_source: 'meta',
    utm_medium: 'cpc',
    utm_campaign: 'launch',
    utm_term: 'omega',
    utm_content: 'hero',
  });

  assert.deepStrictEqual(attribution.first.clickIds, {
    fbclid: 'FB1',
    gclid: 'G1',
    gbraid: 'GB1',
    wbraid: 'WB1',
    ttclid: 'TT1',
    msclkid: 'MS1',
    twclid: 'TW1',
  });

  assert.strictEqual(attribution.first.referrer, 'https://facebook.com/');
  assert.strictEqual(attribution.first.page, '/pricing');
  assert.ok(attribution.first.url.startsWith('https://brand.test/pricing?utm_source=meta'));
  assert.ok(Date.parse(attribution.first.timestamp) > 0, 'first touch carries an ISO timestamp');

  // A tagged first visit is both touches.
  assert.deepStrictEqual(attribution.last, attribution.first);
});

test('attribution capture: an untagged first visit still writes first touch, and leaves last unset', async () => {
  const { visit } = await makeBrowser();

  const attribution = await visit({
    url: 'https://brand.test/',
    referrer: 'https://news.ycombinator.com/',
  });

  assert.ok(attribution.first, 'an organic landing is still the first touch');
  assert.strictEqual(attribution.first.referrer, 'https://news.ycombinator.com/');
  assert.strictEqual(attribution.first.url, 'https://brand.test/');
  assert.strictEqual(attribution.first.page, '/');
  assert.strictEqual(attribution.first.tags, undefined, 'no tags on an untagged visit');
  assert.strictEqual(attribution.first.clickIds, undefined, 'no click ids on an untagged visit');
  assert.strictEqual(attribution.last, undefined, 'an untagged visit never sets last touch');
});

test('attribution capture: first touch is written once; last touch moves with every later tagged visit', async () => {
  const { visit } = await makeBrowser();

  const afterFirst = await visit({ url: 'https://brand.test/?utm_source=meta', referrer: 'https://facebook.com/' });
  const firstTouch = afterFirst.first;

  const afterSecond = await visit({ url: 'https://brand.test/blog?gclid=G2', referrer: 'https://google.com/' });

  assert.deepStrictEqual(afterSecond.first, firstTouch, 'first touch is never overwritten');
  assert.deepStrictEqual(afterSecond.last.clickIds, { gclid: 'G2' });
  assert.strictEqual(afterSecond.last.tags, undefined, 'the newest tagged visit replaces last outright');
  assert.strictEqual(afterSecond.last.page, '/blog');
  assert.strictEqual(afterSecond.last.referrer, 'https://google.com/');
});

test('attribution capture: an untagged visit after a tagged one touches neither first nor last', async () => {
  const { visit } = await makeBrowser();

  const afterTagged = await visit({ url: 'https://brand.test/?utm_source=meta&ttclid=TT9' });
  const afterUntagged = await visit({ url: 'https://brand.test/docs', referrer: 'https://brand.test/' });

  assert.deepStrictEqual(afterUntagged.first, afterTagged.first);
  assert.deepStrictEqual(afterUntagged.last, afterTagged.last);
});

test('attribution capture: aff/ref keeps its own top-level block and is replaced by the newest referral', async () => {
  const { visit } = await makeBrowser();

  const afterAff = await visit({ url: 'https://brand.test/?aff=IAN7' });

  assert.strictEqual(afterAff.affiliate.code, 'IAN7');
  assert.strictEqual(afterAff.affiliate.page, '/');
  assert.strictEqual(afterAff.affiliate.url, 'https://brand.test/?aff=IAN7');
  assert.ok(Date.parse(afterAff.affiliate.timestamp) > 0);

  const afterRef = await visit({ url: 'https://brand.test/pricing?ref=SARA2' });

  assert.strictEqual(afterRef.affiliate.code, 'SARA2', 'ref is the same concern as aff');
  assert.deepStrictEqual(afterRef.first, afterAff.first, 'a referral visit is untagged — first touch stands');
});

test('attribution capture: the legacy utm blob folds into first and last, preserving its original context', async () => {
  const { visit } = await makeBrowser({
    utm: {
      tags: { utm_source: 'newsletter', utm_medium: 'email' },
      timestamp: '2025-06-01T00:00:00.000Z',
      url: 'https://brand.test/old?utm_source=newsletter',
      page: '/old',
    },
    affiliate: { code: 'LEGACY1', timestamp: '2025-06-01T00:00:00.000Z', url: 'https://brand.test/old', page: '/old' },
  });

  const attribution = await visit({ url: 'https://brand.test/' });

  assert.strictEqual(attribution.utm, undefined, 'the legacy key is dropped');
  assert.deepStrictEqual(attribution.first, {
    tags: { utm_source: 'newsletter', utm_medium: 'email' },
    referrer: null,
    url: 'https://brand.test/old?utm_source=newsletter',
    page: '/old',
    timestamp: '2025-06-01T00:00:00.000Z',
  });
  assert.deepStrictEqual(attribution.last, attribution.first, 'the legacy touch seeds both touches');
  assert.strictEqual(attribution.affiliate.code, 'LEGACY1', 'affiliate carries over untouched');
});

test('attribution capture: the legacy migration is idempotent and never re-runs over a newer touch', async () => {
  const { visit } = await makeBrowser({
    utm: {
      tags: { utm_source: 'newsletter' },
      timestamp: '2025-06-01T00:00:00.000Z',
      url: 'https://brand.test/old',
      page: '/old',
    },
  });

  const afterMigration = await visit({ url: 'https://brand.test/' });
  const afterTagged = await visit({ url: 'https://brand.test/pricing?utm_source=meta' });
  const afterReplay = await visit({ url: 'https://brand.test/docs' });

  assert.deepStrictEqual(afterReplay.first, afterMigration.first, 'the migrated first touch stands');
  assert.deepStrictEqual(afterReplay.last, afterTagged.last, 'the migration never re-seeds last');
  assert.strictEqual(afterReplay.utm, undefined);
});
