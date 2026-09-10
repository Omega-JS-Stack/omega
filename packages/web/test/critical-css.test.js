/**
 * #750 (Phase 2 of #467, item 3) — the main sheet stops render-blocking.
 *
 * `head.html` linked `assetManifest.css.main` as a plain blocking stylesheet,
 * which Lighthouse's RenderBlocking insight priced at ~548ms of mobile
 * FCP/LCP. The fix is the mechanism the pipeline lacked: the asset lane
 * extracts the FIRST-PAINT subset of the compiled main bundle (the chrome the
 * layouts render, the marketing nav, the app shell's topbar/sidebar, and the
 * hero sections), the head inlines it, and the full sheet loads through
 * `rel=preload` + an onload rel-swap with a <noscript> fallback.
 *
 * The subset is chosen by MARKUP, not by a hand-kept selector list: PurgeCSS
 * (already the pipeline's extractor) reads the first-paint templates as its
 * content. That is what keeps CLS at zero — every class the nav and the hero
 * actually render carries its rules into the inline block, the mobile menu's
 * `.collapse:not(.show)` guard included.
 *
 * A dev build ships no critical block (the dev lane never purges), so the head
 * keeps the plain blocking link there — no flash while you work.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { after, test } = require('node:test');

const { buildAssets } = require('../src/assets.js');
const { buildWith, miniData, PKG } = require('./lib/build.js');

const ROOT = path.resolve(PKG, '..', '..');
// Own the out dir per process — assets.test.js's #182 rule, same reason.
const OUT = path.join(PKG, '.omega', `critical-test-out-${process.pid}`);

after(() => {
  fs.rmSync(OUT, { recursive: true, force: true });
});

/**
 * Build ONLY the css half over the real layer chain (site → theme(s) → core).
 * @param {string[]} themeIds
 * @param {object} [overrides] - buildAssets option overrides
 * @returns {Promise<object>} manifest
 */
