/**
 * FROZEN B1 snapshot of the bake-off asset pipeline (theme.scss entry,
 * flat manifest) — vendored when @omegajs/web moved to the B2 layer-root
 * conventions. This spike is a retained reference; its pipeline stays as
 * measured. Original: 3-layer page-module JS via esbuild
 * (content-hashed, manifest-mapped), layered sass (`omega:` scheme importer
 * across theme layers), and a PurgeCSS post-pass over the rendered HTML.
 * SSG-agnostic — runs before the SSG, feeds it the manifest (the retained
 * Astro reference spike consumes it too).
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const sass = require('sass');
const { collectLayered } = require('@omegajs/web/layers');

/**
 * Build page-module JS + theme CSS, returning the asset manifest.
 * @param {object} options
 * @param {string[]} options.jsLayers - ordered js layer dirs (site → theme(s) → core), each containing pages/
 * @param {string[]} options.cssLayers - ordered css layer dirs (active theme → classy → core)
 * @param {string} options.outDir - the site output dir (_site)
 * @param {string} options.clientEntry - path to @omegajs/client's entry (aliased as `web-manager`)
 * @returns {Promise<{ js: object, css: object }>}
 */
async function buildAssets(options) {
  const manifest = { js: {}, css: {} };

  // ---- Page modules: layered union, first layer wins
  const modules = collectLayered(options.jsLayers, /^pages\/.*\.js$/);
  const entryPoints = {};
  const keyByEntry = new Map();
  for (const [rel, abs] of modules) {
    const key = rel.replace(/^pages\//, '').replace(/\.js$/, '');
    entryPoints[`pages/${key}`] = abs;
    keyByEntry.set(path.resolve(abs), key);
  }

  const result = await esbuild.build({
    entryPoints,
    bundle: true,
    minify: true,
    format: 'iife',
    outdir: path.join(options.outDir, 'assets', 'js'),
    entryNames: '[dir]/[name]-[hash]',
    metafile: true,
    alias: { 'web-manager': options.clientEntry },
    logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"production"' },
  });

  for (const [outFile, meta] of Object.entries(result.metafile.outputs)) {
    if (!meta.entryPoint) continue;
    const key = keyByEntry.get(path.resolve(meta.entryPoint));
    if (key) manifest.js[key] = `/${path.relative(options.outDir, outFile)}`;
  }

  // ---- Theme CSS: `omega:` imports resolve through the LAYER CHAIN (active
  // theme → classy → core). A bare `@use 'variables'` would resolve relative
  // to the importing file first — beating any layering — so layered lookups
  // use an explicit scheme, which sass never resolves relatively.
  const themeEntry = collectLayered(options.cssLayers, /^theme\.scss$/).get('theme.scss');
  const compiled = sass.compile(themeEntry, {
    importers: [layeredFileImporter(options.cssLayers)],
    style: 'compressed',
  });
  const hash = crypto.createHash('md5').update(compiled.css).digest('hex').slice(0, 8);
  const cssRel = path.join('assets', 'css', `theme-${hash}.css`);
  fs.mkdirSync(path.join(options.outDir, 'assets', 'css'), { recursive: true });
  fs.writeFileSync(path.join(options.outDir, cssRel), compiled.css);
  manifest.css.theme = `/${cssRel}`;

  return manifest;
}

/**
 * PurgeCSS post-pass: strip unused selectors from the theme CSS using the
 * rendered HTML as content.
 * @param {object} options
 * @param {string} options.outDir
 * @param {object} options.manifest - from buildAssets()
 * @returns {Promise<{ before: number, after: number }>}
 */
async function purgeCss(options) {
  const { PurgeCSS } = require('purgecss');
  const cssFile = path.join(options.outDir, options.manifest.css.theme.slice(1));
  const before = fs.statSync(cssFile).size;

  const results = await new PurgeCSS().purge({
    content: [path.join(options.outDir, '**/*.html')],
    css: [cssFile],
  });

  fs.writeFileSync(cssFile, results[0].css);
  return { before, after: Buffer.byteLength(results[0].css) };
}

/**
 * Sass FileImporter resolving `omega:<name>` through the ordered layer dirs
 * (first layer containing _<name>.scss or <name>.scss wins).
 * @param {string[]} layers
 * @returns {object}
 */
function layeredFileImporter(layers) {
  const { pathToFileURL } = require('node:url');
  return {
    findFileUrl(url) {
      if (!url.startsWith('omega:')) return null;
      const name = url.slice('omega:'.length);
      for (const dir of layers) {
        if (fs.existsSync(path.join(dir, `_${name}.scss`)) || fs.existsSync(path.join(dir, `${name}.scss`))) {
          return pathToFileURL(path.join(dir, name));
        }
      }
      return null;
    },
  };
}

module.exports = { buildAssets, purgeCss };
