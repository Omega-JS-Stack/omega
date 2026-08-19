/**
 * The runtime lazy-loader's srcset rewrite (`core/js/core/lazy-loading.js`) —
 * [#367](https://github.com/Omega-JS-Stack/omega/issues/367). The two BUILD
 * passes stopped splitting srcset on bare commas in #362 and explicitly DEFER
 * `data-srcset` to this lane, so until now a candidate URL carrying a legal
 * comma (a `data:` payload, a `?w=100,200` query) was still cut in half in the
 * browser. The grammar now lives in `core/js/libs/srcset.js`, the ESM twin of
 * the build-time `src/srcset.js`.
 *
 * The module is browser code behind two bundler aliases (`@omega.js/client`,
 * `__main_assets__/*`), so the harness drives the REAL file through esbuild
 * with the client swapped for a stub and window/document hand-rolled to the
 * minimum the module touches — the auth-policy suite's convention (node has no
 * DOM and web pulls in no jsdom). The boot path is the no-IntersectionObserver
 * fallback: it loads every matched element straight away, which is the shortest
 * honest route into `loadSrcset`.
 */
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');

const CORE_DIR = path.join(__dirname, '..', 'core');
const ENTRY = path.join(CORE_DIR, 'js', 'core', 'lazy-loading.js');

const BUNDLE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-lazy-srcset-'));
const BUNDLE = path.join(BUNDLE_DIR, 'lazy-loading.cjs');

// The build stamp the runtime cache-buster appends, fixed so the expected
// output is written out in full.
const BUILD_TIME = 1699;

let building = null;

function bundleOnce() {
  building ||= esbuild.build({
    entryPoints: [ENTRY],
    outfile: BUNDLE,
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    plugins: [{
      name: 'harness-aliases',
      setup(build) {
        build.onResolve({ filter: /^__main_assets__\// }, (args) => {
          return { path: path.join(CORE_DIR, args.path.slice('__main_assets__/'.length)) };
        });
        build.onResolve({ filter: /^@omega\.js\/client$/ }, () => {
          return { path: 'client', namespace: 'omega-client-stub' };
        });
        build.onLoad({ filter: /.*/, namespace: 'omega-client-stub' }, () => {
          return { contents: 'export default globalThis.__omegaClient;' };
        });
      },
    }],
  });

  return building;
}

/** The minimum <source> the srcset path touches; records what it was handed. */
function makeSourceElement(lazyValue) {
  const element = {
    tagName: 'SOURCE',
    srcset: '',
    classes: new Set(),
    attributes: { 'data-lazy': lazyValue },
    classList: {
      add: (...names) => names.forEach((name) => element.classes.add(name)),
      remove: (...names) => names.forEach((name) => element.classes.delete(name)),
    },
    getAttribute: (name) => element.attributes[name] ?? null,
    removeAttribute: (name) => { delete element.attributes[name]; },
    // A lone <source> outside a <picture>: nothing to re-evaluate.
    closest: () => null,
  };

  return element;
}

/**
 * Boot the real module against one stub client + browser, with a single
 * `data-lazy="@srcset …"` element on the page, and hand back its srcset.
 */
async function rewriteSrcset(value) {
  await bundleOnce();

  const element = makeSourceElement(`@srcset ${value}`);

  globalThis.__omegaClient = {
    config: {
      buildTime: BUILD_TIME,
      lazyLoading: {
        config: {
          selector: '[data-lazy]',
          rootMargin: '50px 0px',
          threshold: 0.01,
          loadedClass: 'lazy-loaded',
          loadingClass: 'lazy-loading',
          errorClass: 'lazy-error',
        },
      },
    },
    dom: () => ({ ready: () => Promise.resolve() }),
  };

  // No IntersectionObserver: the module's own fallback loads every matched
  // element immediately, so the test needs no viewport.
  globalThis.window = { location: { href: 'https://brand.test/pricing' } };
  globalThis.document = { querySelectorAll: () => [element] };

  delete require.cache[require.resolve(BUNDLE)];
  require(BUNDLE).default();

  // The module starts inside omega.dom().ready() — let that microtask land.
  await new Promise((resolve) => setTimeout(resolve, 0));

  return element.srcset;
}

