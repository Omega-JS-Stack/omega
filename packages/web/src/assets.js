/**
 * The @omega.js/web asset pipeline over ordered LAYER ROOTS (site → active
 * theme → base → core). Each layer root follows one convention:
 *
 *   <layer>/js/main.js        - the main-bundle module (core ships the default)
 *   <layer>/js/pages/**       - page modules (index.js per page dir, or flat)
 *   <layer>/js/layouts/**     - layout modules, keyed by layout name
 *   <layer>/css/main.scss     - the main-bundle entry (core ships the default)
 *   <layer>/css/pages/**      - page styles (same shape as js/pages)
 *   <layer>/css/layouts/**    - layout styles (same shape as js/layouts)
 *   <layer>/_theme.scss       - theme layers only: the theme's sass entry
 *   <layer>/_theme.js         - theme layers only: the theme's js module
 *
 * ONE RULE for page and layout assets, JS and CSS alike (#624): EVERY layer
 * that ships a file for a key is built, and they all LOAD, in layer order —
 * core, then the base theme, then the active theme, then the consumer. Nothing
 * replaces anything: a framework page script always runs, the theme decorates,
 * the consumer adds. So a manifest key holds a LIST in load order:
 *   { js: { main, firstPaint, pages: {key: [url]}, layouts: {key: [url]} },
 *     css: { main, critical, pages: {key: [sheet]}, layouts: {key: [sheet]} } }
 * A css `sheet` is `{ href }`, a hashed file like the js lanes, or (under
 * INLINE_MAX_BYTES) `{ inline }` carrying the compiled css itself, which the
 * head prints as a `<style>` block where the link stood (#767).
 * `css.critical` is css TEXT the same way: the first-paint subset the head
 * inlines so the main sheet can load deferred (#750).
 * Each layer's output carries a suffix naming its owning layer (core: none,
 * a theme: `.<theme id>`, the consumer: `.site`), so two layers' bundles for
 * one key never collide — content hashes aside, dev mode's stable names need it.
 *
 * The site-wide `main.js` / `main.scss` are the one REPLACE lane: the first
 * layer that ships one wins, and it extends the layers below it by importing
 * the same name (`import coreMain from 'omega:main'`, `@use 'omega:main'`).
 *
 * Special import specifiers (UJM conventions, resolved by esbuild plugin):
 *   @omega.js/client             → the @omega.js/client entry (options.clientEntry)
 *   omega:<name>            → the same name from the layers strictly BELOW the
 *                             importing file's OWN layer (the JS twin of sass's
 *                             `omega:` importer, which stays skip-self)
 *   __main_assets__/js/...  → the core layer (framework runtime modules)
 *   __main_assets__/themes/…→ the packaged themes dir (e.g. bootstrap js)
 *   __theme__/...           → active theme root, base fallback
 *   <framework dependency>  → resolved from @omega.js/web's own installation,
 *                             so consumer code imports @tanstack/charts & friends bare
 *
 * Every js entry is wrapped in a boot stub around the runtime handshake
 * (runtime/boot.js): the main bundle calls bootMain(mod) — @omega.js/client
 * initialize + global module — page bundles call bootPage(mod), which
 * awaits the main boot before running the page module with
 * ({ manager, options }), and layout bundles call bootLayout(mod) with the
 * module's namespace, whose default export is optional. Bundles are ESM with code splitting: @omega.js/client
 * and the boot runtime land in a shared chunk that evaluates once per page,
 * so every bundle sees the SAME initialized singleton (webpack's single
 * module graph, reproduced with `<script type="module">` semantics).
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const sass = require('sass');
const Logger = require('@omega.js/devkit/logger');
const { bundle } = require('@omega.js/devkit/bundle');
const { collectLayered, collectProviders } = require('./layers.js');
const { collectSectionAssets } = require('./sections.js');
const { collectHeroAnimations } = require('./hero-animations.js');
const { resolvePathPrefix, prefixCss } = require('./path-prefix.js');
const { checkThemeVocabulary } = require('./theme-vocabulary.js');
const { readFontMetricsFile, systemFontMetrics } = require('./font-metrics.js');

// Variables
const logger = new Logger('assets');

// A page file is an ENTRY when it's a per-page index.js/index.scss, or a flat
// file at most two segments below pages/ (pages/index.js, pages/blog/[slug].js).
// Deeper non-index files are helpers (checkout modules/, account sections/),
// and underscore basenames are shared partials in BOTH languages (sass's own
// convention, mirrored for js: pages/legal/_document.js backs the terms/
// cookies/privacy entries without being an entry itself).
function isPageEntry(rel) {
  const base = path.basename(rel);
  if (base.startsWith('_')) return false;
  if (base === 'index.js' || base === 'index.scss') return true;
  return rel.split('/').length <= 3; // 'pages' + up to 2 segments
}

// The framework's own installation root (src/ in the monorepo, dist/ in a
// published install — both sit one level under the package root).
const FRAMEWORK_ROOT = path.resolve(__dirname, '..');

function pageKey(rel) {
  return rel.replace(/^pages\//, '').replace(/\.(js|scss)$/, '');
}

// A layout file is an entry at ANY depth — its key IS the layout name a page
// writes in frontmatter (`layout: modules/utilities/redirect`), which the
// layout tree nests as deeply as it likes. Underscore basenames stay partials,
// the same convention pages use in both languages.
function layoutKey(rel) {
  if (path.basename(rel).startsWith('_')) return null;
  return rel.replace(/^layouts\//, '').replace(/\.(js|scss)$/, '');
}

/**
 * The layered entry list for one asset lane: every layer that ships a file for
 * a key, in LOAD order — core first, the consumer last (#624). The list is the
 * reverse of the layer chain, which is resolution order (first layer wins).
 * @param {Map<string, Array<{dir: string, file: string}>>} providers - collectProviders output
 * @param {function(string): (string|null)} keyOf - relative path → manifest key, or null for a non-entry
 * @param {function(string): string} suffixOf - layer root → output-name suffix
 * @returns {Map<string, Array<{ file: string, ownerRoot: string, suffix: string }>>}
 */
function laneEntries(providers, keyOf, suffixOf) {
  const lanes = new Map();

  for (const [rel, list] of providers) {
    const key = keyOf(rel);
    if (key == null) continue;
    lanes.set(key, [...list].reverse().map(({ dir, file }) => {
      const ownerRoot = path.dirname(dir);
      return { file, ownerRoot, suffix: suffixOf(ownerRoot) };
    }));
  }

  return lanes;
}

// Wildcard segments use the Next.js filename convention (Windows-safe):
// js/pages/blog/[slug].js → key blog/[slug] matches any /blog/<segment> page.
const WILDCARD_SEGMENT = /^\[[^\]/]+\]$/;

/**
 * Resolve one manifest bucket's entry for a key (spec §7). Precedence: exact
 * key, the per-page-dir `<key>/index` spelling, then wildcard keys — a `[name]`
 * segment matches exactly one URL segment (a trailing `/index` on the wildcard
 * key is the per-page-dir spelling and never consumes a URL segment). Among
 * wildcard matches the most-literal key wins; ties break lexicographically for
 * determinism. Pages key on the URL, layouts on the layout name; both resolve
 * here, because they are one rule.
 * @param {object|undefined} map - manifest bucket (js.pages / js.layouts / css.pages / css.layouts)
 * @param {string} base - the key ('/' → 'index', /blog/hi → 'blog/hi', a layout's name)
 * @returns {Array<string|object>|null} the lane's entries in load order (js urls,
 *   css `{ href }` / `{ inline }` sheets), or null
 */
