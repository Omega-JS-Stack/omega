/**
 * The @omegajs/web asset pipeline over ordered LAYER ROOTS (site → active
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
 *   web-manager             → the @omegajs/client entry (options.clientEntry)
 *   __main_assets__/js/...  → the core layer (framework runtime modules)
 *   __main_assets__/themes/…→ the packaged themes dir (e.g. bootstrap js)
 *   __theme__/...           → active theme root, classy fallback
 *
 * Every js entry is wrapped in a boot stub around the runtime handshake
 * (runtime/boot.js): the main bundle calls bootMain(mod) — web-manager
 * initialize + global module — and page bundles call bootPage(mod), which
 * awaits the main boot before running the page module with
 * ({ manager, options }). Bundles are ESM with code splitting: web-manager
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
 * @param {string} options.themesDir - the themes dir (for __main_assets__/themes)
 * @param {string} options.coreDir - the core layer root (for __main_assets__)
 * @param {string} options.outDir - the site output dir (_site)
 * @param {string} options.clientEntry - path to @omegajs/client's entry (aliased as `web-manager`)
 * @param {boolean} [options.dev] - dev mode: stable (un-hashed) names, no minify —
 *   asset rebuilds keep their URLs so rendered HTML stays valid without a re-render
 * @returns {Promise<{ js: object, css: object }>}
 */
async function buildAssets(options) {
  const manifest = { js: { pages: {} }, css: { pages: {}, themePages: {} } };
  const themeRoots = options.layers.filter((layer) => layer !== options.coreDir && path.dirname(layer) === options.themesDir);

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
      // web-manager into the shared chunk.
      build.onResolve({ filter: /^omega-boot:/ }, (args) => ({
        path: args.path.slice('omega-boot:'.length),
        namespace: 'omega-boot',
      }));
      build.onLoad({ filter: /.*/, namespace: 'omega-boot' }, (args) => {
        const isMain = args.path === mainJs;
        return {
          resolveDir: path.dirname(args.path),
          contents: [
            `import { ${isMain ? 'bootMain' : 'bootPage'} } from ${JSON.stringify(bootRuntime)};`,
            `import mod from ${JSON.stringify(args.path)};`,
            `${isMain ? 'bootMain' : 'bootPage'}(mod);`,
          ].join('\n'),
        };
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
    // ESM + splitting is load-bearing: shared modules (web-manager, the boot
    // runtime) go into one chunk the browser evaluates once — the singleton
    // survives across the main and page bundles.
    format: 'esm',
    splitting: true,
    outdir: path.join(options.outDir, 'assets', 'js'),
    entryNames: options.dev ? '[dir]/[name]' : '[dir]/[name]-[hash]',
    chunkNames: 'chunks/[name]-[hash]',
    metafile: true,
    // Directory alias so SUBPATH imports work too (web-manager/modules/dom.js)
    alias: { 'web-manager': path.dirname(options.clientEntry) },
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

  // ---- CSS: the main bundle + page styles. `omega:` imports resolve through
  // the LAYER ROOTS (a bare `@use 'theme'` would resolve relative to the
  // importing file first — beating any layering — so layered lookups use an
  // explicit scheme, which sass never resolves relatively).
  const cssDirs = options.layers.map((layer) => path.join(layer, 'css')).filter((dir) => fs.existsSync(dir));
  const importers = [layeredFileImporter(options.layers)];
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
    silenceDeprecations: ['import', 'global-builtin', 'color-functions', 'mixed-decls', 'legacy-js-api'],
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

module.exports = { buildAssets, purgeCss };
