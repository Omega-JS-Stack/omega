/**
 * SVG logo generator tests. The service renders its own path data instead
 * of calling opentype.js's `Path.prototype.toPathData`, whose rounding
 * helper turns a coordinate sitting within float noise of an integer into
 * NaN and poisons the whole wordmark (#916). The regression case pins
 * the exact command that breaks upstream (the synthetic font in
 * assets.test.js has integer coordinates, so it can never hit it), the
 * refusal proves a non-finite path is never written, and the integration
 * case renders the real font that found the bug when it is installed.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const opentype = require('opentype.js');

const { renderPathData, generateWordmark } = require('../src/services/assets/lib/svg-logo-generator.js');
const { loadFont } = require('../src/services/assets/lib/font-loader.js');

// The glyph that found the bug: SourceSansPro-Semibold's `N` at 72px
const SEMIBOLD_N_SEGMENT = [
  { type: 'M', x: 0, y: 0 },
  { type: 'L', x: 18.000000000000004, y: -26.496000000000002 },
  { type: 'Z' },
];

const SEMIBOLD_PATH = '/Library/Fonts/SourceSansPro-Semibold.otf';

// ─── Rendering ───────────────────────────────────────────────────────────────

test('svg-logo-generator: float-noise coordinates render clean (opentype yields NaN)', () => {
  // Red: upstream's own renderer poisons this path
  const path = new opentype.Path();
  path.extend(SEMIBOLD_N_SEGMENT);
  assert.match(path.toPathData(4), /NaN/);

  // Green: ours rounds correctly
  assert.equal(renderPathData(SEMIBOLD_N_SEGMENT), 'M0 0L18-26.496Z');
});

test('svg-logo-generator: every command type packs like SVG path data', () => {
  const rendered = renderPathData([
    { type: 'M', x: 1.5, y: -2 },
    { type: 'L', x: 3, y: 4.00001 },
    { type: 'C', x1: 1, y1: -1, x2: 2, y2: -2, x: 3, y: -3 },
    { type: 'Q', x1: 0.12345, y1: 5, x: 6, y: 7 },
    { type: 'Z' },
  ]);

  assert.equal(rendered, 'M1.5-2L3 4C1-1 2-2 3-3Q0.1235 5 6 7Z');
});

// ─── The refusal ─────────────────────────────────────────────────────────────

test('svg-logo-generator: a non-finite coordinate is refused, naming the font and the text', () => {
  const font = {
    getPath: () => ({
      commands: [{ type: 'M', x: 0, y: 0 }, { type: 'L', x: NaN, y: 12 }],
      getBoundingBox: () => ({ x1: 0, y1: 0, x2: 40, y2: 20 }),
    }),
  };

  assert.throws(
    () => generateWordmark('Notifly', font, '/Library/Fonts/Broken-Font.otf'),
    (error) => /Broken-Font\.otf/.test(error.message) && /Notifly/.test(error.message),
  );
});

// ─── The real font ───────────────────────────────────────────────────────────

const semiboldMissing = fs.existsSync(SEMIBOLD_PATH) ? null : `${SEMIBOLD_PATH} is not installed`;
// `skip` must be ABSENT to run: node's runner reports `skip: null` as SKIP
const semiboldOptions = semiboldMissing ? { skip: semiboldMissing } : {};

test('svg-logo-generator: the wordmark that found the bug renders clean', semiboldOptions, () => {
  const loaded = loadFont('SourceSansPro-Semibold', os.tmpdir());
  assert.ok(loaded, 'the installed font resolves');

  const svg = generateWordmark('Notifly', loaded.font, loaded.fontPath);

  assert.doesNotMatch(svg, /NaN|Infinity/);
  const pathData = svg.match(/<path d="([^"]+)"/)[1];
  assert.ok(pathData.length > 200, `wordmark path is substantial (got ${pathData.length} chars)`);
});