function resolvePageAsset(map, base) {
  if (!map) return null;
  const exact = map[base] ?? map[`${base}/index`];
  if (exact != null) return exact;

  const baseSegments = base.split('/');
  const matches = Object.keys(map).filter((key) => {
    if (!key.includes('[')) return false;
    const segments = key.replace(/\/index$/, '').split('/');
    if (segments.length !== baseSegments.length) return false;
    return segments.every((seg, i) => WILDCARD_SEGMENT.test(seg) || seg === baseSegments[i]);
  });
  if (!matches.length) return null;

  const literals = (key) => key.split('/').filter((seg) => !WILDCARD_SEGMENT.test(seg)).length;
  matches.sort((a, b) => literals(b) - literals(a) || a.localeCompare(b));
  return map[matches[0]];
}

/**
 * Build the js + css bundles for a site, returning the asset manifest.
 * @param {object} options
 * @param {string[]} options.layers - ordered layer roots (site → active theme → base → core)
 * @param {string[]} options.themeRoots - the theme layer dirs within `layers`
 *   (resolveThemeLayers output — consumer-local theme dirs can't be derived)
 * @param {string} options.themesDir - the themes dir (for __main_assets__/themes)
 * @param {string} options.coreDir - the core layer root (for __main_assets__)
 * @param {string} options.outDir - the site output dir (_site)
 * @param {string} options.clientEntry - path to @omega.js/client's entry (aliased as `@omega.js/client`)
 * @param {string[]} [options.sectionRoots] - section/component/hero-animation
 *   resolution bases (consumer dir, then theme layers — registerSectionTags'
 *   order). Feeds the spec §7 asset lanes: every entry's section.scss (and
 *   every `_hero/<name>/style.scss`, #441) compiles into the main sheet via
 *   `omega:sections` (PurgeCSS self-trims unused ones) and every section.js /
 *   `script.js` bundles into the main bundle behind DOM-presence init
 *   (data-omega-section/-component/-hero attributes, boot.js bootSections)
 * @param {string} [options.pathPrefix] - the base path the built site is served
 *   under (#355): emitted stylesheets' `url()` targets are written under it.
 *   Manifest URLs stay root-relative — the HTML pass mounts them (src/path-prefix.js)
 * @param {boolean} [options.dev] - dev mode: stable (un-hashed) names, no minify —
 *   asset rebuilds keep their URLs so rendered HTML stays valid without a re-render
 * @param {function} [options.warn] - warning sink for the theme fall-through
 *   guard and the js/modules/ notice (default the devkit logger)
 * @param {'css'|'js'} [options.only] - rebuild just one half (dev watcher
 *   narrowing: a css-only rebuild writes no js files, so the dev server
 *   hot-swaps stylesheets instead of full-reloading; dev's stable names make
 *   the partial manifest harmless). Omit for the full build.
 * @returns {Promise<{ js: object, css: object }>}
 */
