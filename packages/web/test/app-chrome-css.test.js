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

test('#303: the core component sheet carries the icon button and the search pill', () => {
  const warnings = [];
  const css = sass.compile(COMPONENTS_SHEET, {
    logger: { warn: (message) => warnings.push(message), debug: () => {} },
  }).css;

  assert.deepEqual(warnings, [], 'new core css never warns — the #16 bar');

  const button = css.match(/\.btn-icon \{[^}]*\}/);
  assert.ok(button, 'the icon button is structural, not a classy component');
  assert.match(button[0], /display: inline-flex/, 'a square ghost centers its glyph');
  assert.match(button[0], /background: transparent/, 'flat at rest — no UA button chrome');
  assert.match(button[0], /border: 1px solid transparent/, 'the hover frame never shifts geometry');
  assert.match(button[0], /color: var\(--omega-ink-muted\)/, 'ink from the token contract');

  const search = css.match(/\.omega-search \{[^}]*\}/);
  assert.ok(search, 'the ⌘K field is structural too');
  assert.match(search[0], /background: var\(--omega-surface-2\)/, 'the second surface tier — the field is a well');
  assert.match(search[0], /border: 1px solid var\(--omega-line\)/);
  assert.match(search[0], /border-radius: var\(--omega-radius-m\)/, 'shape from the token contract');

  const input = css.match(/\.omega-search input \{[^}]*\}/);
  assert.ok(input, 'the input sheds its native chrome inside the pill');
  assert.match(input[0], /background: transparent/);
  assert.match(input[0], /border: 0/);

  const badge = css.match(/\.omega-search kbd \{[^}]*\}/);
  assert.ok(badge, 'the shortcut badge is skinned here, not left to reboot');
  assert.match(badge[0], /color: var\(--omega-ink-muted\)/, 'ink on a surface — never reboot inverted fill');
  assert.match(badge[0], /background: var\(--omega-surface\)/);

  assert.ok(!/#[0-9a-fA-F]{3,6}\b/.test(css), 'zero hardcoded hex — a skin re-values the tokens');
});

test('#303: a theme that inherits NEITHER classy lane still gets both surfaces', () => {
  // The floorless fixture is a full sibling theme with its own Bootstrap and
  // none of classy's floor partials — exactly the newsflash/neobrutalism shape
  // the bug was reported on.
  const css = compileMain(path.join(THEMING, 'floorless-theme'));

  for (const selector of ['.btn-icon', '.omega-search']) {
    const definitions = [...css.matchAll(new RegExp(`(?:^|\\n)\\${selector} \\{[^}]*\\}`, 'g'))];
    assert.strictEqual(definitions.length, 1, `exactly ONE structural ${selector} in the bundle — presentation SSOT`);
  }

  const badge = css.match(/\.omega-search kbd \{[^}]*\}/);
  assert.ok(badge, 'and the ⌘K badge is skinned on a floorless theme');
  assert.ok(
    css.indexOf('--omega-surface-2') < css.indexOf('.omega-search'),
    'tokens land ahead of the pill in the bundle',
  );
});

test('#303: classy no longer owns a second copy of either rule', () => {
  const buttons = fs.readFileSync(path.join(PKG, 'themes', 'classy', 'css', 'components', '_buttons.scss'), 'utf8');
  const forms = fs.readFileSync(path.join(PKG, 'themes', 'classy', 'css', 'components', '_forms.scss'), 'utf8');

  assert.ok(!/^\.btn-icon \{/m.test(buttons), 'the icon button moved to the core sheet');
  assert.ok(!/^\.omega-search \{/m.test(forms), 'the search pill moved to the core sheet');
});
