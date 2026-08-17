/**
 * C3 two-tier theming mechanics.
 *
 * Tier 1 — consumer main.scss over the stock theme: the consumer's entry
 * wins the layered lookup, `@use 'omega:main' with (…)` pulls and CONFIGURES
 * the whole chain below it (the migrated UJM customization pattern), and the
 * consumer's own rules land last so they win the cascade.
 *
 * Tier 2 — consumer-local FULL theme: `<consumer>/themes/<id>` beats the
 * packaged theme for the same id (resolveThemeLayers), its layouts win the
 * farm, and pages it doesn't cover fall through to the base layer.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const sass = require('sass');

const { collectLayered, resolveThemeLayers } = require('../src/layers.js');
const { consumerPaths } = require('../src/consumer.js');
const { resolveAssetThemeLayers } = require('../src/commands/dev.js');
const { buildAssets, layeredFileImporter, sectionsImporter } = require('../src/assets.js');
const { checkThemeVocabulary } = require('../src/theme-vocabulary.js');
const { buildWith: sharedBuildWith, miniData, MINI, PKG } = require('./lib/build.js');

// Namespace this file's Eleventy output dirs (test files run concurrently)
const buildWith = (siteData, overrides) => sharedBuildWith(siteData, overrides, 'themes-test');

const THEMING = path.join(__dirname, 'fixtures', 'theming');

// ─── resolveThemeLayers ──────────────────────────────────────────────────────

test('resolveThemeLayers: consumer-local theme wins; packaged is the fallback; base always present', () => {
  const themesDir = path.join(PKG, 'themes');

  // mini-site ships themes/toy → consumer-local dir wins for 'toy'
  const local = resolveThemeLayers({ activeTheme: 'toy', consumerDir: MINI, themesDir });
  assert.deepEqual(local, [
    path.join(MINI, 'themes', 'toy'),
    path.join(themesDir, 'base'),
  ]);

  // no consumer-local dir for 'newsflash' → packaged theme
  const packaged = resolveThemeLayers({ activeTheme: 'newsflash', consumerDir: MINI, themesDir });
  assert.deepEqual(packaged, [
    path.join(themesDir, 'newsflash'),
    path.join(themesDir, 'base'),
  ]);

  // classy is a skin like the others (#177): it rides over base too
  assert.deepEqual(resolveThemeLayers({ activeTheme: 'classy', consumerDir: MINI, themesDir }), [path.join(themesDir, 'classy'), path.join(themesDir, 'base')]);
  assert.deepEqual(resolveThemeLayers({ themesDir }), [path.join(themesDir, 'classy'), path.join(themesDir, 'base')]);
});

test('the dev asset lane resolves the consumer-local theme the engine renders (#137)', () => {
  // A brand's own theme lives at src/themes/<id> — the engine, the production
  // build, and customize all probe the Eleventy INPUT dir. The dev asset lane
  // must probe the same place, or the theme's scss/js never enters the bundle
  // and its dir never enters the asset watcher.
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-dev-assets-')));
  const themeDir = path.join(root, 'src', 'themes', 'toy-theme');
  fs.mkdirSync(path.join(themeDir, 'css'), { recursive: true });
  fs.writeFileSync(path.join(themeDir, 'css', 'main.scss'), '.toy { color: red; }');

  try {
    const layers = resolveAssetThemeLayers(consumerPaths(root), 'toy-theme');

    assert.deepEqual(layers, [themeDir, path.join(PKG, 'themes', 'base')]);
    // The consequence: the theme's stylesheet is what the css lane compiles.
    assert.equal(
      collectLayered(layers.map((layer) => path.join(layer, 'css')), /^main\.scss$/).get('main.scss'),
      path.join(themeDir, 'css', 'main.scss'),
      'the consumer-local theme wins the asset lane\'s main.scss lookup',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ─── Tier 1: consumer main.scss over the stock chain ─────────────────────────

test('tier 1: consumer main.scss pulls, configures, and overrides the chain via omega:main', () => {
  const consumerRoot = path.join(THEMING, 'consumer');
  const layers = [consumerRoot, path.join(THEMING, 'mini-theme'), path.join(PKG, 'core')];

  const warnings = [];
  const css = sass.compile(path.join(consumerRoot, 'css', 'main.scss'), {
    importers: [layeredFileImporter(layers), sectionsImporter([])],
    loadPaths: layers,
    quietDeps: true,
    silenceDeprecations: ['import', 'global-builtin', 'color-functions', 'legacy-js-api'],
    logger: { warn: (message) => warnings.push(message), debug: () => {} },
  }).css;

  assert.ok(css.includes('--omega-ground'), 'core token sheet came through the chain');
  assert.ok(css.includes('--mini-theme-marker'), 'theme layer resolved via omega:theme');
  assert.ok(css.includes('--mini-color: blue'), '`with (…)` configured the theme variable through core\'s @forward');
  assert.ok(css.includes('--tier1-marker'), 'consumer rules present');
  assert.ok(
    css.indexOf('--tier1-marker') > css.indexOf('--omega-ground'),
    'consumer rules land AFTER the chain so they win the cascade',
  );
  assert.deepEqual(warnings, [], 'tier-1 compile stays warning-free');
});

// ─── The inheritance hatch (cp190): partial theme @forwards omega:theme ─────

test('inheritance hatch: a partial theme @forwards omega:theme and inherits the classy chain (cp190)', () => {
  const partialRoot = path.join(THEMING, 'partial-theme');
  const layers = [partialRoot, path.join(PKG, 'themes', 'base'), path.join(PKG, 'core')];

  const css = sass.compile(path.join(partialRoot, '_theme.scss'), {
    importers: [layeredFileImporter(layers), sectionsImporter([])],
    loadPaths: layers,
    quietDeps: true,
    silenceDeprecations: ['import', 'global-builtin', 'color-functions', 'legacy-js-api'],
    logger: { warn: () => {}, debug: () => {} },
  }).css;

  // The self-skip landed the @forward on base, whose bridge emits classy
  assert.ok(css.includes('.omega-auth'), 'classy auth vocabulary inherited');
  assert.ok(css.includes('.omega-statgrid'), 'classy app vocabulary inherited');
  assert.ok(css.includes('--bs-body-bg: var(--omega-ground)'), 'classy token bridge inherited');

  // The partial theme's own rules land AFTER the chain so they win ties
  assert.ok(css.includes('--partial-marker'), 'partial theme rules present');
  assert.ok(
    css.indexOf('--partial-marker') > css.lastIndexOf('.omega-statgrid'),
    'partial rules land after the inherited chain',
  );
});

// ─── Per-component knobs (#253): the hatch's `with (…)` re-shapes classy ────

test('hatch knobs: a partial theme re-values classy\'s per-component type + shape through `with (…)` (#253)', () => {
  // A brand with its own shape/type identity configures classy ONLY through
  // the hatch. Two of the surfaces below are what #253 actually unlocked:
  // classy's OWN css HARDCODED them (`_typography.scss` heading font,
  // `_forms.scss` input-group radii), so no `with (…)` value could reach them
  // until they became !default slots those rules read. The other seven already
  // flowed through Bootstrap's own !defaults before #253 and stay as
  // REGRESSION PINS — classy declaring + forwarding its own slots must not
  // sever the path they were already riding.
  const knobsRoot = path.join(THEMING, 'knobs-theme');
  const layers = [knobsRoot, path.join(PKG, 'themes', 'base'), path.join(PKG, 'core')];

  const css = sass.compile(path.join(knobsRoot, '_theme.scss'), {
    importers: [layeredFileImporter(layers), sectionsImporter([])],
    loadPaths: layers,
    quietDeps: true,
    silenceDeprecations: ['import', 'global-builtin', 'color-functions', 'legacy-js-api'],
    logger: { warn: () => {}, debug: () => {} },
  }).css;

  // THE FIX (1/2) — type: classy's OWN heading rule (the one that lands after
  // Bootstrap's) reads the knob, so the brand face survives to the compiled
  // output. Before #253 this rule said `var(--omega-font-display)` outright.
  const headings = css.match(/\nh1, \.h1,[\s\S]*?\{([\s\S]*?)\}/);
  assert.ok(headings, 'classy\'s heading rule is present');
  assert.match(headings[1], /font-family: "Knobtest Display";/, '$headings-font-family reached classy\'s heading rule');

  // THE FIX (2/2) — shape: the input-group composition reads
  // $input-border-radius, so a re-shaped field stays consistent with the
  // standalone .form-control. Before #253 it read the global $border-radius.
  const inputGroup = css.match(/\n\.input-group > \.form-control,\n\.input-group > \.form-control\.is-invalid,[\s\S]*?\{([\s\S]*?)\}/);
  assert.ok(inputGroup, 'classy\'s input-group rule is present');
  assert.match(inputGroup[1], /border-radius: 4\.0404px;/, '$input-border-radius reached classy\'s input-group rule');

  // PINS — the seven that already worked: each reaches a Bootstrap component
  // variable, one surface each, none of them moving the global $border-radius
  // family.
  for (const [property, value] of [
    ['--bs-btn-border-radius', '3.0404px'],
    ['--bs-badge-border-radius', '7.0707px'],
    ['--bs-toast-border-radius', '6.0606px'],
    ['--bs-modal-border-radius', '5.0505px'],
  ]) {
    assert.ok(css.includes(`${property}: ${value};`), `${property} carries the override`);
  }
  assert.ok(css.includes('border-radius: 3.0202px'), '$btn-border-radius-sm reached the small button');
  assert.ok(css.includes('border-radius: 4.0606px'), '$input-border-radius-lg reached the large field');

  // Untouched knobs keep classy's shape (10px buttons/inputs are the default).
  assert.ok(css.includes('--bs-border-radius: 0.625rem'), 'the global radius family is unmoved');
});

test('stock classy: the two surfaces #253 re-slotted still emit classy\'s own look unconfigured', () => {
  // The knobs fixture can only prove an override ARRIVES. Nobody configures
  // stock classy, so the same two rules are where a #253-style re-slot silently
  // changes what every unconfigured brand ships — pin their stock output.
  const layers = [path.join(PKG, 'themes', 'classy'), path.join(PKG, 'themes', 'base'), path.join(PKG, 'core')];
  const css = sass.compile(path.join(PKG, 'themes', 'classy', '_theme.scss'), {
    importers: [layeredFileImporter(layers), sectionsImporter([])],
    loadPaths: layers,
    quietDeps: true,
    silenceDeprecations: ['import', 'global-builtin', 'color-functions', 'legacy-js-api'],
    logger: { warn: () => {}, debug: () => {} },
  }).css;

  // Type: the heading face is still the runtime token, so data-omega-type
  // presets and a plain-CSS re-point keep steering headings with no recompile.
  const headings = css.match(/\nh1, \.h1,[\s\S]*?\{([\s\S]*?)\}/);
  assert.ok(headings, 'classy\'s heading rule is present');
  assert.match(headings[1], /font-family: var\(--omega-font-display\);/, 'stock headings still ride --omega-font-display');

  // Shape: the input-group still rides the --bs- radius ramp, which classy
  // values at 10px — the standalone .form-control's radius, unchanged.
  const inputGroup = css.match(/\n\.input-group > \.form-control,\n\.input-group > \.form-control\.is-invalid,[\s\S]*?\{([\s\S]*?)\}/);
  assert.ok(inputGroup, 'classy\'s input-group rule is present');
  assert.match(inputGroup[1], /border-radius: var\(--bs-border-radius\);/, 'stock input-group rides the --bs- radius ramp');
  assert.ok(css.includes('--bs-border-radius: 0.625rem'), 'and that ramp still computes to classy\'s 10px');
});

// ─── The fall-through guard (#98): a theme that reached NEITHER lane warns ───

// The compiled main bundle for a theme root of any provenance (fixture dirs
// included — the shipped chain always sits under it).
function compileMain(themeRoot) {
  const layers = [themeRoot, path.join(PKG, 'themes', 'base'), path.join(PKG, 'core')];
  return sass.compile(path.join(PKG, 'core', 'css', 'main.scss'), {
    importers: [layeredFileImporter(layers), sectionsImporter([])],
    loadPaths: layers,
    quietDeps: true,
    silenceDeprecations: ['import', 'global-builtin', 'color-functions', 'legacy-js-api'],
    logger: { warn: () => {}, debug: () => {} },
  }).css;
}

test('fall-through guard: a hatchless partial theme warns and names the inheritance hatch (#98)', () => {
  const themeRoot = path.join(THEMING, 'hatchless-theme');
  const warnings = [];
  const result = checkThemeVocabulary({
    css: compileMain(themeRoot),
    themeRoots: [themeRoot, path.join(PKG, 'themes', 'base')],
    warn: (message) => warnings.push(message),
  });

  assert.equal(warnings.length, 1, 'exactly one warning block per build');
  assert.deepEqual(result, {
    theme: 'hatchless-theme',
    lane: 'hatch',
    missing: ['.omega-auth', '.omega-statgrid', '.omega-footer'],
  });

  const block = warnings[0];
  assert.ok(block.includes('theme "hatchless-theme"'), 'names the theme');
  assert.ok(block.includes('.omega-auth (pages/auth'), 'names the missing sentinel and its partial');
  assert.ok(block.includes('inheritance hatch'), 'names the missing piece');
  assert.ok(block.includes("@forward 'omega:theme';"), 'carries the exact fix line');
  assert.ok(block.includes('themes/hatchless-theme/_theme.scss'), 'names the file to edit');
  assert.ok(block.includes('docs/shared/theming.md'), 'points at the contract');
});

test('fall-through guard: a sibling theme with its own Bootstrap is sent to the floor imports (#98)', () => {
  const themeRoot = path.join(THEMING, 'floorless-theme');
  const warnings = [];
  const result = checkThemeVocabulary({
    css: compileMain(themeRoot),
    themeRoots: [themeRoot, path.join(PKG, 'themes', 'base')],
    warn: (message) => warnings.push(message),
  });

  assert.equal(warnings.length, 1, 'exactly one warning block per build');
  assert.equal(result.lane, 'floor', 'its own Bootstrap rules the hatch out');
  assert.ok(warnings[0].includes('vocabulary floor'), 'names the missing piece');
  assert.ok(
    warnings[0].includes("@import '../classy/css/pages/auth';")
    && warnings[0].includes("@import '../classy/css/app/panels';")
    && warnings[0].includes("@import '../classy/css/layout/footer';"),
    'carries the exact floor import lines',
  );
  assert.ok(!warnings[0].includes("@forward 'omega:theme'"), 'never suggests two Bootstraps');
});

test('fall-through guard: every bundled theme is silent (#98)', () => {
  const themesDir = path.join(PKG, 'themes');
  for (const id of fs.readdirSync(themesDir).filter((name) => !name.startsWith('_') && name !== 'bootstrap')) {
    const themeRoots = resolveThemeLayers({ activeTheme: id, themesDir });
    const warnings = [];
    const result = checkThemeVocabulary({
      css: compileMain(path.join(themesDir, id)),
      themeRoots,
      warn: (message) => warnings.push(message),
    });
    assert.equal(result, null, `${id} reaches the fall-through vocabulary`);
    assert.deepEqual(warnings, [], `${id} builds silent`);
  }
});

test('fall-through guard: the asset lane fires it on the real css build (#98)', async () => {
  const themeRoot = path.join(THEMING, 'hatchless-theme');
  const themeRoots = [themeRoot, path.join(PKG, 'themes', 'base')];
  const warnings = [];
  await buildAssets({
    layers: [...themeRoots, path.join(PKG, 'core')],
    themeRoots,
    sectionRoots: themeRoots,
    themesDir: path.join(PKG, 'themes'),
    coreDir: path.join(PKG, 'core'),
    outDir: path.join(PKG, '.omega', 'themes-test-guard-out'),
    only: 'css',
    warn: (message) => warnings.push(message),
  });

  assert.equal(warnings.length, 1, 'the css lane emitted the guard block once');
  assert.ok(warnings[0].includes('theme "hatchless-theme"'), 'the wired warning names the theme');
});

// ─── Tier 2: consumer-local full theme through the engine ────────────────────

test('tier 2: consumer-local theme layouts win the farm; uncovered pages fall through to base', async () => {
  const pages = await buildWith(miniData, { activeTheme: 'toy' });

  const pricing = pages.get('/pricing');
  assert.ok(pricing.includes('TOY THEME PRICING via consumer-local theme'), 'toy layout rendered /pricing');
  assert.ok(!pricing.includes('id="pricing-promo-banner"'), 'classy pricing chrome fully replaced');

  const about = pages.get('/about');
  assert.ok(about && about.length > 0, 'pages the toy theme does not cover still render');
  assert.ok(about.includes('<html'), 'fallback pages render through the base chain');
  // #177 reverses cp200: fonts are SKIN assets, and classy left the partial
  // theme's chain when base became the terminal layer. A theme that vendors
  // no faces now emits no preloads; the classy faces belong to classy alone.
  assert.ok(
    !about.includes('/assets/fonts/inter-normal-latin.woff2'),
    'toy theme vendors no fonts, so no skin faces preload (#177, ex-cp200)',
  );
});

// ─── Font preloads (cp198): first-paint faces discovered from theme fonts/ ──

test('font preloads: classy emits Inter + Newsreader normal-latin preloads (cp198)', async () => {
  const pages = await buildWith(miniData);
  const home = pages.get('/');

  assert.ok(home.includes('rel="preload"'), 'at least one preload link present');
  assert.ok(home.includes('/assets/fonts/inter-normal-latin.woff2'), 'Inter normal latin preloaded');
  assert.ok(home.includes('/assets/fonts/newsreader-normal-latin.woff2'), 'Newsreader normal latin preloaded');
  assert.ok(home.includes('as="font"'), 'as=font attribute present');
  assert.ok(home.includes('crossorigin'), 'crossorigin attribute present');
});

// ─── App panels: the statgrid reflows to its CONTAINER (#69) ────────────────

test('statgrid: columns come from the container, never the viewport (#69)', () => {
  const warnings = [];
  const css = sass.compile(path.join(PKG, 'themes', 'classy', 'css', 'app', '_panels.scss'), {
    logger: { warn: (message) => warnings.push(message), debug: () => {} },
  }).css;

  assert.deepEqual(warnings, [], 'the app panel floor compiles clean');

  // The whole partial is viewport-free: nested in a half-width card, the
  // statgrid reflows off ITS OWN width (the #69 consumer defect).
  assert.ok(!css.includes('@media'), 'no viewport media query in the app panel vocabulary');

  const tracks = css.match(/grid-template-columns:[^;]+;/g) || [];
  assert.equal(tracks.length, 1, 'one track definition, no breakpoint variant');
  assert.ok(tracks[0].includes('auto-fit'), 'intrinsic sizing fits as many cells as the container holds');
  assert.ok(
    tracks[0].includes('var(--omega-statgrid-cols'),
    'the --omega-statgrid-cols knob still caps the column count',
  );

  // Hairlines can't count columns anymore (the reflow decides how many land
  // per row), so cells draw their own rules and the card clips the outer ones.
  assert.ok(!css.includes('nth-child'), 'no column-count-dependent divider selectors');
  assert.ok(css.includes('overflow: hidden'), 'the card still clips to its rounded frame');
});

// ─── Section rhythm: nav clearance rides first-of-TYPE ──────────────────────

test('the first section takes nav clearance by TYPE, so a preceding div cannot steal it (#44)', () => {
  const warnings = [];
  const css = sass.compile(path.join(PKG, 'themes', 'classy', 'css', 'layout', '_general.scss'), {
    logger: { warn: (message) => warnings.push(message), debug: () => {} },
  }).css;

  assert.deepEqual(warnings, [], 'the layout floor compiles clean');

  // /pricing opens with the promo-banner <div> before its hero, and a blog
  // post with the read-progress bar — under :first-child neither hero
  // matched, so those pages started ~5rem tighter than /about. The page JS
  // already pushes the banner down via `main > section:first-of-type`; the
  // stylesheet names the same element.
  assert.match(css, /main > section:first-of-type/, 'the hero is the first section OF ITS TYPE, not the first child');
  assert.match(css, /main > article:first-of-type/, 'a blog post opens with an <article> and clears the nav too');
  assert.ok(!/main > (section|article):first-child/.test(css), 'no first-child clearance left to lose to a leading div');

  // Both the base and the ≥992px step carry the clearance.
  assert.equal((css.match(/main > section:first-of-type/g) || []).length, 2, 'clearance set at both breakpoints');
});

test("a blog post hands its nav clearance to the dot band, so the dots open the page like every other hero (#44)", () => {
  const css = sass.compile(path.join(PKG, 'themes', 'classy', 'css', 'layout', '_general.scss'), {
    logger: { warn: () => {}, debug: () => {} },
  }).css;

  // Ian's screenshot ruling (2026-07-31): held by the <article>, the band
  // started 10rem down and the dots read detached from the nav.
  const band = 'main > article:first-of-type:has(> .omega-dotgrid:first-child)';
  assert.ok(css.includes(`${band} {\n  padding-top: 0;`), 'the article gives up the clearance');
  assert.ok(css.includes(`${band} > .omega-dotgrid:first-child`), 'the band takes it instead');

  // Same numbers as every other opener, at both breakpoints (one mixin).
  const openerClearance = css.match(/padding-top: 10rem;/g) || []; // the breakout utility's !important twin is a different rule
  const openerClearanceLg = css.match(/padding-top: 12rem;/g) || [];
  assert.equal(openerClearance.length, 2, 'the section opener and the post band clear the nav by the same 10rem');
  assert.equal(openerClearanceLg.length, 2, 'and by the same 12rem at ≥992px');
});

test('a blog post wears the dotfield behind its masthead only, never behind the prose (#44)', () => {
  const post = fs.readFileSync(path.join(PKG, 'themes', 'base', '_layouts', 'frontend', 'pages', 'blog', 'post.html'), 'utf8');

  // The read surface stays still: the <article> itself carries no dot grid
  // (it wraps the prose), and the ONE dotfield band closes before the
  // content column opens.
  assert.match(post, /<article\{% unless/, 'the post still opens with the <article> the section rhythm names');
  assert.ok(!/<article[^>]*omega-dotgrid/.test(post), 'no dot grid on the article — dots behind body text is the thing we fixed');

  const bands = post.match(/data-omega-dotfield[ >]/g) || [];
  assert.equal(bands.length, 1, 'exactly one dotfield band on a post');
  assert.match(post, /<div class="omega-dotgrid" data-omega-dotfield>/, 'the band carries the same contract as every other hero');
  assert.ok(
    post.indexOf('<div class="omega-dotgrid" data-omega-dotfield>') < post.indexOf('blog-post-content'),
    'the band sits above the prose column',
  );
});

test('font preloads: newsflash emits Fraunces + Schibsted normal-latin preloads (cp198)', async () => {
  const pages = await buildWith({ ...miniData, theme: { id: 'newsflash' } });
  const home = pages.get('/');

  assert.ok(home.includes('/assets/fonts/fraunces-normal-latin.woff2'), 'Fraunces normal latin preloaded');
  assert.ok(home.includes('/assets/fonts/schibsted-grotesk-normal-latin.woff2'), 'Schibsted Grotesk normal latin preloaded');
  assert.ok(!home.includes('inter-normal-latin'), 'classy fonts not present in newsflash build');
});
