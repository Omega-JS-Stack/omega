/**
 * Module preloads: every module entry a page loads gets one
 * `<link rel="modulepreload">` per chunk in its STATIC import chain, so the
 * browser fetches the whole chain at once instead of one hop at a time. A chunk
 * reached only through a dynamic `import()` is never preloaded, so code the
 * page loads on demand stays off the first load.
 *
 * The fixture is the real layer chain over `fixtures/site-assets` (classy over
 * base over core), built for production, then the mini site rendered against
 * that build's own manifest. The expected chains are read off the built files,
 * never off the manifest's `js.imports` map the build writes.
 */
const fs = require('node:fs');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');

const { buildAssets } = require('../src/assets.js');
const { buildWith, miniData, PKG } = require('./lib/build.js');

const ROOT = path.resolve(PKG, '..', '..');
const SITE_ASSETS = path.join(__dirname, 'fixtures', 'site-assets');
const OUT = path.join(PKG, '.omega', `modulepreload-out-${process.pid}`);

let built = null;

/**
 * Build the assets once, then render the mini site against that manifest.
 * @returns {Promise<{ manifest: object, pages: Map<string, string> }>}
 */
function fixture() {
  built = built || (async () => {
    fs.rmSync(OUT, { recursive: true, force: true });
    const themeRoots = [path.join(PKG, 'themes', 'classy'), path.join(PKG, 'themes', 'base')];
    const manifest = await buildAssets({
      layers: [SITE_ASSETS, ...themeRoots, path.join(PKG, 'core')],
      themeRoots,
      sectionRoots: [SITE_ASSETS, ...themeRoots],
      themesDir: path.join(PKG, 'themes'),
      coreDir: path.join(PKG, 'core'),
      outDir: OUT,
      clientEntry: path.join(ROOT, 'packages', 'client', 'src', 'index.js'),
    });
    const pages = await buildWith(miniData, { assetManifest: manifest, environment: 'production' }, 'modulepreload-test');

    return { manifest, pages };
  })();

  return built;
}

const toUrl = (file) => `/${path.relative(OUT, file).split(path.sep).join('/')}`;
const toFile = (url) => path.join(OUT, url.slice(1));

// Static edges only: `import x from "..."`, `import "..."` and `export ... from
// "..."`. A dynamic `import("...")` has a paren before its quote, so it never matches.
const STATIC_IMPORT = /(?:^|[;}\s])(?:import|export)\s*(?:[\w$*{}\s,]+?\s*from\s*)?["']([^"']+)["']/g;
const DYNAMIC_IMPORT = /\bimport\(\s*["']([^"']+)["']\s*\)/g;

/**
 * Every chunk URL in an entry's static chain, read off the built files.
 * @param {string} entryUrl - the entry's URL, as a script tag names it
 * @returns {Set<string>} chunk URLs, the entry itself excluded
 */
function staticChain(entryUrl) {
  const seen = new Set();
  const visit = (file) => {
    for (const match of fs.readFileSync(file, 'utf8').matchAll(STATIC_IMPORT)) {
      if (!match[1].startsWith('.')) continue;
      const dep = path.resolve(path.dirname(file), match[1]);
      if (seen.has(dep)) continue;
      seen.add(dep);
      visit(dep);
    }
  };
  visit(toFile(entryUrl));

  return new Set([...seen].map(toUrl));
}

// Attribute values may be quoted or bare: the production HTML minifier drops quotes.
const attr = (tag, name) => {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return match ? (match[1] ?? match[2] ?? match[3]) : null;
};
const pathname = (href) => new URL(href, 'https://site.invalid').pathname;

/** The pathnames every `<link rel="modulepreload">` on a page names, repeats kept. */
const preloads = (html) => [...html.matchAll(/<link\b[^>]*>/gi)]
  .map((match) => match[0])
  .filter((tag) => (attr(tag, 'rel') || '').toLowerCase() === 'modulepreload')
  .map((tag) => pathname(attr(tag, 'href')));

/** The module entries a page loads: each `<script type="module" src>` the build wrote. */
const moduleEntries = (html) => [...html.matchAll(/<script\b[^>]*>/gi)]
  .map((match) => match[0])
  .filter((tag) => attr(tag, 'type') === 'module' && attr(tag, 'src'))
  .map((tag) => pathname(attr(tag, 'src')))
  .filter((url) => fs.existsSync(toFile(url)));

const htmlPages = (pages) => [...pages].filter(([, html]) => /<html\b/i.test(html));

