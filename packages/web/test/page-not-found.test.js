/**
 * The 404 page counts the miss
 * ([#408](https://github.com/Omega-JS-Stack/omega/issues/408), inventory gap 6
 * of [#328](https://github.com/Omega-JS-Stack/omega/issues/328)).
 *
 * A dead link is the one page whose traffic is worth reading and the one page
 * that shipped zero tracking: `page_not_found` carries the path the visitor
 * actually asked for, which is what makes the miss fixable. Two things a
 * regression would break are pinned here — the load counts exactly one miss
 * with THAT path, and the trailing-slash fixer (which reloads the page) still
 * counts exactly one — plus the census that keeps the fire on the 404 page's
 * own module, where a normal page never loads it (the page-key mapping itself
 * is assets.test.js's).
 *
 * The REAL facade, the REAL catalog and adapters through @omega.js/client's
 * built analytics module, with `gtag` as the assertion — the convention
 * analytics-blocked.test.js sets: who hears an event is the catalog's call, so
 * stubbing it would prove nothing about a page that must reach GA4.
 */
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');

const PKG = path.join(__dirname, '..');
const ROOT = path.resolve(PKG, '..', '..');
const CORE_DIR = path.join(PKG, 'core');
const CORE_JS = path.join(CORE_DIR, 'js');
const PAGE_ENTRY = path.join(CORE_JS, 'pages', '404', 'index.js');

// The client's built module — the door web core reaches the analytics package
// (catalog, adapters, guarded transport) through.
const CLIENT_ANALYTICS = path.join(ROOT, 'packages', 'client', 'dist', 'modules', 'analytics.js');

const BUNDLE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-page-not-found-')), 'page-404.cjs');

// The census roots: every tree of ours a page can load js from — web's own
// modules, the boot runtime every generated bundle imports, and the theme
// entries a page pulls in with its skin. dev-hooks-guard.test.js's roots, minus
// the shared client (the runtimes without pages fire their own screen events).
const SCAN_ROOTS = [
  CORE_JS,
  path.join(PKG, 'runtime'),
  path.join(PKG, 'themes'),
];

// Vendored upstream trees sitting inside a scan root: Bootstrap's own source
// and its Sass harness are third-party code, not ours to rule on.
const SCAN_EXCLUDES = [
  path.join(PKG, 'themes', 'bootstrap', 'js'),
  path.join(PKG, 'themes', 'bootstrap', 'scss'),
];

let building = null;

function bundleOnce() {
  building ||= esbuild.build({
    entryPoints: [PAGE_ENTRY],
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
        build.onResolve({ filter: /^@omega\.js\/client\/modules\/analytics\.js$/ }, () => {
          return { path: CLIENT_ANALYTICS };
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

/** Land on a dead URL and run the page's real module over it. */
async function land(href) {
  await bundleOnce();

  const tracked = [];
  const navigations = [];
  const reported = [];
  const $pageUrl = { id: 'page-url', innerText: '' };

  globalThis.window = {
    location: {
      get href() { return href; },
      set href(value) { navigations.push(String(value)); },
    },
  };
  globalThis.document = {
    cookie: '',
    getElementById: (id) => (id === 'page-url' ? $pageUrl : null),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
  };
  globalThis.__omegaClient = {
    config: { analytics: { providers: {} } },
    dom: () => ({ ready: async () => {} }),
    sentry: () => ({ captureException: (e) => reported.push(e.message) }),
    // The visitor consented to everything — a denied category is its own suite
    // (consent-gating.test.js).
    storage: () => ({
      get: (key, fallback) => (key === 'trackingConsent'
        ? { analytics: true, marketing: true, region: 'opt-out', version: 1 }
        : fallback),
      set: () => {},
    }),
  };

  globalThis.gtag = (...args) => tracked.push(['gtag', ...args]);
  delete globalThis.fbq;
  delete globalThis.ttq;

  // require.resolve, not BUNDLE: the cache is keyed by the REAL path, and
  // macOS's tmpdir is a symlink (/var → /private/var).
  delete require.cache[require.resolve(BUNDLE)];
  const page = require(BUNDLE);

  await page.default();

  return { tracked, navigations, reported, $pageUrl };
}

test('#408: a dead link counts one page_not_found, carrying the path asked for', async () => {
  const { tracked, navigations, $pageUrl } = await land('https://brand.test/blog/moved-post?ref=newsletter');

  assert.deepStrictEqual(
    tracked,
    [['gtag', 'event', 'page_not_found', { path: '/blog/moved-post' }]],
    'the miss reaches GA4 once, under the canonical name, with the missed path',
  );
  assert.deepStrictEqual(navigations, [], 'a path with no trailing slash is not rewritten');
  assert.strictEqual($pageUrl.innerText, 'https://brand.test/blog/moved-post?ref=newsletter', 'and the visitor is shown what they asked for');
});

test('#408: the trailing-slash fixer counts the path asked for, exactly once', async () => {
  // The fixer REWRITES the url it then reloads (`url.pathname` loses its
  // slash), so the path in the payload is what says which side of the fixer the
  // count happened on: `/blog/moved-post/` is the visitor's own path, and
  // `/blog/moved-post` would mean the count read the corrected url instead.
  // That value is the assertion, not the call order — the reload is deferred
  // through setTimeout, so ANY synchronous fire precedes it and a sequence
  // assertion could never fail. The reload must also not turn one miss into two.
  const { tracked, navigations } = await land('https://brand.test/blog/moved-post/');

  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.deepStrictEqual(
    tracked,
    [['gtag', 'event', 'page_not_found', { path: '/blog/moved-post/' }]],
    'the path the visitor asked for is the one counted, slash and all',
  );
  assert.deepStrictEqual(
    navigations,
    ['https://brand.test/blog/moved-post?404Fixer=trailing-slash'],
    'and the fixer still runs',
  );
});

test('#408: only the 404 page module counts a miss — a normal page cannot', async () => {
  // `page_not_found` belongs to the one page that IS the miss. A shared module
  // firing it (main.js, a core module, a lib, a THEME entry — themes ship
  // first-party js that every page of that skin loads) would count every page
  // view on the site as a dead link, which is the failure this census catches.
  const offenders = [];

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (SCAN_EXCLUDES.includes(full)) {
          continue;
        }
        walk(full);
        continue;
      }
      if (!/\.m?js$/.test(entry.name)) {
        continue;
      }
      if (fs.readFileSync(full, 'utf8').includes('page_not_found')) {
        offenders.push(path.relative(PKG, full));
      }
    }
  };

  SCAN_ROOTS.forEach(walk);

  assert.deepStrictEqual(
    offenders,
    [path.join('core', 'js', 'pages', '404', 'index.js')],
    'page_not_found belongs to the 404 page module alone — a shared module firing it counts every page view as a dead link',
  );
});
