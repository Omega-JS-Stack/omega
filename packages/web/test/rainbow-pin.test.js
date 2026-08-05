/**
 * ONE rainbow palette (Ian 2026-07-31) — the classy ring paints the hand-mixed
 * pastel stops as a conic gradient, and the omega dotfield sweeps the SAME
 * stops in canvas (`@omega.js/client` motion.js), blending between adjacent
 * ones. The palette lives in both languages, so nothing but a test can keep
 * them equal: change the stops in both places or in neither.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const { PKG } = require('./lib/build.js');

const UTILITIES = path.join(PKG, 'themes', 'classy', 'css', 'base', '_utilities.scss');
const MOTION = path.join(PKG, '..', 'client', 'src', 'modules', 'motion.js');

/**
 * Pull an ordered hex list out of a source file.
 * @param {string} source - file contents
 * @param {RegExp} pattern - matcher with the hex list as group 1
 * @param {string} label - what is being read (assertion message)
 * @returns {string[]} the hexes, lowercased, in source order
 */
function readStops(source, pattern, label) {
  const match = source.match(pattern);
  assert.ok(match, `${label} not found — the rainbow pin needs updating with the code it pins`);
  const hexes = match[1].match(/#[0-9a-fA-F]{6}/g) || [];
  return hexes.map((hex) => hex.toLowerCase());
}

test('the rainbow palette is ONE list: the classy ring and the dotfield carry the same stops', () => {
  const scss = fs.readFileSync(UTILITIES, 'utf8');
  const motion = fs.readFileSync(MOTION, 'utf8');

  const scssStops = readStops(scss, /--omega-gradient-stops:\s*([^;]+);/, '--omega-gradient-stops');
  const jsStops = readStops(motion, /const RAINBOW_STOPS = \[([^\]]+)\]/, 'RAINBOW_STOPS');

  assert.deepStrictEqual(
    scssStops,
    ['#f2d478', '#f2a288', '#f094c2', '#bd97f2', '#88b4f2', '#7fd9cf', '#a5e08c', '#f2d478'],
    'the hand-mixed pastel ramp: butter → coral → pink → lavender → periwinkle → aqua → soft green, first stop repeated so the wrap is seamless',
  );
  assert.deepStrictEqual(
    jsStops,
    scssStops,
    'motion.js RAINBOW_STOPS drifted from --omega-gradient-stops — the ring and the dotfield are the same palette: change both or neither',
  );
});