async function buildAssets(options) {
  const manifest = { js: { pages: {}, layouts: {} }, css: { pages: {}, layouts: {} } };
  // Explicit (resolveThemeLayers output) — a consumer-local theme dir can't
  // be recognized by its parent dir, so callers name the theme roots.
  const themeRoots = options.themeRoots;
  // Every layer's file for a key is built, so their outputs need distinct
  // names: the suffix names the OWNING layer. Core is the unsuffixed floor, a
  // theme carries its own id, and the consumer layer — the chain holds exactly
  // one — is `.site`.
  const layerSuffix = (layerRoot) => {
    if (layerRoot === options.coreDir) return '';
    if (themeRoots.includes(layerRoot)) return `.${path.basename(layerRoot)}`;
    return '.site';
  };
  // The §7 asset lanes: every resolved section/component, plus the hero
  // animations (#441), which ride the SAME lanes by design — one
  // `{ kind, id, scss, js }` list, so the sass importer and the bundle's
  // registry take a hero folder with no special case.
  const sectionAssets = [
    ...collectSectionAssets(options.sectionRoots || []),
    ...collectHeroAnimations(options.sectionRoots || []),
  ];

  if (options.only !== 'css') {
    // ---- JS entries: layered union of page modules + the main bundle
    const jsDirs = options.layers.map((layer) => path.join(layer, 'js')).filter((dir) => fs.existsSync(dir));
    // The framework's own layers — theme roots + core (the #469 orphan guard
    // answers to consumer files only).
    const frameworkLayers = new Set([...themeRoots, options.coreDir]);
    const entryPoints = {};
    const keyBySpecifier = new Map();
    // #469: the CONSUMER files isPageEntry passed over, minus the `_` partials
    // it rejects by name. Judged against the bundle graph below.
    const consumerJsDirs = new Set(jsDirs.filter((dir) => !frameworkLayers.has(path.dirname(dir))));
    const notEntries = [];

    const jsPageProviders = collectProviders(jsDirs, /^pages\/.*\.js$/);
    for (const [rel, providers] of jsPageProviders) {
      if (isPageEntry(rel) || path.basename(rel).startsWith('_')) continue;
      for (const { dir, file } of providers) {
        if (consumerJsDirs.has(dir)) notEntries.push(file);
      }
    }

    // Page and layout modules ride ONE rule (#624): every layer's file is an
    // entry, and the manifest keeps them in load order.
    const jsLanes = [
      ['pages', laneEntries(jsPageProviders, (rel) => (isPageEntry(rel) ? pageKey(rel) : null), layerSuffix)],
      ['layouts', laneEntries(collectProviders(jsDirs, /^layouts\/.*\.js$/), layoutKey, layerSuffix)],
    ];
    for (const [bucket, lanes] of jsLanes) {
      for (const [key, entries] of lanes) {
        // Sized up front so the metafile pass can fill each layer's slot by
        // index — esbuild reports outputs in its own order.
        manifest.js[bucket][key] = new Array(entries.length);
        entries.forEach(({ file, suffix }, slot) => {
          entryPoints[`${bucket}/${key}${suffix}`] = `omega-boot:${file}`;
          keyBySpecifier.set(file, [bucket, key, slot]);
        });
      }
    }

    const mainJs = collectLayered(jsDirs, /^main\.js$/).get('main.js');
    if (mainJs) {
      entryPoints.main = `omega-boot:${mainJs}`;
      keyBySpecifier.set(mainJs, ['main']);
    }

    // The first-paint entry (#585): layered like main.js, but deliberately NOT
    // wrapped in the boot stub — the stub's runtime import is what pulls
    // @omega.js/client into the shared chunk, and this script exists precisely
    // to run without it. Plain entry, its own tiny bundle, loaded from the head
    // ahead of the main bundle.
    const firstPaintJs = collectLayered(jsDirs, /^first-paint\.js$/).get('first-paint.js');
    if (firstPaintJs) {
      entryPoints['first-paint'] = firstPaintJs;
      keyBySpecifier.set(firstPaintJs, ['firstPaint']);
    }

    const bootRuntime = path.resolve(FRAMEWORK_ROOT, 'runtime', 'boot.js');

    const bootPlugin = {
      name: 'omega-boot',
      setup(build) {
        // Boot stubs: main → bootMain (initialize + global module), page
        // modules → bootPage (awaits the main boot), layout modules →
        // bootLayout. The runtime import is what pulls @omega.js/client into
        // the shared chunk.
        //
        // A LAYOUT module is handed to the runtime as its NAMESPACE, so
        // shipping no default export is legal there: layout chrome that must
        // act BEFORE the client is ready runs at import time and boots nothing
        // (the redirect layout's hop, which cannot wait on the firebase
        // runtime). The stub never names `default` for one, because esbuild
        // proves that access undefined and warns on every build (#742); the
        // optional default is read at RUNTIME, inside bootLayout. Main and page
        // modules keep the default import, where a missing export is a typo and
        // esbuild says so.
        build.onResolve({ filter: /^omega-boot:/ }, (args) => ({
          path: args.path.slice('omega-boot:'.length),
          namespace: 'omega-boot',
        }));
        build.onLoad({ filter: /.*/, namespace: 'omega-boot' }, (args) => {
          const isMain = args.path === mainJs;
          const spec = keyBySpecifier.get(args.path);
          const isLayout = Boolean(spec) && spec[0] === 'layouts';
          const boot = isMain ? 'bootMain' : (isLayout ? 'bootLayout' : 'bootPage');
          const lines = [
            `import { ${boot} } from ${JSON.stringify(bootRuntime)};`,
            isLayout
              ? `import * as mod from ${JSON.stringify(args.path)};`
              : `import mod from ${JSON.stringify(args.path)};`,
            `${boot}(mod);`,
          ];
          // §7 section-JS lane: the main stub imports every section.js (and
          // every hero animation's script.js, #441) and registers the id → init
          // map; bootSections inits per [data-omega-<kind>="<id>"] element
          // after the main boot.
          const jsEntries = isMain ? sectionAssets.filter((entry) => entry.js) : [];
          if (jsEntries.length) {
            lines[0] = `import { bootMain, bootSections } from ${JSON.stringify(bootRuntime)};`;
            const registry = { section: [], component: [], hero: [] };
            jsEntries.forEach((entry, i) => {
              lines.push(`import sectionInit${i} from ${JSON.stringify(entry.js)};`);
              registry[entry.kind].push(`${JSON.stringify(entry.id)}: sectionInit${i}`);
            });
            lines.push(`bootSections({ section: { ${registry.section.join(', ')} }, component: { ${registry.component.join(', ')} }, hero: { ${registry.hero.join(', ')} } });`);
          }
          return { resolveDir: path.dirname(args.path), contents: lines.join('\n') };
        });

        // `omega:<name>` — the JS twin of sass's layered `omega:` importer:
        // the SAME relative name resolved from the layers BELOW the importing
        // file. That is how a consumer `js/main.js` EXTENDS the framework's
        // site-wide bundle instead of replacing it: `import coreMain from
        // 'omega:main'`, matching `@use 'omega:main'` on the css side.
        //
        // BELOW is literal here: the scan starts one layer UNDER the importer's
        // own, so a theme's main.js reaches core and can never resolve upward
        // into the consumer layer that extends it (a cycle, and core drops out
        // of the graph entirely). The sass importer deliberately stays
        // skip-self — `@use` is a configure-and-extend contract sass resolves
        // per file, and no theme sheet has needed the stricter rule; changing
        // it there is its own decision, not a side effect of this one. An
        // importer outside every layer (a node_modules file) matches no layer
        // and scans the whole chain.
        build.onResolve({ filter: /^omega:/ }, (args) => {
          const name = args.path.slice('omega:'.length);
          const importer = path.resolve(args.importer);
          const importerLayer = options.layers
            .findIndex((root) => importer.startsWith(path.resolve(root) + path.sep));
          for (const root of options.layers.slice(importerLayer + 1)) {
            for (const candidate of [path.join(root, 'js', `${name}.js`), path.join(root, `${name}.js`)]) {
              if (fs.existsSync(candidate)) return { path: candidate };
            }
          }
          // Nothing below ships it — esbuild's own "Could not resolve" says so.
          return null;
        });

        // UJM asset-aliases: __main_assets__ → core layer / themes dir; __theme__ → active theme (base fallback)
        build.onResolve({ filter: /^__main_assets__\// }, (args) => {
          const rest = args.path.slice('__main_assets__/'.length);
          const target = rest.startsWith('themes/')
            ? path.join(options.themesDir, rest.slice('themes/'.length))
            : path.join(options.coreDir, rest);
          return { path: target };
        });
        // The walk includes each shadowed packaged theme (withShadowedTwins,
        // #773): a consumer theme standing in for `classy` and shipping no
        // `_theme.js` means to INHERIT the skin — Bootstrap on window, the
        // tooltip and hero-form boots — exactly as its `_theme.scss` inherits
        // the sheet. Base's floor still answers for a theme with a NEW id,
        // which shadows nothing.
        const themeResolveRoots = withShadowedTwins(themeRoots, options);
        build.onResolve({ filter: /^__theme__\// }, (args) => {
          const rest = args.path.slice('__theme__/'.length);
          for (const root of themeResolveRoots) {
            if (fs.existsSync(path.join(root, rest))) return { path: path.join(root, rest) };
          }
          return { path: path.join(themeResolveRoots[0] || options.themesDir, rest) };
        });
      },
    };

    // The ONE esbuild wrapper (#736): @omega.js/devkit composes the shared parts
    // — the framework-deps resolve hook, the production `@dev-only` strip, the
    // minify/sourcemap rules, the timing line — so only web's own boot plugin
    // and entry shape live here. `omega dev` rebuilds one-shot from its own
    // source watcher (it watches layer roots the bundle graph never sees), so
    // this is always mode 'build' with dev as the OUTPUT rule.
    const result = await bundle({
      frameworkRoot: FRAMEWORK_ROOT,
      entries: entryPoints,
      dev: Boolean(options.dev),
      // ESM + splitting is load-bearing: shared modules (@omega.js/client, the boot
      // runtime) go into one chunk the browser evaluates once — the singleton
      // survives across the main and page bundles.
      format: 'esm',
      splitting: true,
      outdir: path.join(options.outDir, 'assets', 'js'),
      entryNames: options.dev ? '[dir]/[name]' : '[dir]/[name]-[hash]',
      chunkNames: 'chunks/[name]-[hash]',
      // Directory alias so SUBPATH imports work too (@omega.js/client/modules/dom.js)
      alias: { '@omega.js/client': path.dirname(options.clientEntry) },
      plugins: [bootPlugin],
      define: { 'process.env.NODE_ENV': options.dev ? '"development"' : '"production"' },
    });

    for (const [outFile, meta] of Object.entries(result.metafile.outputs)) {
      if (!meta.entryPoint) continue;
      const abs = meta.entryPoint.replace(/^omega-boot:/, '');
      const spec = keyBySpecifier.get(path.resolve(abs)) || keyBySpecifier.get(abs);
      if (!spec) continue;
      const url = `/${path.relative(options.outDir, outFile)}`;
      if (spec[0] === 'main') manifest.js.main = url;
      else if (spec[0] === 'firstPaint') manifest.js.firstPaint = url;
      else manifest.js[spec[0]][spec[1]][spec[2]] = url;
    }

    // ---- Orphaned page modules (#469): a consumer `js/pages/` file that is
    // neither an ENTRY nor an INPUT of one is dead code — the build stays green
    // and the page it was written for ships with no JS. The legacy UJM shape
    // (js/pages/dashboard/agents/edit.js, 4 segments) lands here every time.
    // The bundle graph is the judge, not the path: deep helpers are legitimate
    // (payment/checkout/modules/, dashboard/account/sections/) and stay silent
    // because their page entry imports them. Framework layers are out of scope
    // — a production build strips `@dev-only` blocks BEFORE esbuild records
    // inputs, so core's dev-block-only helpers read as orphans there.
    const bundled = new Set(Object.keys(result.metafile.inputs).map((input) => path.resolve(input)));
    const orphans = notEntries.filter((abs) => !bundled.has(abs));
    if (orphans.length) {
      const warn = options.warn || logger.warn.bind(logger);
      warn(
        `js/pages/ modules NOTHING loads — not page entries, and no entry imports them, so these `
        + `pages ship with no JS: ${orphans.join(', ')}\n`
        + `  the fix for a FAMILY of pages: one \`[name]\` wildcard entry serving every URL under it `
        + `(js/pages/blog/[slug].js, or js/pages/dashboard/agents/[id]/index.js deeper)\n`
        + `  the fix for ONE page: a page entry is an \`index.js\` at any depth (js/pages/dashboard/agents/edit/index.js), `
        + `or a flat file of 3 segments or fewer (js/pages/dashboard/agents.js)\n`
        + `  a deliberate helper is imported by its page entry, or named with a leading underscore (js/pages/legal/_document.js)`,
      );
    }

    // ---- `js/modules/` is not an asset lane (#249, #624). It was the
    // framework's own standalone-IIFE lane at fixed URLs until the layout lane
    // replaced its last user (the redirect script), and a consumer's copy was
    // never built at all. Nothing here builds one now — but a directory that
    // silently ships nothing is the trap #249 was filed for, so the build names
    // it. Shared code goes in `js/libs/`, imported normally (docs/web/libs.md).
    const strayModuleDirs = options.layers
      .map((layer) => path.join(layer, 'js', 'modules'))
      .filter((dir) => fs.existsSync(dir) && fs.readdirSync(dir).some((file) => file.endsWith('.js')));
    if (strayModuleDirs.length) {
      const warn = options.warn || logger.warn.bind(logger);
      warn(
        `js/modules/ is not an asset lane — nothing builds these directories, so their files ship `
        + `nowhere: ${strayModuleDirs.join(', ')}\n`
        + `  the fix: move shared modules to js/libs/ and import them from js/main.js or a page module\n`
        + `  a script that belongs to ONE layout goes in js/layouts/<layout>.js\n`
        + `  contract: docs/web/libs.md`,
      );
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
  const pathPrefix = resolvePathPrefix(options.pathPrefix);
  const emitCss = (rawCss, rel) => {
    // Base path (#355) before the hash: the digest names the bytes actually
    // served, and a theme sheet's `url(/assets/fonts/…)` is out of reach of
    // every HTML pass. No prefix → the sheet is untouched.
    const css = prefixCss(rawCss, pathPrefix);
    const hash = crypto.createHash('md5').update(css).digest('hex').slice(0, 8);
    const outRel = path.join('assets', 'css', options.dev ? `${rel}.css` : rel.replace(/(\.css)?$/, `-${hash}.css`));
    fs.mkdirSync(path.dirname(path.join(options.outDir, outRel)), { recursive: true });
    fs.writeFileSync(path.join(options.outDir, outRel), css);
    return `/${outRel}`;
  };
  // #767: a page or layout sheet small enough to carry in the document ships
  // as css TEXT (`{ inline }`) rather than a url (`{ href }`): the same
  // pipeline bytes, base path and all, just never a request. Dev is exempt for
  // #750's reason: a stable blocking link is what keeps a watch rebuild
  // flash-free.
  const inlineOrEmitCss = (rawCss, rel) => {
    const css = escapeStyleText(prefixCss(rawCss, pathPrefix));
    if (!options.dev && Buffer.byteLength(css) <= INLINE_MAX_BYTES) return { inline: css };
    return { href: emitCss(rawCss, rel) };
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
  // Held past the block: the font lane below reads the SHEET for its preloads.
  let mainCss = null;
  if (mainScss) {
    const ownerRoot = path.dirname(path.dirname(mainScss));
    // #768: the metric-matched fallback faces go in HERE, on the compiled
    // sheet, before the emit and before the critical extractor, so the
    // inlined block and the deferred sheet carry the same faces and the same
    // stacks, and a swap moves nothing.
    mainCss = injectFallbackFonts(compileScss(mainScss, ownerRoot), options);
    manifest.css.main = emitCss(mainCss, 'main');
    // #98: the compiled bundle is the only honest place to ask whether the
    // active theme reached the shared fall-through vocabulary at all.
    checkThemeVocabulary({ css: mainCss, themeRoots, warn: options.warn });
    // #750: the first-paint subset the head inlines, so the sheet above can
    // stop render-blocking. Dev is exempt — it never purges either, and a
    // stable blocking link is what keeps a watch rebuild flash-free.
    manifest.css.critical = options.dev ? '' : await extractCriticalCss({
      css: prefixCss(mainCss, pathPrefix),
      // The consumer's own templates first (its nav override is the markup
      // that actually paints), then the theme layers, then core.
      roots: [...new Set([...(options.sectionRoots || []), ...options.layers])],
      warn: options.warn,
    });
  }

  // Page and layout css on the SAME rule as their js twins (#624): every
  // layer's sheet for a key compiles to its own bundle, and the manifest keeps
  // them in load order, so the head links core's first and the consumer's last
  // — the cascade decides, not a replacement.
  const cssLanes = [
    ['pages', laneEntries(collectProviders(cssDirs, /^pages\/.*\.scss$/), (rel) => (isPageEntry(rel) ? pageKey(rel) : null), layerSuffix)],
    ['layouts', laneEntries(collectProviders(cssDirs, /^layouts\/.*\.scss$/), layoutKey, layerSuffix)],
  ];
  //
  // A sheet that compiles to NOTHING (core's pricing, 404 and alternatives
  // files are empty) is never emitted: the head links every page sheet as a
  // render-blocking stylesheet, and on Slow 4G that empty request queued
  // behind the font preloads and held the page's first paint a second past
  // the home page's (#763 proof). No rules, no link.
  //
  // And a sheet SMALL enough is never a request either (#767): the round trip
  // costs about a second on that connection whatever the sheet weighs, so a
  // compiled sheet at or under INLINE_MAX_BYTES rides the manifest as css text
  // and the head prints it as a <style> block where its link stood. Each entry
  // is `{ inline }` or `{ href }`, in the same load order (#624). The split
  // is per sheet, so a heavy layer keeps its link beside a light one's block
  // without moving either in the cascade.
  for (const [bucket, lanes] of cssLanes) {
    for (const [key, entries] of lanes) {
      const sheets = entries
        .map(({ file, ownerRoot, suffix }) => ({ css: compileScss(file, ownerRoot), rel: path.join(bucket, `${key}${suffix}`) }))
        .filter(({ css }) => css.trim() !== '')
        .map(({ css, rel }) => inlineOrEmitCss(css, rel));
      if (sheets.length) manifest.css[bucket][key] = sheets;
    }
  }

  // ---- Fonts: every layer's fonts/ dir lands at /assets/fonts (first layer
  // wins — a consumer's file beats the theme's vendored face), and a
  // consumer-local theme is followed by the packaged theme it shadows, whose
  // faces it inherits through the hatch (fontLayers, #773). Stable names
  // by design: @font-face src URLs are written in theme css. The union is
  // then PRUNED to faces some emitted stylesheet actually references — a
  // sibling theme imports classy's token-pure floor but not its faces, so
  // the base layer's woff2s were pure artifact fat (cp199 parked finding).
  // Partial builds (options.only) skip the prune: their css set is not the
  // full picture.
  const fontDirs = fontLayers(options).map((layer) => path.join(layer, 'fonts')).filter((dir) => fs.existsSync(dir));
  const copiedFonts = [];
  for (const [rel, abs] of collectLayered(fontDirs)) {
    const dest = path.join(options.outDir, 'assets', 'fonts', rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(abs, dest);
    copiedFonts.push(rel);
  }
  if (!options.only && copiedFonts.length > 0) {
    let cssText = '';
    const readCssTree = (dir) => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          readCssTree(abs);
        } else if (entry.name.endsWith('.css')) {
          cssText += fs.readFileSync(abs, 'utf8');
        }
      }
    };
    readCssTree(path.join(options.outDir, 'assets', 'css'));
    // The tree is no longer the whole picture (#767): a page or layout sheet
    // small enough to inline never reaches disk, it rides the manifest as css
    // text. Its `url(…woff2)` is a real reference to a real file, so a face
    // only that sheet declares would look unreferenced and be deleted out
    // from under the page that needs it.
    cssText += inlinedSheetCss(manifest.css);
    for (const rel of copiedFonts) {
      const urlRel = rel.split(path.sep).join('/');
      if (!cssText.includes(urlRel) && !cssText.includes(path.basename(rel))) {
        fs.rmSync(path.join(options.outDir, 'assets', 'fonts', rel), { force: true });
      }
    }
  }

  // ---- Font preloads (#765): the first-paint faces the head preloads, read
  // off the compiled sheet's @font-face rules (see firstPaintFontFaces) and
  // kept to the ones a browser can actually FETCH. A local face names a file
  // this build writes, and the inheritance hatch hands a partial theme the
  // default skin's @font-face rules without its font FILES (fonts are skin
  // assets, #177) — so the rule alone would name four files nothing wrote,
  // and a preload for a face that is not there is a guaranteed 404. The one
  // theme that DOES get the files is a consumer-local theme shadowing a
  // packaged id: fontLayers walks the dir it shadows, so its inherited faces
  // are fetchable and stay in the list (#773).
  // The local URLs stay ROOT-RELATIVE like every other manifest URL: the html
  // transform is the one place a manifest URL becomes markup, and prefixing
  // both would mount it twice (path-prefix.js). A face hosted on another
  // origin (absolute or protocol-relative src) rides through untouched — the
  // browser can fetch it, and the head's loop already emits the crossorigin
  // the spec asks for.
  const fetchable = (url) => (
    ABSOLUTE_URL.test(url) ? true : fs.existsSync(path.join(options.outDir, url.slice(1)))
  );
  manifest.fontPreloads = mainCss === null ? [] : firstPaintFontFaces(mainCss, options.warn).filter(fetchable);

  return manifest;
}

// A @font-face block and the pieces of it the preload rule reads. Font-face
// bodies never nest braces, so the block match is exact.
const FONT_FACE_BLOCK = /@font-face\s*\{([^}]*)\}/gi;
const FONT_FACE_FAMILY = /font-family\s*:\s*([^;}]+)/i;
const FONT_FACE_SRC = /src\s*:/i;
const FONT_FACE_UNICODE_RANGE = /unicode-range\s*:\s*([^;}]+)/i;
const FONT_SRC_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^'")]*))\s*\)/gi;