test('runtime lazy-loader: a data-URI candidate survives the rewrite whole (#367)', async () => {
  const dataUri = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

  const srcset = await rewriteSrcset(`${dataUri} 1x, /assets/images/hero.png 2x`);

  assert.ok(srcset.startsWith(dataUri), `the base64 payload arrives in one piece: ${srcset}`);
  assert.equal(srcset.split(', ').length, 2, 'two candidates — the comma inside the payload is not a boundary');
  assert.ok(srcset.endsWith(`https://brand.test/assets/images/hero.png?cb=${BUILD_TIME} 2x`), `the second candidate is intact: ${srcset}`);
});

test('runtime lazy-loader: a comma in a candidate’s query is not a boundary either (#367)', async () => {
  const srcset = await rewriteSrcset('/assets/images/hero.png?w=100,200 1x');

  assert.equal(srcset, `https://brand.test/assets/images/hero.png?w=100%2C200&cb=${BUILD_TIME} 1x`);
});

// #368 — the runtime cache-buster had no locality guard, so the payload the
// #367 splitter now keeps whole was corrupted one step later by a `?cb=`
// appended to it. It skips exactly what the build-time pass skips.
test('runtime lazy-loader: a data: URI is never cache-busted — byte-identical through the rewrite (#368)', async () => {
  const dataUri = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

  const srcset = await rewriteSrcset(`${dataUri} 1x, /assets/images/hero.png 2x`);

  assert.equal(srcset, `${dataUri} 1x, https://brand.test/assets/images/hero.png?cb=${BUILD_TIME} 2x`);
});

test('runtime lazy-loader: blob: and external candidates are left alone too (#368)', async () => {
  const blob = 'blob:https://brand.test/2c8f0e1a-0c1b-4f2e-9a6d-3b7c8d9e0f11';

  const srcset = await rewriteSrcset(`${blob} 1x, https://cdn.example.com/hero.png 2x, //cdn.example.com/wide.png 3x`);

  assert.equal(srcset, `${blob} 1x, https://cdn.example.com/hero.png 2x, //cdn.example.com/wide.png 3x`);
});

test('runtime lazy-loader: an ordinary ladder rewrites exactly as it always did', async () => {
  const srcset = await rewriteSrcset('/assets/images/shot-320px.webp 320w, /assets/images/shot-1024px.webp 1024w');

  assert.equal(srcset, [
    `https://brand.test/assets/images/shot-320px.webp?cb=${BUILD_TIME} 320w`,
    `https://brand.test/assets/images/shot-1024px.webp?cb=${BUILD_TIME} 1024w`,
  ].join(', '));
});

// The two grammar files are format TWINS (each says so at the top): one lane is
// CJS build-time, the other ESM browser code, and they must agree on what a
// candidate is or the passes and the runtime cut markup differently.
test('the browser grammar twin and the build-time original parse identically', () => {
  const { mapSrcset: buildTime } = require('../src/srcset.js');
  const { mapSrcset: runtime } = require('../core/js/libs/srcset.js');

  const cases = [
    'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7 1x, /b.png 2x',
    '/a.png?w=100,200 1x, /b.png 2x',
    '/a.png 320w, /b.png 1024w',
    '/a.png,/b.png',
    '  /a.png   ,,  /b.png 2x  ',
    '/a.png calc(100vw - (2 * 1rem)), /b.png 2x',
    '',
  ];

  for (const value of cases) {
    assert.equal(runtime(value, (url) => `${url}#x`), buildTime(value, (url) => `${url}#x`), `same parse: ${value}`);
  }
});
