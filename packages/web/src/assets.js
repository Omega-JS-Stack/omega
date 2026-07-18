/**
 * The @omega.js/web asset pipeline over ordered LAYER ROOTS (site → active
 * theme → classy → core). Each layer root follows one convention:
 *
 *   <layer>/js/main.js        - the main-bundle module (core ships the default)
 *   <layer>/js/pages/**       - page modules (index.js per page dir, or flat)
 *   <layer>/css/main.scss     - the main-bundle entry (core ships the default)
 *   <layer>/css/pages/**      - page styles (same shape as js/pages)
 *   <layer>/_theme.scss       - theme layers only: the theme's sass entry
 *   <layer>/_theme.js         - theme layers only: the theme's js module
 *
 * Entries are content-hashed and mapped in the manifest:
 *   { js: { main, pages: {key: url} }, css: { main, pages: {}, themePages: {} } }
 * Theme page css lives in a separate namespace because BOTH load (base page
 * css first, then the active theme's override for the same page).
 *
 * Special import specifiers (UJM conventions, resolved by esbuild plugin):
 *   @omega.js/client             → the @omega.js/client entry (options.clientEntry)
 *   __main_assets__/js/...  → the core layer (framework runtime modules)
 *   __main_assets__/themes/…→ the packaged themes dir (e.g. bootstrap js)
 *   __theme__/...           → active theme root, classy fallback
 *
 * Every js entry is wrapped in a boot stub around the runtime handshake
 * (runtime/boot.js): the main bundle calls bootMain(mod) — @omega.js/client
 * initialize + global module — and page bundles call bootPage(mod), which
 * awaits the main boot before running the page module with
 * ({ manager, options }). Bundles are ESM with code splitting: @omega.js/client
 * and the boot runtime land in a shared chunk that evaluates once per page,
 * so every bundle sees the SAME initialized singleton (webpack's single
 * module graph, reproduced with `<script type="module">` semantics).
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const sass = require('sass');
const { collectLayered } = require('./layers.js');
const { collectSectionAssets } = require('./sections.js');

// A page file is an ENTRY when it's a per-page index.js/index.scss, or a flat
// file at most two segments below pages/ (pages/index.js, pages/blog/post.js).
// Deeper non-index files are helpers (checkout modules/, account sections/).
function isPageEntry(rel) {
  const base = path.basename(rel);
  if (base === 'index.js' || base === 'index.scss') return true;
  return rel.split('/').length <= 3; // 'pages' + up to 2 segments
}

function pageKey(rel) {
  return rel.replace(/^pages\//, '').replace(/\.(js|scss)$/, '');
}

/**
 * Build the js + css bundles for a site, returning the asset manifest.
 * @param {object} options
 * @param {string[]} options.layers - ordered layer roots (site → active theme → classy → core)
 * @param {string[]} options.themeRoots - the theme layer dirs within `layers`
 *   (resolveThemeLayers output — consumer-local theme dirs can't be derived)
 * @param {string} options.themesDir - the themes dir (for __main_assets__/themes)
 * @param {string} options.coreDir - the core layer root (for __main_assets__)
 * @param {string} options.outDir - the site output dir (_site)
 * @param {string} options.clientEntry - path to @omega.js/client's entry (aliased as `@omega.js/client`)
 * @param {string[]} [options.sectionRoots] - section/component resolution bases
 *   (consumer dir, then theme layers — registerSectionTags' order). Feeds the
 *   spec §7 asset lanes: every entry's section.scss compiles into the main
 *   sheet via `omega:sections` (PurgeCSS self-trims unused ones) and every
 *   section.js bundles into the main bundle behind DOM-presence init
 *   (data-omega-section/-component attributes, boot.js bootSections)
 * @param {boolean} [options.dev] - dev mode: stable (un-hashed) names, no minify —
 *   asset rebuilds keep their URLs so rendered HTML stays valid without a re-render
 * @param {'css'|'js'} [options.only] - rebuild just one half (dev watcher
 *   narrowing: a css-only rebuild writes no js files, so the dev server
 *   hot-swaps stylesheets instead of full-reloading; dev's stable names make
 *   the partial manifest harmless). Omit for the full build.
 * @returns {Promise<{ js: object, css: object }>}
 */