const walkJs = (dir) => fs.readdirSync(dir, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
  .map((entry) => path.join(entry.parentPath, entry.name));

/** Every entry URL the manifest lists: main, first paint, page and layout entries. */
const manifestEntries = (manifest) => [
  manifest.js.main,
  manifest.js.firstPaint,
  ...Object.values(manifest.js.pages).flat(),
  ...Object.values(manifest.js.layouts).flat(),
];

module.exports = defineCases({
  type: 'group',
  description: 'modulepreload',
  cleanup: () => fs.rmSync(OUT, { recursive: true, force: true }),
  tests: [
    {
      name: 'case 11: each module entry a page loads preloads every chunk in its static chain, once, and nothing else',
      run: async (ctx) => {
        const { manifest, pages } = await fixture();

        // The premise, on /signin: the main entry and the page entry share a chunk,
        // and the page entry has a chunk of its own no other entry on the page reaches.
        const signin = pages.get('/signin');
        const signinEntry = manifest.js.pages['signin/index'][0];
        const entries = moduleEntries(signin);
        ctx.expect(entries.includes(manifest.js.main), '/signin loads the main entry').toBeTruthy();
        ctx.expect(entries.includes(signinEntry), '/signin loads its page entry').toBeTruthy();

        const mainChain = staticChain(manifest.js.main);
        const pageChain = staticChain(signinEntry);
        const others = new Set(entries.filter((url) => url !== signinEntry).flatMap((url) => [...staticChain(url)]));
        ctx.expect([...pageChain].some((url) => mainChain.has(url)), 'main and the signin entry share a static chunk').toBeTruthy();
        ctx.expect([...pageChain].some((url) => !others.has(url)), 'the signin entry has a static chunk of its own').toBeTruthy();

        for (const [url, html] of htmlPages(pages)) {
          const expected = new Set(moduleEntries(html).flatMap((entry) => [...staticChain(entry)]));
          const links = preloads(html);

          for (const chunk of expected) {
            const count = links.filter((href) => href === chunk).length;
            ctx.expect(count, `${url}: ${chunk} has exactly one modulepreload link (found ${count})`).toBe(1);
          }
          for (const href of links) {
            ctx.expect(expected.has(href), `${url}: modulepreload ${href} is outside the static chains of the page's entries`).toBeTruthy();
          }
        }
      },
    },

    {
      name: 'case 12: a chunk reached only by a dynamic import is on disk and never preloaded',
      run: async (ctx) => {
        const { manifest, pages } = await fixture();

        const staticAll = new Set(manifestEntries(manifest).flatMap((url) => [...staticChain(url)]));
        const dynamicOnly = new Set();
        for (const file of walkJs(path.join(OUT, 'assets', 'js'))) {
          for (const match of fs.readFileSync(file, 'utf8').matchAll(DYNAMIC_IMPORT)) {
            const url = toUrl(path.resolve(path.dirname(file), match[1]));
            if (!staticAll.has(url)) dynamicOnly.add(url);
          }
        }

        // The premise: the theme's `__theme__` import is the fixture's known
        // dynamic-only chunk, and the pages preload something, so "none" is not vacuous.
        ctx.expect([...dynamicOnly].some((url) => /\/chunks\/_theme-[A-Z0-9]+\.js$/.test(url)), 'the theme chunk is reached only dynamically').toBeTruthy();
        ctx.expect(preloads(pages.get('/signin')).length > 0, '/signin carries modulepreload links').toBeTruthy();

        // The two the Contract names, found by content: the file stems (`index.esm-`,
        // `prod-`) are shared by other Firebase modules and say nothing about Sentry.
        const chunks = walkJs(path.join(OUT, 'assets', 'js', 'chunks'));
        const sdks = {
          firestore: chunks.filter((file) => fs.readFileSync(file, 'utf8').includes('firestore.googleapis.com')).map(toUrl),
          sentry: chunks.filter((file) => fs.readFileSync(file, 'utf8').includes('sentry.javascript.browser')).map(toUrl),
        };
        for (const [sdk, urls] of Object.entries(sdks)) {
          ctx.expect(urls.length > 0, `the build has a ${sdk} SDK chunk`).toBeTruthy();
          for (const url of urls) ctx.expect(dynamicOnly.has(url), `the ${sdk} SDK chunk ${url} is reached only dynamically`).toBeTruthy();
        }
        const named = new Set(htmlPages(pages).flatMap(([, html]) => preloads(html)));
        for (const url of [...sdks.firestore, ...sdks.sentry]) {
          ctx.expect(!named.has(url), `no page preloads the SDK chunk ${url}`).toBeTruthy();
        }

        for (const chunk of dynamicOnly) {
          ctx.expect(fs.existsSync(toFile(chunk)), `${chunk} is on disk`).toBeTruthy();
        }
        for (const [url, html] of htmlPages(pages)) {
          for (const href of preloads(html)) {
            ctx.expect(!dynamicOnly.has(href), `${url}: modulepreload names the dynamic-only chunk ${href}`).toBeTruthy();
          }
        }
      },
    },

    {
      name: 'the manifest maps every entry URL to its static chunks',
      run: async (ctx) => {
        const { manifest } = await fixture();
        const { imports } = manifest.js;

        ctx.expect(imports && typeof imports === 'object', 'the manifest carries js.imports').toBeTruthy();
        for (const entry of manifestEntries(manifest)) {
          ctx.expect(Object.hasOwn(imports, entry), `js.imports has a key for ${entry}`).toBeTruthy();
        }
        ctx.expect([...imports[manifest.js.main]].sort(), 'the main entry maps to its static chain').toEqual([...staticChain(manifest.js.main)].sort());
      },
    },
  ],
});
