/**
 * #467 (Phase 2, item 2) — the VISIBLE logo prefers the bridged svg.
 *
 * `brand.images.brandmark` is a RASTER by contract: the manager's payment
 * service hands that same URL to Stripe/PayPal as the product image, and
 * OG/social cards need a raster too. So the config value never moves. What
 * moves is the read: the manager's assets service mints `color-x.svg` beside
 * the png ladder and web's static bridge ships BOTH
 * (`assets/images/brand/brandmark.{svg,png}`), so every template that renders
 * the VISIBLE lockup — nav, footer, the app sidebar, the auth cards, the app
 * launch mark, the checkout head, the email-preferences portal, the extension
 * installed page and the download page's cards — takes the svg when the mint
 * produced one and falls back to the configured raster when it did not.
 *
 * "When the mint produced one" is a BUILD-TIME fact, resolved exactly the way
 * the favicon links already resolve theirs (`hasFaviconSet`): the static lane
 * reports what it is about to ship, the build records it on the asset
 * manifest, and the template reads `assetManifest.brandmarkSvg`. No config
 * key, and no template guessing a filename it never saw on disk.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const jetpack = require('fs-jetpack');

const { resolveStaticDirs, brandmarkSvgUrl } = require('../src/static-assets.js');
const { buildSite, buildWith, miniData, MINI, PKG } = require('./lib/build.js');

const SVG_URL = '/assets/images/brand/brandmark.svg';
const PNG_URL = '/assets/images/brand/brandmark.png';

// The mini fixture with a configured RASTER brandmark — the shape every
// in-repo brand config ships.
const rasterData = { ...miniData, brand: { ...miniData.brand, images: { brandmark: PNG_URL } } };

/**
 * The fixture asset manifest, optionally carrying the bridged svg url
 * (critical-css.test.js's manifestWith, same reason: the head's own links
 * ride along so nothing else in the page changes between cases).
 * @param {string|null} [brandmarkSvg]
 * @returns {object}
 */
function manifestWith(brandmarkSvg) {
  return {
    js: {
      main: '/assets/js/main-TEST.js',
      firstPaint: '/assets/js/first-paint-TEST.js',
      pages: {},
      layouts: { 'modules/utilities/redirect': ['/assets/js/layouts/modules/utilities/redirect-TEST.js'] },
    },
    css: { main: '/assets/css/main-TEST.css', pages: {}, layouts: {} },
    brandmarkSvg: brandmarkSvg || null,
  };
}

