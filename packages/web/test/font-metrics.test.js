/**
 * #768: the font metric reader behind the metric-matched fallback faces.
 *
 * The numbers a fallback face is built from come from the FONT FILE, never
 * from a table someone typed: a theme's own vendored face is covered the day
 * it ships. The reader takes a WOFF2 (what every theme vendors) and a bare
 * sfnt (what the system families on a build machine are), and hands back the
 * five values the overrides are computed from.
 */
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('fs-jetpack');

const { readFontMetrics, systemFontMetrics } = require('../src/font-metrics.js');
const { PKG } = require('./lib/build.js');

const CLASSY_FONTS = path.join(PKG, 'themes', 'classy', 'fonts');

module.exports = defineCases({
  type: 'group',
  description: 'font-metrics',
  tests: [
    {
      name: 'readFontMetrics: reads a vendored WOFF2 (classy\'s Inter) with no dependency',
      run: (ctx) => {
        const metrics = readFontMetrics(fs.read(path.join(CLASSY_FONTS, 'inter-normal-latin.woff2'), 'buffer'));

        // Inter's own published vertical metrics: the numbers the file carries,
        // not a shape this reader invented.
        ctx.expect(metrics.unitsPerEm, 'Inter\'s em square').toBe(2048);
        ctx.expect(metrics.ascent, 'above the baseline').toBe(1984);
        ctx.expect(metrics.descent, 'below it, sign kept as the font stores it').toBe(-494);
        ctx.expect(metrics.lineGap).toBe(0);
        ctx.expect(metrics.avgCharWidth > 0, 'the measured average advance is present').toBeTruthy();

        // A face's content box is close to its em square, and its average glyph is
        // half of one. That is the sanity band that catches a table read off by an order
        // of magnitude.
        const height = (metrics.ascent - metrics.descent) / metrics.unitsPerEm;
        ctx.expect(height > 1 && height < 1.5, `content height ${height} is em-scale`).toBeTruthy();
        const width = metrics.avgCharWidth / metrics.unitsPerEm;
        ctx.expect(width > 0.3 && width < 0.8, `average advance ${width} is em-scale`).toBeTruthy();
      },
    },

    {
      name: 'readFontMetrics: the italic face of the same family reads too',
      run: (ctx) => {
        const metrics = readFontMetrics(fs.read(path.join(CLASSY_FONTS, 'inter-italic-latin.woff2'), 'buffer'));

        ctx.expect(metrics.unitsPerEm).toBe(2048);
        ctx.expect(metrics.ascent > 0 && metrics.descent < 0 && metrics.avgCharWidth > 0).toBeTruthy();
      },
    },

    {
      name: 'readFontMetrics: a second family (Newsreader) reads its own numbers',
      run: (ctx) => {
        const inter = readFontMetrics(fs.read(path.join(CLASSY_FONTS, 'inter-normal-latin.woff2'), 'buffer'));
        const newsreader = readFontMetrics(fs.read(path.join(CLASSY_FONTS, 'newsreader-normal-latin.woff2'), 'buffer'));

        ctx.expect(newsreader.avgCharWidth > 0).toBeTruthy();
        ctx.expect(newsreader, 'two families never measure identical').not.toEqual(inter);
      },
    },

    {
      name: 'readFontMetrics: a bare sfnt (a system TTF) goes through the same reader',
      run: (ctx) => {
        const arial = '/System/Library/Fonts/Supplemental/Arial.ttf';
        if (!fs.exists(arial)) return; // a non-mac machine: the WOFF2 lane above is the pin

        const metrics = readFontMetrics(fs.read(arial, 'buffer'));

        // Arial's published metrics, and the same numbers the checked-in system
        // table carries: the sfnt lane and the WOFF2 lane share one table parse.
        ctx.expect(metrics.unitsPerEm, 'Arial\'s em square').toBe(2048);
        ctx.expect(metrics.ascent).toBe(1854);
        ctx.expect(metrics.descent).toBe(-434);
        ctx.expect(metrics.lineGap).toBe(67);
        ctx.expect(Number(metrics.avgCharWidth.toFixed(3)), 'the table row re-measures').toBe(systemFontMetrics('Arial').avgCharWidth);
      },
    },

    {
      name: 'readFontMetrics: a corrupt or truncated buffer throws, naming what it is not',
      run: (ctx) => {
        ctx.expect(() => readFontMetrics(Buffer.from('not a font at all'))).toThrow(/font/i);
        ctx.expect(() => readFontMetrics(fs.read(path.join(CLASSY_FONTS, 'inter-normal-latin.woff2'), 'buffer').subarray(0, 40))).toThrow(/font|truncat/i);
      },
    },

    {
      name: 'systemFontMetrics: the built-in table answers by name, case and quotes aside',
      run: (ctx) => {
        const arial = systemFontMetrics('Arial');

        ctx.expect(arial, 'Arial is in the table').toBeTruthy();
        ctx.expect(systemFontMetrics('arial'), 'the lookup is case-insensitive').toEqual(arial);
        ctx.expect(systemFontMetrics('"Times New Roman"'), 'quotes are stripped').toEqual(systemFontMetrics('Times New Roman'));
        ctx.expect(systemFontMetrics('Comic Papyrus Neue'), 'a family the table does not know is null').toBe(null);

        for (const family of ['Arial', 'Helvetica Neue', 'Georgia', 'Times New Roman', 'Verdana']) {
          const metrics = systemFontMetrics(family);
          ctx.expect(metrics && metrics.unitsPerEm > 0 && metrics.ascent > 0 && metrics.descent < 0 && metrics.avgCharWidth > 0, `${family} carries all five metrics`).toBeTruthy();
        }
      },
    },
  ],
});
