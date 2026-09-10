/**
 * #768: the font metric reader behind the metric-matched fallback faces.
 *
 * The numbers a fallback face is built from come from the FONT FILE, never
 * from a table someone typed: a theme's own vendored face is covered the day
 * it ships. The reader takes a WOFF2 (what every theme vendors) and a bare
 * sfnt (what the system families on a build machine are), and hands back the
 * five values the overrides are computed from.
 */
const assert = require('node:assert');
const path = require('node:path');
const { test } = require('node:test');
const fs = require('fs-jetpack');

const { readFontMetrics, systemFontMetrics } = require('../src/font-metrics.js');
const { PKG } = require('./lib/build.js');

const CLASSY_FONTS = path.join(PKG, 'themes', 'classy', 'fonts');

test('readFontMetrics: reads a vendored WOFF2 (classy\'s Inter) with no dependency', () => {
  const metrics = readFontMetrics(fs.read(path.join(CLASSY_FONTS, 'inter-normal-latin.woff2'), 'buffer'));

  // Inter's own published vertical metrics: the numbers the file carries,
  // not a shape this reader invented.
  assert.equal(metrics.unitsPerEm, 2048, 'Inter\'s em square');
  assert.equal(metrics.ascent, 1984, 'above the baseline');
  assert.equal(metrics.descent, -494, 'below it, sign kept as the font stores it');
  assert.equal(metrics.lineGap, 0);
  assert.ok(metrics.avgCharWidth > 0, 'the measured average advance is present');

  // A face's content box is close to its em square, and its average glyph is
  // half of one. That is the sanity band that catches a table read off by an order
  // of magnitude.
  const height = (metrics.ascent - metrics.descent) / metrics.unitsPerEm;
  assert.ok(height > 1 && height < 1.5, `content height ${height} is em-scale`);
  const width = metrics.avgCharWidth / metrics.unitsPerEm;
  assert.ok(width > 0.3 && width < 0.8, `average advance ${width} is em-scale`);
});

test('readFontMetrics: the italic face of the same family reads too', () => {
  const metrics = readFontMetrics(fs.read(path.join(CLASSY_FONTS, 'inter-italic-latin.woff2'), 'buffer'));

  assert.equal(metrics.unitsPerEm, 2048);
  assert.ok(metrics.ascent > 0 && metrics.descent < 0 && metrics.avgCharWidth > 0);
});

test('readFontMetrics: a second family (Newsreader) reads its own numbers', () => {
  const inter = readFontMetrics(fs.read(path.join(CLASSY_FONTS, 'inter-normal-latin.woff2'), 'buffer'));
  const newsreader = readFontMetrics(fs.read(path.join(CLASSY_FONTS, 'newsreader-normal-latin.woff2'), 'buffer'));

  assert.ok(newsreader.avgCharWidth > 0);
  assert.notDeepEqual(newsreader, inter, 'two families never measure identical');
});

test('readFontMetrics: a bare sfnt (a system TTF) goes through the same reader', () => {
  const arial = '/System/Library/Fonts/Supplemental/Arial.ttf';
  if (!fs.exists(arial)) return; // a non-mac machine: the WOFF2 lane above is the pin

  const metrics = readFontMetrics(fs.read(arial, 'buffer'));

  // Arial's published metrics, and the same numbers the checked-in system
  // table carries: the sfnt lane and the WOFF2 lane share one table parse.
  assert.equal(metrics.unitsPerEm, 2048, 'Arial\'s em square');
  assert.equal(metrics.ascent, 1854);
  assert.equal(metrics.descent, -434);
  assert.equal(metrics.lineGap, 67);
  assert.equal(Number(metrics.avgCharWidth.toFixed(3)), systemFontMetrics('Arial').avgCharWidth, 'the table row re-measures');
});

test('readFontMetrics: a corrupt or truncated buffer throws, naming what it is not', () => {
  assert.throws(() => readFontMetrics(Buffer.from('not a font at all')), /font/i);
  assert.throws(
    () => readFontMetrics(fs.read(path.join(CLASSY_FONTS, 'inter-normal-latin.woff2'), 'buffer').subarray(0, 40)),
    /font|truncat/i,
  );
});

test('systemFontMetrics: the built-in table answers by name, case and quotes aside', () => {
  const arial = systemFontMetrics('Arial');

  assert.ok(arial, 'Arial is in the table');
  assert.deepEqual(systemFontMetrics('arial'), arial, 'the lookup is case-insensitive');
  assert.deepEqual(systemFontMetrics('"Times New Roman"'), systemFontMetrics('Times New Roman'), 'quotes are stripped');
  assert.equal(systemFontMetrics('Comic Papyrus Neue'), null, 'a family the table does not know is null');

  for (const family of ['Arial', 'Helvetica Neue', 'Georgia', 'Times New Roman', 'Verdana']) {
    const metrics = systemFontMetrics(family);
    assert.ok(metrics && metrics.unitsPerEm > 0 && metrics.ascent > 0 && metrics.descent < 0 && metrics.avgCharWidth > 0, `${family} carries all five metrics`);
  }
});
