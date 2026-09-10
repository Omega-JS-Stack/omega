/**
 * #619 — the runtime half of the ONE icon system: the watcher that upgrades
 * any `fa-*` (or `omega-flag-*`) element JS creates after the build, by
 * fetching that one icon out of the site's own emitted set.
 *
 * The DOM here is the hand-rolled minimum the watcher touches (the same
 * convention the language-switcher suite and @omega.js/client's own
 * icon-renderer suite set: node has no DOM and web pulls in no jsdom), and
 * the transport seam is the real `fetch` global, stubbed per test.
 */
const test = require('node:test');
const assert = require('node:assert');

const { createIconResolver, createIconWatcher, ICON_BASE } = require('../runtime/icons.js');

/** The minimum <i> the watcher reads and fills. */
function makeIcon(className) {
  const el = {
    tagName: 'I',
    className,
    dataset: {},
    innerHTML: '',
    isConnected: true,
    get classList() {
      return String(el.className).split(/\s+/).filter(Boolean);
    },
    matches(selector) {
      if (/\[data-omega-fa\]/.test(selector) && el.dataset.omegaFa !== undefined) return true;
      if (/omega-flag-/.test(selector) && /(^|\s)omega-flag-/.test(el.className)) return true;
      return /class\*="fa-"/.test(selector) && /(^|\s)fa-/.test(el.className);
    },
    querySelector: (selector) => (selector === 'svg' && el.innerHTML.includes('<svg') ? {} : null),
    querySelectorAll: () => [],
  };
  return el;
}

function makeRoot(children) {
  return {
    matches: () => false,
    querySelectorAll: (selector) => children.filter((child) => child.matches(selector)),
  };
}

/** Swap the fetch global for one test and record what was asked for. */
function withFetch(responder, run) {
  const original = globalThis.fetch;
  const urls = [];
  globalThis.fetch = (url) => {
    urls.push(url);
    return Promise.resolve(responder(url));
  };
  return Promise.resolve(run(urls)).finally(() => { globalThis.fetch = original; });
}

/** Swap console.error for one test and record the lines. */
function withConsoleError(run) {
  const original = console.error;
  const lines = [];
  console.error = (...args) => lines.push(args.join(' '));
  return Promise.resolve(run(lines)).finally(() => { console.error = original; });
}

const ok = (body) => ({ ok: true, status: 200, text: () => Promise.resolve(body) });
const notFound = { ok: false, status: 404, text: () => Promise.resolve('') };

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const SVG = '<svg viewBox="0 0 512 512"><path d="M0 0h512v512H0z"/></svg>';

test('#619: the resolver fetches one icon out of the site\'s own emitted set', () => {
  return withFetch(() => ok(SVG), async (urls) => {
    const svg = await createIconResolver({ development: false })('rocket', 'solid');

    assert.deepStrictEqual(urls, [`${ICON_BASE}/solid/rocket.svg`]);
    assert.strictEqual(svg, SVG);
  });
});

test('#619: flags ride the same URL shape, one namespace over', () => {
  return withFetch(() => ok(SVG), async (urls) => {
    await createIconResolver({ development: false })('us', 'flags');

    assert.deepStrictEqual(urls, [`${ICON_BASE}/flags/us.svg`]);
  });
});

test('#619: a missing icon is LOUD in development and silent in production', () => {
  return withFetch(() => notFound, () => withConsoleError(async (lines) => {
    const dev = await createIconResolver({ development: true })('not-a-real-glyph', 'solid');
    assert.strictEqual(dev, null, 'a miss resolves to nothing — never a wrong-glyph fallback');
    assert.strictEqual(lines.length, 1, 'exactly one line per miss');
    assert.match(lines[0], /\[@omega\.js\/web:icons\]/, 'the one log tag');
    assert.match(lines[0], /solid\/not-a-real-glyph/, 'the console names the icon');

    lines.length = 0;
    const prod = await createIconResolver({ development: false })('not-a-real-glyph', 'solid');
    assert.strictEqual(prod, null);
    assert.deepStrictEqual(lines, [], 'production skips silently');
  }));
});

test('#619: the watcher upgrades an icon JS created after the build', () => {
  return withFetch(() => ok(SVG), async (urls) => {
    // Exactly what a page module does: build an <i> in JS and put it in the DOM.
    const icon = makeIcon('fa-solid fa-bell fa-sm me-1');

    createIconWatcher({ development: false }).scan(makeRoot([icon]));
    await settle();

    assert.deepStrictEqual(urls, [`${ICON_BASE}/solid/bell.svg`], 'only the icon actually asked for transfers');
    assert.strictEqual(icon.dataset.omegaFa, 'solid/bell');
    assert.match(icon.innerHTML, /<svg/, 'the glyph landed in the element');
    assert.match(icon.innerHTML, /width="1em"/, '…through the shared root-attribute pass');
  });
});

test('#619: the watcher upgrades a JS-created flag too', () => {
  return withFetch(() => ok(SVG), async (urls) => {
    const flag = makeIcon('omega-flag omega-flag-us');

    createIconWatcher({ development: false }).scan(makeRoot([flag]));
    await settle();

    assert.deepStrictEqual(urls, [`${ICON_BASE}/flags/us.svg`]);
    assert.strictEqual(flag.dataset.omegaFa, 'flags/us');
    assert.match(flag.innerHTML, /<svg/);
  });
});

test('#619: a brand mark falls back to brands/, so fa-solid fa-github renders', () => {
  const responder = (url) => (url.endsWith('/brands/github.svg') ? ok(SVG) : notFound);

  return withFetch(responder, async (urls) => {
    const icon = makeIcon('fa-solid fa-github');

    createIconWatcher({ development: false }).scan(makeRoot([icon]));
    await settle();

    assert.deepStrictEqual(urls, [
      `${ICON_BASE}/solid/github.svg`,
      `${ICON_BASE}/brands/github.svg`,
    ], 'the requested style first, then brands — icon-core\'s candidate order, the same one the build-time pass and desktop use');
    assert.strictEqual(icon.dataset.omegaFa, 'solid/github');
    assert.match(icon.innerHTML, /<svg/, 'the mark lands without the author knowing which side of the set it lives on');
  });
});

test('#619: an icon the build already inlined costs zero fetches', () => {
  return withFetch(() => ok(SVG), async (urls) => {
    const inlined = makeIcon('fa-solid fa-rocket');
    inlined.dataset.omegaFa = 'solid/rocket';
    inlined.innerHTML = SVG;

    createIconWatcher({ development: false }).scan(makeRoot([inlined]));
    await settle();

    assert.deepStrictEqual(urls, [], 'the build-time stamp is what makes the runtime free');
  });
});
