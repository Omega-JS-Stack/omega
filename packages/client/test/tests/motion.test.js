/**
 * motion tests — the shared animation engine's pure logic (classy v2): the
 * count-up parser/formatter round-trip and the factory's environment safety
 * (no document → inert, like icon-renderer). The DOM behaviors (reveals,
 * rotators, marquees) are exercised end-to-end by @omega.js/web's build
 * and the browser proof. Pure CJS — required straight from dist.
 */
const assert = require('assert');
const path = require('path');

const DIST_PATH = path.join(__dirname, '..', '..', 'dist', 'modules', 'motion.js');

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
