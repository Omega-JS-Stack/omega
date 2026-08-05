/**
 * #184: the animation sheet's reduced-motion deal: every CONTINUOUS loop
 * parks, every one-shot keeps running.
 *
 * docs/shared/theming.md presents the reduced-motion branch as the deal a
 * looping effect makes, so the pin is written off the loop marker itself
 * (`infinite` in the utility's shorthand), not off a hand-kept list: a new
 * infinite utility with no park fails here.
 */
const assert = require('node:assert');
const path = require('node:path');
const { test } = require('node:test');
const sass = require('sass');

const { PKG } = require('./lib/build.js');

const compileAnimationSheet = () => {
  const warnings = [];
  const result = sass.compile(path.join(PKG, 'core', 'css', 'core', '_animations.scss'), {
    logger: { warn: (message) => warnings.push(message), debug: () => {} },
  });
  return { css: result.css, warnings };
};

// Every `.selector { … }` rule that sits inside a reduced-motion media block.
const parkedRules = (css) => {
  const parks = new Map();
  for (const block of css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{(.*?)\n\}/gs)) {
    for (const rule of block[1].matchAll(/([.\w-]+) \{([^}]*)\}/g)) {
      parks.set(rule[1], rule[2]);
    }
  }
  return parks;
};

test('#184: every continuous loop utility parks under reduced motion', () => {
  const { css, warnings } = compileAnimationSheet();

  assert.deepEqual(warnings, [], 'new core css never warns (the #16 bar)');

  const loops = [...css.matchAll(/\n(\.[\w-]+) \{\n  animation: [^;]*infinite[^;]*;/g)].map((m) => m[1]);
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
