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
const path = require('node:path');
const { test } = require('node:test');
const sass = require('sass');

const { resolveThemeLayers } = require('../src/layers.js');
const { layeredFileImporter, sectionsImporter } = require('../src/assets.js');
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
