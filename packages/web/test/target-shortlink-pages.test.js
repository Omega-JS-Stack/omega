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
 * Legacy parity that matters: `/download/<platform>` with no format points at
 * the platform's FIRST format (UJM sent /download/mac → the dmg and
 * /download/linux → the .deb).
 *
 * Since #620 a shortlink hands over the FILE (`/releases/latest/download/
 * <versionless asset>`), never the releases page. Since #867 the segments are
 * the format vocabulary (`/download/mac/dmg`), with the three words it replaced
 * kept as redirects to the same file.
 */
const assert = require('node:assert');
const { test, before } = require('node:test');

const { buildWith, miniData } = require('./lib/build.js');
const { readTargetShortlinks, targetShortlinkPages } = require('../src/target-shortlinks.js');

const RELEASES = 'https://github.com/mini-org/mini-releases/releases/latest';
// The mini fixture's brand is "MiniCo" — @omega.js/config's one naming rule.
const DL = (asset) => `${RELEASES}/download/MiniCo-${asset}`;
const DOWNLOADS = {
  mac: { dmg: DL('mac-dmg.dmg') },
  windows: { nsis: DL('windows-nsis.exe') },
  linux: { deb: DL('linux-deb.deb'), appimage: DL('linux-appimage.AppImage'), snap: 'https://snapcraft.io/minico' },
};

// A brand that opted into desktop releases and listed three stores — the whole
// declaration, in the one place it lives.
const TARGETS = {
  repo: { provider: 'github', org: 'mini-org' },
  targets: {
    web: { type: 'web' },
    desktop: { type: 'desktop', releases: {} },
    extension: {
      type: 'extension',
      listings: {
        chrome: { url: 'https://chromewebstore.google.com/detail/abc', state: 'live' },
        firefox: { url: 'https://addons.mozilla.org/addon/minico' },
        edge: { url: 'https://microsoftedge.microsoft.com/addons/detail/xyz' },
      },
    },
  },
};

// The curated view the engine hands the generator (toSiteGlobal's output), off
// the SAME config the build below runs on — the brand name in it is what the
// artifact filenames derive from.
const siteOf = (config) => require('@omega.js/config/site-global').toSiteGlobal(config);
const SITE = siteOf({ ...miniData, ...TARGETS });

test('an unset block declares nothing', () => {
  assert.deepStrictEqual(readTargetShortlinks({}), []);
  assert.deepStrictEqual(readTargetShortlinks({ targets: {} }), []);
  assert.deepStrictEqual(readTargetShortlinks({ targets: { desktop: { enabled: true }, extension: { enabled: true } } }), [],
    'a declared target that derived nothing declares no shortlink either');
  assert.deepStrictEqual(targetShortlinkPages(readTargetShortlinks({})), [], 'no targets, no pages');
});

test('the derived downloads declare every platform and format shortlink, each pointing at the FILE', () => {
  assert.deepStrictEqual(readTargetShortlinks({ targets: { desktop: { releasesUrl: RELEASES, downloads: DOWNLOADS } } }), [
    { label: 'download.mac', url: '/download/mac', redirect: DOWNLOADS.mac.dmg },
    { label: 'download.mac.dmg', url: '/download/mac/dmg', redirect: DOWNLOADS.mac.dmg },
    { label: 'download.mac.universal', url: '/download/mac/universal', redirect: DOWNLOADS.mac.dmg },
    { label: 'download.windows', url: '/download/windows', redirect: DOWNLOADS.windows.nsis },
    { label: 'download.windows.nsis', url: '/download/windows/nsis', redirect: DOWNLOADS.windows.nsis },
    { label: 'download.windows.universal', url: '/download/windows/universal', redirect: DOWNLOADS.windows.nsis },
    { label: 'download.linux', url: '/download/linux', redirect: DOWNLOADS.linux.deb },
    { label: 'download.linux.deb', url: '/download/linux/deb', redirect: DOWNLOADS.linux.deb },
    { label: 'download.linux.debian', url: '/download/linux/debian', redirect: DOWNLOADS.linux.deb },
    { label: 'download.linux.appimage', url: '/download/linux/appimage', redirect: DOWNLOADS.linux.appimage },
    { label: 'download.linux.snap', url: '/download/linux/snap', redirect: DOWNLOADS.linux.snap },
  ]);
});

test('a retired URL segment still has a page, pointing at the same file (#867)', () => {
  const byUrl = new Map(readTargetShortlinks({ targets: { desktop: { downloads: DOWNLOADS } } }).map((entry) => [entry.url, entry.redirect]));

  // The words the format vocabulary replaced: an old link must not 404.
  assert.strictEqual(byUrl.get('/download/mac/universal'), byUrl.get('/download/mac/dmg'));
  assert.strictEqual(byUrl.get('/download/windows/universal'), byUrl.get('/download/windows/nsis'));
  assert.strictEqual(byUrl.get('/download/linux/debian'), byUrl.get('/download/linux/deb'));
  // And the one segment that IS a store page, never a release asset
  assert.strictEqual(byUrl.get('/download/linux/snap'), 'https://snapcraft.io/minico');
});

test('the bare platform URL comes FIRST and leads with that platform\'s first format, legacy parity', () => {
  const entries = readTargetShortlinks({ targets: { desktop: { releasesUrl: RELEASES, downloads: DOWNLOADS } } });

  assert.deepStrictEqual(entries.slice(6).map((entry) => entry.url),
    ['/download/linux', '/download/linux/deb', '/download/linux/debian', '/download/linux/appimage', '/download/linux/snap'],
    'UJM sent /download/linux to the .deb, and the bare URL leads its formats');
  assert.strictEqual(entries[6].redirect, DOWNLOADS.linux.deb, 'and it hands over the .deb itself');
});

test('a hub with no derived filenames declares nothing — the releases PAGE is never a shortlink target', () => {
  assert.deepStrictEqual(readTargetShortlinks({ targets: { desktop: { releasesUrl: RELEASES } } }), []);
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

test('the targets are found by TYPE, so renamed ones still declare their shortlinks (#886)', () => {
  // A brand may name its targets anything: the curated view is keyed by NAME,
  // and only the facts say which target is the desktop one and which the
  // extension one.
  const site = siteOf({
    ...miniData,
    ...TARGETS,
    targets: {
      web: { type: 'web' },
      app: { type: 'desktop', releases: {} },
      browser: {
        type: 'extension',
        listings: { chrome: { url: 'https://chromewebstore.google.com/detail/abc' } },
      },
    },
  });

  const urls = readTargetShortlinks(site).map((entry) => entry.url);
  assert.ok(urls.includes('/download/mac'), 'the desktop target named `app` still declares its downloads');
  assert.ok(urls.includes('/extension/chrome'), 'and the extension target named `browser` its store listing');
});

let pages;
before(async () => {
  pages = await buildWith({ ...miniData, ...TARGETS }, {}, 'target-shortlinks');
});

test('every platform and store ships its shortlink, on the redirect module', () => {
  const expected = {
    '/download/mac': DOWNLOADS.mac.dmg,
    '/download/mac/dmg': DOWNLOADS.mac.dmg,
    '/download/mac/universal': DOWNLOADS.mac.dmg,
    '/download/windows': DOWNLOADS.windows.nsis,
    '/download/windows/nsis': DOWNLOADS.windows.nsis,
    '/download/linux': DOWNLOADS.linux.deb,
    '/download/linux/deb': DOWNLOADS.linux.deb,
    '/download/linux/debian': DOWNLOADS.linux.deb,
    '/download/linux/appimage': DOWNLOADS.linux.appimage,
    '/download/linux/snap': DOWNLOADS.linux.snap,
    '/extension/chrome': 'https://chromewebstore.google.com/detail/abc',
    '/extension/firefox': 'https://addons.mozilla.org/addon/minico',
    '/extension/edge': 'https://microsoftedge.microsoft.com/addons/detail/xyz',
  };

  for (const [url, redirect] of Object.entries(expected)) {
    assert.ok(pages.has(url), `${url} is generated`);
    assert.ok(pages.get(url).includes(`data-url="${redirect}"`), `${url} points at ${redirect}`);
  }

  assert.ok(pages.get('/download/mac').includes('/assets/js/layouts/modules/utilities/redirect-TEST.js'),
    'the shortlink rides the redirect layout\'s script like a hand-written one');
});

test('a shortlink is noindex and out of every machine file', () => {
  assert.ok(pages.get('/extension/chrome').includes('<meta name="robots" content="noindex'), 'the redirect layout already says noindex');

  const sitemap = pages.get('/sitemap.xml');
  const pagesJson = pages.get('/pages.json');
  for (const url of ['/download/mac', '/download/linux/appimage', '/extension/chrome']) {
    assert.ok(!sitemap.includes(`<loc>${miniData.url}${url}</loc>`), `${url} stays out of the sitemap`);
    assert.ok(!pagesJson.includes(`"${url}"`), `${url} stays out of the search index`);
  }
});

test('the hub pages read the SAME facts — one home, two consumers', () => {
  assert.ok(pages.get('/download').includes(DOWNLOADS.mac.dmg), '/download renders the same direct URLs');
  assert.ok(pages.get('/extension').includes('https://chromewebstore.google.com/detail/abc'), 'and /extension its listings');
});

test('a shortlink URL is a config-time fact, so the takeover gate can see it', () => {
  // The same lane as the socials shortlinks and the default pages: every page
  // carries its own url, which is what engine.js hands decisions.framework()
  // and what the render gate asks about. #429's suite pins the takeover itself.
  const generated = targetShortlinkPages(readTargetShortlinks(SITE));

  assert.strictEqual(generated.length, 14, 'one page per platform, format, retired segment and store');
  assert.ok(generated.every((page) => page.url && page.virtual && page.raw), 'each page names its URL, its virtual path and its source');
  assert.ok(generated.every((page) => page.raw.includes('layout: modules/utilities/redirect')), 'each rides the redirect module');
});

test('no desktop releases and no listings, no shortlinks — and nothing else moves', async () => {
  const bare = await buildWith(miniData, {}, 'target-shortlinks-none');

  assert.ok(!bare.has('/download/mac') && !bare.has('/extension/chrome'), 'nothing generated');
  assert.ok(bare.has('/download') && bare.has('/extension'), 'the hub pages still ship');
  assert.ok(bare.has('/account'), 'the framework\'s own redirect defaults are untouched');
});