/** The nav's brand `<img src>` (cachebreak query stripped). */
function navLogo(html) {
  const match = html.match(/<a class="navbar-brand omega-nav__brand[^"]*"[^>]*>\s*<img src="([^"?]+)/);
  assert.ok(match, 'the nav renders a brand image');
  return match[1];
}

/** The footer's brand image url — lazy-mounted, so it rides `data-lazy`. */
function footerLogo(html) {
  const match = html.match(/<footer class="omega-footer[\s\S]*?data-lazy="@src ([^"]+)"/);
  assert.ok(match, 'the footer renders a brand image');
  return match[1];
}

/** The auth card's brand `<img src>` — signin/signup/reset/token and the connections callback share it. */
function authLogo(html) {
  const match = html.match(/omega-auth__brand">\s*<img src="([^"?]+)/);
  assert.ok(match, 'the auth card renders a brand image');
  return match[1];
}

/** The checkout head's brand `<img src>` (our own page chrome, not the provider's product image). */
function checkoutLogo(html) {
  const match = html.match(/omega-checkout__brand"[\s\S]*?<img src="([^"?]+)/);
  assert.ok(match, 'the checkout head renders a brand image');
  return match[1];
}

/** A download-page brandmark url — lazy-mounted like the footer's, so it rides `data-lazy`. */
function downloadLogo(html) {
  const match = html.match(/data-lazy="@src ([^"]+)" class="brandmark"/);
  assert.ok(match, 'the download page renders a brand image');
  return match[1];
}

/** The redirect chrome's brand mark (core/_layouts/modules/utilities/redirect.html). */
function redirectLogo(html) {
  const match = html.match(/class="omega-redirect__mark"[^>]*>\s*<img src="([^"?]+)/);
  assert.ok(match, 'the redirect page renders its brand mark');
  return match[1];
}

/** Every mini page for a given manifest brandmark value. */
function sitePages(brandmarkSvg, name, siteData = rasterData) {
  return buildWith(siteData, { assetManifest: manifestWith(brandmarkSvg) }, name);
}

/** The mini fixture's home page for a given manifest brandmark value. */
async function home(brandmarkSvg, name, siteData = rasterData) {
  const pages = await sitePages(brandmarkSvg, name, siteData);

  return pages.get('/');
}

// ─── The build-time fact ─────────────────────────────────────────────────────

/** A brand root whose mint output is seeded by `files` (path → contents). */
function mintRoot(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-web-brandmark-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  for (const [relative, contents] of Object.entries(files)) jetpack.write(path.join(root, relative), contents);

  return root;
}

test('#467: the static lane reports the bridged svg url when the mint produced one', (t) => {
  const root = mintRoot(t, {
    '.omega/assets/logo/brandmark/color-x.svg': '<svg/>',
    '.omega/assets/logo/brandmark/color-512.png': 'png',
  });

  const dirs = resolveStaticDirs({ brandRoot: root, assetsDir: path.join(root, 'src', 'assets') });

  assert.equal(brandmarkSvgUrl(dirs), SVG_URL);
});

test('#467: a mint with only the raster ladder reports nothing', (t) => {
  const root = mintRoot(t, { '.omega/assets/logo/brandmark/color-512.png': 'png' });

  const dirs = resolveStaticDirs({ brandRoot: root, assetsDir: path.join(root, 'src', 'assets') });

  assert.equal(brandmarkSvgUrl(dirs), null, 'no svg on disk, no url');
});

test("#467: a consumer's own src/assets svg counts — it wins the same collision", (t) => {
  const root = mintRoot(t, { 'src/assets/images/brand/brandmark.svg': '<svg/>' });

  const dirs = resolveStaticDirs({ brandRoot: null, assetsDir: path.join(root, 'src', 'assets') });

  assert.equal(brandmarkSvgUrl(dirs), SVG_URL);
});

// ─── The read ────────────────────────────────────────────────────────────────

test('#467: nav and footer take the bridged svg when the mint produced one', async () => {
  const html = await home(SVG_URL, 'brandmark-svg-present');

  assert.equal(navLogo(html), SVG_URL, 'nav logo is the vector');
  assert.equal(footerLogo(html), SVG_URL, 'footer logo is the vector');
});

test('#467: no minted svg → both fall back to the configured raster', async () => {
  const html = await home(null, 'brandmark-svg-absent');

  assert.equal(navLogo(html), PNG_URL, 'nav logo is the configured raster');
  assert.equal(footerLogo(html), PNG_URL, 'footer logo is the configured raster');
});

test('#467: the config value stays the raster — OG and payment still read it', async () => {
  const html = await home(SVG_URL, 'brandmark-svg-og');

  const og = html.match(/<meta property="og:image" content="([^"?]+)/);
  assert.ok(og, 'the page carries an og:image');
  assert.equal(og[1], `${miniData.url}${PNG_URL}`, 'social cards keep the raster');
});

test('#467: a section-data logo.src still outranks both', async (t) => {
  // The fixture copy lives UNDER cwd: Eleventy matches its `**/_layouts/**`
  // ignores against cwd-relative paths, and a `../../`-relative input dir
  // slips past them (the farm gotcha engine.js documents).
  const root = path.join(PKG, '.omega', `brandmark-override-site-${process.pid}`);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  jetpack.copy(MINI, root, { overwrite: true });
  for (const section of ['nav', 'footer']) {
    jetpack.write(
      path.join(root, '_includes', 'frontend', 'sections', `${section}.json`),
      JSON.stringify({ logo: { src: '/custom/mark.svg', href: '/', text: 'MiniCo' } }),
    );
  }

  const pages = await buildSite(root, rasterData, { assetManifest: manifestWith(SVG_URL) }, 'brandmark-svg-override');
  const html = pages.get('/');

  assert.equal(navLogo(html), '/custom/mark.svg', 'the authored nav logo wins');
  assert.equal(footerLogo(html), '/custom/mark.svg', 'the authored footer logo wins');
});

// ─── The rest of the visible lockups ─────────────────────────────────────────

test('#467: the other visible lockups take the bridged svg too', async () => {
  const pages = await sitePages(SVG_URL, 'brandmark-svg-lockups');

  assert.equal(authLogo(pages.get('/signin')), SVG_URL, 'the auth card is the vector');
  assert.equal(checkoutLogo(pages.get('/payment/checkout')), SVG_URL, 'the checkout head is the vector');
  assert.equal(downloadLogo(pages.get('/download')), SVG_URL, 'the download cards are the vector');
  assert.equal(redirectLogo(pages.get('/careers')), SVG_URL, 'the redirect chrome mark is the vector');
});

test('#467: and every one of them falls back to the configured raster', async () => {
  const pages = await sitePages(null, 'brandmark-svg-lockups-absent');

  assert.equal(authLogo(pages.get('/signin')), PNG_URL, 'the auth card is the configured raster');
  assert.equal(checkoutLogo(pages.get('/payment/checkout')), PNG_URL, 'the checkout head is the configured raster');
  assert.equal(downloadLogo(pages.get('/download')), PNG_URL, 'the download cards are the configured raster');
  assert.equal(redirectLogo(pages.get('/careers')), PNG_URL, 'the redirect chrome mark is the configured raster');
});
