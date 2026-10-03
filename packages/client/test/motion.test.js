/**
 * motion tests — the shared animation engine's pure logic (classy v2): the
 * count-up parser/formatter round-trip and the factory's environment safety
 * (no document → inert, like icon-renderer). The DOM behaviors (reveals,
 * rotators, marquees) are exercised end-to-end by @omega.js/web's build
 * and the browser proof. ESM like its siblings, required straight from dist
 * (require(esm)).
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const path = require('path');
const { createOmega, clearStorage, disposeOmega } = require('./helpers.js');

const beforeEachHook = clearStorage;

const DIST_PATH = path.join(__dirname, '..', 'dist', 'modules', 'motion.js');

module.exports = defineCases({
  type: 'group',
  description: 'motion',
  setup: createOmega,
  cleanup: disposeOmega,
  tests: [
    ...(() => {
      const cases = [];
      let motion;

      let beforeHookRun;
      const beforeHook = (ctx) => (beforeHookRun ||= Promise.resolve().then(() => (() => {
        motion = require(DIST_PATH);
      })()));

      cases.push(
        {
          name: 'motion > parseCountTarget > parses plain integers with grouping and suffixes',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            ctx.expect(motion.parseCountTarget('12,400+')).toEqual({
              prefix: '',
              value: 12400,
              decimals: 0,
              suffix: '+',
              grouped: true,
            });
          },
        },
        {
          name: 'motion > parseCountTarget > parses currency prefixes and decimals',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            ctx.expect(motion.parseCountTarget('$1,234.56')).toEqual({
              prefix: '$',
              value: 1234.56,
              decimals: 2,
              suffix: '',
              grouped: true,
            });
          },
        },
        {
          name: 'motion > parseCountTarget > parses percentages and ratings',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            ctx.expect(motion.parseCountTarget('99.98%')).toEqual({
              prefix: '',
              value: 99.98,
              decimals: 2,
              suffix: '%',
              grouped: false,
            });
            ctx.expect(motion.parseCountTarget('4.9/5')).toEqual({
              prefix: '',
              value: 4.9,
              decimals: 1,
              suffix: '/5',
              grouped: false,
            });
          },
        },
        {
          name: 'motion > parseCountTarget > returns null for text without a number',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            ctx.expect(motion.parseCountTarget('Unlimited')).toBe(null);
            ctx.expect(motion.parseCountTarget('')).toBe(null);
          },
        },
      );

      cases.push(
        {
          name: 'motion > formatCount > round-trips the parsed target at full value',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            for (const text of ['12,400+', '$1,234.56', '99.98%', '4.9/5', '200+', '2017', '120+']) {
              const target = motion.parseCountTarget(text);
              ctx.expect(motion.formatCount(target, target.value)).toBe(text);
            }
          },
        },
        {
          name: 'motion > formatCount > formats intermediate frames with the target decimals and grouping',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            const target = motion.parseCountTarget('50,000+');
            ctx.expect(motion.formatCount(target, 12345.678)).toBe('12,346+');
          },
        },
        {
          name: 'motion > formatCount > never invents grouping the markup did not have (years stay years)',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            const year = motion.parseCountTarget('2017');
            ctx.expect(motion.formatCount(year, 2017)).toBe('2017');
            ctx.expect(motion.formatCount(year, 1234.5)).toBe('1235');
          },
        },
      );

      cases.push(
        {
          name: 'motion > marqueeCopies > clones the set until half the track covers the container',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            // 500px set in a 1400px container → 3 copies per half (1500 ≥ 1400)
            ctx.expect(motion.marqueeCopies(500, 1400)).toBe(3);
            // exact fit needs no extra copy
            ctx.expect(motion.marqueeCopies(700, 1400)).toBe(2);
            // a set already wider than the container needs one copy
            ctx.expect(motion.marqueeCopies(1600, 1400)).toBe(1);
          },
        },
        {
          name: 'motion > marqueeCopies > falls back to one copy when geometry is unmeasurable',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            ctx.expect(motion.marqueeCopies(0, 1400)).toBe(1);
            ctx.expect(motion.marqueeCopies(500, 0)).toBe(1);
            ctx.expect(motion.marqueeCopies(NaN, 1400)).toBe(1);
          },
        },
      );

      cases.push(
        {
          name: 'motion > rainbowColor > returns valid rgb channels and is deterministic',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            const a = motion.rainbowColor(100, 50, 1400, 2);
            const b = motion.rainbowColor(100, 50, 1400, 2);

            ctx.expect(a).toEqual(b);
            a.forEach((channel) => {
              ctx.expect(Number.isInteger(channel) && channel >= 0 && channel <= 255, `channel in range: ${channel}`).toBeTruthy();
            });
          },
        },
        {
          name: 'motion > rainbowColor > the palette advances across the field — one gradient, not confetti',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            // Same moment, positions a quarter-field apart → clearly different colors
            const left = motion.rainbowColor(0, 0, 1400, 0);
            const mid = motion.rainbowColor(700, 0, 1400, 0);
            ctx.expect(left).not.toEqual(mid);
          },
        },
        {
          name: 'motion > rainbowColor > lands exactly on the classy pastel stops at their positions',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            // pos = x / (width * 1.25) at t=0, y=0 → one segment every 1750/7 = 250px
            ctx.expect(motion.rainbowColor(0, 0, 1400, 0), 'butter').toEqual([0xf2, 0xd4, 0x78]);
            ctx.expect(motion.rainbowColor(250, 0, 1400, 0), 'coral').toEqual([0xf2, 0xa2, 0x88]);
            ctx.expect(motion.rainbowColor(500, 0, 1400, 0), 'pink').toEqual([0xf0, 0x94, 0xc2]);
            ctx.expect(motion.rainbowColor(750, 0, 1400, 0), 'lavender').toEqual([0xbd, 0x97, 0xf2]);
            ctx.expect(motion.rainbowColor(1000, 0, 1400, 0), 'periwinkle').toEqual([0x88, 0xb4, 0xf2]);
            ctx.expect(motion.rainbowColor(1250, 0, 1400, 0), 'aqua').toEqual([0x7f, 0xd9, 0xcf]);
            ctx.expect(motion.rainbowColor(1500, 0, 1400, 0), 'soft green').toEqual([0xa5, 0xe0, 0x8c]);
            // The last stop repeats the first, so the sweep wraps back to butter
            ctx.expect(motion.rainbowColor(1750, 0, 1400, 0), 'wraps to butter').toEqual([0xf2, 0xd4, 0x78]);
          },
        },
        {
          name: 'motion > rainbowColor > blends per channel between adjacent stops',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            // Halfway through the butter → coral segment
            ctx.expect(motion.rainbowColor(125, 0, 1400, 0)).toEqual([
              0xf2,
              Math.round((0xd4 + 0xa2) / 2),
              Math.round((0x78 + 0x88) / 2),
            ]);
          },
        },
        {
          name: 'motion > rainbowColor > drifts with time and wraps cleanly past a full cycle',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            const now = motion.rainbowColor(300, 100, 1400, 0);
            const later = motion.rainbowColor(300, 100, 1400, 5);
            ctx.expect(now, 'gradient moves over time').not.toEqual(later);

            // t*0.05 → a full hue cycle every 20s: same dot, same color again
            const cycled = motion.rainbowColor(300, 100, 1400, 20);
            ctx.expect(now).toEqual(cycled);
          },
        },
        {
          name: 'motion > rainbowColor > fills a caller-supplied array without allocating (hot loop contract)',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            const out = [0, 0, 0];
            const result = motion.rainbowColor(64, 64, 800, 1, out);
            ctx.expect(result).toBe(out);
          },
        },
      );

      cases.push(
        {
          name: 'motion > createMotion > returns the engine surface and stays inert without a document',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            const engine = motion.createMotion();

            ctx.expect(typeof engine.start).toBe('function');
            ctx.expect(typeof engine.stop).toBe('function');
            ctx.expect(typeof engine.scan).toBe('function');

            // No document in the unit env — start()/scan()/stop() must not throw.
            engine.start();
            engine.scan(null);
            engine.stop();
          },
        },
      );

      // #499: CSS can park an animation; it cannot pause a <video>. No lane did,
      // so every autoplaying band (the hero video demo, marketing/product-demo)
      // kept moving for a visitor who asked for stillness. The engine owns it now,
      // for every section at once. The unit env has no DOM, so the element is a
      // stub of exactly the surface setupVideo touches (the icon-renderer idiom).
      cases.push(
        ...(() => {
          const cases = [];
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

          cases.push({
            name: 'motion > reduced-motion video park (#499) > pauses an autoplaying video and shows its controls',
            run: async (ctx) => {
              await beforeHook(ctx);
              await beforeEachHook();
              const video = makeVideo();
              scanWith(true, [video]);

              ctx.expect(video.paused, 'the video is parked').toBe(true);
              ctx.expect(video.pauseCalls, 'paused by the engine, not by luck').toBe(1);
              ctx.expect(video.autoplay, 'and it will not restart itself').toBe(false);
              ctx.expect(video.hasAttribute('autoplay'), 'the attribute goes with it').toBe(false);
              ctx.expect(video.controls, 'the visitor gets the controls to start it themselves').toBe(true);
            },
          });

          cases.push({
            name: 'motion > reduced-motion video park (#499) > leaves an autoplaying video alone when the visitor asked for nothing',
            run: async (ctx) => {
              await beforeHook(ctx);
              await beforeEachHook();
              const video = makeVideo();
              scanWith(false, [video]);

              ctx.expect(video.paused, 'the authored playback stands').toBe(false);
              ctx.expect(video.pauseCalls, 'nothing paused it').toBe(0);
              ctx.expect(video.autoplay, 'autoplay survives').toBe(true);
              ctx.expect(video.controls, 'and a controls-off band stays clean').toBe(false);
            },
          });

          cases.push({
            name: 'motion > reduced-motion video park (#499) > is idempotent — a rescan never pauses a video the visitor started',
            run: async (ctx) => {
              await beforeHook(ctx);
              await beforeEachHook();
              const video = makeVideo();
              scanWith(true, [video]);

              video.paused = false; // the visitor pressed play
              scanWith(true, [video]);

              ctx.expect(video.pauseCalls, 'the second scan leaves it running').toBe(1);
              ctx.expect(video.paused).toBe(false);
            },
          });
          return cases;
        })(),
      );

      // #752: the dotfield hero canvas repainted its whole grid on every animation
      // frame from the moment the engine scanned, inside the LCP window, on the
      // page's own thread, and the marquee read geometry in the same tick it
      // replaced the track's children (a forced reflow). The unit env has no DOM,
      // so each case builds the exact surface these two lanes touch (the
      // icon-renderer/#499 idiom) plus a hand-driven rAF and idle queue.
      cases.push(
        ...(() => {
          const cases = [];
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

          cases.push(
            {
              name: 'motion > first-paint budget (#752) > dotfield > paints nothing until first paint has settled',
              run: async (ctx) => {
                await beforeHook(ctx);
                await beforeEachHook();
                withMotionEnv({}, (env) => {
                  const field = makeField(env.readyState);
                  motion.createMotion().scan(rootOf('[data-omega-dotfield]', field.el));

                  ctx.expect(field.ctx.clears, 'the scan itself paints nothing').toBe(0);
                  ctx.expect(env.pending(), 'and arms no animation frame at all').toBe(0);

                  env.frame(0);
                  ctx.expect(field.ctx.clears, 'a frame before the settle signal still paints nothing').toBe(0);

                  env.idle();
                  env.frame(0);
                  ctx.expect(field.ctx.clears, 'the first grid lands on the settle signal').toBe(1);
                  ctx.expect(field.ctx.dots > 0, 'and it is a real grid').toBeTruthy();
                });
              },
            },
            {
              name: 'motion > first-paint budget (#752) > dotfield > waits for the load event before asking for idle time',
              run: async (ctx) => {
                await beforeHook(ctx);
                await beforeEachHook();
                withMotionEnv({ readyState: 'loading' }, (env) => {
                  const field = makeField(env.readyState);
                  motion.createMotion().scan(rootOf('[data-omega-dotfield]', field.el));

                  env.idle();
                  env.frame(0);
                  ctx.expect(field.ctx.clears, 'a document still loading paints nothing').toBe(0);

                  env.load();
                  env.idle();
                  env.frame(0);
                  ctx.expect(field.ctx.clears, 'the field starts once the page is loaded and idle').toBe(1);
                });
              },
            },
            {
              name: 'motion > first-paint budget (#752) > dotfield > falls back to the load event where idle callbacks do not exist',
              run: async (ctx) => {
                await beforeHook(ctx);
                await beforeEachHook();
                withMotionEnv({ readyState: 'loading', idleCallback: false }, (env) => {
                  const field = makeField(env.readyState);
                  motion.createMotion().scan(rootOf('[data-omega-dotfield]', field.el));

                  ctx.expect(field.ctx.clears, 'nothing before load').toBe(0);
                  ctx.expect(env.pending(), 'and no frame is even armed before it').toBe(0);

                  env.load();
                  env.frame(0);
                  ctx.expect(field.ctx.clears, 'load alone is the signal on browsers without requestIdleCallback').toBe(1);
                });
              },
            },
            {
              name: 'motion > first-paint budget (#752) > dotfield > hands the CSS fallback dots off on the first painted grid, not at scan',
              run: async (ctx) => {
                await beforeHook(ctx);
                await beforeEachHook();
                withMotionEnv({}, (env) => {
                  const field = makeField(env.readyState);
                  motion.createMotion().scan(rootOf('[data-omega-dotfield]', field.el));

                  // `.omega-dotgrid[data-omega-dotfield-ready]::before` fades the CSS
                  // dots out on this stamp, so an early one leaves the hero blank.
                  ctx.expect(field.el.dataset.omegaDotfieldReady, 'not at scan').toBe(undefined);

                  env.idle();
                  ctx.expect(field.el.dataset.omegaDotfieldReady, 'not on the settle signal either').toBe(undefined);

                  env.frame(0);
                  ctx.expect(field.ctx.clears, 'the first grid is painted').toBe(1);
                  ctx.expect(field.el.dataset.omegaDotfieldReady, 'and the CSS dots hand off to it').toBe('true');
                });
              },
            },
            {
              name: 'motion > first-paint budget (#752) > dotfield > installs once, even rescanned before the stamp lands',
              run: async (ctx) => {
                await beforeHook(ctx);
                await beforeEachHook();
                withMotionEnv({}, (env) => {
                  const field = makeField(env.readyState);
                  const engine = motion.createMotion();
                  const root = rootOf('[data-omega-dotfield]', field.el);

                  engine.scan(root);
                  engine.scan(root); // a MutationObserver rescan, before the stamp exists

                  ctx.expect(field.el.prepended.length, 'one canvas, not two').toBe(1);

                  env.idle();
                  env.frame(0);
                  ctx.expect(field.ctx.clears, 'and one field painting it').toBe(1);
                });
              },
            },
            {
              name: 'motion > first-paint budget (#752) > dotfield > sizes the canvas at the settle signal, never through an early resize observer',
              run: async (ctx) => {
                await beforeHook(ctx);
                await beforeEachHook();
                withMotionEnv({}, (env) => {
                  const field = makeField(env.readyState);
                  motion.createMotion().scan(rootOf('[data-omega-dotfield]', field.el));

                  ctx.expect(field.el.measures, 'the scan measures nothing').toBe(0);

                  env.resize(); // the observer's own first callback, a frame after scan
                  ctx.expect(field.el.measures, 'and neither does the observer, before settle').toBe(0);
                  ctx.expect(field.canvas.width, 'so nothing allocates a backing store either').toBe(0);

                  env.idle();
                  ctx.expect(field.el.measures > 0, 'the settle callback is what measures').toBeTruthy();
                  ctx.expect(field.canvas.width, 'and sizes the canvas to the field').toBe(200);

                  const settledMeasures = field.el.measures;
                  env.resize();
                  ctx.expect(field.el.measures > settledMeasures, 'a resize after settle is honored as before').toBeTruthy();
                });
              },
            },
            {
              name: 'motion > first-paint budget (#752) > dotfield > caps the repaint cadence at 30fps, whatever the display runs at',
              run: async (ctx) => {
                await beforeHook(ctx);
                await beforeEachHook();
                withMotionEnv({}, (env) => {
                  const field = makeField(env.readyState);
                  motion.createMotion().scan(rootOf('[data-omega-dotfield]', field.el));
                  env.idle();

                  // One second of a 60Hz display
                  for (let i = 0; i <= 60; i += 1) {
                    env.frame((i * 1000) / 60);
                  }
                  ctx.expect(field.ctx.clears <= 31, `capped at ~30 repaints/s, got ${field.ctx.clears}`).toBeTruthy();
                  ctx.expect(field.ctx.clears >= 29, `still animating, got ${field.ctx.clears}`).toBeTruthy();
                });

                withMotionEnv({}, (env) => {
                  const field = makeField(env.readyState);
                  motion.createMotion().scan(rootOf('[data-omega-dotfield]', field.el));
                  env.idle();

                  // One second of a 120Hz display; the cap is the same number
                  for (let i = 0; i <= 120; i += 1) {
                    env.frame((i * 1000) / 120);
                  }
                  ctx.expect(field.ctx.clears <= 31, `120Hz stays capped, got ${field.ctx.clears}`).toBeTruthy();
                  ctx.expect(field.ctx.clears >= 29, `and still animates, got ${field.ctx.clears}`).toBeTruthy();
                });
              },
            },
            {
              name: 'motion > first-paint budget (#752) > dotfield > gives a reduced-motion visitor one static grid and no loop',
              run: async (ctx) => {
                await beforeHook(ctx);
                await beforeEachHook();
                withMotionEnv({ reduced: true }, (env) => {
                  const field = makeField(env.readyState);
                  motion.createMotion().scan(rootOf('[data-omega-dotfield]', field.el));

                  ctx.expect(field.ctx.clears, 'not even the static grid competes with first paint').toBe(0);
                  ctx.expect(field.el.dataset.omegaDotfieldReady, 'and the CSS dots stay until there is a grid').toBe(undefined);

                  env.idle();
                  ctx.expect(field.ctx.clears, 'one grid, drawn once').toBe(1);
                  ctx.expect(env.pending(), 'no animation frame was ever armed').toBe(0);

                  env.frame(16);
                  env.frame(32);
                  ctx.expect(field.ctx.clears, 'and nothing repaints it').toBe(1);
                  ctx.expect(field.el.dataset.omegaDotfieldReady, 'the CSS handoff stamp lands with that grid').toBe('true');
                });
              },
            },
            {
              name: 'motion > first-paint budget (#752) > dotfield > re-reads the theme color for a still grid, which has no loop to poll it',
              run: async (ctx) => {
                await beforeHook(ctx);
                await beforeEachHook();
                withMotionEnv({ reduced: true }, (env) => {
                  const field = makeField(env.readyState);
                  motion.createMotion().scan(rootOf('[data-omega-dotfield]', field.el));
                  env.idle();

                  const before = field.ctx.lastDot();
                  env.themeFlip('#ffffff'); // dark → light: --omega-line-strong changes

                  ctx.expect(field.ctx.clears, 'the still grid is redrawn, once').toBe(2);
                  ctx.expect(field.ctx.lastDot(), 'in the color the new theme reads').not.toBe(before);
                  ctx.expect(env.pending(), 'and it still never armed a frame').toBe(0);
                });
              },
            },
            {
              name: 'motion > first-paint budget (#752) > dotfield > repaints a still grid on resize, in the current theme color',
              run: async (ctx) => {
                await beforeHook(ctx);
                await beforeEachHook();
                withMotionEnv({ reduced: true }, (env) => {
                  const field = makeField(env.readyState);
                  motion.createMotion().scan(rootOf('[data-omega-dotfield]', field.el));
                  env.idle();

                  const before = field.ctx.lastDot();
                  env.themeFlip('#ffffff');
                  env.resize();

                  ctx.expect(field.ctx.clears, 'the resize redraws it').toBe(3);
                  ctx.expect(field.ctx.lastDot(), 'never in the color of the theme it left').not.toBe(before);
                });
              },
            },
          );

          cases.push(
            ...(() => {
              const cases = [];
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

              cases.push({
                name: 'motion > first-paint budget (#752) > marquee > reads the track geometry in a later frame, never in the mutation tick',
                run: async (ctx) => {
                  await beforeHook(ctx);
                  await beforeEachHook();
                  withMotionEnv({}, (env) => {
                    track = makeTrack([makeItem(), makeItem()]);
                    motion.createMotion().scan(rootOf('[data-omega-marquee]', marqueeOf(track)));

                    ctx.expect(track.calls, 'the write lands alone, with no read behind it').toEqual(['replaceChildren']);
                    ctx.expect(env.pending(), 'the read is queued for the next frame').toBe(1);

                    env.frame(0);
                    ctx.expect(track.calls, 'and lands after the frame').toEqual(['replaceChildren', 'read']);
                    // 300px set, 900px container → 3 copies per half, doubled
                    ctx.expect(track.children.length, 'the clones still land, in that frame').toBe(12);
                    ctx.expect(track.speed, 'and the duration comes from the SET width').toBe('11s');
                  });
                },
              });

              cases.push({
                name: 'motion > first-paint budget (#752) > marquee > a burst of rebuilds still measures the bare set, never a cloned track',
                run: async (ctx) => {
                  await beforeHook(ctx);
                  await beforeEachHook();
                  withMotionEnv({}, (env) => {
                    const images = [makeImage(), makeImage()];
                    track = makeTrack([makeItem([images[0]]), makeItem([images[1]])]);
                    motion.createMotion().scan(rootOf('[data-omega-marquee]', marqueeOf(track)));
                    env.frame(0);

                    // Both images decode in the same tick, so two rebuilds queue for one
                    // frame: the second must not measure what the first just cloned.
                    images.forEach((image) => image.fire());
                    env.frame(16);

                    ctx.expect(track.children.length, 'one set of clones, not a doubling').toBe(12);
                    ctx.expect(track.speed, 'the duration is still the set width, not the whole track').toBe('11s');
                  });
                },
              });
              return cases;
            })(),
          );
          return cases;
        })(),
      );
      return cases;
    })(),
  ],
});
