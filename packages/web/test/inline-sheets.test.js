/**
 * #767: small page and layout sheets ship INLINE instead of blocking.
 *
 * #750 took the main sheet off the render path, but every per-page and
 * per-layout sheet stayed a plain blocking `<link>`. The #763 proof measured
 * what that costs even when the sheet is tiny: `/terms` (a 1 KB page sheet)
 * first-painted at 1,928 ms against the home page's 824 ms, because the
 * request queues behind the HTML and the font preloads and the round trip
 * costs about a second whatever the size.
 *
 * So a compiled sheet at or under `INLINE_MAX_BYTES` becomes a `<style>` block
 * in the exact document position its link held: same bytes, same order, no
 * request. Over the budget the sheet keeps its hashed file and its link, and
 * `omega dev` keeps every link (a stable blocking link is what keeps a watch
 * rebuild flash-free, the same reason #750 exempts dev).
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { after, test } = require('node:test');

const { buildAssets } = require('../src/assets.js');
const { buildWith, miniData, PKG } = require('./lib/build.js');

const ROOT = path.resolve(PKG, '..', '..');
// Own the out dir per process (assets.test.js's #182 rule, same reason).
const OUT = path.join(PKG, '.omega', `inline-sheets-test-out-${process.pid}`);

after(() => {
  fs.rmSync(OUT, { recursive: true, force: true });
});

/**
 * Build ONLY the css half over the real layer chain (site → theme(s) → core).
 * @param {object} [overrides] - buildAssets option overrides
 * @returns {Promise<object>} manifest
 */
function buildCss(overrides = {}) {
  const themeRoots = [path.join(PKG, 'themes', 'classy'), path.join(PKG, 'themes', 'base')];

  return buildAssets({
    layers: [path.join(__dirname, 'fixtures', 'site-assets'), ...themeRoots, path.join(PKG, 'core')],
    themeRoots,
    sectionRoots: [path.join(__dirname, 'fixtures', 'site-assets'), ...themeRoots],
    themesDir: path.join(PKG, 'themes'),
    coreDir: path.join(PKG, 'core'),
    outDir: OUT,
    clientEntry: path.join(ROOT, 'packages', 'client', 'src', 'index.js'),
    only: 'css',
    ...overrides,
  });
}

/**
 * The fixture asset manifest: one inline layout sheet, and a page key carrying
 * an inline sheet ahead of an over-budget linked one (the mixed bucket: the
 * cascade order inside a key has to survive the split).
 * @returns {object}
 */
function manifestWith() {
  return {
    js: {
      main: '/assets/js/main-TEST.js',
      firstPaint: '/assets/js/first-paint-TEST.js',
      pages: {},
      layouts: {},
    },
    css: {
      main: '/assets/css/main-TEST.css',
      critical: '',
      pages: { index: [{ inline: '.page-inline-probe{color:red}' }, { href: '/assets/css/pages/index-TEST.css' }] },
      layouts: { 'frontend/core/base': [{ inline: '.layout-inline-probe{color:blue}' }] },
    },
  };
}

test('#767: a page sheet under the budget rides the manifest as css text, with no file behind it', async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  const manifest = await buildCss();

  const [sheet] = manifest.css.pages['inline-probe/index'];
  assert.ok(sheet.inline.includes('.consumer-inline-probe'), 'the compiled css itself is in the manifest');
  assert.ok(!sheet.href, 'and no url, because there is nothing to request');
  // The fixture carries `content: "</style>"`: printed raw, that closes the
  // head's block early and the rest of the sheet lands in the page as markup.
  assert.ok(!sheet.inline.includes('</style'), 'a `</style` inside the sheet cannot close the inline block');
  assert.ok(sheet.inline.includes('<\\/style'), 'it is css-escaped, the same way the critical block escapes it');
  assert.ok(
    !fs.existsSync(path.join(OUT, 'assets', 'css', 'pages', 'inline-probe')),
    'nothing was emitted for it either: an unlinked file is dead weight in dist',
  );

  // The bytes are the ones the file would have carried: the same compressed
  // pipeline output, base path applied, not a second-class copy.
  assert.ok(!sheet.inline.includes('\n'), 'minified exactly as the emitted file is');
});

test('#767: a page sheet over the budget keeps its hashed file and its link', async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  const manifest = await buildCss();

  const [sheet] = manifest.css.pages['bulky-probe/index'];
  assert.ok(!sheet.inline, 'past the budget the css text never enters the manifest');
  assert.match(
    sheet.href,
    /^\/assets\/css\/pages\/bulky-probe\/index\.site-[a-f0-9]{8}\.css$/,
    'it is an ordinary content-hashed sheet',
  );

  const css = fs.readFileSync(path.join(OUT, sheet.href.slice(1)), 'utf8');
  assert.ok(css.includes('.consumer-bulky-probe-1'), 'and the file holds the compiled sheet');
  assert.ok(Buffer.byteLength(css) > 8 * 1024, `the fixture is over the 8 KB budget (${Buffer.byteLength(css)} bytes)`);
});

test('#767: a dev build inlines nothing, so every sheet stays a stable link', async () => {
  const manifest = await buildCss({ dev: true, outDir: path.join(OUT, 'dev') });

  for (const key of ['inline-probe/index', 'bulky-probe/index']) {
    for (const sheet of manifest.css.pages[key]) {
      assert.ok(!sheet.inline, `${key} is not inlined in dev`);
      assert.ok(sheet.href, `${key} keeps a url a watch rebuild can replace in place`);
    }
  }
});

test('#767: the head inlines the sheet in the position its link held', async () => {
  const pages = await buildWith(miniData, { assetManifest: manifestWith() }, 'inline-sheets-head-test');
  const page = pages.get('/');

  assert.ok(page.includes('<style>.layout-inline-probe{color:blue}</style>'), 'the layout sheet is inlined verbatim');
  assert.ok(page.includes('<style>.page-inline-probe{color:red}</style>'), 'and so is the page sheet');
  assert.ok(
    page.includes('<link rel="stylesheet" type="text/css" href="/assets/css/pages/index-TEST.css"/>'),
    'the over-budget sheet beside it still links',
  );

  // Position is the whole point: an inline block that moves changes the
  // cascade. Main sheet, then the layout sheets, then the page sheets in
  // layer order, which is the order the links held.
  const main = page.indexOf('/assets/css/main-TEST.css');
  const layout = page.indexOf('.layout-inline-probe');
  const pageInline = page.indexOf('.page-inline-probe');
  const pageLink = page.indexOf('/assets/css/pages/index-TEST.css');
  assert.ok(main < layout, 'the main sheet keeps its place ahead of the layout sheets');
  assert.ok(layout < pageInline, 'the layout sheet still comes before the page sheet');
  assert.ok(pageInline < pageLink, 'and the inline sheet keeps its place ahead of the layer that follows it');
});
