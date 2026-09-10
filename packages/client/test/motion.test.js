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

  // #752: the dotfield hero canvas repainted its whole grid on every animation
  // frame from the moment the engine scanned, inside the LCP window, on the
  // page's own thread, and the marquee read geometry in the same tick it
  // replaced the track's children (a forced reflow). The unit env has no DOM,
  // so each case builds the exact surface these two lanes touch (the
  // icon-renderer/#499 idiom) plus a hand-driven rAF and idle queue.
  describe('first-paint budget (#752)', () => {
    /** A 2d context stub that counts grid repaints (one clearRect each). */
    function makeContext() {
      const ctx = {
        clears: 0,
        dots: 0,
        fills: [],
        setTransform() {},
        clearRect() { this.clears += 1; },
        beginPath() {},
        arc() { this.dots += 1; },
        fill() {},
        /** The color of the last dot drawn. */
        lastDot: () => ctx.fills.filter((value) => String(value).startsWith('rgba')).pop(),
      };

      // fillStyle is an accessor because the engine writes it twice: once per
      // dot, and once per color parse (it round-trips a CSS value through the
      // canvas to normalize it).
      let current = '#000000';
      Object.defineProperty(ctx, 'fillStyle', {
        get: () => current,
        set: (value) => {
          current = value;
          ctx.fills.push(value);
        },
      });

      return ctx;
    }

    /**
     * Install the browser surface the motion engine reaches for, with the
     * animation frames, idle callbacks and the load event under test control.
     * Everything is restored afterwards: the suite shares one global window.
     */
    function withMotionEnv({ reduced = false, readyState = 'complete', idleCallback = true } = {}, body) {
      const frames = [];
      const idles = [];
      const listeners = { load: [] };
      const observers = { resize: [], mutation: [] };
      let lineColor = '#808080';
      const originals = {
        raf: global.requestAnimationFrame,
        caf: global.cancelAnimationFrame,
        matchMedia: global.window.matchMedia,
        computed: global.window.getComputedStyle,
        idle: global.window.requestIdleCallback,
        add: global.window.addEventListener,
        resizeObserver: global.ResizeObserver,
        mutationObserver: global.MutationObserver,
      };

      global.requestAnimationFrame = (fn) => frames.push(fn);
      global.cancelAnimationFrame = () => {};
      global.window.matchMedia = (query) => ({ matches: reduced && query.includes('prefers-reduced-motion') });
      global.window.getComputedStyle = () => ({ getPropertyValue: () => lineColor });
      global.window.addEventListener = (type, fn) => {
        (listeners[type] = listeners[type] || []).push(fn);
      };
      global.ResizeObserver = class {
        constructor(fn) { this.fn = fn; }
        observe() { observers.resize.push(this.fn); }
        disconnect() {}
      };
      global.MutationObserver = class {
        constructor(fn) { this.fn = fn; }
        observe() { observers.mutation.push(this.fn); }
        disconnect() {}
      };
      if (idleCallback) {
        global.window.requestIdleCallback = (fn) => idles.push(fn);
      } else {
        delete global.window.requestIdleCallback;
      }

      const env = {
        readyState,
        /** Render one animation frame at `now` (ms). */
        frame: (now) => frames.splice(0, frames.length).forEach((fn) => fn(now)),
        /** How many callbacks are waiting on the next frame. */
        pending: () => frames.length,
        /** Run the queued idle callbacks. */
        idle: () => idles.splice(0, idles.length).forEach((fn) => fn({ didTimeout: false, timeRemaining: () => 50 })),
        /** Fire the window load event. */
        load: () => (listeners.load || []).splice(0).forEach((fn) => fn()),
        /** Fire every ResizeObserver the engine armed (it fires on observe too). */
        resize: () => observers.resize.forEach((fn) => fn([])),
        /** Flip data-bs-theme to a page whose line color is `color`. */
        themeFlip: (color) => {
          lineColor = color;
          observers.mutation.forEach((fn) => fn([]));
        },
      };

      try {
        body(env);
      } finally {
        global.requestAnimationFrame = originals.raf;
        global.cancelAnimationFrame = originals.caf;
        global.window.matchMedia = originals.matchMedia;
        global.window.getComputedStyle = originals.computed;
        global.window.addEventListener = originals.add;
        if (originals.idle === undefined) {
          delete global.window.requestIdleCallback;
        } else {
          global.window.requestIdleCallback = originals.idle;
        }
        if (originals.resizeObserver === undefined) {
          delete global.ResizeObserver;
        } else {
          global.ResizeObserver = originals.resizeObserver;
        }
        if (originals.mutationObserver === undefined) {
          delete global.MutationObserver;
        } else {
          global.MutationObserver = originals.mutationObserver;
        }
      }
    }

    /** A root whose only motion target is `el`, found by `selector`. */
    const rootOf = (selector, el) => ({
      matches: () => false,
      querySelectorAll: (query) => (query === selector ? [el] : []),
    });

    /** A `[data-omega-dotfield]` element and the canvas the engine prepends. */
    function makeField(readyState) {
      const ctx = makeContext();
      const canvas = {
        className: '',
        width: 0,
        height: 0,
        setAttribute() {},
        getContext: () => ctx,
      };
      const doc = {
        readyState,
        hidden: false,
        createElement: () => canvas,
        addEventListener() {},
        documentElement: { addEventListener() {} },
      };
      const el = {
        dataset: {},
        clientHeight: 100,
        measures: 0,
        get clientWidth() {
          this.measures += 1;
          return 200;
        },
        ownerDocument: doc,
        prepended: [],
        getAttribute: (name) => (name === 'data-omega-dotfield' ? '20' : null),
        prepend(node) { this.prepended.push(node); },
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 100 }),
      };
      return { el, ctx, canvas };
    }

    describe('dotfield', () => {
      it('paints nothing until first paint has settled', () => {
        withMotionEnv({}, (env) => {
          const field = makeField(env.readyState);
          motion.createMotion().scan(rootOf('[data-omega-dotfield]', field.el));

          assert.strictEqual(field.ctx.clears, 0, 'the scan itself paints nothing');
          assert.strictEqual(env.pending(), 0, 'and arms no animation frame at all');

          env.frame(0);
          assert.strictEqual(field.ctx.clears, 0, 'a frame before the settle signal still paints nothing');

          env.idle();
          env.frame(0);
          assert.strictEqual(field.ctx.clears, 1, 'the first grid lands on the settle signal');
          assert.ok(field.ctx.dots > 0, 'and it is a real grid');
        });
      });

      it('waits for the load event before asking for idle time', () => {
        withMotionEnv({ readyState: 'loading' }, (env) => {
          const field = makeField(env.readyState);
          motion.createMotion().scan(rootOf('[data-omega-dotfield]', field.el));

          env.idle();
          env.frame(0);
          assert.strictEqual(field.ctx.clears, 0, 'a document still loading paints nothing');

          env.load();
          env.idle();
          env.frame(0);
          assert.strictEqual(field.ctx.clears, 1, 'the field starts once the page is loaded and idle');
        });
      });

      it('falls back to the load event where idle callbacks do not exist', () => {
        withMotionEnv({ readyState: 'loading', idleCallback: false }, (env) => {
          const field = makeField(env.readyState);
          motion.createMotion().scan(rootOf('[data-omega-dotfield]', field.el));

          assert.strictEqual(field.ctx.clears, 0, 'nothing before load');
          assert.strictEqual(env.pending(), 0, 'and no frame is even armed before it');

          env.load();
          env.frame(0);
          assert.strictEqual(field.ctx.clears, 1, 'load alone is the signal on browsers without requestIdleCallback');
        });
      });

      it('hands the CSS fallback dots off on the first painted grid, not at scan', () => {
        withMotionEnv({}, (env) => {
          const field = makeField(env.readyState);
          motion.createMotion().scan(rootOf('[data-omega-dotfield]', field.el));

          // `.omega-dotgrid[data-omega-dotfield-ready]::before` fades the CSS
          // dots out on this stamp, so an early one leaves the hero blank.
          assert.strictEqual(field.el.dataset.omegaDotfieldReady, undefined, 'not at scan');

          env.idle();
          assert.strictEqual(field.el.dataset.omegaDotfieldReady, undefined, 'not on the settle signal either');

          env.frame(0);
          assert.strictEqual(field.ctx.clears, 1, 'the first grid is painted');
          assert.strictEqual(field.el.dataset.omegaDotfieldReady, 'true', 'and the CSS dots hand off to it');
        });
      });

      it('installs once, even rescanned before the stamp lands', () => {
        withMotionEnv({}, (env) => {
          const field = makeField(env.readyState);
          const engine = motion.createMotion();
          const root = rootOf('[data-omega-dotfield]', field.el);

          engine.scan(root);
          engine.scan(root); // a MutationObserver rescan, before the stamp exists

          assert.strictEqual(field.el.prepended.length, 1, 'one canvas, not two');

          env.idle();
          env.frame(0);
          assert.strictEqual(field.ctx.clears, 1, 'and one field painting it');
        });
      });

      it('sizes the canvas at the settle signal, never through an early resize observer', () => {
        withMotionEnv({}, (env) => {
          const field = makeField(env.readyState);
          motion.createMotion().scan(rootOf('[data-omega-dotfield]', field.el));

          assert.strictEqual(field.el.measures, 0, 'the scan measures nothing');

          env.resize(); // the observer's own first callback, a frame after scan
          assert.strictEqual(field.el.measures, 0, 'and neither does the observer, before settle');
          assert.strictEqual(field.canvas.width, 0, 'so nothing allocates a backing store either');

          env.idle();
          assert.ok(field.el.measures > 0, 'the settle callback is what measures');
          assert.strictEqual(field.canvas.width, 200, 'and sizes the canvas to the field');

          const settledMeasures = field.el.measures;
          env.resize();
          assert.ok(field.el.measures > settledMeasures, 'a resize after settle is honored as before');
        });
      });

      it('caps the repaint cadence at 30fps, whatever the display runs at', () => {
        withMotionEnv({}, (env) => {
          const field = makeField(env.readyState);
          motion.createMotion().scan(rootOf('[data-omega-dotfield]', field.el));
          env.idle();

          // One second of a 60Hz display
          for (let i = 0; i <= 60; i += 1) {
            env.frame((i * 1000) / 60);
          }
          assert.ok(field.ctx.clears <= 31, `capped at ~30 repaints/s, got ${field.ctx.clears}`);
          assert.ok(field.ctx.clears >= 29, `still animating, got ${field.ctx.clears}`);
        });

        withMotionEnv({}, (env) => {
          const field = makeField(env.readyState);
          motion.createMotion().scan(rootOf('[data-omega-dotfield]', field.el));
          env.idle();

          // One second of a 120Hz display; the cap is the same number
          for (let i = 0; i <= 120; i += 1) {
            env.frame((i * 1000) / 120);
          }
          assert.ok(field.ctx.clears <= 31, `120Hz stays capped, got ${field.ctx.clears}`);
          assert.ok(field.ctx.clears >= 29, `and still animates, got ${field.ctx.clears}`);
        });
      });

      it('gives a reduced-motion visitor one static grid and no loop', () => {
        withMotionEnv({ reduced: true }, (env) => {
          const field = makeField(env.readyState);
          motion.createMotion().scan(rootOf('[data-omega-dotfield]', field.el));

          assert.strictEqual(field.ctx.clears, 0, 'not even the static grid competes with first paint');
          assert.strictEqual(field.el.dataset.omegaDotfieldReady, undefined, 'and the CSS dots stay until there is a grid');

          env.idle();
          assert.strictEqual(field.ctx.clears, 1, 'one grid, drawn once');
          assert.strictEqual(env.pending(), 0, 'no animation frame was ever armed');

          env.frame(16);
          env.frame(32);
          assert.strictEqual(field.ctx.clears, 1, 'and nothing repaints it');
          assert.strictEqual(field.el.dataset.omegaDotfieldReady, 'true', 'the CSS handoff stamp lands with that grid');
        });
      });

      it('re-reads the theme color for a still grid, which has no loop to poll it', () => {
        withMotionEnv({ reduced: true }, (env) => {
          const field = makeField(env.readyState);
          motion.createMotion().scan(rootOf('[data-omega-dotfield]', field.el));
          env.idle();

          const before = field.ctx.lastDot();
          env.themeFlip('#ffffff'); // dark → light: --omega-line-strong changes

          assert.strictEqual(field.ctx.clears, 2, 'the still grid is redrawn, once');
          assert.notStrictEqual(field.ctx.lastDot(), before, 'in the color the new theme reads');
          assert.strictEqual(env.pending(), 0, 'and it still never armed a frame');
        });
      });

      it('repaints a still grid on resize, in the current theme color', () => {
        withMotionEnv({ reduced: true }, (env) => {
          const field = makeField(env.readyState);
          motion.createMotion().scan(rootOf('[data-omega-dotfield]', field.el));
          env.idle();

          const before = field.ctx.lastDot();
          env.themeFlip('#ffffff');
          env.resize();

          assert.strictEqual(field.ctx.clears, 3, 'the resize redraws it');
          assert.notStrictEqual(field.ctx.lastDot(), before, 'never in the color of the theme it left');
        });
      });
    });

    describe('marquee', () => {
      /** An image inside a marquee item, still loading. */
      const makeImage = () => ({
        complete: false,
        listeners: [],
        addEventListener(type, fn) { this.listeners.push(fn); },
        /** Finish the load, the way a decoded image does. */
        fire() {
          this.complete = true;
          this.listeners.splice(0).forEach((fn) => fn());
        },
      });

      /** A marquee item that can clone itself, optionally carrying images. */
      const makeItem = (images = []) => ({
        matches: () => false,
        querySelectorAll: (selector) => (selector === 'img' ? images : []),
        setAttribute() {},
        cloneNode() { return makeItem(); },
      });

      /**
       * A `.omega-marquee__track` that logs the order of mutation and read,
       * and measures what it actually holds (150px an item), so a read of an
       * already-cloned track is visible in the duration it produces.
       */
      function makeTrack(items) {
        return {
          children: items.slice(),
          calls: [],
          speed: '',
          replaceChildren(...next) {
            this.calls.push('replaceChildren');
            this.children = next;
          },
          appendChild(child) { this.children.push(child); },
          getBoundingClientRect() {
            this.calls.push('read');
            return { width: this.children.length * 150 };
          },
          style: {
            setProperty: (name, value) => {
              if (name === '--omega-marquee-speed') {
                track.speed = value;
              }
            },
          },
        };
      }

      /** A `[data-omega-marquee]` element over `track`, 900px wide. */
      const marqueeOf = (track) => ({
        dataset: {},
        clientWidth: 900,
        getAttribute: () => null,
        querySelector: (selector) => (selector === '.omega-marquee__track' ? track : null),
      });

      let track;

      it('reads the track geometry in a later frame, never in the mutation tick', () => {
        withMotionEnv({}, (env) => {
          track = makeTrack([makeItem(), makeItem()]);
          motion.createMotion().scan(rootOf('[data-omega-marquee]', marqueeOf(track)));

          assert.deepStrictEqual(track.calls, ['replaceChildren'], 'the write lands alone, with no read behind it');
          assert.strictEqual(env.pending(), 1, 'the read is queued for the next frame');

          env.frame(0);
          assert.deepStrictEqual(track.calls, ['replaceChildren', 'read'], 'and lands after the frame');
          // 300px set, 900px container → 3 copies per half, doubled
          assert.strictEqual(track.children.length, 12, 'the clones still land, in that frame');
          assert.strictEqual(track.speed, '11s', 'and the duration comes from the SET width');
        });
      });

      it('a burst of rebuilds still measures the bare set, never a cloned track', () => {
        withMotionEnv({}, (env) => {
          const images = [makeImage(), makeImage()];
          track = makeTrack([makeItem([images[0]]), makeItem([images[1]])]);
          motion.createMotion().scan(rootOf('[data-omega-marquee]', marqueeOf(track)));
          env.frame(0);

          // Both images decode in the same tick, so two rebuilds queue for one
          // frame: the second must not measure what the first just cloned.
          images.forEach((image) => image.fire());
          env.frame(16);

          assert.strictEqual(track.children.length, 12, 'one set of clones, not a doubling');
          assert.strictEqual(track.speed, '11s', 'the duration is still the set width, not the whole track');
        });
      });
    });
  });
});