// A src that names another origin: absolute (https:, and `data:` for that
// matter) or protocol-relative.
const ABSOLUTE_URL = /^(?:\/\/|[a-z][a-z0-9+.-]*:)/i;

/**
 * The value of a face's `src:` descriptor, ended at the first `;` OUTSIDE
 * url() and outside quotes. A `data:font/woff2;base64,…` URI carries a
 * semicolon of its own, and stopping there swallowed every later source in
 * the same face — the real file among them included.
 * @param {string} body - a @font-face block body
 * @returns {string|null} the descriptor value, null when the face declares none
 */
function readSrcDescriptor(body) {
  const start = FONT_FACE_SRC.exec(body);
  if (!start) return null;

  const from = start.index + start[0].length;
  let depth = 0;
  let quote = null;
  let i = from;
  for (; i < body.length; i += 1) {
    const char = body[i];
    if (quote) {
      if (char === quote && body[i - 1] !== '\\') quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth = Math.max(0, depth - 1);
    } else if (char === ';' && depth === 0) {
      break;
    }
  }

  return body.slice(from, i);
}

// Basic latin — the block the first viewport's copy is written in.
const BASIC_LATIN_MAX = 0xFF;

/**
 * Does a `unicode-range` descriptor cover any basic-latin codepoint? Every
 * form reduces to its LOWEST codepoint: `U+0131` is its own value, `U+0100-02BA`
 * its start, and a `U+00??` wildcard the digits with `?` read as 0 — so a range
 * reaches basic latin exactly when that value is at or below U+00FF.
 * @param {string} descriptor - the raw comma-separated descriptor value
 * @returns {boolean}
 */
