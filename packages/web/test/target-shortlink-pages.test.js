/**
 * target-shortlinks.js — the redirect page a brand gets per download platform
 * and per extension store (#561), the download/extension half of the shortlink
 * lane #429 opened for socials.
 *
 * Legacy UJM shipped these as hand-maintained default pages
 * (`src/defaults/dist/redirects/download/**`, `.../extension/*.html`):
 * `/download/mac`, `/download/mac/universal`, `/download/linux/snap`,
 * `/extension/chrome`, … Every one is linked from a store page, a third-party
 * listing or an old post, and every migrating brand 404s them today. A brand
 * never hand-authors these: the curated `site.targets` view — the SAME facts
 * `/download` and `/extension` render from — IS the declaration (#610).
 *
 * Legacy parity that matters: `/download/<platform>` with no arch points at the
 * platform's FIRST artifact (UJM sent /download/mac → mac.universal and
 * /download/linux → linux.debian).
 */
const assert = require('node:assert');
const { test, before } = require('node:test');

const { buildWith, miniData } = require('./lib/build.js');
const { readTargetShortlinks, targetShortlinkPages } = require('../src/target-shortlinks.js');

const RELEASES = 'https://github.com/mini-org/mini-desktop/releases/latest';

// A brand that opted into desktop releases and listed three stores — the whole
// declaration, in the one place it lives.
const TARGETS = {
  repo: { providers: { github: { org: 'mini-org', repo: 'mini-site' } } },
  targets: {
    web: {},
    desktop: { releases: { repo: 'mini-desktop' } },
    extension: {
      listings: {
        chrome: { url: 'https://chromewebstore.google.com/detail/abc', state: 'live' },
        firefox: { url: 'https://addons.mozilla.org/addon/minico' },
        edge: { url: 'https://microsoftedge.microsoft.com/addons/detail/xyz' },
      },
    },
  },
};

// The curated view the engine hands the generator (toSiteGlobal's output).
const siteOf = (config) => require('@omega.js/config/site-global').toSiteGlobal(config);
const SITE = siteOf(TARGETS);

test('an unset block declares nothing', () => {
  assert.deepStrictEqual(readTargetShortlinks({}), []);
  assert.deepStrictEqual(readTargetShortlinks({ targets: {} }), []);
  assert.deepStrictEqual(readTargetShortlinks({ targets: { desktop: { enabled: true }, extension: { enabled: true } } }), [],
    'a declared target that derived nothing declares no shortlink either');
  assert.deepStrictEqual(targetShortlinkPages(readTargetShortlinks({})), [], 'no targets, no pages');
});

test('the desktop releases URL declares every platform and artifact shortlink', () => {
  assert.deepStrictEqual(readTargetShortlinks({ targets: { desktop: { releasesUrl: RELEASES } } }), [
    { label: 'download.mac', url: '/download/mac', redirect: RELEASES },
    { label: 'download.mac.universal', url: '/download/mac/universal', redirect: RELEASES },
    { label: 'download.windows', url: '/download/windows', redirect: RELEASES },
    { label: 'download.windows.universal', url: '/download/windows/universal', redirect: RELEASES },
    { label: 'download.linux', url: '/download/linux', redirect: RELEASES },
    { label: 'download.linux.debian', url: '/download/linux/debian', redirect: RELEASES },
    { label: 'download.linux.snap', url: '/download/linux/snap', redirect: RELEASES },
  ]);
});

test('the bare platform URL comes FIRST — legacy parity', () => {
  const urls = readTargetShortlinks({ targets: { desktop: { releasesUrl: RELEASES } } }).map((entry) => entry.url);

  assert.deepStrictEqual(urls.slice(4), ['/download/linux', '/download/linux/debian', '/download/linux/snap'],
    'UJM sent /download/linux to the .deb, and the bare URL leads its artifacts');
});

test('a store listing declares its shortlink at /extension/<store>', () => {
  assert.deepStrictEqual(
    readTargetShortlinks({ targets: { extension: { listings: { chrome: { url: 'https://chromewebstore.google.com/detail/abc' } } } } }),
    [{ label: 'extension.chrome', url: '/extension/chrome', redirect: 'https://chromewebstore.google.com/detail/abc' }],
  );
});

