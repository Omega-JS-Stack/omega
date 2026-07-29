/**
 * icon-renderer tests — the ONE Font Awesome DOM auto-render (C4 cp112)
 * shared by desktop renderers, web pages, and extension pages. Pure CJS —
 * required straight from dist like desktop main does.
 *
 * The module's own seam is the injected transport `(name, style) => svg`, so
 * the transport here is a real recording function, not a stub of the module.
 * The DOM is the hand-rolled minimum this suite drives (the shared setup.js
 * convention — Node has no DOM and the package pulls in no jsdom); the SVG
 * that lands is produced by the REAL icon-core injectSvgAttributes pass.
 */
const { describe, it, before, beforeEach, afterEach } = require('node:test');
const assert = require('assert');
const path = require('path');
require('./helpers.js');

const DIST_PATH = path.join(__dirname, '..', 'dist', 'modules', 'icon-renderer.js');

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

describe('icon-renderer', () => {
  let createIconRenderer;

  before(() => {
    // Guard against a targeted run testing stale output — dist is built by prepare.
    assert(require('fs').existsSync(DIST_PATH), 'dist/modules/icon-renderer.js exists after prepare');
    ({ createIconRenderer } = require(DIST_PATH));
  });

  describe('rendering', () => {
    it('renders a scanned icon and marks it with data-omega-fa', async () => {
      const { calls, resolve } = transport();
      const icon = makeIcon('fa-solid fa-rocket');

      createIconRenderer({ resolve }).scan(makeRoot([icon]));
      await settle();

      assert.deepStrictEqual(calls, ['solid/rocket']);
      assert.strictEqual(icon.dataset.omegaFa, 'solid/rocket');
      // The REAL icon-core attribute injection is what lands in the DOM.
      assert.ok(icon.innerHTML.includes('<svg'));
      assert.ok(icon.innerHTML.includes('aria-hidden="true"'));
      assert.ok(icon.innerHTML.includes('viewBox="0 0 512 512"'), 'existing attributes survive');
    });

    it('renders the root itself when the root IS an icon', async () => {
      const { calls, resolve } = transport();
      const icon = makeIcon('fa-brands fa-apple');

      createIconRenderer({ resolve }).scan(icon);
      await settle();

      assert.deepStrictEqual(calls, ['brands/apple']);
      assert.strictEqual(icon.dataset.omegaFa, 'brands/apple');
    });

    it('resolves the family/base style pair, not just the base', async () => {
      const { calls, resolve } = transport();
      const icons = [
        makeIcon('fa-sharp fa-light fa-play'),
        makeIcon('fa-regular fa-user'),
        makeIcon('fa-rocket'),
      ];

      createIconRenderer({ resolve }).scan(makeRoot(icons));
      await settle();

      assert.deepStrictEqual(calls.sort(), ['regular/user', 'sharp-light/play', 'solid/rocket']);
    });

    it('caches by style/name — one transport call however many elements', async () => {
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

      assert.deepStrictEqual(calls.sort(), ['regular/rocket', 'solid/rocket']);
      assert.strictEqual(icons[1].innerHTML.includes('<svg'), true);
    });
  });

  describe('missing icons never crash', () => {
    it('an unknown icon leaves the element empty but MARKED', async () => {
      const { resolve } = transport(() => null);
      const icon = makeIcon('fa-solid fa-not-a-real-icon');

      createIconRenderer({ resolve }).scan(makeRoot([icon]));
      await settle();

      assert.strictEqual(icon.innerHTML, '');
      assert.strictEqual(icon.dataset.omegaFa, 'solid/not-a-real-icon');
    });

    it('a transport that throws resolves to nothing, never a rejection', async () => {
      const icon = makeIcon('fa-solid fa-rocket');
      const resolve = async () => { throw new Error('ipc channel closed'); };

      createIconRenderer({ resolve }).scan(makeRoot([icon]));
      await settle();

      assert.strictEqual(icon.innerHTML, '');
      assert.strictEqual(icon.dataset.omegaFa, 'solid/rocket');
    });

    it('classes that parse to no valid icon are not rendered at all', async () => {
      const { calls, resolve } = transport();
      const icons = [
        makeIcon('fa-solid'),
        makeIcon('fa-2x fa-fw'),
        makeIcon('fa-solid fa-Rocket'),
      ];

      createIconRenderer({ resolve }).scan(makeRoot(icons));
      await settle();

      assert.deepStrictEqual(calls, []);
      assert.deepStrictEqual(icons.map((icon) => icon.dataset.omegaFa), [undefined, undefined, undefined]);
    });
  });

  describe('re-render semantics', () => {
    it('a changed class renders the new icon', async () => {
      const { calls, resolve } = transport();
      const icon = makeIcon('fa-solid fa-rocket');
      const renderer = createIconRenderer({ resolve });

      renderer.scan(makeRoot([icon]));
      await settle();

      icon.className = 'fa-regular fa-star';
      renderer.scan(makeRoot([icon]));
      await settle();

      assert.deepStrictEqual(calls, ['solid/rocket', 'regular/star']);
      assert.strictEqual(icon.dataset.omegaFa, 'regular/star');
    });

    it('an unchanged element is left alone — no clear, no re-resolve', async () => {
      const { calls, resolve } = transport();
      const icon = makeIcon('fa-solid fa-rocket');
      const renderer = createIconRenderer({ resolve });

      renderer.scan(makeRoot([icon]));
      await settle();
      const rendered = icon.innerHTML;

      renderer.scan(makeRoot([icon]));
      assert.strictEqual(icon.innerHTML, rendered, 'never blanks between frames');
      await settle();

      assert.deepStrictEqual(calls, ['solid/rocket']);
    });

    it('dropping the icon NAME clears a previously rendered icon', async () => {
      const { resolve } = transport();
      const icon = makeIcon('fa-solid fa-rocket');
      const renderer = createIconRenderer({ resolve });

      renderer.scan(makeRoot([icon]));
      await settle();
      assert.ok(icon.innerHTML.includes('<svg'));

      // Modifiers only — still an fa- element, but no icon name left.
      icon.className = 'fa-2x fa-fw';
      renderer.scan(makeRoot([icon]));
      await settle();

      assert.strictEqual(icon.innerHTML, '');
      assert.strictEqual(icon.dataset.omegaFa, undefined);
    });

    it('a class change mid-flight discards the stale SVG', async () => {
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
      assert.strictEqual(icon.innerHTML, '', 'the stale answer never lands');

      gates.get('solid/fast')(RAW_SVG);
      await settle();
      assert.ok(icon.innerHTML.includes('<svg'), 'the current answer does');
      assert.strictEqual(icon.dataset.omegaFa, 'solid/fast');
    });

    it('a detached element never receives its SVG', async () => {
      const gates = new Map();
      const resolve = (name, style) => new Promise((done) => gates.set(`${style}/${name}`, done));
      const icon = makeIcon('fa-solid fa-rocket');

      createIconRenderer({ resolve }).scan(makeRoot([icon]));
      await settle();

      icon.isConnected = false;
      gates.get('solid/rocket')(RAW_SVG);
      await settle();

      assert.strictEqual(icon.innerHTML, '');
    });
  });

  describe('start / stop', () => {
    // MutationObserver is a platform API Node does not ship; this stand-in
    // records what the module asks for and lets the test deliver mutations.
    let observers;

    beforeEach(() => {
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
    });

    afterEach(() => {
      delete global.MutationObserver;
    });

    function makeDoc(children, readyState = 'complete') {
      const listeners = {};
      return {
        readyState,
        documentElement: makeRoot(children),
        addEventListener: (event, handler) => { listeners[event] = handler; },
        fire: (event) => listeners[event] && listeners[event](),
      };
    }

    it('observes insertions AND class changes, then scans what is already there', async () => {
      const { calls, resolve } = transport();
      const icon = makeIcon('fa-solid fa-rocket');
      const doc = makeDoc([icon]);

      createIconRenderer({ resolve }).start(doc);
      await settle();

      assert.strictEqual(observers.length, 1);
      assert.strictEqual(observers[0].target, doc.documentElement);
      assert.deepStrictEqual(observers[0].options, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class'],
      });
      assert.deepStrictEqual(calls, ['solid/rocket']);
    });

    it('an inserted element is scanned; a class mutation re-renders its target', async () => {
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

      assert.deepStrictEqual(calls, ['solid/plus', 'regular/star']);
      assert.strictEqual(inserted.dataset.omegaFa, 'solid/plus');
      assert.strictEqual(changed.dataset.omegaFa, 'regular/star');
    });

    it('a class mutation that removes every fa- class still clears the icon', async () => {
      const { resolve } = transport();
      const icon = makeIcon('fa-solid fa-rocket');
      const doc = makeDoc([icon]);
      createIconRenderer({ resolve }).start(doc);
      await settle();
      assert.ok(icon.innerHTML.includes('<svg'));

      // The element no longer matches i[class*="fa-"] — the data-omega-fa
      // half of the observer selector is what keeps the clear reachable.
      icon.className = 'plain';
      observers[0].callback([{ type: 'attributes', target: icon }]);
      await settle();

      assert.strictEqual(icon.innerHTML, '');
      assert.strictEqual(icon.dataset.omegaFa, undefined);
    });

    it('a still-loading document defers until DOMContentLoaded', async () => {
      const { calls, resolve } = transport();
      const icon = makeIcon('fa-solid fa-rocket');
      const doc = makeDoc([icon], 'loading');

      createIconRenderer({ resolve }).start(doc);
      await settle();

      assert.strictEqual(observers.length, 0);
      assert.deepStrictEqual(calls, []);

      doc.fire('DOMContentLoaded');
      await settle();

      assert.strictEqual(observers.length, 1);
      assert.deepStrictEqual(calls, ['solid/rocket']);
    });

    it('start is idempotent and a doc-less environment is a no-op', async () => {
      const { calls, resolve } = transport();
      const doc = makeDoc([makeIcon('fa-solid fa-rocket')]);
      const renderer = createIconRenderer({ resolve });

      renderer.start(doc);
      renderer.start(doc);
      await settle();

      assert.strictEqual(observers.length, 1);
      assert.deepStrictEqual(calls, ['solid/rocket']);

      createIconRenderer({ resolve }).start(null);
      assert.strictEqual(observers.length, 1);
    });

    it('stop disconnects the observer and drops the cache', async () => {
      const { calls, resolve } = transport();
      const doc = makeDoc([makeIcon('fa-solid fa-rocket')]);
      const renderer = createIconRenderer({ resolve });

      renderer.start(doc);
      await settle();
      renderer.stop();

      assert.strictEqual(observers[0].disconnected, true);

      // A cleared cache means the next start really re-resolves...
      renderer.start(makeDoc([makeIcon('fa-solid fa-rocket')]));
      await settle();

      assert.deepStrictEqual(calls, ['solid/rocket', 'solid/rocket']);
      assert.strictEqual(observers.length, 2, '...and starts a fresh observer');
    });

    it('stop before start is harmless', () => {
      const { resolve } = transport();

      createIconRenderer({ resolve }).stop();

      assert.strictEqual(observers.length, 0);
    });
  });
});