function coversBasicLatin(descriptor) {
  return descriptor.split(',').some((token) => {
    const match = /^\s*u\+([0-9a-f?]{1,6})/i.exec(token);

    return !!match && parseInt(match[1].replace(/\?/g, '0'), 16) <= BASIC_LATIN_MAX;
  });
}

/**
 * The first-paint faces of a compiled stylesheet (#765) — the woff2 files the
 * head preloads so glyphs are ready when the layout paints (no system-font
 * flash on a cold cache).
 *
 * The source is what the CSS DECLARES, never what the files are named: a theme
 * that vendors ONE variable face, or names its files its own way, is covered
 * the day it ships, and nothing has a naming convention to keep. A face is a
 * first-paint face when it declares no `unicode-range` (it covers everything)
 * or when one of its ranges reaches basic latin. The `-latin-ext` subsets and
 * their kin stay out: they cover glyphs the first viewport's copy does not
 * use, and every extra preload competes with the ones it does.
 *
 * BOTH styles ride the list (#467): every display headline renders its accent
 * as an <em> (heading/masthead, the hero's headline_accent), so the first
 * viewport asks for the italic face as surely as the normal one.
 *
 * woff2 only — the one format the head's `type="font/woff2"` link names.
 * Sorted and deduped: the emitted HTML must be deterministic.
 *
 * A src the head cannot mount — anything neither root-relative nor absolute
 * nor protocol-relative — is SKIPPED and named: a page-relative `url(../fonts/
 * x.woff2)` resolves against the PAGE, so `/blog/post/` would ask for a path
 * the site never wrote, and a silently wrong preload is the failure mode this
 * rule exists to end.
 * @param {string} css - a compiled bundle, URLs as the sheet carries them
 * @param {function} [warn] - warning sink (default the devkit logger)
 * @returns {string[]} the face URLs, deduped and sorted
 */
