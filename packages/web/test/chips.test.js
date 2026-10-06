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
const fs = require('node:fs');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');
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

module.exports = defineCases({
  type: 'group',
  description: 'chips',
  tests: [
    {
      name: '#242: the core component sheet carries the chip, painted only through tokens',
      run: (ctx) => {
        const warnings = [];
        const css = sass.compile(COMPONENTS_SHEET, {
          logger: { warn: (message) => warnings.push(message), debug: () => {} },
        }).css;

        ctx.expect(warnings, 'new core css never warns — the #16 bar').toEqual([]);

        const chip = css.match(/\.omega-chip \{[^}]*\}/);
        ctx.expect(chip, 'the structural chip rule lives here').toBeTruthy();
        ctx.expect(chip[0], 'the micro-pill is a flex row').toMatch(/display: inline-flex/);
        ctx.expect(chip[0]).toMatch(/text-transform: uppercase/);
        ctx.expect(chip[0]).toMatch(/white-space: nowrap/);
        ctx.expect(chip[0], 'shape from the token contract').toMatch(/border-radius: var\(--omega-radius-pill/);
        ctx.expect(chip[0], 'ink from the token contract').toMatch(/color: var\(--omega-ink-muted\)/);
        ctx.expect(chip[0], 'the second surface tier — chips are a well').toMatch(/background: var\(--omega-surface-2\)/);
        ctx.expect(chip[0]).toMatch(/border: 1px solid var\(--omega-line\)/);

        for (const modifier of ['.omega-chip--accent', '.omega-chip--ink']) {
          const rule = css.match(new RegExp(`\\${modifier} \\{[^}]*\\}`));
          ctx.expect(rule, `${modifier} rides along — a base surface uses it too`).toBeTruthy();
        }

        ctx.expect(!/#[0-9a-fA-F]{3,6}\b/.test(css), 'zero hardcoded hex — a skin re-values the tokens').toBeTruthy();
      },
    },

    {
      name: '#242: main.scss wires the component vocabulary after tokens and before the theme',
      run: (ctx) => {
        const main = fs.readFileSync(path.join(PKG, 'core', 'css', 'main.scss'), 'utf8');
        const tokensAt = main.indexOf("@use 'tokens/index'");
        const componentsAt = main.indexOf("@use 'components/index'");
        const themeAt = main.indexOf("@use 'omega:theme'");

        ctx.expect(componentsAt !== -1, 'the component sheet is used').toBeTruthy();
        ctx.expect(tokensAt < componentsAt, 'tokens emit first (the sheet consumes them)').toBeTruthy();
        ctx.expect(componentsAt < themeAt, 'the vocabulary emits before the theme, so a skin overrides it').toBeTruthy();
      },
    },

    {
      name: '#242: a theme that inherits NEITHER classy lane still gets the chip',
      run: (ctx) => {
        // The floorless fixture is a full sibling theme with its own Bootstrap and
        // none of classy's floor partials — exactly the newsflash/neobrutalism
        // shape the bug was reported on, minus the floor import that hid it.
        const css = compileMain(path.join(THEMING, 'floorless-theme'));

        const definitions = [...css.matchAll(/(?:^|\n)\.omega-chip \{[^}]*\}/g)];
        ctx.expect(definitions.length, 'exactly ONE structural definition in the bundle — presentation SSOT').toBe(1);
        ctx.expect(definitions[0][0], 'and it is the token-painted one').toMatch(/background: var\(--omega-surface-2\)/);

        ctx.expect(css.indexOf('--omega-surface-2') < css.indexOf('.omega-chip'), 'tokens land ahead of the chip in the bundle').toBeTruthy();
      },
    },
  ],
});
