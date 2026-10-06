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
const defineCases = require('@omega.js/devkit/test/define-cases');
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
        build.onResolve({ filter: /^@omega\.js\/web\/runtime$/ }, () => {
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
      dom: { ready: () => Promise.resolve() },
      storage: storage,
    };

    // require.resolve, not BUNDLE: the cache is keyed by the REAL path, and
    // macOS's tmpdir is a symlink (/var → /private/var).
    delete require.cache[require.resolve(BUNDLE)];
    require(BUNDLE).default({ omega: globalThis.__omegaClient });

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

module.exports = defineCases({
  type: 'group',
  description: 'attribution-capture',
  tests: [
    {
      name: 'attribution capture: a tagged landing records every utm param, every click id, and the landing context',
      run: async (ctx) => {
        const { visit } = await makeBrowser();

        const attribution = await visit({
          url: 'https://brand.test/pricing?utm_source=meta&utm_medium=cpc&utm_campaign=launch&utm_term=omega&utm_content=hero'
            + '&fbclid=FB1&gclid=G1&gbraid=GB1&wbraid=WB1&ttclid=TT1&msclkid=MS1&twclid=TW1',
          referrer: 'https://facebook.com/',
        });

        ctx.expect(attribution.first.tags).toEqual({
          utm_source: 'meta',
          utm_medium: 'cpc',
          utm_campaign: 'launch',
          utm_term: 'omega',
          utm_content: 'hero',
        });

        ctx.expect(attribution.first.clickIds).toEqual({
          fbclid: 'FB1',
          gclid: 'G1',
          gbraid: 'GB1',
          wbraid: 'WB1',
          ttclid: 'TT1',
          msclkid: 'MS1',
          twclid: 'TW1',
        });

        ctx.expect(attribution.first.referrer).toBe('https://facebook.com/');
        ctx.expect(attribution.first.page).toBe('/pricing');
        ctx.expect(attribution.first.url.startsWith('https://brand.test/pricing?utm_source=meta')).toBeTruthy();
        ctx.expect(Date.parse(attribution.first.timestamp) > 0, 'first touch carries an ISO timestamp').toBeTruthy();

        // A tagged first visit is both touches.
        ctx.expect(attribution.last).toEqual(attribution.first);
      },
    },

    {
      name: 'attribution capture: an untagged first visit still writes first touch, and leaves last unset',
      run: async (ctx) => {
        const { visit } = await makeBrowser();

        const attribution = await visit({
          url: 'https://brand.test/',
          referrer: 'https://news.ycombinator.com/',
        });

        ctx.expect(attribution.first, 'an organic landing is still the first touch').toBeTruthy();
        ctx.expect(attribution.first.referrer).toBe('https://news.ycombinator.com/');
        ctx.expect(attribution.first.url).toBe('https://brand.test/');
        ctx.expect(attribution.first.page).toBe('/');
        ctx.expect(attribution.first.tags, 'no tags on an untagged visit').toBe(undefined);
        ctx.expect(attribution.first.clickIds, 'no click ids on an untagged visit').toBe(undefined);
        ctx.expect(attribution.last, 'an untagged visit never sets last touch').toBe(undefined);
      },
    },

    {
      name: 'attribution capture: first touch is written once; last touch moves with every later tagged visit',
      run: async (ctx) => {
        const { visit } = await makeBrowser();

        const afterFirst = await visit({ url: 'https://brand.test/?utm_source=meta', referrer: 'https://facebook.com/' });
        const firstTouch = afterFirst.first;

        const afterSecond = await visit({ url: 'https://brand.test/blog?gclid=G2', referrer: 'https://google.com/' });

        ctx.expect(afterSecond.first, 'first touch is never overwritten').toEqual(firstTouch);
        ctx.expect(afterSecond.last.clickIds).toEqual({ gclid: 'G2' });
        ctx.expect(afterSecond.last.tags, 'the newest tagged visit replaces last outright').toBe(undefined);
        ctx.expect(afterSecond.last.page).toBe('/blog');
        ctx.expect(afterSecond.last.referrer).toBe('https://google.com/');
      },
    },

    {
      name: 'attribution capture: an untagged visit after a tagged one touches neither first nor last',
      run: async (ctx) => {
        const { visit } = await makeBrowser();

        const afterTagged = await visit({ url: 'https://brand.test/?utm_source=meta&ttclid=TT9' });
        const afterUntagged = await visit({ url: 'https://brand.test/docs', referrer: 'https://brand.test/' });

        ctx.expect(afterUntagged.first).toEqual(afterTagged.first);
        ctx.expect(afterUntagged.last).toEqual(afterTagged.last);
      },
    },

    {
      name: 'attribution capture: aff/ref keeps its own top-level block and is replaced by the newest referral',
      run: async (ctx) => {
        const { visit } = await makeBrowser();

        const afterAff = await visit({ url: 'https://brand.test/?aff=IAN7' });

        ctx.expect(afterAff.affiliate.code).toBe('IAN7');
        ctx.expect(afterAff.affiliate.page).toBe('/');
        ctx.expect(afterAff.affiliate.url).toBe('https://brand.test/?aff=IAN7');
        ctx.expect(Date.parse(afterAff.affiliate.timestamp) > 0).toBeTruthy();

        const afterRef = await visit({ url: 'https://brand.test/pricing?ref=SARA2' });

        ctx.expect(afterRef.affiliate.code, 'ref is the same concern as aff').toBe('SARA2');
        ctx.expect(afterRef.first, 'a referral visit is untagged — first touch stands').toEqual(afterAff.first);
      },
    },

    {
      name: 'attribution capture: the legacy utm blob folds into first and last, preserving its original context',
      run: async (ctx) => {
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

        ctx.expect(attribution.utm, 'the legacy key is dropped').toBe(undefined);
        ctx.expect(attribution.first).toEqual({
          tags: { utm_source: 'newsletter', utm_medium: 'email' },
          referrer: null,
          url: 'https://brand.test/old?utm_source=newsletter',
          page: '/old',
          timestamp: '2025-06-01T00:00:00.000Z',
        });
        ctx.expect(attribution.last, 'the legacy touch seeds both touches').toEqual(attribution.first);
        ctx.expect(attribution.affiliate.code, 'affiliate carries over untouched').toBe('LEGACY1');
      },
    },

    {
      name: 'attribution capture: the legacy migration is idempotent and never re-runs over a newer touch',
      run: async (ctx) => {
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

        ctx.expect(afterReplay.first, 'the migrated first touch stands').toEqual(afterMigration.first);
        ctx.expect(afterReplay.last, 'the migration never re-seeds last').toEqual(afterTagged.last);
        ctx.expect(afterReplay.utm).toBe(undefined);
      },
    },
  ],
});
