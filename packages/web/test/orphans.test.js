/**
 * #188: no compiled sheet consumes a custom property nothing defines.
 *
 * A declaration like `background: var(--x)` where `--x` is never defined is
 * invalid at computed-value time and computes to transparent, so the surface
 * disappears instead of falling back. The updates page shipped that bug as a
 * misnamed `--bs-tertiary-bg` (#187), and this sweep is the mechanical form
 * of the check that found it: collect every bare `var(--x)` use, subtract
 * every `--x:` definition, and whatever remains is an orphan. A use WITH a
 * fallback is exempt by design.
 *
 * Scope note: the check is name-level, not scope-level, and `defined` is the
 * union across all compile units. A property defined only inside `.card`, or
 * only by another theme, still counts as defined, so the #27 dropdown class
 * of bug (a name that exists but not on the consuming element) is out of
 * reach here.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const sass = require('sass');

const { PKG } = require('./lib/build.js');

const CSS_DIR = path.join(PKG, 'core', 'css');
const THEMES_DIR = path.join(PKG, 'themes');

// themes/bootstrap/scss is vendored upstream Bootstrap. Its sheets are not
// compilation units of their own (they read the vendor variable chain), so
// the roster reaches them through themes/bootstrap/_theme.scss, which pulls
// the whole vendor bundle plus this package's overrides. That is what makes
// vendor-defined tokens count as DEFINED.
const VENDOR_THEME = path.join(THEMES_DIR, 'bootstrap', 'scss') + path.sep;

// core/css/main.scss is the build's bundle entry: its `omega:theme` and
// `omega:sections` imports resolve through the layer-root importers that only
// src/assets.js installs, so it never compiles standalone. Nothing is lost,
// because every sheet it pulls is a roster entry in its own right.
const BUNDLE_ENTRY = path.join(CSS_DIR, 'main.scss');

// Names consumed bare on purpose. Every entry says why it is legitimate.
const ALLOWLIST = new Map([
  // Upstream Bootstrap, `$body-text-align: null !default` (scss/_variables.scss):
  // _root.scss emits the property only when the brand sets the variable, and
  // an undefined text-align simply inherits.
  ['--bs-body-text-align', 'upstream Bootstrap: opt-in, emitted only when $body-text-align is set'],
  // Upstream Bootstrap, `$breadcrumb-font-size: null !default`: the rfs()
  // mixin skips the property for a null value, and font-size inherits.
  ['--bs-breadcrumb-font-size', 'upstream Bootstrap: opt-in, emitted only when $breadcrumb-font-size is set'],
  // Upstream Bootstrap, `$nav-link-font-size: null !default`: same rfs()
  // deal as the breadcrumb size.
  ['--bs-nav-link-font-size', 'upstream Bootstrap: opt-in, emitted only when $nav-link-font-size is set'],
  // The build-time accent ramp (composeBrandTokens, emitted by head.html
  // after the bundles) needs no entry: core/css/tokens/_index.scss ships a
  // static placeholder for every name in the family, so the ramp's tokens are
  // defined at package level too and the injected values only override them.
]);

const scssFiles = (root) => fs.readdirSync(root, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.scss'))
  .map((entry) => path.join(entry.parentPath, entry.name))
  .sort();

// A theme partial is a fragment, not a compilation unit: its variables and
// mixins arrive through the theme entry's import chain, so the entry is what
// compiles. Component and section sheets are the exception, because the
// sections lane compiles each one on its own.
const compileUnitFor = (sheet) => {
  const [theme, area] = path.relative(THEMES_DIR, sheet).split(path.sep);
  return area === '_components' || area === '_sections' ? sheet : path.join(THEMES_DIR, theme, '_theme.scss');
};

// The compile surface: every core sheet on its own (the build compiles page
// entries exactly that way), plus every theme sheet through its unit. Derived
// from the tree, so a new sheet is guarded the day it lands.
const compileUnits = () => {
  const units = new Set(scssFiles(CSS_DIR).filter((file) => file !== BUNDLE_ENTRY));
  for (const sheet of scssFiles(THEMES_DIR)) {
    if (!sheet.startsWith(VENDOR_THEME)) units.add(compileUnitFor(sheet));
  }
  return [...units].sort();
};

const compileUnit = (file) => sass.compile(file, {
  logger: { warn: () => {}, debug: () => {} },
  quietDeps: true,
  // The same legacy allowance src/assets.js compiles the real bundles with;
  // deprecations are tokens.test.js's beat, not this one's.
  silenceDeprecations: ['import', 'global-builtin', 'color-functions', 'legacy-js-api'],
}).css;

// Compiled sass is flat, so every innermost `selector { decls }` reads off one
// pass. Declarations split on `;`, which is enough to name the offending line.
const declarations = (css) => [...css.matchAll(/[^{}]+\{([^{}]*)\}/g)]
  .flatMap((match) => match[1].split(';'))
  .map((decl) => decl.replace(/\s+/g, ' ').trim())
  .filter(Boolean);

// A bare use is `var(--x)` with no fallback argument; `var(--x, …)` is the
// author saying an undefined name is fine here, so it never orphans.
const BARE_USE = /var\(\s*(--[\w-]+)\s*\)/g;

test('#188: the sweep reaches core css, every theme, and vendored bootstrap', () => {
  const units = compileUnits();

  assert.ok(units.includes(path.join(CSS_DIR, 'tokens', '_index.scss')), 'the core token sheet is in the surface');
  assert.ok(units.includes(path.join(THEMES_DIR, 'bootstrap', '_theme.scss')),
    'vendored bootstrap compiles, so its tokens count as defined');
  for (const theme of ['base', 'classy', 'newsflash', 'neobrutalism']) {
    assert.ok(units.includes(path.join(THEMES_DIR, theme, '_theme.scss')), `the derivation still reaches themes/${theme}`);
  }
});

test('#188: every custom property a compiled sheet consumes is defined somewhere', () => {
  const defined = new Set();
  const uses = [];

  for (const unit of compileUnits()) {
    const name = path.relative(PKG, unit);
    const css = compileUnit(unit);

    for (const decl of declarations(css)) {
      // Definition collection is declaration-position only: a sweep over raw
      // css also matches selector text, where a BEM modifier ahead of a
      // pseudo-class (`.omega-interactive--lift:hover`) reads as `--lift:`
      // and would silently absorb a real orphan of the same name.
      const definition = decl.match(/^(--[\w-]+)\s*:/);
      if (definition) defined.add(definition[1]);
      for (const match of decl.matchAll(BARE_USE)) uses.push({ property: match[1], sheet: name, decl });
    }
  }

  // A regex that quietly stopped matching would pass this test vacuously, so
  // the sweep proves it saw the vocabulary before it judges it.
  assert.ok(defined.has('--bs-body-bg'), 'the definition sweep sees vendored bootstrap tokens');
  assert.ok(uses.some((use) => use.property === '--omega-accent'), 'the use sweep sees bare var() consumers');

  // Deduped: the same declaration repeated across a sheet's rules is one fix,
  // so it reads as one line.
  const orphans = uses
    .filter((use) => !defined.has(use.property) && !ALLOWLIST.has(use.property))
    .map((use) => `${use.sheet}: \`${use.decl}\` consumes ${use.property}, which nothing defines`);
  assert.deepEqual(
    [...new Set(orphans)].sort(),
    [],
    'a var() with no definition computes to transparent; define the property, or give the use a fallback',
  );
});