function firstPaintFontFaces(css, warn) {
  const report = warn || logger.warn.bind(logger);
  const urls = new Set();
  for (const [, body] of String(css).matchAll(FONT_FACE_BLOCK)) {
    const range = FONT_FACE_UNICODE_RANGE.exec(body);
    if (range && !coversBasicLatin(range[1])) continue;

    const src = readSrcDescriptor(body);
    if (src === null) continue;

    const family = FONT_FACE_FAMILY.exec(body);
    for (const [, doubleQuoted, singleQuoted, bare] of src.matchAll(FONT_SRC_URL)) {
      const url = (doubleQuoted ?? singleQuoted ?? bare).trim();
      if (!/\.woff2(?:[?#]|$)/i.test(url)) continue;

      if (!url.startsWith('/') && !ABSOLUTE_URL.test(url)) {
        report(
          `@font-face ${family ? family[1].trim() : '(unnamed)'}: src "${url}" is page-relative, `
          + 'so it is NOT preloaded — a relative font URL resolves against the page that links it, '
          + 'and every route below the root would ask for a path this build never wrote\n'
          + '  the fix: write the src root-relative (url(/assets/fonts/…)), which is where the '
          + 'asset lane copies every layer\'s fonts/ dir',
        );
        continue;
      }

      urls.add(url);
    }
  }

  return [...urls].sort();
}

/**
 * Every sheet the manifest carries as css TEXT rather than as a file (#767):
 * the page and layout entries that inlined. The font prune reads these beside
 * the emitted css tree, since a face an inlined sheet declares is referenced
 * exactly as surely as one an emitted sheet does.
 * @param {object} css - the manifest's css bucket
 * @returns {string} the inlined sheets, concatenated
 */
function inlinedSheetCss(css) {
  return ['pages', 'layouts']
    .flatMap((bucket) => Object.values(css[bucket] || {}).flat())
    .filter((sheet) => sheet && sheet.inline)
    .map((sheet) => sheet.inline)
    .join('');
}

// ─── Metric-matched fallback faces (#768) ────────────────────────────────────

// A face's style descriptor, and the `--omega-font-*` type stacks the theme
// tokens carry. A custom property's value is verbatim text (sass never
// normalizes it), so the rewrite below edits it in place rather than
// reprinting it.
const FONT_FACE_STYLE = /font-style\s*:\s*([^;}]+)/i;
const FONT_TOKEN_DECLARATION = /--omega-font-[a-z0-9-]*\s*:\s*([^;}]+)/gi;

// Where the asset lane mounts every layer's fonts/ dir, and so the one prefix
// a face's src can carry back to a file on disk.
const FONTS_MOUNT = '/assets/fonts/';

/**
 * Generate a metric-matched fallback face per vendored family (#768) and name
 * it in the stacks: the transform that ends the swap-time reflow.
 *
 * `font-display: swap` paints the system fallback first and the real face when
 * it lands. Unless the two occupy the same lines, every paragraph moves: the
 * #763 proof measured /terms at CLS 0.158, one shift at 3.1 s on the body copy.
 * So for each family the sheet vendors, this reads the FONT FILE's metrics
 * (src/font-metrics.js), reads the same five numbers for the system family the
 * theme's own stack already names next, and emits
 *
 *   @font-face{font-family:"Inter Fallback";src:local("Helvetica Neue");
 *     size-adjust:…;ascent-override:…;descent-override:…;line-gap-override:…}
 *
 * That is the fontaine / next-font formula: size-adjust is the width ratio of
 * the two faces, and each vertical override is the web face's own proportion
 * divided by it (an override is read against the ALREADY adjusted em).
 *
 * The input is the COMPILED sheet, so a consumer theme's own faces get this
 * with nothing to declare, and no scss source names a fallback family. It runs
 * before the critical extractor, so the inlined block and the deferred sheet
 * agree, which is the one thing that makes the swap free.
 *
 * A family the lane cannot cover is SKIPPED, never fatal: a face whose file
 * this build does not ship has nothing to measure (the #177 inheritance hatch,
 * silent, the way the preload lane drops those too), and a stack that names no
 * system family the metrics table knows is named in one warning.
 * @param {string} css - the compiled main bundle
 * @param {object} options - buildAssets options (layers, warn)
 * @returns {string} the sheet, with the generated faces appended
 */
function injectFallbackFonts(css, options) {
  const report = options.warn || logger.warn.bind(logger);
  const faces = [];
  const fallbacks = new Map();
  for (const [family, file] of vendoredFaces(css, fontLayers(options))) {
    const stack = fontStackNaming(css, family);
    if (!stack) continue;

    const system = firstKnownSystemFamily(stack, family);
    if (!system) {
      report(
        `@font-face ${family}: no metric-matched fallback, because the --omega-font-* stack that names it `
        + `("${stack.trim()}") reaches no family this build can measure, so the swap from the system `
        + 'font to it will still move the text\n'
        + '  the fix: name one of the common system families (Arial, Helvetica, Helvetica Neue, Georgia, '
        + 'Times New Roman, Verdana) in the stack behind the web family',
      );
      continue;
    }

    let metrics = null;
    try {
      metrics = readFontMetricsFile(file);
    } catch (error) {
      report(`@font-face ${family}: ${file} could not be measured (${error.message}), so it gets no metric-matched fallback`);
      continue;
    }

    faces.push(fallbackFace(family, system, metrics));
    fallbacks.set(family.toLowerCase(), `${family} Fallback`);
  }

  return faces.length === 0 ? css : nameFallbacksInStacks(css, fallbacks) + faces.join('');
}

/**
 * The vendored families of a sheet and the file to measure each one from: the
 * NORMAL face (an italic sets different widths), preferring the one that
 * covers basic latin, the subset body copy is written in. A face whose src
 * this build did not write is not a family this lane can cover.
 * @param {string} css - the compiled main bundle
 * @param {string[]} layers - the layer roots, in order
 * @returns {Map<string, string>} family name → font file on disk
 */
function vendoredFaces(css, layers) {
  const best = new Map();
  for (const [, body] of String(css).matchAll(FONT_FACE_BLOCK)) {
    const family = FONT_FACE_FAMILY.exec(body);
    const src = readSrcDescriptor(body);
    if (!family || src === null) continue;

    const style = FONT_FACE_STYLE.exec(body);
    if (style && style[1].trim().toLowerCase() !== 'normal') continue;

    const name = unquoteFamily(family[1]);
    const range = FONT_FACE_UNICODE_RANGE.exec(body);
    const rank = !range || coversBasicLatin(range[1]) ? 2 : 1;
    if ((best.get(name) || { rank: 0 }).rank >= rank) continue;

    const file = fontFileOnDisk(src, layers);
    if (file) best.set(name, { file, rank });
  }

  return new Map([...best].map(([name, { file }]) => [name, file]));
}

/**
 * The layer chain the FONT lanes walk: every asset layer, and behind each
 * consumer-local theme the packaged theme it SHADOWS
 * ([#773](https://github.com/Omega-JS-Stack/omega/issues/773)).
 *
 * A tier-2 theme wins its id whole (`resolveThemeLayers`), and the
 * `@forward 'omega:theme'` hatch hands it the packaged skin's `@font-face`
 * rules — which name files that live in the very dir the consumer theme
 * replaced. Inheriting the sheet has to imply inheriting the files it points
 * at, or every one of those URLs 404s and the preload lane drops the faces as
 * unfetchable. The twin sits directly BEHIND its shadower, so a consumer face
 * of the same name still wins.
 * @param {object} options - buildAssets options ({ layers, themeRoots, themesDir })
 * @returns {string[]} layer roots, in order
 */
function fontLayers(options) {
  return withShadowedTwins(options.layers || [], options);
}

/**
 * A layer list with the PACKAGED theme each consumer-local theme shadows
 * inserted directly behind it
 * ([#773](https://github.com/Omega-JS-Stack/omega/issues/773)).
 *
 * A tier-2 theme wins its id whole (`resolveThemeLayers`), which means the dir
 * it replaced is no longer in any chain — so anything the consumer theme
 * INHERITS rather than ships (the skin's faces through the scss hatch, the
 * skin's `_theme.js` behaviors) would resolve past it to base and be lost. The
 * twin sits between them: the consumer's own file still wins, and base is
 * still the floor for a theme with a NEW id, which shadows nothing.
 * @param {string[]} roots - layer roots, in order
 * @param {object} options - { themeRoots, themesDir }
 * @returns {string[]} roots, each shadowing theme followed by its twin
 */
function withShadowedTwins(roots, options) {
  const themeRoots = options.themeRoots || [];
  const themesDir = options.themesDir;

  return roots.flatMap((layer) => {
    if (!themesDir || !themeRoots.includes(layer)) return [layer];
    // Already the packaged dir — nothing shadows it.
    if (!path.relative(themesDir, layer).startsWith('..')) return [layer];
    const twin = path.join(themesDir, path.basename(layer));
    return fs.existsSync(twin) ? [layer, twin] : [layer];
  });
}

/**
 * The file behind a face's `src`, in the layer that ships it. Only the faces
 * THIS build writes can be measured: a `url(/assets/fonts/…)` is a layer's
 * `fonts/` file (first layer wins, as the copy lane resolves it), and anything
 * else (a CDN face, a data URI, a page-relative url) is out of reach.
 * @param {string} src - the src descriptor value
 * @param {string[]} layers - the layer roots, in order
 * @returns {string|null}
 */
function fontFileOnDisk(src, layers) {
  for (const [, doubleQuoted, singleQuoted, bare] of src.matchAll(FONT_SRC_URL)) {
    const url = (doubleQuoted ?? singleQuoted ?? bare).trim();
    if (!url.startsWith(FONTS_MOUNT)) continue;

    const rel = url.slice(FONTS_MOUNT.length).replace(/[?#].*$/, '');
    for (const layer of layers) {
      const file = path.join(layer, 'fonts', rel);
      if (fs.existsSync(file)) return file;
    }
  }

  return null;
}

/**
 * The first `--omega-font-*` stack that names a family: the theme's own
 * statement of what this face falls back to.
 * @param {string} css - the compiled main bundle
 * @param {string} family - the web family
 * @returns {string|null} the stack's value, null when no token names it
 */
function fontStackNaming(css, family) {
  for (const [, value] of String(css).matchAll(FONT_TOKEN_DECLARATION)) {
    if (value.split(',').some((entry) => unquoteFamily(entry) === family)) return value;
  }

  return null;
}

/**
 * The family a metric-matched face is built against: the first one AFTER the
 * web family in its own stack that the metrics table knows. `-apple-system`,
 * `ui-serif`, `roboto` and their kin are not measurable families, so they are
 * simply passed over. The name comes from the TABLE, so the generated
 * `local()` carries the family's canonical spelling whatever case the stack
 * happens to be written in (`georgia`).
 * @param {string} stack - the stack's value
 * @param {string} family - the web family
 * @returns {{name: string, metrics: object}|null}
 */
function firstKnownSystemFamily(stack, family) {
  const entries = stack.split(',').map((entry) => unquoteFamily(entry));
  const known = [];
  for (let i = entries.indexOf(family) + 1; i > 0 && i < entries.length; i += 1) {
    const metrics = systemFontMetrics(entries[i]);
    if (metrics) known.push(metrics);
  }
  if (!known.length) return null;

  // Every measured family the stack names, in stack order, becomes a local()
  // source of the ONE generated face: `local()` resolves only where that font
  // is installed (Helvetica Neue is macOS-only, Arial and Georgia ship on
  // Windows too), and a face with no resolvable source is skipped by font
  // matching, which would hand the swap to an UNADJUSTED tail entry. The
  // overrides are computed against the first family; the others differ from it
  // by about a percent of size-adjust, which is still a swap that moves
  // nothing visible, where no source at all is the whole 0.158 CLS back.
  return { name: known[0].family, metrics: known[0], names: known.map((entry) => entry.family) };
}

/**
 * The generated face. `size-adjust` is the width ratio; each vertical override
 * is the web face's own proportion divided by that ratio, because an override
 * is read against the already size-adjusted em. `descent-override` is a
 * non-negative percentage, so the sign the font stores is dropped here.
 * @param {string} family - the web family
 * @param {{name: string, metrics: object, names: string[]}} system - the fallback family, and every measured family the stack names after the web one
 * @param {object} metrics - the web family's metrics
 * @returns {string} one @font-face rule
 */
function fallbackFace(family, system, metrics) {
  const sizeAdjust = (metrics.avgCharWidth / metrics.unitsPerEm)
    / (system.metrics.avgCharWidth / system.metrics.unitsPerEm);
  const percent = (value) => `${(value * 100).toFixed(3)}%`;
  const override = (value) => percent(Math.abs(value / metrics.unitsPerEm) / sizeAdjust);

  const sources = system.names.map((name) => `local("${name}")`).join(',');

  return `@font-face{font-family:"${family} Fallback";src:${sources};`
    + `size-adjust:${percent(sizeAdjust)};ascent-override:${override(metrics.ascent)};`
    + `descent-override:${override(metrics.descent)};line-gap-override:${override(metrics.lineGap)}}`;
}

/**
 * Name each generated face in the stacks, immediately after its web family:
 * the fallback is what paints while the face loads, so it has to beat the
 * system tail. Idempotent: a stack that already names it is left alone.
 * @param {string} css - the compiled main bundle
 * @param {Map<string, string>} fallbacks - lowercased web family → fallback family
 * @returns {string}
 */
function nameFallbacksInStacks(css, fallbacks) {
  return css.replace(FONT_TOKEN_DECLARATION, (declaration, value) => {
    const entries = value.split(',');
    const names = entries.map((entry) => unquoteFamily(entry));
    const rewritten = [];
    for (let i = 0; i < entries.length; i += 1) {
      rewritten.push(entries[i]);
      const fallback = fallbacks.get(names[i].toLowerCase());
      if (!fallback || names.includes(fallback)) continue;

      // The neighbour's own spacing: a compiled sheet writes `a, b`, but a
      // consumer's stack may be written tight, and this edits in place.
      rewritten.push(`${/^\s*/.exec(entries[i + 1] ?? entries[i])[0]}"${fallback}"`);
    }

    return declaration.slice(0, declaration.length - value.length) + rewritten.join(',');
  });
}

/**
 * A family name as the stack means it: no quotes, no padding.
 * @param {string} name - one entry of a font stack, or a font-family descriptor
 * @returns {string}
 */
function unquoteFamily(name) {
  return name.trim().replace(/^['"]|['"]$/g, '').trim();
}

// The framework's own safelist — what no content scan can see (see purgeCss).
// It is the DEFAULT, not the whole truth: a brand's `targets.web.purgecss`
// safelist merges over it (#250).
const PURGE_SAFELIST = { greedy: [/omega-/], standard: ['collapse', 'collapsing', 'show', 'showing', 'fade'] };

/**
 * Compile one configured pattern-lane entry. `new RegExp`'s own throw names
 * neither the lane nor the pattern, so a typo in omega.json5 (an unclosed
 * character class) surfaced as an anonymous SyntaxError mid-build — this
 * attributes it to the exact config key that carries it.
 * @param {string|RegExp} pattern - one safelist entry
 * @param {string} lane - the safelist lane (deep/greedy/keyframes)
 * @returns {RegExp}
 * @throws {Error} naming targets.web.purgecss.safelist.<lane> and the pattern
 */
function toSafelistPattern(pattern, lane) {
  if (pattern instanceof RegExp) return pattern;
  try {
    return new RegExp(pattern);
  } catch (error) {
    throw new Error(
      `targets.web.purgecss.safelist.${lane}: "${pattern}" is not a valid regular expression `
      + `— ${error.message}`,
    );
  }
}

/**
 * Merge a config-supplied PurgeCSS safelist over the framework defaults.
 * Config is JSON5, so its patterns are STRINGS — the pattern lanes
 * (greedy/deep/keyframes) take RegExp, so strings become one there; `standard`
 * takes both. The array form is PurgeCSS's own shorthand for `standard`.
 * @param {object|Array} [configured] - targets.web.purgecss.safelist
 * @returns {object} a PurgeCSS safelist object
 */
function mergeSafelist(configured) {
  if (!configured) return PURGE_SAFELIST;
  const extra = Array.isArray(configured) ? { standard: configured } : configured;
  const merged = { ...PURGE_SAFELIST };
  for (const [lane, patterns] of Object.entries(extra)) {
    if (!Array.isArray(patterns) || !patterns.length) continue;
    const values = lane === 'standard'
      ? patterns
      : patterns.map((pattern) => toSafelistPattern(pattern, lane));
    merged[lane] = [...(merged[lane] || []), ...values];
  }
  return merged;
}

/**
 * PurgeCSS post-pass: strip unused selectors from the MAIN css bundle using
 * the rendered HTML AND the built JS as content.
 * @param {object} options
 * @param {string} options.outDir
 * @param {object} options.manifest - from buildAssets()
 * @param {object} [options.purgecss] - the resolved config's `purgecss` section
 *   (`targets.web.purgecss`): `{ safelist: { standard, deep, greedy, keyframes } }`
 * @returns {Promise<{ before: number, after: number }>}
 */
async function purgeCss(options) {
  const { PurgeCSS } = require('purgecss');
  const cssFile = path.join(options.outDir, options.manifest.css.main.slice(1));
  const before = fs.statSync(cssFile).size;

  const results = await new PurgeCSS().purge({
    // The built JS is content too: a client-rendered app's markup exists only
    // as strings in its bundle, so scanning HTML alone strips a consumer's own
    // classes at build time (#66 — they survive `omega dev`, which never purges).
    content: [path.join(options.outDir, '**/*.html'), path.join(options.outDir, '**/*.js')],
    css: [cssFile],
    // The omega namespace is runtime-driven — app-shell.js stamps data-shell-*
    // and the motion engine stamps data-omega-inview / data-omega-scrolled /
    // data-omega-active client-side — so the content scan can never see those
    // states. Keep every omega-namespaced rule.
    // greedy: the framework's own runtime-stamped namespace. standard:
    // Bootstrap's JS-toggled transition classes — added at runtime, absent
    // from the rendered HTML the content scan reads, so without the safelist
    // the collapse/fade transitions get purged and snap.
    // A brand adds its own on top through targets.web.purgecss.safelist.
    safelist: mergeSafelist(options.purgecss && options.purgecss.safelist),
  });

  fs.writeFileSync(cssFile, results[0].css);
  return { before, after: Buffer.byteLength(results[0].css) };
}

// The FIRST-PAINT template set (#750): the markup a visitor sees before
// scrolling, per layer root — the root/base layout chrome, the marketing nav,
// the app shell's topbar and sidebar, and every layer's hero section. The
// subset is chosen by MARKUP rather than by a hand-kept selector list, so a
// theme (or a consumer that overrides one of these files) gets ITS OWN nav and
// hero rules inlined with no per-theme bookkeeping — and every class the nav
// and hero really render carries its rules, which is what keeps CLS at zero.
const CRITICAL_TEMPLATES = [
  path.join('_layouts', 'core', 'root.html'),
  path.join('_layouts', '**', 'core', 'base.html'),
  path.join('_includes', '**', 'sections', 'nav.html'),
  path.join('_includes', 'global', 'sections', 'app-topbar.html'),
  path.join('_includes', 'global', 'sections', 'app-sidebar.html'),
  path.join('_sections', '**', 'hero', 'section.html'),
  // The shared masthead cluster: about, contact, pricing, download and every
  // document page compose their opening band's copy through it (#467)
  path.join('_components', 'heading', 'masthead', 'component.html'),
];

// Every band a template stamps `data-omega-first-paint` (#763, #467): the SAME
// attribute that starts a band's reveals at parse time selects its critical css,
// so a template that opts a band in is never listed above by hand. Only the
// band's own markup feeds the extractor, never the rest of its page: a whole
// page layout drags its below-the-fold vocabulary (pricing's accordion) into
// the inline block. A band that paints with the document needs its sizing in
// the block, or the headline paints at the UA size and jumps.
const FIRST_PAINT_BAND_GLOB = path.join('{_layouts,_sections,_components,_includes}', '**', '*.html');
const FIRST_PAINT_BAND_REGEX = /<section\b[^>]*\bdata-omega-first-paint\b[^>]*>[\s\S]*?<\/section>/g;

/**
 * The first-paint band chunks across the template roots, as PurgeCSS raw content.
 * @param {string[]} roots
 * @returns {Array<{ raw: string, extension: string }>}
 */
function firstPaintBands(roots) {
  return roots.flatMap((root) => fs.globSync(FIRST_PAINT_BAND_GLOB, { cwd: root }).flatMap((rel) => {
    const source = fs.readFileSync(path.join(root, rel), 'utf8');
    return [...source.matchAll(FIRST_PAINT_BAND_REGEX)].map((match) => ({ raw: match[0], extension: 'html' }));
  }));
}

// The inline block's byte budget. It is a WIRE number: the packaged themes
// measure 64 KB (neobrutalism) to 71 KB (newsflash, classy 68 KB), which gzip to
// 12-15 KB — about one initial congestion window, arriving WITH the HTML
// instead of costing the round trip this whole lane exists to remove. 72 KiB
// sits just above the heaviest packaged theme, so the warning means a sheet
// really has outgrown the mechanism. Over budget the build says so and still
// ships it: a heavier theme is that theme's call, not a reason to fail a
// consumer's build.
const CRITICAL_MAX_BYTES = 72 * 1024;

// A page or layout sheet at or under this size ships INLINE instead of as a
// link (#767). The cost of the link is the ROUND TRIP, not the bytes: the
// request queues behind the HTML and the font preloads, so the #763 proof
// measured /terms, which ships one 1 KB page sheet, first-painting a second
// past the home page's, which ships none. 8 KB is the crossover: below it the css is
// cheaper carried in the document than fetched, above it the document pays
// for bytes every page repeats.
const INLINE_MAX_BYTES = 8 * 1024;

/**
 * Make a stylesheet safe to print inside a <style> block: `</style` inside a
 * string literal (a `content:` value, an unencoded SVG data URI) would end the
 * block early and dump the rest of the sheet into the document as markup.
 * The css escape for `/` is legal exactly there, and the sequence cannot
 * appear anywhere else in a stylesheet. One home for the rule: the critical
 * block (#750) and the inlined page and layout sheets (#767) both print raw.
 *
 * @param {string} css
 * @returns {string}
 */
function escapeStyleText(css) {
  return css.replace(/<\/(style)/gi, '<\\/$1');
}

/**
 * Extract the first-paint subset of the compiled main bundle (#750) — the
 * block `head.html` inlines so the full sheet can load deferred. Same
 * extractor as the site-wide pass, pointed at the first-paint templates
 * instead of the rendered site.
 * @param {object} options
 * @param {string} options.css - the compiled main bundle (base path applied)
 * @param {string[]} options.roots - template roots (consumer dir + layer roots)
 * @param {function} [options.warn] - warning sink (default the devkit logger)
 * @returns {Promise<string>} the critical css ('' when no template matched)
 */
async function extractCriticalCss(options) {
  const { PurgeCSS } = require('purgecss');
  const content = [
    ...options.roots.flatMap((root) => CRITICAL_TEMPLATES.map((rel) => path.join(root, rel))),
    ...firstPaintBands(options.roots),
  ];
  const results = await new PurgeCSS().purge({
    content,
    css: [{ raw: options.css, name: 'main.css' }],
    // Every @font-face stays: the kept rules name their family through
    // `var(--omega-font-*)`, which PurgeCSS cannot follow, so `fontFace: true`
    // pruned all of them to an empty shell and the preloaded faces went
    // undeclared until the deferred sheet landed, a swap-time reflow. The
    // eight declarations cost about a kilobyte. Keyframes still prune.
    fontFace: false,
    keyframes: true,
    // Only the JS-toggled lane of the framework safelist: the collapsed mobile
    // menu's `.collapse:not(.show)` guard is a first-paint rule (an expanded
    // link list pushes the hero down). The greedy `omega-` lane is deliberately
    // NOT here — it would pull every section's styles into the inline block.
    //
    // Plus the motion lane, and ONLY it (#763): every reveal rule is scoped
    // `html[data-omega-motion] …` and resolved by `data-omega-inview`, and
    // neither token is ever in rendered markup for the scan to find (the same
    // reason the site-wide safelist exists) — so the extractor purged the whole
    // lane. Inline, that meant the first-paint band's copy painted VISIBLE, the
    // head's starter stamped it, and the deferred sheet landed on an
    // already-stamped element: no fade ever ran. The hide rule IS the
    // transition's starting state, so it belongs in the block that paints.
    // Greedy: the pattern has to keep a rule the token only appears in one
    // compound of (`html[data-omega-motion] [data-omega-reveal][data-omega-inview]`).
    //
    // Plus two rules the markup scan cannot reach (#763 proof, playground home
    // at CLS 0.27 → 0.07):
    // - the skip link's utility class. body.html renders it BEFORE every band,
    //   and unstyled it is a line of text that pushes the whole page down until
    //   the deferred sheet hides it. The rest of body.html is the alert bars,
    //   `hidden` until a script shows them, whose icon vocabulary would cost
    //   11 KB of block, so the file is not scanned: the one class is kept.
    // - the dotfield canvas, which its module CREATES at runtime. Without its
    //   positioning rule the canvas lands in flow whenever the module beats the
    //   deferred sheet, and the hero copy drops by the canvas height.
    safelist: {
      standard: PURGE_SAFELIST.standard,
      greedy: [/data-omega-(motion|reveal|inview)/, /visually-hidden-focusable/, /omega-dotfield__canvas/],
    },
  });

  const css = escapeStyleText(results[0].css);
  if (Buffer.byteLength(css) > CRITICAL_MAX_BYTES) {
    const warn = options.warn || logger.warn.bind(logger);
    warn(
      `critical css is ${Buffer.byteLength(css)} bytes, over the ${CRITICAL_MAX_BYTES}-byte budget `
      + '— the inlined block now costs more than the request it defers',
    );
  }

  return css;
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
 * component.scss / hero style.scss (deterministic kind+id order), so core main.scss pulls the
 * whole library with ONE line and PurgeCSS self-trims sections a site never
 * renders. Empty library → empty module (the @use is always safe).
 * @param {Array<{scss: string|null}>} sectionAssets - collectSectionAssets output
 *   plus collectHeroAnimations' (#441 — one lane, same shape)
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

module.exports = { buildAssets, purgeCss, resolvePageAsset, isPageEntry, firstPaintFontFaces, layeredFileImporter, sectionsImporter };
