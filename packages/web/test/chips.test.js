/**
 * #242 — the chip is CORE vocabulary, not a classy component.
 *
 * `.omega-chip` is emitted by BASE-layer markup (the app sidebar, the billing
 * modal's current-plan badge, the legal hub links), so its structure may not
 * live in one theme's badges partial: a brand off classy rendered bare
 * unstyled text. The structural rules sit in the core component sheet, painted
 * exclusively through tokens and emitted BEFORE the theme, so every skin
 * inherits the chip and any theme still overrides it (the icon-CSS ruling:
 * presentation SSOT in the shared sheet).
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const sass = require('sass');

const { layeredFileImporter, sectionsImporter } = require('../src/assets.js');
const { PKG } = require('./lib/build.js');

const COMPONENTS_SHEET = path.join(PKG, 'core', 'css', 'components', '_index.scss');
const THEMING = path.join(__dirname, 'fixtures', 'theming');

// The compiled main bundle for a theme root of any provenance.
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

test('#242: the core component sheet carries the chip, painted only through tokens', () => {
  const warnings = [];
  const css = sass.compile(COMPONENTS_SHEET, {
    logger: { warn: (message) => warnings.push(message), debug: () => {} },
  }).css;

  assert.deepEqual(warnings, [], 'new core css never warns — the #16 bar');

  const chip = css.match(/\.omega-chip \{[^}]*\}/);
  assert.ok(chip, 'the structural chip rule lives here');
  assert.match(chip[0], /display: inline-flex/, 'the micro-pill is a flex row');
  assert.match(chip[0], /text-transform: uppercase/);
  assert.match(chip[0], /white-space: nowrap/);
  assert.match(chip[0], /border-radius: var\(--omega-radius-pill/, 'shape from the token contract');
  assert.match(chip[0], /color: var\(--omega-ink-muted\)/, 'ink from the token contract');
  assert.match(chip[0], /background: var\(--omega-surface-2\)/, 'the second surface tier — chips are a well');
  assert.match(chip[0], /border: 1px solid var\(--omega-line\)/);

  for (const modifier of ['.omega-chip--accent', '.omega-chip--ink']) {
    const rule = css.match(new RegExp(`\\${modifier} \\{[^}]*\\}`));
    assert.ok(rule, `${modifier} rides along — a base surface uses it too`);
  }

  assert.ok(!/#[0-9a-fA-F]{3,6}\b/.test(css), 'zero hardcoded hex — a skin re-values the tokens');
});

test('#242: main.scss wires the component vocabulary after tokens and before the theme', () => {
  const main = fs.readFileSync(path.join(PKG, 'core', 'css', 'main.scss'), 'utf8');
  const tokensAt = main.indexOf("@use 'tokens/index'");
  const componentsAt = main.indexOf("@use 'components/index'");
  const themeAt = main.indexOf("@use 'omega:theme'");

  assert.ok(componentsAt !== -1, 'the component sheet is used');
  assert.ok(tokensAt < componentsAt, 'tokens emit first (the sheet consumes them)');
  assert.ok(componentsAt < themeAt, 'the vocabulary emits before the theme, so a skin overrides it');
});

test('#242: a theme that inherits NEITHER classy lane still gets the chip', () => {
  // The floorless fixture is a full sibling theme with its own Bootstrap and
  // none of classy's floor partials — exactly the newsflash/neobrutalism
  // shape the bug was reported on, minus the floor import that hid it.
  const css = compileMain(path.join(THEMING, 'floorless-theme'));

  const definitions = [...css.matchAll(/(?:^|\n)\.omega-chip \{[^}]*\}/g)];
  assert.strictEqual(definitions.length, 1, 'exactly ONE structural definition in the bundle — presentation SSOT');
  assert.match(definitions[0][0], /background: var\(--omega-surface-2\)/, 'and it is the token-painted one');

  assert.ok(
    css.indexOf('--omega-surface-2') < css.indexOf('.omega-chip'),
    'tokens land ahead of the chip in the bundle',
  );
});
