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
const defineCases = require('@omega.js/devkit/test/define-cases');

const { createIconResolver, ICON_BASE } = require('../runtime/icons.js');
const { createIconRenderer } = require('@omega.js/client/modules/icon-renderer.js');

/**
 * The watcher runtime/boot.js starts (`omega.icons.start`): @omega.js/client's
 * renderer bound to this site's transport.
 */
function createIconWatcher({ development }) {
  return createIconRenderer({ resolve: createIconResolver({ development }) });
}

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

module.exports = defineCases({
  type: 'group',
  description: 'icons-runtime',
  tests: [
    {
      name: '#619: the resolver fetches one icon out of the site\'s own emitted set',
      run: (ctx) => {
        return withFetch(() => ok(SVG), async (urls) => {
          const svg = await createIconResolver({ development: false })('rocket', 'solid');

          ctx.expect(urls).toEqual([`${ICON_BASE}/solid/rocket.svg`]);
          ctx.expect(svg).toBe(SVG);
        });
      },
    },

    {
      name: '#619: flags ride the same URL shape, one namespace over',
      run: (ctx) => {
        return withFetch(() => ok(SVG), async (urls) => {
          await createIconResolver({ development: false })('us', 'flags');

          ctx.expect(urls).toEqual([`${ICON_BASE}/flags/us.svg`]);
        });
      },
    },

    {
      name: '#619: a missing icon is LOUD in development and silent in production',
      run: (ctx) => {
        return withFetch(() => notFound, () => withConsoleError(async (lines) => {
          const dev = await createIconResolver({ development: true })('not-a-real-glyph', 'solid');
          ctx.expect(dev, 'a miss resolves to nothing — never a wrong-glyph fallback').toBe(null);
          ctx.expect(lines.length, 'exactly one line per miss').toBe(1);
          ctx.expect(lines[0], 'the one log tag').toMatch(/\[@omega\.js\/web:icons\]/);
          ctx.expect(lines[0], 'the console names the icon').toMatch(/solid\/not-a-real-glyph/);

          lines.length = 0;
          const prod = await createIconResolver({ development: false })('not-a-real-glyph', 'solid');
          ctx.expect(prod).toBe(null);
          ctx.expect(lines, 'production skips silently').toEqual([]);
        }));
      },
    },

    {
      name: '#619: the watcher upgrades an icon JS created after the build',
      run: (ctx) => {
        return withFetch(() => ok(SVG), async (urls) => {
          // Exactly what a page module does: build an <i> in JS and put it in the DOM.
          const icon = makeIcon('fa-solid fa-bell fa-sm me-1');

          createIconWatcher({ development: false }).scan(makeRoot([icon]));
          await settle();

          ctx.expect(urls, 'only the icon actually asked for transfers').toEqual([`${ICON_BASE}/solid/bell.svg`]);
          ctx.expect(icon.dataset.omegaFa).toBe('solid/bell');
          ctx.expect(icon.innerHTML, 'the glyph landed in the element').toMatch(/<svg/);
          ctx.expect(icon.innerHTML, '…through the shared root-attribute pass').toMatch(/width="1em"/);
        });
      },
    },

    {
      name: '#619: the watcher upgrades a JS-created flag too',
      run: (ctx) => {
        return withFetch(() => ok(SVG), async (urls) => {
          const flag = makeIcon('omega-flag omega-flag-us');

          createIconWatcher({ development: false }).scan(makeRoot([flag]));
          await settle();

          ctx.expect(urls).toEqual([`${ICON_BASE}/flags/us.svg`]);
          ctx.expect(flag.dataset.omegaFa).toBe('flags/us');
          ctx.expect(flag.innerHTML).toMatch(/<svg/);
        });
      },
    },

    {
      name: '#619: a brand mark falls back to brands/, so fa-solid fa-github renders',
      run: (ctx) => {
        const responder = (url) => (url.endsWith('/brands/github.svg') ? ok(SVG) : notFound);

        return withFetch(responder, async (urls) => {
          const icon = makeIcon('fa-solid fa-github');

          createIconWatcher({ development: false }).scan(makeRoot([icon]));
          await settle();

          ctx.expect(urls, 'the requested style first, then brands — icon-core\'s candidate order, the same one the build-time pass and desktop use').toEqual([
            `${ICON_BASE}/solid/github.svg`,
            `${ICON_BASE}/brands/github.svg`,
          ]);
          ctx.expect(icon.dataset.omegaFa).toBe('solid/github');
          ctx.expect(icon.innerHTML, 'the mark lands without the author knowing which side of the set it lives on').toMatch(/<svg/);
        });
      },
    },

    {
      name: '#619: an icon the build already inlined costs zero fetches',
      run: (ctx) => {
        return withFetch(() => ok(SVG), async (urls) => {
          const inlined = makeIcon('fa-solid fa-rocket');
          inlined.dataset.omegaFa = 'solid/rocket';
          inlined.innerHTML = SVG;

          createIconWatcher({ development: false }).scan(makeRoot([inlined]));
          await settle();

          ctx.expect(urls, 'the build-time stamp is what makes the runtime free').toEqual([]);
        });
      },
    },
  ],
});