function buildCss(themeIds, overrides = {}) {
  const themeRoots = themeIds.map((id) => path.join(PKG, 'themes', id));
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

// A sentinel that is unmistakably OUR block wherever it lands in the page.
const CRITICAL = '.omega-nav{--critical-marker: 1}';

/**
 * The fixture asset manifest, optionally carrying a critical block. The page
 * and layout buckets are filled so the head's own per-page/per-layout links
 * are under test beside the main one.
 * @param {string} [critical]
 * @returns {object}
 */
function manifestWith(critical) {
  return {
    js: {
      main: '/assets/js/main-TEST.js',
      firstPaint: '/assets/js/first-paint-TEST.js',
      pages: {},
      layouts: { 'modules/utilities/redirect': ['/assets/js/layouts/modules/utilities/redirect-TEST.js'] },
    },
    css: {
      main: '/assets/css/main-TEST.css',
      critical,
      pages: { index: [{ href: '/assets/css/pages/index-TEST.css' }] },
      layouts: { 'frontend/core/base': [{ href: '/assets/css/layouts/frontend/core/base-TEST.css' }] },
    },
  };
}

/**
 * The mini fixture's home page, built with a given critical block.
 * @param {string|undefined} critical
 * @param {string} name - this caller's .omega output namespace
 * @returns {Promise<string>} the rendered page
 */
async function home(critical, name) {
  const pages = await buildWith(miniData, { assetManifest: manifestWith(critical) }, name);

  return pages.get('/');
}

test('#750: the css lane extracts the first-paint subset of the main bundle', async () => {
  const manifest = await buildCss(['classy', 'base']);
  const critical = manifest.css.critical;
  const main = fs.readFileSync(path.join(OUT, manifest.css.main.slice(1)), 'utf8');

  assert.ok(critical && critical.length, 'the manifest carries a critical block');

  // The token ramp: every painted surface reads --omega-*, so a token sheet
  // that arrives late repaints the whole page.
  assert.match(critical, /:root\{[^}]*--omega-ground/, 'the design tokens are critical');

  // The nav, its container, and the mobile menu's collapse guard. That guard
  // IS the CLS case: without it the mobile link list paints EXPANDED and the
  // hero drops down the moment the deferred sheet lands.
  assert.match(critical, /\.omega-nav/, 'the marketing nav is critical');
  assert.match(critical, /\.navbar-collapse/, 'and its collapse wrapper');
  assert.match(critical, /\.collapse:not\(\.show\)/, 'a collapsed mobile menu never paints open');
  assert.match(critical, /\.container\{/, 'the container the nav and the hero both sit in');

  // The hero box model, and the shell chrome an app page paints first.
  assert.match(critical, /\.omega-hero/, 'the hero is critical');
  assert.match(critical, /\.omega-shell/, 'so is the app shell chrome');

  // Faces are preloaded in the head; their @font-face declarations have to
  // ride along or the first paint uses a fallback face and reflows on swap.
  // A real declaration names a woff2 source: PurgeCSS's face pruning cannot
  // follow a family through `var(--omega-font-*)`, so it stripped every face
  // down to an empty `@font-face{font-display:auto}` (#467 head verify).
  assert.match(critical, /@font-face\{[^}]*\.woff2/, 'the first-paint faces are declared inline, sources included');

  // The bands #467 moved onto the first-paint lane (about, contact, pricing,
  // download, the minimal document masthead) paint with the document, so
  // their h1 sizing is critical too or the headline paints at the UA size
  // and jumps when the deferred sheet lands.
  assert.match(critical, /\.omega-display--page\{/, 'the masthead h1 sizing is critical');
  assert.match(critical, /\.omega-dl-hero/, 'the download hero box model is critical');

  // The skip link body.html renders BEFORE every band. Unstyled, it is a 23 px
  // line of text above the band, and the whole page jumps up when the deferred
  // sheet lands (a 0.27 CLS on the playground home, #763 proof). The alert bars
  // beside it are `hidden`, so they never paint early and stay out.
  assert.match(critical, /\.visually-hidden-focusable:not\(:focus\)/, 'the skip link is hidden from first paint');
  assert.ok(!critical.includes('.main-alert'), 'the hidden alert bars are not first paint');

  // The dotfield module creates its canvas at runtime, so the class is never
  // in markup for the scan to find. Without its positioning rule the canvas
  // lands IN FLOW (150 px) whenever the module beats the deferred sheet, and
  // the hero copy drops by that much (#763 proof).
  assert.match(critical, /\.omega-dotfield__canvas\{[^}]*position:\s*absolute/, 'the runtime canvas is positioned from first paint');

  // …and it stays a SUBSET: below-the-fold vocabulary waits for the deferred
  // sheet, which is what makes inlining affordable at all.
  for (const below of ['modal-exit-avatar', 'omega-receipt', 'accordion']) {
    assert.ok(main.includes(below), `${below} ships in the full sheet`);
    assert.ok(!critical.includes(below), `${below} is not first paint`);
  }
});

test('#763: the critical block carries the reveal lane, or the first-paint fade has no starting state', async () => {
  const manifest = await buildCss(['classy', 'base']);
  const critical = manifest.css.critical;

  // Every reveal rule is scoped `html[data-omega-motion] …`, and NOTHING in the
  // content set carries that token — the head's inline script stamps it and the
  // engine stamps `data-omega-inview`, neither of which a markup scan can see.
  // So the extractor purged the whole lane, and on a built site the copy painted
  // VISIBLE, the starter stamped it, and the deferred sheet arrived to an
  // already-stamped element: the fade never ran (proven in a browser on #763).
  // The hide rule IS the transition's starting state, so it has to be inline.
  assert.match(critical, /html\[data-omega-motion\] \[data-omega-reveal\]\s*\{[^}]*opacity:\s*0/,
    'the reveal lane starts hidden, in the inline block');
  assert.match(critical, /html\[data-omega-motion\] \[data-omega-reveal\]\s*\{[^}]*transition:/,
    'and carries the transition that makes it a fade rather than a swap');
  assert.match(critical, /transition-delay:\s*var\(--omega-reveal-delay/,
    'including the custom property the starter writes the stagger into');
  assert.match(critical, /\[data-omega-reveal\]\[data-omega-inview\]\s*\{[^}]*opacity:\s*1/,
    'and the stamp that resolves it');

  // The lane is safelisted NARROWLY: the site-wide greedy `omega-` pattern would
  // drag every section's styles into the block, which is the thing #750 buys.
  for (const below of ['modal-exit-avatar', 'omega-receipt', 'accordion']) {
    assert.ok(!critical.includes(below), `${below} is still not first paint`);
  }
});

test('#768: the inline block carries the metric-matched fallback faces', async () => {
  // The block and the deferred sheet have to AGREE about the fallback, or the
  // first paint sets the text in one face and the sheet's arrival re-sets it
  // in another, the exact shift #768 removes. The transform runs before the
  // extractor for that reason, and `fontFace: false` keeps every face.
  const manifest = await buildCss(['classy', 'base']);
  const critical = manifest.css.critical;

  assert.ok(
    critical.includes('@font-face{font-family:"Inter Fallback";src:local("Helvetica Neue"),local("Arial");size-adjust:'),
    'the generated face is inlined with the rest',
  );
  assert.ok(critical.includes('@font-face{font-family:"Newsreader Fallback";src:local("Georgia"),local("Times New Roman");size-adjust:'));
  assert.ok(
    critical.includes('--omega-font-ui: \'Inter\', "Inter Fallback", -apple-system'),
    'and the stack the first paint reads names it',
  );
});

test('#750: the inline block stays under the stated ceiling', async () => {
  // The heaviest packaged theme is the one that would breach first (#763)
  const manifest = await buildCss(['newsflash', 'base']);
  const bytes = Buffer.byteLength(manifest.css.critical);
  const mainBytes = fs.statSync(path.join(OUT, manifest.css.main.slice(1))).size;

  // 72 KiB, the lane's CRITICAL_MAX_BYTES. It is a WIRE budget: the packaged
  // themes measure 64-71 KB, which gzip to 12-15 KB — about one initial
  // congestion window, arriving WITH the HTML instead of costing a second
  // round trip. Past that the inline block stops being cheaper than the
  // request it replaces, and the lane warns.
  assert.ok(bytes < 72 * 1024, `the critical block is ${bytes} bytes, under the 73728-byte ceiling`);
  assert.ok(bytes < mainBytes / 2, `${bytes} bytes is a fraction of the ${mainBytes}-byte sheet it defers`);
});

test('#750: a dev build ships no critical block, so its head stays blocking', async () => {
  const manifest = await buildCss(['classy', 'base'], { dev: true, outDir: path.join(OUT, 'dev') });

  assert.equal(manifest.css.critical, '', 'dev skips the extraction (the dev lane never purges either)');
});

test('#750: the head inlines the critical block and defers the main sheet', async () => {
  const page = await home(CRITICAL, 'critical-inline-test');

  assert.ok(page.includes(`<style>${CRITICAL}</style>`), 'the critical block is inlined verbatim');

  // The main sheet loads through preload + an onload rel-swap. The <link>
  // keeps its document position, so the cascade order never moves.
  assert.match(
    page,
    /<link rel="preload" as="style" href="\/assets\/css\/main-TEST\.css" onload="this\.onload=null;this\.rel='stylesheet'"\/>/,
    'the main sheet is preloaded and swapped in on load',
  );
  assert.match(
    page,
    /<noscript><link rel="stylesheet" type="text\/css" href="\/assets\/css\/main-TEST\.css"\/><\/noscript>/,
    'a JS-less visitor still gets the sheet',
  );

  // …and nowhere else: a blocking copy outside <noscript> would undo the fix.
  const scripted = page.replace(/<noscript>[\s\S]*?<\/noscript>/g, '');
  assert.ok(
    !/<link rel="stylesheet"[^>]*main-TEST\.css/.test(scripted),
    'the main sheet never render-blocks',
  );

  // The per-layout and per-page sheets keep their own lane: these two are
  // over the inline budget (#767), so they stay page-scoped blocking links
  // behind the deferred main sheet.
  assert.ok(
    scripted.includes('<link rel="stylesheet" type="text/css" href="/assets/css/layouts/frontend/core/base-TEST.css"/>'),
    'the layout sheet still links plainly',
  );
  assert.ok(
    scripted.includes('<link rel="stylesheet" type="text/css" href="/assets/css/pages/index-TEST.css"/>'),
    'and so does the page sheet',
  );

  // Order: the inline block paints first, then the deferred main sheet, then
  // the page-scoped sheets that decorate it.
  assert.ok(page.indexOf(CRITICAL) < page.indexOf('rel="preload" as="style"'), 'the critical block comes first');
  assert.ok(
    page.indexOf('rel="preload" as="style"') < page.indexOf('/assets/css/pages/index-TEST.css'),
    'the main sheet keeps its place ahead of the page sheets',
  );
});

test('#750: without a critical block the main sheet stays a plain blocking link', async () => {
  const page = await home('', 'critical-dev-head-test');

  assert.ok(
    page.includes('<link rel="stylesheet" type="text/css" href="/assets/css/main-TEST.css"/>'),
    'the head falls back to the blocking link',
  );
  assert.ok(!page.includes('rel="preload" as="style"'), 'no deferral without an inline block to paint from');
  assert.ok(!page.includes('<noscript><link rel="stylesheet"'), 'and no noscript twin');
});