async function buildAssets(options) {
  const manifest = { js: { pages: {} }, css: { pages: {}, themePages: {} } };
  // Explicit (resolveThemeLayers output) — a consumer-local theme dir can't
  // be recognized by its parent dir, so callers name the theme roots.
  const themeRoots = options.themeRoots;
  const sectionAssets = collectSectionAssets(options.sectionRoots || []);

  if (options.only !== 'css') {
    // ---- JS entries: layered union of page modules + the main bundle
    const jsDirs = options.layers.map((layer) => path.join(layer, 'js')).filter((dir) => fs.existsSync(dir));
    const entryPoints = {};
    const keyBySpecifier = new Map();

    for (const [rel, abs] of collectLayered(jsDirs, /^pages\/.*\.js$/)) {
      if (!isPageEntry(rel)) continue;
      const key = pageKey(rel);
      entryPoints[`pages/${key}`] = `omega-boot:${abs}`;
      keyBySpecifier.set(abs, ['pages', key]);
    }
    const mainJs = collectLayered(jsDirs, /^main\.js$/).get('main.js');
    if (mainJs) {
      entryPoints.main = `omega-boot:${mainJs}`;
      keyBySpecifier.set(mainJs, ['main']);
    }

    const bootRuntime = path.resolve(__dirname, '..', 'runtime', 'boot.js');

    const bootPlugin = {
      name: 'omega-boot',
      setup(build) {
        // Boot stubs: main → bootMain (initialize + global module), pages →
        // bootPage (awaits the main boot). The runtime import is what pulls
        // @omega.js/client into the shared chunk.
        build.onResolve({ filter: /^omega-boot:/ }, (args) => ({
          path: args.path.slice('omega-boot:'.length),
          namespace: 'omega-boot',
        }));
        build.onLoad({ filter: /.*/, namespace: 'omega-boot' }, (args) => {
          const isMain = args.path === mainJs;
          const lines = [
            `import { ${isMain ? 'bootMain' : 'bootPage'} } from ${JSON.stringify(bootRuntime)};`,
            `import mod from ${JSON.stringify(args.path)};`,
            `${isMain ? 'bootMain' : 'bootPage'}(mod);`,
          ];
          // §7 section-JS lane: the main stub imports every section.js and
          // registers the id → init map; bootSections inits per
          // [data-omega-<kind>="<id>"] element after the main boot.
          const jsEntries = isMain ? sectionAssets.filter((entry) => entry.js) : [];
          if (jsEntries.length) {
            lines[0] = `import { bootMain, bootSections } from ${JSON.stringify(bootRuntime)};`;
            const registry = { section: [], component: [] };
            jsEntries.forEach((entry, i) => {
              lines.push(`import sectionInit${i} from ${JSON.stringify(entry.js)};`);
              registry[entry.kind].push(`${JSON.stringify(entry.id)}: sectionInit${i}`);
            });
            lines.push(`bootSections({ section: { ${registry.section.join(', ')} }, component: { ${registry.component.join(', ')} } });`);
          }
          return { resolveDir: path.dirname(args.path), contents: lines.join('\n') };
        });

        // UJM asset-aliases: __main_assets__ → core layer / themes dir; __theme__ → active theme (classy fallback)
        build.onResolve({ filter: /^__main_assets__\// }, (args) => {
          const rest = args.path.slice('__main_assets__/'.length);
          const target = rest.startsWith('themes/')
            ? path.join(options.themesDir, rest.slice('themes/'.length))
            : path.join(options.coreDir, rest);
          return { path: target };
        });
        build.onResolve({ filter: /^__theme__\// }, (args) => {
          const rest = args.path.slice('__theme__/'.length);
          for (const root of themeRoots) {
            if (fs.existsSync(path.join(root, rest))) return { path: path.join(root, rest) };
          }
          return { path: path.join(themeRoots[0] || options.themesDir, rest) };
        });
      },
    };

    const result = await esbuild.build({
      entryPoints,
      bundle: true,
      minify: !options.dev,
      // ESM + splitting is load-bearing: shared modules (@omega.js/client, the boot
      // runtime) go into one chunk the browser evaluates once — the singleton
      // survives across the main and page bundles.
      format: 'esm',
      splitting: true,
      outdir: path.join(options.outDir, 'assets', 'js'),
      entryNames: options.dev ? '[dir]/[name]' : '[dir]/[name]-[hash]',
      chunkNames: 'chunks/[name]-[hash]',
      metafile: true,
      // Directory alias so SUBPATH imports work too (@omega.js/client/modules/dom.js)
      alias: { '@omega.js/client': path.dirname(options.clientEntry) },
      plugins: [bootPlugin],
      logLevel: 'silent',
      define: { 'process.env.NODE_ENV': options.dev ? '"development"' : '"production"' },
    });

    for (const [outFile, meta] of Object.entries(result.metafile.outputs)) {
      if (!meta.entryPoint) continue;
      const abs = meta.entryPoint.replace(/^omega-boot:/, '');
      const spec = keyBySpecifier.get(path.resolve(abs)) || keyBySpecifier.get(abs);
      if (!spec) continue;
      const url = `/${path.relative(options.outDir, outFile)}`;
      if (spec[0] === 'main') manifest.js.main = url;
      else manifest.js.pages[spec[1]] = url;
    }

    // ---- Legacy module bundles: <layer>/js/modules/*.js → the FIXED URL
    // /assets/js/modules/<name>.bundle.js. The redirect layout and the ad
    // units script these directly (uj_cachebreak query param), so they are
    // never content-hashed and carry no manifest key. Standalone IIFEs — no
    // boot stub, no shared chunk — so a module importing @omega.js/client is
    // SKIPPED: inlining a second client copy would break the cross-bundle
    // singleton (vert.js sits out until the ads lane gets manifest URLs).
    const moduleEntries = {};
    for (const [rel, abs] of collectLayered(jsDirs, /^modules\/[^/]+\.js$/)) {
      if (/from\s+['"]@omega\.js\/client/.test(fs.readFileSync(abs, 'utf8'))) continue;
      moduleEntries[`modules/${path.basename(rel, '.js')}.bundle`] = abs;
    }
    if (Object.keys(moduleEntries).length) {
      await esbuild.build({
        entryPoints: moduleEntries,
        bundle: true,
        minify: !options.dev,
        format: 'iife',
        outdir: path.join(options.outDir, 'assets', 'js'),
        entryNames: '[dir]/[name]',
        logLevel: 'silent',
        define: { 'process.env.NODE_ENV': options.dev ? '"development"' : '"production"' },
      });
    }
  }

  if (options.only === 'js') {
    return manifest;
  }

  // ---- CSS: the main bundle + page styles. `omega:` imports resolve through
  // the LAYER ROOTS (a bare `@use 'theme'` would resolve relative to the
  // importing file first — beating any layering — so layered lookups use an
  // explicit scheme, which sass never resolves relatively).
  const cssDirs = options.layers.map((layer) => path.join(layer, 'css')).filter((dir) => fs.existsSync(dir));
  const importers = [layeredFileImporter(options.layers), sectionsImporter(sectionAssets)];
  const emitCss = (css, rel) => {
    const hash = crypto.createHash('md5').update(css).digest('hex').slice(0, 8);
    const outRel = path.join('assets', 'css', options.dev ? `${rel}.css` : rel.replace(/(\.css)?$/, `-${hash}.css`));
    fs.mkdirSync(path.dirname(path.join(options.outDir, outRel)), { recursive: true });
    fs.writeFileSync(path.join(options.outDir, outRel), css);
    return `/${outRel}`;
  };
  const compileScss = (file, ownerRoot) => sass.compile(file, {
    importers,
    loadPaths: [ownerRoot, path.join(ownerRoot, 'css'), ...options.layers, ...cssDirs],
    style: options.dev ? 'expanded' : 'compressed',
    quietDeps: true,
    // Classy-era legacy patterns only — new core css (tokens/) compiles with
    // ZERO deprecations (pinned in test/tokens.test.js); this list shrinks as
    // the C3 reskin rewrites the theme sheets. 'mixed-decls' graduated to
    // standard Dart Sass behavior — silencing it now WARNS (friction #16).
    silenceDeprecations: ['import', 'global-builtin', 'color-functions', 'legacy-js-api'],
  }).css;

  const mainScss = collectLayered(cssDirs, /^main\.scss$/).get('main.scss');
  if (mainScss) {
    const ownerRoot = path.dirname(path.dirname(mainScss));
    manifest.css.main = emitCss(compileScss(mainScss, ownerRoot), 'main');
  }

  // Page css: base entries come from NON-theme layers (site, core); the theme
  // namespace comes from theme layers (active wins over classy). Both load.
  const baseCssDirs = options.layers.filter((layer) => !themeRoots.includes(layer)).map((l) => path.join(l, 'css')).filter((d) => fs.existsSync(d));
  const themeCssDirs = themeRoots.map((l) => path.join(l, 'css')).filter((d) => fs.existsSync(d));
  for (const [dirs, bucket, suffix] of [[baseCssDirs, 'pages', ''], [themeCssDirs, 'themePages', '.theme']]) {
    for (const [rel, abs] of collectLayered(dirs, /^pages\/.*\.scss$/)) {
      if (!isPageEntry(rel) || path.basename(rel).startsWith('_')) continue;
      const ownerRoot = path.dirname(abs.slice(0, abs.length - rel.length - 1));
      manifest.css[bucket][pageKey(rel)] = emitCss(compileScss(abs, ownerRoot), path.join('pages', `${pageKey(rel)}${suffix}`));
    }
  }

  // ---- Fonts: every layer's fonts/ dir lands at /assets/fonts verbatim
  // (first layer wins — a consumer's file beats the theme's vendored face).
  // Stable names by design: @font-face src URLs are written in theme css.
  const fontDirs = options.layers.map((layer) => path.join(layer, 'fonts')).filter((dir) => fs.existsSync(dir));
  for (const [rel, abs] of collectLayered(fontDirs)) {
    const dest = path.join(options.outDir, 'assets', 'fonts', rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(abs, dest);
  }

  return manifest;
}

/**
 * PurgeCSS post-pass: strip unused selectors from the MAIN css bundle using
 * the rendered HTML as content.
 * @param {object} options
 * @param {string} options.outDir
 * @param {object} options.manifest - from buildAssets()
 * @returns {Promise<{ before: number, after: number }>}
 */
async function purgeCss(options) {
  const { PurgeCSS } = require('purgecss');
  const cssFile = path.join(options.outDir, options.manifest.css.main.slice(1));
  const before = fs.statSync(cssFile).size;

  const results = await new PurgeCSS().purge({
    content: [path.join(options.outDir, '**/*.html')],
    css: [cssFile],
    // The omega namespace is runtime-driven — app-shell.js stamps data-shell-*
    // and the motion engine stamps data-omega-inview / data-omega-scrolled /
    // data-omega-active client-side — so the content scan can never see those
    // states. Keep every omega-namespaced rule.
    safelist: { greedy: [/omega-/] },
  });

  fs.writeFileSync(cssFile, results[0].css);
  return { before, after: Buffer.byteLength(results[0].css) };
}

/**
 * Sass FileImporter resolving `omega:<name>` through the ordered layer roots
 * (first layer containing _<name>.scss / <name>.scss at its root or under
 * css/ wins). `omega:theme` → the active theme's _theme.scss. A candidate
 * that IS the requesting file is skipped, so a consumer main.scss can
 * `@use 'omega:main' with (…)` to configure and extend the main bundle from
 * the layers below it (the migrated form of UJM's
 * `@use 'ultimate-jekyll-manager' with (…)` theme customization).
 * @param {string[]} layers - layer roots
 * @returns {object}
 */
/**
 * Sass importer synthesizing `omega:sections` — the §7 css lane. The module
 * body is a generated @use list over every layer-resolved section.scss /
 * component.scss (deterministic kind+id order), so core main.scss pulls the
 * whole library with ONE line and PurgeCSS self-trims sections a site never
 * renders. Empty library → empty module (the @use is always safe).
 * @param {Array<{scss: string|null}>} sectionAssets - collectSectionAssets output
 * @returns {object}
 */
function sectionsImporter(sectionAssets) {
  const { pathToFileURL } = require('node:url');
  return {
    canonicalize(url) {
      return url === 'omega:sections' ? new URL(url) : null;
    },
    load() {
      const contents = sectionAssets
        .filter((entry) => entry.scss)
        .map((entry, i) => `@use ${JSON.stringify(pathToFileURL(entry.scss).href)} as omega-section-${i};`)
        .join('\n');
      return { contents, syntax: 'scss' };
    },
  };
}

function layeredFileImporter(layers) {
  const { pathToFileURL, fileURLToPath } = require('node:url');
  return {
    findFileUrl(url, context) {
      if (!url.startsWith('omega:')) return null;
      const name = url.slice('omega:'.length);
      const containing = context && context.containingUrl ? fileURLToPath(context.containingUrl) : null;
      for (const root of layers) {
        for (const candidate of [path.join(root, name), path.join(root, 'css', name)]) {
          const dir = path.dirname(candidate);
          const base = path.basename(candidate);
          for (const file of [path.join(dir, `_${base}.scss`), path.join(dir, `${base}.scss`)]) {
            if (!fs.existsSync(file)) continue;
            if (containing && path.resolve(file) === path.resolve(containing)) continue;
            return pathToFileURL(file);
          }
        }
      }
      return null;
    },
  };
}

module.exports = { buildAssets, purgeCss, layeredFileImporter, sectionsImporter };
