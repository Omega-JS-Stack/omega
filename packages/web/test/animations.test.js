/**
 * #184/#185: the core css reduced-motion deal: every CONTINUOUS loop parks,
 * every one-shot keeps running.
 *
 * docs/shared/theming.md presents the reduced-motion branch as the deal a
 * looping effect makes, so the pin is written off the loop marker itself
 * (`infinite` in the shorthand), not off a hand-kept list: a new infinite
 * utility with no park fails here. #185 widens the same pin from the
 * animation sheet to EVERY core sheet that declares a loop, roster derived
 * from the tree; #186 widens the roster again, over the theme trees.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const sass = require('sass');

const { PKG } = require('./lib/build.js');

const CSS_DIR = path.join(PKG, 'core', 'css');
const ANIMATION_SHEET = path.join(CSS_DIR, 'core', '_animations.scss');
const THEMES_DIR = path.join(PKG, 'themes');

// themes/bootstrap/scss is vendored upstream Bootstrap, not ours to edit, and
// its spinners answer reduced motion by slowing down rather than stopping. The
// roster covers everything this package authors, bootstrap overrides included.
const VENDOR_THEME = path.join(THEMES_DIR, 'bootstrap', 'scss') + path.sep;

const compileSheet = (file) => {
  const warnings = [];
  const result = sass.compile(file, {
    logger: { warn: (message) => warnings.push(message), debug: () => {} },
  });
  return { css: result.css, warnings };
};

const compileAnimationSheet = () => compileSheet(ANIMATION_SHEET);

// Every sheet under a tree whose source declares an infinite animation.
// Derived from the tree, so a new looping sheet is guarded the day it lands.
const loopingSheets = (root) => fs.readdirSync(root, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.scss'))
  .map((entry) => path.join(entry.parentPath, entry.name))
  .filter((file) => !file.startsWith(VENDOR_THEME))
  .filter((file) => /animation[^;{}]*:[^;{}]*\binfinite\b/.test(fs.readFileSync(file, 'utf8')))
  .sort();

// The animation names a sheet's own loops carry. A theme partial compiles as
// part of a whole theme, so the check needs a way to stay on that sheet's
// rules instead of every rule the theme's import chain drags in.
const loopNames = (file) => [...fs.readFileSync(file, 'utf8')
  .matchAll(/animation:\s*([a-zA-Z][\w-]*)[^;{}]*\binfinite\b/g)].map((match) => match[1]);

// A theme partial is a fragment, not a compilation unit: its variables and
// mixins arrive through the theme entry's import chain, so the entry is what
// compiles. Component and section sheets are the exception, because the
// sections lane compiles each one on its own.
const compileUnitFor = (sheet) => {
  const [theme, area] = path.relative(THEMES_DIR, sheet).split(path.sep);
  return area === '_components' || area === '_sections' ? sheet : path.join(THEMES_DIR, theme, '_theme.scss');
};

// Compiled sass is flat, so every innermost `selector { decls }` reads off one
// pass; selector lists split, whitespace collapsed to the compiled spelling.
const cssRules = (css) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
  selectors: match[1].trim().split(',').map((selector) => selector.replace(/\s+/g, ' ').trim()),
  decls: match[2],
}));

// Selectors carrying an infinite animation shorthand, narrowed to a set of
// animation names when the compiled css holds more than the sheet under test.
const loopingSelectors = (css, names = null) => cssRules(css)
  .filter((rule) => /animation:[^;]*\binfinite\b/.test(rule.decls))
  .filter((rule) => !names || names.some((name) => new RegExp(`animation:\\s*${name}\\b`).test(rule.decls)))
  .flatMap((rule) => rule.selectors);

// Every `selector { … }` rule that sits inside a reduced-motion media block.
const parkedRules = (css) => {
  const parks = new Map();
  for (const block of css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{(.*?)\n\}/gs)) {
    for (const rule of cssRules(block[1])) {
      for (const selector of rule.selectors) parks.set(selector, rule.decls);
    }
  }
  return parks;
};

test('#184: every continuous loop utility parks under reduced motion', () => {
  const { css, warnings } = compileAnimationSheet();

  assert.deepEqual(warnings, [], 'new core css never warns (the #16 bar)');

  const loops = loopingSelectors(css);
  assert.deepEqual(
    loops.sort(),
    [
      '.animation-bounce',
      '.animation-flex',
      '.animation-pulse',
      '.animation-pulse-right',
      '.animation-shimmer',
      '.animation-spin',
      '.animation-wiggle',
    ],
    'the loop roster the sheet ships; a new one joins this list AND gets a park',
  );

  const parks = parkedRules(css);
  for (const loop of loops) {
    assert.ok(parks.has(loop), `${loop} loops forever with no reduced-motion park`);
    assert.match(parks.get(loop), /animation: none/, `${loop}'s park stops the loop outright`);
  }
});

test('#184: the shimmer parks at its resting frame, not on an initial background-position', () => {
  const { css } = compileAnimationSheet();

  // Dropping the animation hands the element back its authored
  // background-position; the loop rests at `0 50%`, so the park says so
  // rather than leaving a tall gradient parked off its band.
  assert.match(parkedRules(css).get('.animation-shimmer'), /background-position: 0 50%/);
});

test('#184: one-shot utilities are NOT parked, because a 1s fade is not a motion hazard', () => {
  const { css } = compileAnimationSheet();

  const parks = parkedRules(css);
  for (const oneShot of [
    '.animation-fade-in',
    '.animation-fade-out',
    '.animation-slide-up',
    '.animation-slide-down',
    '.animation-popup',
    '.animation-popup-medium',
  ]) {
    assert.ok(!parks.has(oneShot), `${oneShot} plays once and finishes; parking it would strand its start frame`);
  }
});

test('#185: every core sheet that loops parks that loop, not just the animation sheet', () => {
  const sheets = loopingSheets(CSS_DIR);
  assert.ok(sheets.includes(ANIMATION_SHEET), 'the derivation finds the animation sheet at minimum');

  for (const sheet of sheets) {
    const name = path.relative(PKG, sheet);
    const { css } = compileSheet(sheet);

    const loops = loopingSelectors(css);
    assert.ok(loops.length > 0, `${name}: source declares a loop, so the compiled sheet must show one`);

    const parks = parkedRules(css);
    for (const loop of loops) {
      assert.ok(parks.has(loop), `${name}: \`${loop}\` loops forever with no reduced-motion park`);
      assert.match(parks.get(loop), /animation: none/, `${name}: \`${loop}\`'s park stops the loop outright`);
    }
  }
});

test('#186: theme sheets loop under the same deal as core css', () => {
  const sheets = loopingSheets(THEMES_DIR);
  for (const theme of ['base', 'classy', 'newsflash']) {
    assert.ok(sheets.some((sheet) => sheet.startsWith(path.join(THEMES_DIR, theme) + path.sep)),
      `the derivation still reaches themes/${theme}`);
  }

  const compiled = new Map();
  for (const sheet of sheets) {
    const name = path.relative(PKG, sheet);
    const unit = compileUnitFor(sheet);
    if (!compiled.has(unit)) compiled.set(unit, compileSheet(unit).css);
    const css = compiled.get(unit);

    const loops = loopingSelectors(css, loopNames(sheet));
    assert.ok(loops.length > 0, `${name}: source declares a loop, so the compiled theme must show one`);

    const parks = parkedRules(css);
    for (const loop of loops) {
      assert.ok(parks.has(loop), `${name}: \`${loop}\` loops forever with no reduced-motion park`);
      assert.match(parks.get(loop), /animation: none/, `${name}: \`${loop}\`'s park stops the loop outright`);
    }
  }
});
