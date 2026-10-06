/**
 * #303 — the icon button and the search pill are CORE vocabulary.
 *
 * The base app chrome (`themes/base/_includes/global/sections/app-topbar.html`,
 * `app-sidebar.html`) renders `.btn-icon` and the `.omega-search` ⌘K field on
 * EVERY theme, but their structure only ever lived in classy's buttons/forms
 * partials — partials a full sibling theme (newsflash, neobrutalism) never
 * imports. The Daily Build rendered both raw: a native UA button box beside the
 * breadcrumb, a native search field, and reboot's inverted cream `kbd`. Same
 * promotion as the chip (#242): structure in the core component sheet, painted
 * only through tokens, emitted before the theme so a skin still overrides it.
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
  description: 'app-chrome-css',
  tests: [
    {
      name: '#303: the core component sheet carries the icon button and the search pill',
      run: (ctx) => {
        const warnings = [];
        const css = sass.compile(COMPONENTS_SHEET, {
          logger: { warn: (message) => warnings.push(message), debug: () => {} },
        }).css;

        ctx.expect(warnings, 'new core css never warns — the #16 bar').toEqual([]);

        const button = css.match(/\.btn-icon \{[^}]*\}/);
        ctx.expect(button, 'the icon button is structural, not a classy component').toBeTruthy();
        ctx.expect(button[0], 'a square ghost centers its glyph').toMatch(/display: inline-flex/);
        ctx.expect(button[0], 'flat at rest — no UA button chrome').toMatch(/background: transparent/);
        ctx.expect(button[0], 'the hover frame never shifts geometry').toMatch(/border: 1px solid transparent/);
        ctx.expect(button[0], 'ink from the token contract').toMatch(/color: var\(--omega-ink-muted\)/);

        const search = css.match(/\.omega-search \{[^}]*\}/);
        ctx.expect(search, 'the ⌘K field is structural too').toBeTruthy();
        ctx.expect(search[0], 'the second surface tier — the field is a well').toMatch(/background: var\(--omega-surface-2\)/);
        ctx.expect(search[0]).toMatch(/border: 1px solid var\(--omega-line\)/);
        ctx.expect(search[0], 'shape from the token contract').toMatch(/border-radius: var\(--omega-radius-m\)/);

        const input = css.match(/\.omega-search input \{[^}]*\}/);
        ctx.expect(input, 'the input sheds its native chrome inside the pill').toBeTruthy();
        ctx.expect(input[0]).toMatch(/background: transparent/);
        ctx.expect(input[0]).toMatch(/border: 0/);

        const badge = css.match(/\.omega-search kbd \{[^}]*\}/);
        ctx.expect(badge, 'the shortcut badge is skinned here, not left to reboot').toBeTruthy();
        ctx.expect(badge[0], 'ink on a surface — never reboot inverted fill').toMatch(/color: var\(--omega-ink-muted\)/);
        ctx.expect(badge[0]).toMatch(/background: var\(--omega-surface\)/);

        ctx.expect(!/#[0-9a-fA-F]{3,6}\b/.test(css), 'zero hardcoded hex — a skin re-values the tokens').toBeTruthy();
      },
    },

    {
      name: '#303: a theme that inherits NEITHER classy lane still gets both surfaces',
      run: (ctx) => {
        // The floorless fixture is a full sibling theme with its own Bootstrap and
        // none of classy's floor partials — exactly the newsflash/neobrutalism shape
        // the bug was reported on.
        const css = compileMain(path.join(THEMING, 'floorless-theme'));

        for (const selector of ['.btn-icon', '.omega-search']) {
          const definitions = [...css.matchAll(new RegExp(`(?:^|\\n)\\${selector} \\{[^}]*\\}`, 'g'))];
          ctx.expect(definitions.length, `exactly ONE structural ${selector} in the bundle — presentation SSOT`).toBe(1);
        }

        const badge = css.match(/\.omega-search kbd \{[^}]*\}/);
        ctx.expect(badge, 'and the ⌘K badge is skinned on a floorless theme').toBeTruthy();
        ctx.expect(css.indexOf('--omega-surface-2') < css.indexOf('.omega-search'), 'tokens land ahead of the pill in the bundle').toBeTruthy();
      },
    },

    {
      name: '#303: classy no longer owns a second copy of either rule',
      run: (ctx) => {
        const buttons = fs.readFileSync(path.join(PKG, 'themes', 'classy', 'css', 'components', '_buttons.scss'), 'utf8');
        const forms = fs.readFileSync(path.join(PKG, 'themes', 'classy', 'css', 'components', '_forms.scss'), 'utf8');

        ctx.expect(!/^\.btn-icon \{/m.test(buttons), 'the icon button moved to the core sheet').toBeTruthy();
        ctx.expect(!/^\.omega-search \{/m.test(forms), 'the search pill moved to the core sheet').toBeTruthy();
      },
    },
  ],
});
