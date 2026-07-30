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
 * farm, and pages it doesn't cover fall through to the classy base.
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

test('resolveThemeLayers: consumer-local theme wins; packaged is the fallback; classy base always present', () => {
  const themesDir = path.join(PKG, 'themes');

  // mini-site ships themes/toy → consumer-local dir wins for 'toy'
  const local = resolveThemeLayers({ activeTheme: 'toy', consumerDir: MINI, themesDir });
  assert.deepEqual(local, [
    path.join(MINI, 'themes', 'toy'),
    path.join(themesDir, 'classy'),
  ]);

  // no consumer-local dir for 'newsflash' → packaged theme
  const packaged = resolveThemeLayers({ activeTheme: 'newsflash', consumerDir: MINI, themesDir });
  assert.deepEqual(packaged, [
    path.join(themesDir, 'newsflash'),
    path.join(themesDir, 'classy'),
  ]);

  // classy active (and the default) dedups to a single layer
  assert.deepEqual(resolveThemeLayers({ activeTheme: 'classy', consumerDir: MINI, themesDir }), [path.join(themesDir, 'classy')]);
  assert.deepEqual(resolveThemeLayers({ themesDir }), [path.join(themesDir, 'classy')]);
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

    assert.deepEqual(layers, [themeDir, path.join(PKG, 'themes', 'classy')]);
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
  const layers = [partialRoot, path.join(PKG, 'themes', 'classy'), path.join(PKG, 'core')];

  const css = sass.compile(path.join(partialRoot, '_theme.scss'), {
    importers: [layeredFileImporter(layers), sectionsImporter([])],
    loadPaths: layers,
    quietDeps: true,
    silenceDeprecations: ['import', 'global-builtin', 'color-functions', 'legacy-js-api'],
    logger: { warn: () => {}, debug: () => {} },
  }).css;

  // The self-skip landed the @forward on classy — its full chain emitted
  assert.ok(css.includes('.classy-auth'), 'classy auth vocabulary inherited');
  assert.ok(css.includes('.classy-statgrid'), 'classy app vocabulary inherited');
  assert.ok(css.includes('--bs-body-bg: var(--omega-ground)'), 'classy token bridge inherited');

  // The partial theme's own rules land AFTER the chain so they win ties
  assert.ok(css.includes('--partial-marker'), 'partial theme rules present');
  assert.ok(
    css.indexOf('--partial-marker') > css.lastIndexOf('.classy-statgrid'),
    'partial rules land after the inherited chain',
  );
});

// ─── The fall-through guard (#98): a theme that reached NEITHER lane warns ───

// The compiled main bundle for a theme root of any provenance (fixture dirs
// included — the shipped chain always sits under it).
function compileMain(themeRoot) {
  const layers = [themeRoot, path.join(PKG, 'themes', 'classy'), path.join(PKG, 'core')];
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
    themeRoots: [themeRoot, path.join(PKG, 'themes', 'classy')],
    warn: (message) => warnings.push(message),
  });

  assert.equal(warnings.length, 1, 'exactly one warning block per build');
  assert.deepEqual(result, {
    theme: 'hatchless-theme',
    lane: 'hatch',
    missing: ['.classy-auth', '.classy-statgrid', '.classy-footer'],
  });

  const block = warnings[0];
  assert.ok(block.includes('theme "hatchless-theme"'), 'names the theme');
  assert.ok(block.includes('.classy-auth (pages/auth'), 'names the missing sentinel and its partial');
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
    themeRoots: [themeRoot, path.join(PKG, 'themes', 'classy')],
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
  const themeRoots = [themeRoot, path.join(PKG, 'themes', 'classy')];
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

test('tier 2: consumer-local theme layouts win the farm; uncovered pages fall through to classy', async () => {
  const pages = await buildWith(miniData, { activeTheme: 'toy' });

  const pricing = pages.get('/pricing');
  assert.ok(pricing.includes('TOY THEME PRICING via consumer-local theme'), 'toy layout rendered /pricing');
  assert.ok(!pricing.includes('id="pricing-promo-banner"'), 'classy pricing chrome fully replaced');

  const about = pages.get('/about');
  assert.ok(about && about.length > 0, 'pages the toy theme does not cover still render');
  assert.ok(about.includes('<html'), 'fallback pages render through the classy base chain');
  assert.ok(
    about.includes('/assets/fonts/inter-normal-latin.woff2'),
    'toy theme vendors no fonts — preloads fall through to the classy base faces (cp200)',
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
    tracks[0].includes('var(--classy-statgrid-cols'),
    'the --classy-statgrid-cols knob still caps the column count',
  );

  // Hairlines can't count columns anymore (the reflow decides how many land
  // per row), so cells draw their own rules and the card clips the outer ones.
  assert.ok(!css.includes('nth-child'), 'no column-count-dependent divider selectors');
  assert.ok(css.includes('overflow: hidden'), 'the card still clips to its rounded frame');
});

test('font preloads: newsflash emits Fraunces + Schibsted normal-latin preloads (cp198)', async () => {
  const pages = await buildWith({ ...miniData, theme: { id: 'newsflash' } });
  const home = pages.get('/');

  assert.ok(home.includes('/assets/fonts/fraunces-normal-latin.woff2'), 'Fraunces normal latin preloaded');
  assert.ok(home.includes('/assets/fonts/schibsted-grotesk-normal-latin.woff2'), 'Schibsted Grotesk normal latin preloaded');
  assert.ok(!home.includes('inter-normal-latin'), 'classy fonts not present in newsflash build');
});
