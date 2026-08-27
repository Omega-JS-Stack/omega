/**
 * #531 — `.omega-price-card` is MARKETING vocabulary, not /pricing furniture.
 *
 * The homepage plan band (`marketing/pricing-cards`, #493) is the first
 * surface that composes price cards outside /pricing, and on neobrutalism and
 * newsflash the theme's card skin lived in `css/pages/pricing/index.scss` — a
 * page sheet only /pricing loads. Everywhere else the cards fell back to the
 * plain themed `card`. Classy always had them in the main bundle; the other
 * two now match, so the sheet EVERY page loads carries the skin and /pricing
 * keeps rendering identically (its styles just arrive from the shared layer).
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const sass = require('sass');

const { layeredFileImporter, sectionsImporter } = require('../src/assets.js');
const { PKG } = require('./lib/build.js');

const themeRoot = (name) => path.join(PKG, 'themes', name);

/** Compile a sheet the way the asset lane does, for one theme's layer stack. */
function compile(entry, name) {
  const layers = [themeRoot(name), path.join(PKG, 'themes', 'base'), path.join(PKG, 'core')];
  return sass.compile(entry, {
    importers: [layeredFileImporter(layers), sectionsImporter([])],
    loadPaths: [themeRoot(name), path.join(themeRoot(name), 'css'), ...layers, ...layers.map((l) => path.join(l, 'css'))],
    quietDeps: true,
    silenceDeprecations: ['import', 'global-builtin', 'color-functions', 'legacy-js-api'],
    logger: { warn: () => {}, debug: () => {} },
  }).css;
}

// The main bundle is the sheet every page loads — a homepage band can only
// wear what lands here.
const compileMain = (name) => compile(path.join(PKG, 'core', 'css', 'main.scss'), name);
const pricingSheet = (name) => path.join(themeRoot(name), 'css', 'pages', 'pricing', 'index.scss');

// Per theme: the voice marker that proves the theme's OWN price-card skin —
// not just the classy floor's structure — reached the bundle.
const THEMES = [
  { name: 'classy', popular: /--omega-gradient/ },
  { name: 'neobrutalism', popular: /--nb-accent-yellow/ },
  { name: 'newsflash', popular: /--nf-shadow-hard-hover/ },
];

for (const theme of THEMES) {
  test(`#531: ${theme.name} carries the price-card skin in the main bundle`, () => {
    const css = compileMain(theme.name);

    assert.match(css, /\.omega-price-card\b/, 'the card vocabulary is in the sheet every page loads');
    // A sibling theme imports classy's floor, so the bundle holds more than
    // one popular-plan rule — the theme's OWN has to be among them.
    const popular = [...css.matchAll(/[^{}]*\.omega-price-card--popular\s*\{[^}]*\}/g)].map((match) => match[0]);
    assert.ok(popular.length > 0, `${theme.name} skins the popular plan outside /pricing`);
    assert.ok(popular.some((rule) => theme.popular.test(rule)), `${theme.name}'s own voice, not the bare themed card`);
    assert.match(css, /\.omega-price-card__popular\s*\{[^}]*position:\s*absolute/, 'the "Most popular" flag is pinned to the card, not left in flow');
  });

  test(`#531: ${theme.name} keeps no price-card rules in the /pricing page sheet`, () => {
    const sheet = pricingSheet(theme.name);
    if (!fs.existsSync(sheet)) return; // classy forks no pricing page sheet

    assert.ok(!/\.omega-price-card/.test(compile(sheet, theme.name)), 'one home for the card skin — a page copy would drift');
  });
}
