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

  // #499: CSS can park an animation; it cannot pause a <video>. No lane did,
  // so every autoplaying band (the hero video demo, marketing/product-demo)
  // kept moving for a visitor who asked for stillness. The engine owns it now,
  // for every section at once. The unit env has no DOM, so the element is a
  // stub of exactly the surface setupVideo touches (the icon-renderer idiom).
  describe('reduced-motion video park (#499)', () => {
    /** A <video autoplay> stub: attributes, properties, and pause(). */
    function makeVideo() {
      const attributes = new Set(['autoplay', 'loop', 'muted']);
      return {
        tagName: 'VIDEO',
        dataset: {},
        autoplay: true,
        controls: false,
        paused: false,
        pauseCalls: 0,
        hasAttribute: (name) => attributes.has(name),
        removeAttribute: (name) => attributes.delete(name),
        matches: (selector) => selector === 'video[autoplay]' && attributes.has('autoplay'),
        querySelectorAll: () => [],
        pause() {
          this.pauseCalls += 1;
          this.paused = true;
        },
      };
    }

    /** A root whose only motion targets are the given videos. */
    const rootOf = (videos) => ({
      matches: () => false,
      querySelectorAll: (selector) => (selector === 'video[autoplay]' ? videos : []),
    });

    /** Run scan with prefers-reduced-motion answering `reduced`. */
    function scanWith(reduced, videos) {
      const original = global.window.matchMedia;
      global.window.matchMedia = (query) => ({ matches: reduced && query.includes('prefers-reduced-motion') });
      try {
        motion.createMotion().scan(rootOf(videos));
      } finally {
        global.window.matchMedia = original;
      }
    }

    it('pauses an autoplaying video and shows its controls', () => {
      const video = makeVideo();
      scanWith(true, [video]);

      assert.strictEqual(video.paused, true, 'the video is parked');
      assert.strictEqual(video.pauseCalls, 1, 'paused by the engine, not by luck');
      assert.strictEqual(video.autoplay, false, 'and it will not restart itself');
      assert.strictEqual(video.hasAttribute('autoplay'), false, 'the attribute goes with it');
      assert.strictEqual(video.controls, true, 'the visitor gets the controls to start it themselves');
    });

    it('leaves an autoplaying video alone when the visitor asked for nothing', () => {
      const video = makeVideo();
      scanWith(false, [video]);

      assert.strictEqual(video.paused, false, 'the authored playback stands');
      assert.strictEqual(video.pauseCalls, 0, 'nothing paused it');
      assert.strictEqual(video.autoplay, true, 'autoplay survives');
      assert.strictEqual(video.controls, false, 'and a controls-off band stays clean');
    });

    it('is idempotent — a rescan never pauses a video the visitor started', () => {
      const video = makeVideo();
      scanWith(true, [video]);

      video.paused = false; // the visitor pressed play
      scanWith(true, [video]);

      assert.strictEqual(video.pauseCalls, 1, 'the second scan leaves it running');
      assert.strictEqual(video.paused, false);
    });
  });
});