test('an entry with nowhere to point generates no page, and says nothing about it', () => {
  // An announced-but-unshipped store: /extension already leaves it on Coming
  // soon, and so does this lane.
  assert.deepStrictEqual(readTargetShortlinks({ targets: { extension: { listings: { safari: { state: 'pending' } } } } }), []);
  assert.deepStrictEqual(readTargetShortlinks({ targets: { desktop: { enabled: true } } }), [],
    'a desktop target that never opted into releases declares nothing');
});

test('a store key the brand fat-fingered is an ERROR — a dropped entry is a dead third-party link', () => {
  assert.throws(
    () => readTargetShortlinks({ targets: { extension: { listings: { 'Chrome Web Store': { url: 'https://x' } } } } }),
    /targets\.extension\.listings\."Chrome Web Store" is not a usable store key/,
  );
});

let pages;
before(async () => {
  pages = await buildWith({ ...miniData, ...TARGETS }, {}, 'target-shortlinks');
});

test('every platform and store ships its shortlink, on the redirect module', () => {
  const expected = {
    '/download/mac': RELEASES,
    '/download/mac/universal': RELEASES,
    '/download/windows': RELEASES,
    '/download/windows/universal': RELEASES,
    '/download/linux': RELEASES,
    '/download/linux/debian': RELEASES,
    '/download/linux/snap': RELEASES,
    '/extension/chrome': 'https://chromewebstore.google.com/detail/abc',
    '/extension/firefox': 'https://addons.mozilla.org/addon/minico',
    '/extension/edge': 'https://microsoftedge.microsoft.com/addons/detail/xyz',
  };

  for (const [url, redirect] of Object.entries(expected)) {
    assert.ok(pages.has(url), `${url} is generated`);
    assert.ok(pages.get(url).includes(`data-url="${redirect}"`), `${url} points at ${redirect}`);
  }

  assert.ok(pages.get('/download/mac').includes('/assets/js/modules/redirect.bundle.js'),
    'the shortlink rides the redirect module like a hand-written one');
});

test('a shortlink is noindex and out of every machine file', () => {
  assert.ok(pages.get('/extension/chrome').includes('<meta name="robots" content="noindex'), 'the redirect layout already says noindex');

  const sitemap = pages.get('/sitemap.xml');
  const pagesJson = pages.get('/pages.json');
  for (const url of ['/download/mac', '/download/linux/snap', '/extension/chrome']) {
    assert.ok(!sitemap.includes(`<loc>${miniData.url}${url}</loc>`), `${url} stays out of the sitemap`);
    assert.ok(!pagesJson.includes(`"${url}"`), `${url} stays out of the search index`);
  }
});

test('the hub pages read the SAME facts — one home, two consumers', () => {
  assert.ok(pages.get('/download').includes(RELEASES), '/download renders the releases hub');
  assert.ok(pages.get('/extension').includes('https://chromewebstore.google.com/detail/abc'), 'and /extension its listings');
});

test('a shortlink URL is a config-time fact, so the takeover gate can see it', () => {
  // The same lane as the socials shortlinks and the default pages: every page
  // carries its own url, which is what engine.js hands decisions.framework()
  // and what the render gate asks about. #429's suite pins the takeover itself.
  const generated = targetShortlinkPages(readTargetShortlinks(SITE));

  assert.strictEqual(generated.length, 10, 'one page per platform, artifact and store');
  assert.ok(generated.every((page) => page.url && page.virtual && page.raw), 'each page names its URL, its virtual path and its source');
  assert.ok(generated.every((page) => page.raw.includes('layout: modules/utilities/redirect')), 'each rides the redirect module');
});

test('no desktop releases and no listings, no shortlinks — and nothing else moves', async () => {
  const bare = await buildWith(miniData, {}, 'target-shortlinks-none');

  assert.ok(!bare.has('/download/mac') && !bare.has('/extension/chrome'), 'nothing generated');
  assert.ok(bare.has('/download') && bare.has('/extension'), 'the hub pages still ship');
  assert.ok(bare.has('/account'), 'the framework\'s own redirect defaults are untouched');
});
