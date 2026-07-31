/**
 * ONE rainbow formula (Ian 2026-07-31) — the classy ring samples the ramp in
 * CSS every 45°, the omega dotfield samples it continuously in canvas
 * (`@omega.js/client` motion.js). The fixed saturation/lightness live in both
 * languages, so nothing but a test can keep them equal: change the ramp in
 * both places or in neither.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const { PKG } = require('./lib/build.js');

const UTILITIES = path.join(PKG, 'themes', 'classy', 'css', 'base', '_utilities.scss');
const MOTION = path.join(PKG, '..', 'client', 'src', 'modules', 'motion.js');

/**
 * Pull one number out of a source file, normalized to a 0-1 fraction (the
 * SCSS side writes percentages, the JS side fractions).
 * @param {string} source - file contents
 * @param {RegExp} pattern - matcher with the number as group 1
 * @param {string} label - what is being read (assertion message)
 * @returns {number} the value as a fraction
 */
function readRatio(source, pattern, label) {
  const match = source.match(pattern);
  assert.ok(match, `${label} not found — the rainbow pin needs updating with the code it pins`);
  const value = Number(match[1]);
  return match[0].includes('%') ? value / 100 : value;
}

test('the rainbow ramp is ONE formula: scss and canvas carry the same S/L', () => {
  const scss = fs.readFileSync(UTILITIES, 'utf8');
  const motion = fs.readFileSync(MOTION, 'utf8');

  const scssS = readRatio(scss, /\$classy-rainbow-s:\s*([\d.]+)%/, '$classy-rainbow-s');
  const scssL = readRatio(scss, /\$classy-rainbow-l:\s*([\d.]+)%/, '$classy-rainbow-l');
  const jsS = readRatio(motion, /const RAINBOW_S = ([\d.]+);/, 'RAINBOW_S');
  const jsL = readRatio(motion, /const RAINBOW_L = ([\d.]+);/, 'RAINBOW_L');

  assert.strictEqual(scssS, 0.68, '$classy-rainbow-s is the 68% ramp');
  assert.strictEqual(scssL, 0.58, '$classy-rainbow-l is the 58% ramp');
  assert.strictEqual(
    jsS, scssS,
    'motion.js RAINBOW_S drifted from $classy-rainbow-s — the ring and the dotfield are the same ramp: change both or neither',
  );
  assert.strictEqual(
    jsL, scssL,
    'motion.js RAINBOW_L drifted from $classy-rainbow-l — the ring and the dotfield are the same ramp: change both or neither',
  );
});
