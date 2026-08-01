/**
 * motion tests — the shared animation engine's pure logic (classy v2): the
 * count-up parser/formatter round-trip and the factory's environment safety
 * (no document → inert, like icon-renderer). The DOM behaviors (reveals,
 * rotators, marquees) are exercised end-to-end by @omega.js/web's build
 * and the browser proof. Pure CJS — required straight from dist.
 */
const { describe, it, before } = require('node:test');
const assert = require('assert');
const path = require('path');
require('./helpers.js');

const DIST_PATH = path.join(__dirname, '..', 'dist', 'modules', 'motion.js');

describe('motion', () => {
  let motion;

  before(() => {
    motion = require(DIST_PATH);
  });

  describe('parseCountTarget', () => {
    it('parses plain integers with grouping and suffixes', () => {
      assert.deepStrictEqual(motion.parseCountTarget('12,400+'), {
        prefix: '',
        value: 12400,
        decimals: 0,
        suffix: '+',
        grouped: true,
      });
    });

    it('parses currency prefixes and decimals', () => {
      assert.deepStrictEqual(motion.parseCountTarget('$1,234.56'), {
        prefix: '$',
        value: 1234.56,
        decimals: 2,
        suffix: '',
        grouped: true,
      });
    });

    it('parses percentages and ratings', () => {
      assert.deepStrictEqual(motion.parseCountTarget('99.98%'), {
        prefix: '',
        value: 99.98,
        decimals: 2,
        suffix: '%',
        grouped: false,
      });
      assert.deepStrictEqual(motion.parseCountTarget('4.9/5'), {
        prefix: '',
        value: 4.9,
        decimals: 1,
        suffix: '/5',
        grouped: false,
      });
    });

    it('returns null for text without a number', () => {
      assert.strictEqual(motion.parseCountTarget('Unlimited'), null);
      assert.strictEqual(motion.parseCountTarget(''), null);
    });
  });

  describe('formatCount', () => {
    it('round-trips the parsed target at full value', () => {
      for (const text of ['12,400+', '$1,234.56', '99.98%', '4.9/5', '200+', '2017', '120+']) {
        const target = motion.parseCountTarget(text);
        assert.strictEqual(motion.formatCount(target, target.value), text);
      }
    });

    it('formats intermediate frames with the target decimals and grouping', () => {
      const target = motion.parseCountTarget('50,000+');
      assert.strictEqual(motion.formatCount(target, 12345.678), '12,346+');
    });

    it('never invents grouping the markup did not have (years stay years)', () => {
      const year = motion.parseCountTarget('2017');
      assert.strictEqual(motion.formatCount(year, 2017), '2017');
      assert.strictEqual(motion.formatCount(year, 1234.5), '1235');
    });
  });

  describe('marqueeCopies', () => {
    it('clones the set until half the track covers the container', () => {
      // 500px set in a 1400px container → 3 copies per half (1500 ≥ 1400)
      assert.strictEqual(motion.marqueeCopies(500, 1400), 3);
      // exact fit needs no extra copy
      assert.strictEqual(motion.marqueeCopies(700, 1400), 2);
      // a set already wider than the container needs one copy
      assert.strictEqual(motion.marqueeCopies(1600, 1400), 1);
    });

    it('falls back to one copy when geometry is unmeasurable', () => {
      assert.strictEqual(motion.marqueeCopies(0, 1400), 1);
      assert.strictEqual(motion.marqueeCopies(500, 0), 1);
      assert.strictEqual(motion.marqueeCopies(NaN, 1400), 1);
    });
  });

  describe('rainbowColor', () => {
    it('returns valid rgb channels and is deterministic', () => {
      const a = motion.rainbowColor(100, 50, 1400, 2);
      const b = motion.rainbowColor(100, 50, 1400, 2);

      assert.deepStrictEqual(a, b);
      a.forEach((channel) => {
        assert.ok(Number.isInteger(channel) && channel >= 0 && channel <= 255, `channel in range: ${channel}`);
      });
    });

    it('the palette advances across the field — one gradient, not confetti', () => {
      // Same moment, positions a quarter-field apart → clearly different colors
      const left = motion.rainbowColor(0, 0, 1400, 0);
      const mid = motion.rainbowColor(700, 0, 1400, 0);
      assert.notDeepStrictEqual(left, mid);
    });

    it('lands exactly on the classy pastel stops at their positions', () => {
      // pos = x / (width * 1.25) at t=0, y=0 → one segment every 1750/7 = 250px
      assert.deepStrictEqual(motion.rainbowColor(0, 0, 1400, 0), [0xf2, 0xd4, 0x78], 'butter');
      assert.deepStrictEqual(motion.rainbowColor(250, 0, 1400, 0), [0xf2, 0xa2, 0x88], 'coral');
      assert.deepStrictEqual(motion.rainbowColor(500, 0, 1400, 0), [0xf0, 0x94, 0xc2], 'pink');
      assert.deepStrictEqual(motion.rainbowColor(750, 0, 1400, 0), [0xbd, 0x97, 0xf2], 'lavender');
      assert.deepStrictEqual(motion.rainbowColor(1000, 0, 1400, 0), [0x88, 0xb4, 0xf2], 'periwinkle');
      assert.deepStrictEqual(motion.rainbowColor(1250, 0, 1400, 0), [0x7f, 0xd9, 0xcf], 'aqua');
      assert.deepStrictEqual(motion.rainbowColor(1500, 0, 1400, 0), [0xa5, 0xe0, 0x8c], 'soft green');
      // The last stop repeats the first, so the sweep wraps back to butter
      assert.deepStrictEqual(motion.rainbowColor(1750, 0, 1400, 0), [0xf2, 0xd4, 0x78], 'wraps to butter');
    });

    it('blends per channel between adjacent stops', () => {
      // Halfway through the butter → coral segment
      assert.deepStrictEqual(motion.rainbowColor(125, 0, 1400, 0), [
        0xf2,
        Math.round((0xd4 + 0xa2) / 2),
        Math.round((0x78 + 0x88) / 2),
      ]);
    });

    it('drifts with time and wraps cleanly past a full cycle', () => {
      const now = motion.rainbowColor(300, 100, 1400, 0);
      const later = motion.rainbowColor(300, 100, 1400, 5);
      assert.notDeepStrictEqual(now, later, 'gradient moves over time');

      // t*0.05 → a full hue cycle every 20s: same dot, same color again
      const cycled = motion.rainbowColor(300, 100, 1400, 20);
      assert.deepStrictEqual(now, cycled);
    });

    it('fills a caller-supplied array without allocating (hot loop contract)', () => {
      const out = [0, 0, 0];
      const result = motion.rainbowColor(64, 64, 800, 1, out);
      assert.strictEqual(result, out);
    });
  });

  describe('createMotion', () => {
    it('returns the engine surface and stays inert without a document', () => {
      const engine = motion.createMotion();

      assert.strictEqual(typeof engine.start, 'function');
      assert.strictEqual(typeof engine.stop, 'function');
      assert.strictEqual(typeof engine.scan, 'function');

      // No document in the unit env — start()/scan()/stop() must not throw.
      engine.start();
      engine.scan(null);
      engine.stop();
    });
  });
});
