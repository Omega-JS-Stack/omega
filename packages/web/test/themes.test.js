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
const { layeredFileImporter } = require('../src/assets.js');
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
    importers: [layeredFileImporter(layers)],
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

// ─── Tier 2: consumer-local full theme through the engine ────────────────────

test('tier 2: consumer-local theme layouts win the farm; uncovered pages fall through to classy', async () => {
  const pages = await buildWith(miniData, { activeTheme: 'toy' });

  const pricing = pages.get('/pricing');
  assert.ok(pricing.includes('TOY THEME PRICING via consumer-local theme'), 'toy layout rendered /pricing');
  assert.ok(!pricing.includes('id="pricing-promo-banner"'), 'classy pricing chrome fully replaced');

  const about = pages.get('/about');
  assert.ok(about && about.length > 0, 'pages the toy theme does not cover still render');
  assert.ok(about.includes('<html'), 'fallback pages render through the classy base chain');
});
