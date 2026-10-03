/**
 * icon-renderer tests — the ONE Font Awesome DOM auto-render (C4 cp112)
 * shared by desktop renderers, web pages, and extension pages, plus the
 * instance's wrapper around it (`omega.icons`). ESM like its siblings,
 * required straight from dist (require(esm)) like desktop main does.
 *
 * The module's own seam is the injected transport `(name, style) => svg`, so
 * the transport here is a real recording function, not a stub of the module.
 * The DOM is the hand-rolled minimum this suite drives (the shared setup.js
 * convention — Node has no DOM and the package pulls in no jsdom); the SVG
 * that lands is produced by the REAL icon-core injectSvgAttributes pass.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const path = require('path');
const { createOmega, clearStorage, disposeOmega } = require('./helpers.js');

const beforeEachHook = clearStorage;

const DIST_PATH = path.join(__dirname, '..', 'dist', 'modules', 'icon-renderer.js');
const ICONS_DIST_PATH = path.join(__dirname, '..', 'dist', 'modules', 'icons.js');

const RAW_SVG = '<svg viewBox="0 0 512 512"><path d="M0 0h512v512H0z"/></svg>';

// ─── The minimum DOM the module touches ───

function makeIcon(className) {
  const el = {
    tagName: 'I',
    className,
    dataset: {},
    innerHTML: '',
    isConnected: true,
    children: [],
    get classList() {
      return String(el.className).split(/\s+/).filter(Boolean);
    },
    matches(selector) {
      if (selector.includes('i[data-omega-fa]') && el.dataset.omegaFa !== undefined) return true;
      if (selector.includes('omega-flag-') && /(^|\s)omega-flag-/.test(el.className)) return true;
      return /i\[class\*="fa-"\]/.test(selector) && /(^|\s)fa-/.test(el.className);
    },
    querySelector(selector) {
      return selector === 'svg' && el.innerHTML.includes('<svg') ? {} : null;
    },
    querySelectorAll() {
      return [];
    },
  };
  return el;
}

function makeRoot(children) {
  return {
    children,
    matches: () => false,
    querySelector: () => null,
    querySelectorAll: (selector) => children.filter((child) => child.matches(selector)),
  };
}

// A recording transport: resolves each icon and counts the calls per key.
function transport(svgFor = () => RAW_SVG) {
  const calls = [];
  const resolve = async (name, style) => {
    calls.push(`${style}/${name}`);
    return svgFor(name, style);
  };
  return { calls, resolve };
}

// The module resolves asynchronously; let the microtask queue drain.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

module.exports = defineCases({
  type: 'group',
  description: 'icon-renderer',
  setup: createOmega,
  cleanup: disposeOmega,
  tests: [
    ...(() => {
      const cases = [];
      let createIconRenderer;

      let beforeHookRun;
      const beforeHook = (ctx) => (beforeHookRun ||= Promise.resolve().then(() => ((ctx) => {
        // Guard against a targeted run testing stale output — dist is built by prepare.
        ctx.expect(require('fs').existsSync(DIST_PATH), 'dist/modules/icon-renderer.js exists after prepare').toBeTruthy();
        ({ createIconRenderer } = require(DIST_PATH));
      })(ctx)));

      cases.push(
        {
          name: 'icon-renderer > rendering > renders a scanned icon and marks it with data-omega-fa',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            const { calls, resolve } = transport();
            const icon = makeIcon('fa-solid fa-rocket');

            createIconRenderer({ resolve }).scan(makeRoot([icon]));
            await settle();

            ctx.expect(calls).toEqual(['solid/rocket']);
            ctx.expect(icon.dataset.omegaFa).toBe('solid/rocket');
            // The REAL icon-core attribute injection is what lands in the DOM.
            ctx.expect(icon.innerHTML.includes('<svg')).toBeTruthy();
            ctx.expect(icon.innerHTML.includes('aria-hidden="true"')).toBeTruthy();
            ctx.expect(icon.innerHTML.includes('viewBox="0 0 512 512"'), 'existing attributes survive').toBeTruthy();
          },
        },
        {
          name: 'icon-renderer > rendering > #619: renders the country-flag namespace through the same lookup',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            const { calls, resolve } = transport();
            const flag = makeIcon('omega-flag omega-flag-us');

            createIconRenderer({ resolve }).scan(makeRoot([flag]));
            await settle();

            ctx.expect(calls).toEqual(['flags/us']);
            ctx.expect(flag.dataset.omegaFa).toBe('flags/us');
            ctx.expect(flag.innerHTML.includes('<svg')).toBeTruthy();
          },
        },
        {
          name: 'icon-renderer > rendering > renders the root itself when the root IS an icon',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            const { calls, resolve } = transport();
            const icon = makeIcon('fa-brands fa-apple');

            createIconRenderer({ resolve }).scan(icon);
            await settle();

            ctx.expect(calls).toEqual(['brands/apple']);
            ctx.expect(icon.dataset.omegaFa).toBe('brands/apple');
          },
        },
        {
          name: 'icon-renderer > rendering > resolves the family/base style pair, not just the base',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            const { calls, resolve } = transport();
            const icons = [
              makeIcon('fa-sharp fa-light fa-play'),
              makeIcon('fa-regular fa-user'),
              makeIcon('fa-rocket'),
            ];

            createIconRenderer({ resolve }).scan(makeRoot(icons));
            await settle();

            ctx.expect(calls.sort()).toEqual(['regular/user', 'sharp-light/play', 'solid/rocket']);
          },
        },
        {
          name: 'icon-renderer > rendering > caches by style/name — one transport call however many elements',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            const { calls, resolve } = transport();
            const icons = [
              makeIcon('fa-solid fa-rocket'),
              makeIcon('fa-solid fa-rocket'),
              makeIcon('fa-regular fa-rocket'),
            ];
            const renderer = createIconRenderer({ resolve });

            renderer.scan(makeRoot(icons));
            await settle();
            renderer.scan(makeRoot(icons));
            await settle();

            ctx.expect(calls.sort()).toEqual(['regular/rocket', 'solid/rocket']);
            ctx.expect(icons[1].innerHTML.includes('<svg')).toBe(true);
          },
        },
      );

      cases.push(
        {
          name: 'icon-renderer > missing icons never crash > an unknown icon leaves the element empty but MARKED',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            const { resolve } = transport(() => null);
            const icon = makeIcon('fa-solid fa-not-a-real-icon');

            createIconRenderer({ resolve }).scan(makeRoot([icon]));
            await settle();

            ctx.expect(icon.innerHTML).toBe('');
            ctx.expect(icon.dataset.omegaFa).toBe('solid/not-a-real-icon');
          },
        },
        {
          name: 'icon-renderer > missing icons never crash > a transport that throws resolves to nothing, never a rejection',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            const icon = makeIcon('fa-solid fa-rocket');
            const resolve = async () => { throw new Error('ipc channel closed'); };

            createIconRenderer({ resolve }).scan(makeRoot([icon]));
            await settle();

            ctx.expect(icon.innerHTML).toBe('');
            ctx.expect(icon.dataset.omegaFa).toBe('solid/rocket');
          },
        },
        {
          name: 'icon-renderer > missing icons never crash > classes that parse to no valid icon are not rendered at all',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            const { calls, resolve } = transport();
            const icons = [
              makeIcon('fa-solid'),
              makeIcon('fa-2x fa-fw'),
              makeIcon('fa-solid fa-Rocket'),
            ];

            createIconRenderer({ resolve }).scan(makeRoot(icons));
            await settle();

            ctx.expect(calls).toEqual([]);
            ctx.expect(icons.map((icon) => icon.dataset.omegaFa)).toEqual([undefined, undefined, undefined]);
          },
        },
      );

      cases.push(
        {
          name: 'icon-renderer > re-render semantics > a changed class renders the new icon',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            const { calls, resolve } = transport();
            const icon = makeIcon('fa-solid fa-rocket');
            const renderer = createIconRenderer({ resolve });

            renderer.scan(makeRoot([icon]));
            await settle();

            icon.className = 'fa-regular fa-star';
            renderer.scan(makeRoot([icon]));
            await settle();

            ctx.expect(calls).toEqual(['solid/rocket', 'regular/star']);
            ctx.expect(icon.dataset.omegaFa).toBe('regular/star');
          },
        },
        {
          name: 'icon-renderer > re-render semantics > an unchanged element is left alone — no clear, no re-resolve',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            const { calls, resolve } = transport();
            const icon = makeIcon('fa-solid fa-rocket');
            const renderer = createIconRenderer({ resolve });

            renderer.scan(makeRoot([icon]));
            await settle();
            const rendered = icon.innerHTML;

            renderer.scan(makeRoot([icon]));
            ctx.expect(icon.innerHTML, 'never blanks between frames').toBe(rendered);
            await settle();

            ctx.expect(calls).toEqual(['solid/rocket']);
          },
        },
        {
          name: 'icon-renderer > re-render semantics > dropping the icon NAME clears a previously rendered icon',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            const { resolve } = transport();
            const icon = makeIcon('fa-solid fa-rocket');
            const renderer = createIconRenderer({ resolve });

            renderer.scan(makeRoot([icon]));
            await settle();
            ctx.expect(icon.innerHTML.includes('<svg')).toBeTruthy();

            // Modifiers only — still an fa- element, but no icon name left.
            icon.className = 'fa-2x fa-fw';
            renderer.scan(makeRoot([icon]));
            await settle();

            ctx.expect(icon.innerHTML).toBe('');
            ctx.expect(icon.dataset.omegaFa).toBe(undefined);
          },
        },
        {
          name: 'icon-renderer > re-render semantics > a class change mid-flight discards the stale SVG',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            const gates = new Map();
            const calls = [];
            const resolve = (name, style) => {
              calls.push(`${style}/${name}`);
              return new Promise((done) => gates.set(`${style}/${name}`, done));
            };
            const icon = makeIcon('fa-solid fa-slow');
            const renderer = createIconRenderer({ resolve });

            renderer.scan(makeRoot([icon]));
            await settle();

            // The classes change before the first transport answers.
            icon.className = 'fa-solid fa-fast';
            renderer.scan(makeRoot([icon]));
            await settle();

            gates.get('solid/slow')(RAW_SVG);
            await settle();
            ctx.expect(icon.innerHTML, 'the stale answer never lands').toBe('');

            gates.get('solid/fast')(RAW_SVG);
            await settle();
            ctx.expect(icon.innerHTML.includes('<svg'), 'the current answer does').toBeTruthy();
            ctx.expect(icon.dataset.omegaFa).toBe('solid/fast');
          },
        },
        {
          name: 'icon-renderer > re-render semantics > a detached element never receives its SVG',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            const gates = new Map();
            const resolve = (name, style) => new Promise((done) => gates.set(`${style}/${name}`, done));
            const icon = makeIcon('fa-solid fa-rocket');

            createIconRenderer({ resolve }).scan(makeRoot([icon]));
            await settle();

            icon.isConnected = false;
            gates.get('solid/rocket')(RAW_SVG);
            await settle();

            ctx.expect(icon.innerHTML).toBe('');
          },
        },
      );

      cases.push(
        ...(() => {
          const cases = [];
          // MutationObserver is a platform API Node does not ship; this stand-in
          // records what the module asks for and lets the test deliver mutations.
          let observers;

          const beforeEachHook2 = () => {
            observers = [];
            global.MutationObserver = class {
              constructor(callback) {
                this.callback = callback;
                this.options = null;
                this.disconnected = false;
                observers.push(this);
              }

              observe(target, options) {
                this.target = target;
                this.options = options;
              }

              disconnect() {
                this.disconnected = true;
              }
            };
          };

          const afterEachHook = () => {
            delete global.MutationObserver;
          };

          function makeDoc(children, readyState = 'complete') {
            const listeners = {};
            return {
              readyState,
              documentElement: makeRoot(children),
              addEventListener: (event, handler) => { listeners[event] = handler; },
              fire: (event) => listeners[event] && listeners[event](),
            };
          }

          cases.push({
            name: 'icon-renderer > start / stop > observes insertions AND class changes, then scans what is already there',
            run: async (ctx) => {
              await beforeHook(ctx);
              await beforeEachHook();
              beforeEachHook2();
              ctx.after(afterEachHook);
              const { calls, resolve } = transport();
              const icon = makeIcon('fa-solid fa-rocket');
              const doc = makeDoc([icon]);

              createIconRenderer({ resolve }).start(doc);
              await settle();

              ctx.expect(observers.length).toBe(1);
              ctx.expect(observers[0].target).toBe(doc.documentElement);
              ctx.expect(observers[0].options).toEqual({
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['class'],
              });
              ctx.expect(calls).toEqual(['solid/rocket']);
            },
          });

          cases.push({
            name: 'icon-renderer > start / stop > an inserted element is scanned; a class mutation re-renders its target',
            run: async (ctx) => {
              await beforeHook(ctx);
              await beforeEachHook();
              beforeEachHook2();
              ctx.after(afterEachHook);
              const { calls, resolve } = transport();
              const doc = makeDoc([]);
              createIconRenderer({ resolve }).start(doc);
              await settle();

              const inserted = makeIcon('fa-solid fa-plus');
              inserted.nodeType = 1;
              observers[0].callback([{ type: 'childList', addedNodes: [inserted] }]);
              await settle();

              const changed = makeIcon('fa-regular fa-star');
              observers[0].callback([{ type: 'attributes', target: changed }]);
              await settle();

              ctx.expect(calls).toEqual(['solid/plus', 'regular/star']);
              ctx.expect(inserted.dataset.omegaFa).toBe('solid/plus');
              ctx.expect(changed.dataset.omegaFa).toBe('regular/star');
            },
          });

          cases.push({
            name: 'icon-renderer > start / stop > a class mutation that removes every fa- class still clears the icon',
            run: async (ctx) => {
              await beforeHook(ctx);
              await beforeEachHook();
              beforeEachHook2();
              ctx.after(afterEachHook);
              const { resolve } = transport();
              const icon = makeIcon('fa-solid fa-rocket');
              const doc = makeDoc([icon]);
              createIconRenderer({ resolve }).start(doc);
              await settle();
              ctx.expect(icon.innerHTML.includes('<svg')).toBeTruthy();

              // The element no longer matches i[class*="fa-"] — the data-omega-fa
              // half of the observer selector is what keeps the clear reachable.
              icon.className = 'plain';
              observers[0].callback([{ type: 'attributes', target: icon }]);
              await settle();

              ctx.expect(icon.innerHTML).toBe('');
              ctx.expect(icon.dataset.omegaFa).toBe(undefined);
            },
          });

          cases.push({
            name: 'icon-renderer > start / stop > a still-loading document defers until DOMContentLoaded',
            run: async (ctx) => {
              await beforeHook(ctx);
              await beforeEachHook();
              beforeEachHook2();
              ctx.after(afterEachHook);
              const { calls, resolve } = transport();
              const icon = makeIcon('fa-solid fa-rocket');
              const doc = makeDoc([icon], 'loading');

              createIconRenderer({ resolve }).start(doc);
              await settle();

              ctx.expect(observers.length).toBe(0);
              ctx.expect(calls).toEqual([]);

              doc.fire('DOMContentLoaded');
              await settle();

              ctx.expect(observers.length).toBe(1);
              ctx.expect(calls).toEqual(['solid/rocket']);
            },
          });

          cases.push({
            name: 'icon-renderer > start / stop > start is idempotent and a doc-less environment is a no-op',
            run: async (ctx) => {
              await beforeHook(ctx);
              await beforeEachHook();
              beforeEachHook2();
              ctx.after(afterEachHook);
              const { calls, resolve } = transport();
              const doc = makeDoc([makeIcon('fa-solid fa-rocket')]);
              const renderer = createIconRenderer({ resolve });

              renderer.start(doc);
              renderer.start(doc);
              await settle();

              ctx.expect(observers.length).toBe(1);
              ctx.expect(calls).toEqual(['solid/rocket']);

              createIconRenderer({ resolve }).start(null);
              ctx.expect(observers.length).toBe(1);
            },
          });

          cases.push({
            name: 'icon-renderer > start / stop > stop disconnects the observer and drops the cache',
            run: async (ctx) => {
              await beforeHook(ctx);
              await beforeEachHook();
              beforeEachHook2();
              ctx.after(afterEachHook);
              const { calls, resolve } = transport();
              const doc = makeDoc([makeIcon('fa-solid fa-rocket')]);
              const renderer = createIconRenderer({ resolve });

              renderer.start(doc);
              await settle();
              renderer.stop();

              ctx.expect(observers[0].disconnected).toBe(true);

              // A cleared cache means the next start really re-resolves...
              renderer.start(makeDoc([makeIcon('fa-solid fa-rocket')]));
              await settle();

              ctx.expect(calls).toEqual(['solid/rocket', 'solid/rocket']);
              ctx.expect(observers.length, '...and starts a fresh observer').toBe(2);
            },
          });

          cases.push({
            name: 'icon-renderer > start / stop > stop before start is harmless',
            run: async (ctx) => {
              await beforeHook(ctx);
              await beforeEachHook();
              beforeEachHook2();
              ctx.after(afterEachHook);
              const { resolve } = transport();

              createIconRenderer({ resolve }).stop();

              ctx.expect(observers.length).toBe(0);
            },
          });
          return cases;
        })(),
      );
      return cases;
    })(),

    ...(() => {
      const cases = [];
      let Icons;

      let beforeHook2Run;
      const beforeHook2 = (ctx) => (beforeHook2Run ||= Promise.resolve().then(() => (() => {
        Icons = require(ICONS_DIST_PATH).default;
      })()));

      // A document still parsing: start() defers its observer to
      // DOMContentLoaded, which this suite never fires, so the transport binding
      // is all a start() does here.
      const loadingDoc = () => ({ readyState: 'loading', addEventListener: () => {} });

      cases.push({
        name: 'Icons (omega.icons) > refuses a scan before start() binds a transport',
        run: async (ctx) => {
          await beforeHook2(ctx);
          await beforeEachHook();
          ctx.expect(() => new Icons().scan(makeRoot([]))).toThrow(/before icons\.start\(\)/);
        },
      });

      cases.push({
        name: 'Icons (omega.icons) > renders through the transport start() bound, and keeps it on a second start()',
        run: async (ctx) => {
          await beforeHook2(ctx);
          await beforeEachHook();
          const icons = new Icons();
          const first = transport();
          const second = transport();
          const icon = makeIcon('fa-solid fa-rocket');

          icons.start({ resolve: first.resolve }, loadingDoc());
          icons.start({ resolve: second.resolve }, loadingDoc());
          icons.scan(makeRoot([icon]));
          await settle();

          ctx.expect(first.calls, 'the first transport answers').toEqual(['solid/rocket']);
          ctx.expect(second.calls, 'a second start() binds nothing new').toEqual([]);
          ctx.expect(icon.innerHTML.includes('<svg'), 'the icon rendered').toBeTruthy();
        },
      });

      cases.push({
        name: 'Icons (omega.icons) > stop() drops the transport, so a later scan fails loudly until start() again',
        run: async (ctx) => {
          await beforeHook2(ctx);
          await beforeEachHook();
          const icons = new Icons();

          icons.start({ resolve: transport().resolve }, loadingDoc());
          icons.stop();

          ctx.expect(() => icons.scan(makeRoot([]))).toThrow(/before icons\.start\(\)/);
        },
      });
      return cases;
    })(),
  ],
});
