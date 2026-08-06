/**
 * `omega dev` — the development loop:
 *   1. dev-mode assets (stable un-hashed names, no minify) → .omega/manifest
 *   2. programmatic Eleventy watch + serve over src/
 *   3. asset-source watchers (consumer src/assets + packaged theme/core
 *      layers) rebuild bundles IN PLACE — URLs are stable in dev, so the
 *      rendered HTML stays valid without a re-render; the dev server
 *      watches the built asset trees and live-reloads the browser (css
 *      hot-swaps, js reloads — no hand refresh).
 *
 * Port (N7): the website convention is 4000, resolved through the allocator —
 * taken ports bump +1. Multi-instance web brands offset deterministically:
 * each instance wants 4000 + its position in the instances array, so
 * apps/website and apps/website-admin dev side-by-side. `omega dev
 * --port=4001` (or a config `ports.website` entry) PINS the port instead:
 * busy = hard error, never a silent bump. The
 * resolved map of a live sibling backend (its `.temp/ports.json`) plus this
 * website port are injected into the page chrome as `dev.ports` so
 * @omega.js/client connects to the stack that is ACTUALLY running.
 *
 * `omega dev --local` first links every @omega.js framework the brand uses to
 * the local Omega monorepo (file: installs, idempotent) and starts the
 * monorepo's src→dist watch, then runs the normal dev loop (master plan §8).
 */
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const jetpack = require('fs-jetpack');
const Logger = require('@omega.js/devkit/logger');
const {
  CLASSIC_PORTS, isPortFree, resolvePorts, envPort,
  readPortsFile, writePortsFile, clearPortsFile,
  findBrandRoot, hasOmegaConfig, loadConfig, instancePortOffset,
} = require('@omega.js/config');
const { emitIcons } = require('@omega.js/devkit/icons');
const attachLogFile = require('@omega.js/devkit/attach-log-file');
const { emitLanguageFlags } = require('../language-flags.js');
const { buildAssets } = require('../assets.js');
const { buildServiceWorker, writeBuildMeta } = require('../service-worker.js');
const { resolveStaticDirs, copyStaticAssets, hasFaviconSet } = require('../static-assets.js');
const { devImageFallback } = require('../imagemin.js');
const { configureOmega } = require('../engine.js');
const { reconcileSampleContent } = require('../sample-content.js');
const { resolveThemeLayers } = require('../layers.js');
const { consumerPaths, loadSiteData } = require('../consumer.js');
const { PATHS, resolveClientEntry } = require('../paths.js');

const logger = new Logger('omega:dev');

const WATCH_DEBOUNCE_MS = 250;

module.exports = async function (options) {
  options = options || {};

  // Tee the whole run to <appRoot>/logs/dev.log — first statement of the verb
  // so a crash on the way up is already in the file (#197).
  attachLogFile(path.join(consumerPaths().root, 'logs', 'dev.log'));

  if (options.local) {
    await linkBrandToMonorepo();
  }

  const paths = consumerPaths();
  const siteData = loadSiteData(paths.root);
  const clientEntry = resolveClientEntry();
  const { port, bumped } = await resolveWebsitePort(paths.root, Number(options.port) || null);
  const devPorts = { ...readSiblingPorts(paths.root), website: port };

  // HTTPS (same contract as the backend's serve/emulator): the PUBLIC website
  // port speaks TLS through the shared mkcert proxy; eleventy sits on an
  // internal plain-http port behind it (WebSocket live-reload tunnels through).
  // `--no-https` or no mkcert → plain http on the public port, as before.
  const { ensureLocalHttpsCerts, startLocalHttpsProxy } = require('@omega.js/devkit/local-https');
  let httpsCerts = null;
  let internalPort = null;
  if (options.https !== false) {
    httpsCerts = await ensureLocalHttpsCerts({
      certsDir: path.join(paths.root, '.temp', 'certs'),
      log: (line) => logger.log(line),
    });

    if (httpsCerts) {
      ({ ports: { internal: internalPort } } = await resolvePorts({ wanted: { internal: 4443 } }));
    } else {
      logger.log('HTTPS disabled — could not obtain certificates (install mkcert: brew install mkcert && mkcert -install)');
    }
  }

  applyDevSiteUrl(siteData, port, httpsCerts !== null);

  // ---- Sample content on disk (spec §8): mirror the injected filler under
  // the gitignored .omega/sample-content/ so it can be read and copied —
  // machine-owned, regenerated every boot, gone per-collection once the
  // consumer owns that collection.
  const samples = reconcileSampleContent({
    appRoot: paths.root,
    consumerDir: paths.src,
    defaultsDir: PATHS.defaults,
  });
  if (samples.written.length) {
    logger.log(`Sample content: ${samples.written.length} files → ${path.relative(paths.root, samples.root)}/ (gitignored, regenerated each boot)`);
  }
  samples.removed.forEach((collectionDir) => logger.log(`Sample content: ${collectionDir} is yours now — materialized samples removed`));

  const activeTheme = (siteData.theme && siteData.theme.id) || 'classy';
  const themeLayerDirs = resolveAssetThemeLayers(paths, activeTheme);
  const layers = [
    ...(fs.existsSync(paths.assets) ? [paths.assets] : []),
    ...themeLayerDirs,
    PATHS.core,
  ];

  // ---- Fresh output + dev assets
  fs.rmSync(paths.out, { recursive: true, force: true });

  const build = (only) => buildAssets({
    layers,
    themeRoots: themeLayerDirs,
    sectionRoots: [paths.src, ...themeLayerDirs],
    themesDir: PATHS.themes,
    coreDir: PATHS.core,
    outDir: paths.out,
    clientEntry,
    dev: true,
    only,
  });

  // Static images (minted brand identity + src/assets/images) resolve up
  // front — the manifest's favicon flag depends on what will ship
  const staticDirs = resolveStaticDirs({
    brandRoot: findBrandRoot(paths.root),
    imagesDir: path.join(paths.assets, 'images'),
  });

  const manifest = await build();
  manifest.favicons = hasFaviconSet(staticDirs);
  jetpack.write(paths.manifest, JSON.stringify(manifest, null, 2));
  logger.log('Assets built (dev mode: stable names, no minify)');

  // ---- Service worker + build meta (/service-worker.js, /build.js,
  // /build.json) — dev serves the REAL service worker so push/caching are
  // testable; registration takeover + cache eviction keep one localhost
  // port safe across different projects.
  const buildSw = async () => {
    writeBuildMeta({
      siteData,
      outDir: paths.out,
      environment: 'development',
      version: jetpack.read(path.join(paths.root, 'package.json'), 'json')?.version,
      consumerDir: paths.src,
      clientEntry,
      manifest,
    });
    await buildServiceWorker({
      consumerDir: paths.src,
      outDir: paths.out,
      clientEntry,
      dev: true,
    });
  };
  await buildSw();

  // Copied once at boot; they change rarely, so no watcher (restart to pick
  // up new ones)
  copyStaticAssets({
    staticDirs,
    outDir: paths.out,
  });

  // Runtime icon set (/assets/fa/) — the browser-side auto-renderer fetches
  // these on demand (JS-set fa-* markup, e.g. the share buttons); emitted once
  // at boot like the statics (the set never changes mid-dev).
  emitIcons({
    outDir: paths.out,
    coreIconsDir: path.join(PATHS.core, 'icons'),
  });
  emitLanguageFlags({ outDir: paths.out });

  // ---- Rebuild assets in place on source changes
  const watchDirs = [
    paths.assets,
    ...themeLayerDirs,
    path.join(PATHS.core, 'js'),
    path.join(PATHS.core, 'css'),
    // Consumer-local section/component assets (§7) live OUTSIDE the asset
    // trees (src/_sections) — theme-layer sections are covered by the theme
    // roots above.
    path.join(paths.src, '_sections'),
    path.join(paths.src, '_components'),
  ].filter((dir) => fs.existsSync(dir));

  // Narrowed rebuilds: a css-only change set rebuilds just the stylesheets —
  // no js files are rewritten, so the dev server HOT-SWAPS the css without a
  // page reload. js changes rebuild js (full reload — scripts need one), and
  // an unknown/mixed set rebuilds everything.
  let timer = null;
  let pendingKinds = new Set();
  const kindOf = (file) => {
    if (/\.(scss|css)$/.test(file || '')) return 'css';
    if (/\.(js|mjs)$/.test(file || '')) return 'js';
    return 'other';
  };
  for (const dir of watchDirs) {
    fs.watch(dir, { recursive: true }, (event, file) => {
      pendingKinds.add(kindOf(file));
      clearTimeout(timer);
      timer = setTimeout(() => {
        const kinds = pendingKinds;
        pendingKinds = new Set();
        const only = kinds.size === 1 && !kinds.has('other') ? kinds.values().next().value : undefined;
        build(only)
          .then(() => logger.log(`Assets rebuilt (${only || 'all'}) — browser live-reloads${only === 'css' ? ' via css hot-swap' : ''}`))
          .catch((error) => logger.error('Asset rebuild failed:', error));
      }, WATCH_DEBOUNCE_MS);
    });
  }

  // The consumer's service-worker entry lives OUTSIDE the asset trees
  // (src/service-worker.js) — its own watcher; the browser picks the new
  // worker up on the next reload's registration update check.
  const consumerSwEntry = path.join(paths.src, 'service-worker.js');
  if (fs.existsSync(consumerSwEntry)) {
    let swTimer = null;
    fs.watch(consumerSwEntry, () => {
      clearTimeout(swTimer);
      swTimer = setTimeout(() => {
        buildSw()
          .then(() => logger.log('Service worker rebuilt — reload to activate the new worker'))
          .catch((error) => logger.error('Service worker rebuild failed:', error));
      }, WATCH_DEBOUNCE_MS);
    });
  }

  // ---- Eleventy watch + serve
  const Eleventy = require('@11ty/eleventy').default;
  const elev = new Eleventy(paths.src, paths.out, {
    quietMode: true,
    configPath: false,
    config: (eleventyConfig) => {
      eleventyConfig.setServerOptions(devServerOptions(paths.out, devPorts.auth));
      registerTemplateWatchTargets(eleventyConfig, { consumerDir: paths.src, activeTheme });
      return configureOmega(eleventyConfig, {
        consumerDir: paths.src,
        siteData,
        activeTheme,
        assetManifest: manifest,
        environment: 'development',
        dev: { ports: devPorts, authEmulatorProxy: true },
      });
    },
  });

  await elev.init();
  await elev.watch();
  elev.serve(httpsCerts ? internalPort : port);

  // TLS terminator on the public port → eleventy on the internal one
  if (httpsCerts) {
    startLocalHttpsProxy({
      port,
      targetPort: internalPort,
      certs: httpsCerts,
      log: (line) => logger.log(line),
    });
  }

  // Publish the resolved website port for sibling tools (same contract as the
  // backend emulator's ports file) and retract it on shutdown. The PUBLIC
  // port is the published one — the internal eleventy port is plumbing.
  writePortsFile(paths.root, { website: port });
  process.on('exit', () => clearPortsFile(paths.root));
  process.on('SIGINT', () => process.exit(0));

  if (bumped) {
    logger.log(`Port ${CLASSIC_PORTS.website} was taken — bumped to ${port}`);
  }
  logger.log(`Dev server: ${httpsCerts ? 'https' : 'http'}://localhost:${port}`);
};

/**
 * The asset lane's theme layer chain (#137). `resolveThemeLayers` probes
 * `<consumerDir>/themes/<id>` for a consumer-local theme, and EVERY other
 * caller — the engine, the production build, customize, the override map —
 * passes the Eleventy input dir, so a consumer-local theme lives at
 * `src/themes/<id>`. Resolving the asset lane from the app ROOT instead made
 * that theme invisible to the scss/js build AND to the asset watcher (both
 * derive from this list), so a brand's own theme silently rendered with the
 * packaged theme's styles.
 * @param {object} paths - consumerPaths() output
 * @param {string} activeTheme - theme id
 * @returns {string[]} ordered theme layer dirs
 */
function resolveAssetThemeLayers(paths, activeTheme) {
  return resolveThemeLayers({ activeTheme, consumerDir: paths.src, themesDir: PATHS.themes });
}

/**
 * Dev-server options: the image-variant fallback middleware (dev never runs
 * the responsive matrix — missing -NNNpx/.webp URLs rewrite to the verbatim
 * original) + live-reload on ASSET rebuilds. Eleventy's dev server only
 * reloads on its own template re-renders; our asset watcher writes bundles
 * straight into the out dir, so the server chokidars those trees too — css
 * changes hot-swap without a full reload, js changes reload the page. Kills
 * the "refresh the browser" hand step.
 *
 * The auth-emulator proxy goes FIRST: it owns whole URL prefixes and answers
 * them itself, so it must run before the clean-URL rewriter gets a chance to
 * treat one as a page path.
 * @param {string} outDir
 * @param {number} [authPort] - the auth emulator port to proxy (classic 9099)
 * @returns {object} setServerOptions() payload
 */
function devServerOptions(outDir, authPort) {
  return {
    middleware: [devAuthEmulator(authPort || CLASSIC_PORTS.auth), devCleanUrls(outDir), devImageFallback(outDir)],
    watch: [
      path.join(outDir, 'assets', 'css'),
      path.join(outDir, 'assets', 'js'),
    ],
  };
}

/**
 * Force a config RESET on edits under the template-source dirs (#49). Both
 * layered layouts (registered as virtual templates, content read at config
 * time) and the json-in-_includes data system (read into site.data._includes
 * at config time) are CAPTURES — and Eleventy reuses one config across watch
 * rebuilds unless the changed file triggers a reset, so without this the
 * rebuild logs "Wrote N files" and re-renders the stale capture until the
 * server is restarted.
 *
 * EVERY layer of the same chain the engine reads is a target (#134), not just
 * the consumer's: consumer `src/` → the theme layers (a consumer-local
 * `src/themes/<id>` or the packaged one) → core. Same chain, same resolution
 * — `resolveThemeLayers` — so a target can never drift from what
 * `configureOmega` actually captured. Only the machinery subtrees of a layer
 * (`_layouts`/`_includes`/`_sections`/`_components`, plus a theme's `fonts/`,
 * whose face list is a config-time readdir): a whole theme dir would
 * drag scss (the sass lane's own watcher) and pages (the incremental rebuild
 * path) into full config resets. The packaged `defaults` tree is the one whole
 * root (#136) — nothing in it rides the incremental path.
 *
 * Packaged targets register REAL paths. A linked brand reaches the framework
 * through a `node_modules/@omega.js/web` symlink, and Eleventy's watcher
 * ignores everything under `node_modules` — the resolved path sidesteps it.
 *
 * BOTH path forms are registered for cwd-contained targets. The absolute form
 * alone carries the reset today (the dev loop hands Eleventy absolute dirs, so
 * the watcher's event arrives absolute and matches it). Registering the
 * relative form ADDS a second, relative event for the same edit — each event
 * decides the reset for itself and the last one wins the throttle, which is
 * why the relative form must never be registered ALONE — and is kept as
 * insurance so a reset still fires if Eleventy ever reports these edits in
 * relative form. Its observable cost is a duplicate "File changed" line per
 * save. A target OUTSIDE cwd (a linked brand's framework layers, a hoisted
 * node_modules) registers ONLY absolute: an escaping `../` watch target makes
 * Eleventy re-root its watcher to the common ancestor, after which NO event
 * path matches ANY registered target and every reset dies — including the
 * consumer ones (#134 verification).
 * @param {object} eleventyConfig
 * @param {object} options
 * @param {string} options.consumerDir - the Eleventy input dir (<root>/src)
 * @param {string} [options.activeTheme] - theme id (default 'classy')
 * @param {string} [options.themesDir] - packaged themes root (default: packaged themes)
 * @param {string} [options.coreDir] - the framework core layer (default: packaged core)
 * @param {string} [options.defaultsDir] - framework defaults root (default: packaged defaults)
 */
function registerTemplateWatchTargets(eleventyConfig, options) {
  const themesDir = options.themesDir || PATHS.themes;
  const coreDir = options.coreDir || PATHS.core;
  const defaultsDir = options.defaultsDir || PATHS.defaults;
  const themeLayers = resolveThemeLayers({
    activeTheme: options.activeTheme,
    consumerDir: options.consumerDir,
    themesDir,
  });
  const targets = new Set();

  // The defaults tree WHOLE (#136): every dir under it — pages, showcase, the
  // sample-content corpora — is read at config time and registered as virtual
  // templates, so an edit to a packaged default page serves stale until
  // restart. Nothing under defaults/ rides the incremental path (it is not the
  // Eleventy input dir and carries no assets), so the root is the honest
  // target — it cannot drift as the engine grows another defaults reader.
  if (fs.existsSync(defaultsDir)) targets.add(fs.realpathSync(defaultsDir));

  for (const dir of ['_layouts', '_includes']) {
    // The consumer's own dirs register unconditionally — a brand may author
    // src/_includes mid-session, and the reset must already be armed.
    targets.add(path.join(options.consumerDir, dir));

    // Framework layers exist per theme, not per convention — most carry only
    // one of the two dirs, and a missing one is not a watchable path.
    for (const layer of [...themeLayers, coreDir]) {
      const target = path.join(layer, dir);
      if (fs.existsSync(target)) targets.add(fs.realpathSync(target));
    }
  }

  // Section/component entries are the same capture shape over a shorter chain
  // (consumer → theme layers, no core): sections.js caches each entry's
  // resolved template and its json5 defaults PER config registration, so an
  // edit to a section renders the cached parse until a reset. The dirs are
  // Eleventy-ignored, so template/json5 edits have no other lane — but the
  // dirs are also asset watchDirs, so a section.scss/js edit rides BOTH lanes:
  // its css hot-swap AND a config reset (accepted cost, #138).
  for (const dir of ['_sections', '_components']) {
    targets.add(path.join(options.consumerDir, dir));

    for (const layer of themeLayers) {
      const target = path.join(layer, dir);
      if (fs.existsSync(target)) targets.add(fs.realpathSync(target));
    }
  }

  // The theme layers' `fonts/` dirs (#139), the same theme-only chain the
  // capture reads: configureOmega readdir's the first layer WITH the dir into
  // site.fontPreloads, so a face added or removed mid-session serves stale
  // preload tags until restart. No consumer `src/fonts` — the capture never
  // looks there. Theme dirs are also asset watchDirs, so a font edit rides
  // BOTH lanes (asset rebuild + config reset) — same accepted cost as the
  // _sections block above (#138).
  for (const layer of themeLayers) {
    const target = path.join(layer, 'fonts');
    if (fs.existsSync(target)) targets.add(fs.realpathSync(target));
  }

  for (const target of targets) {
    const relative = path.relative(process.cwd(), target);
    const forms = relative.startsWith('..') ? [target] : new Set([target, relative]);
    for (const form of forms) {
      eleventyConfig.addWatchTarget(form, { resetConfig: true });
    }
  }
}

/**
 * Serve the Firebase auth emulator THROUGH the site origin (#156) — the dev
 * counterpart of the self-hosted /__/auth/* helpers a production build ships
 * (src/firebase-auth-helpers.js).
 *
 * The emulator's OAuth handler hands a redirect credential back by writing
 * `firebase:redirectEvent:*` into sessionStorage on ITS OWN origin, and the
 * SDK's helper iframe reads it back from there. Served on the emulator's port,
 * that origin is a third party to the site, and browser storage partitioning
 * gives the iframe a different, empty partition — the return leg dead-ends.
 * Proxied here, handler and iframe are both first-party to the site, so they
 * share one partition and signInWithRedirect completes in dev exactly as it
 * does in production.
 *
 * The prefixes are the emulator's whole surface, mounted at the site ROOT
 * because connectAuthEmulator() discards any path on the URL it is given
 * (@firebase/auth: "Always replace path with /") — a sub-path mount is not
 * available to us. `/emulator/*` covers the handler, the helper iframe and the
 * out-of-band action links; the two googleapis.com prefixes are the REST
 * surface, which the SDK addresses as `<emulator origin>/<apiHost><path>`.
 * None of them can collide with a page URL.
 * @param {number} authPort
 * @returns {function} connect-style middleware
 */
function devAuthEmulator(authPort) {
  const prefixes = ['/emulator', '/identitytoolkit.googleapis.com', '/securetoken.googleapis.com'];

  // Hop-by-hop framing headers belong to THIS connection, not the upstream's —
  // copying them makes Node chunk a body it is already re-chunking.
  const skipHeaders = new Set(['connection', 'keep-alive', 'transfer-encoding']);

  // setHeader + statusCode, never writeHead. Eleventy's dev server wraps `res`
  // to inject its live-reload script (eleventy-dev-server/server/wrapResponse):
  // a writeHead carrying a text/html content-type is DEFERRED into a replay
  // queue, but a piped Buffer write flushes the real headers first, and the
  // replay then throws ERR_HTTP_HEADERS_SENT and takes the whole dev server
  // down. Going through setHeader keeps that queue empty. It also keeps the
  // wrapper's html transform off the emulator's pages — the live-reload script
  // has no business inside the OAuth handler.
  const answer = (res, status, headers) => {
    res.statusCode = status;
    for (const [name, value] of Object.entries(headers)) {
      if (!skipHeaders.has(name.toLowerCase())) {
        res.setHeader(name, value);
      }
    }
  };

  // The emulator deliberately binds 127.0.0.1 only, while the site listens on
  // every interface — proxying for a LAN client would silently remove that
  // safety property and hand the emulator's whole REST surface to the network.
  const isLoopback = (address) => address === '::1'
    || (address || '').startsWith('127.')
    || (address || '').startsWith('::ffff:127.');

  return (req, res, next) => {
    const pathname = (req.url || '').split('?')[0];

    if (!prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
      return next();
    }
    if (!isLoopback(req.socket?.remoteAddress)) {
      return next();
    }

    const upstream = http.request({
      host: '127.0.0.1',
      port: authPort,
      method: req.method,
      path: req.url,
      headers: { ...req.headers, host: `127.0.0.1:${authPort}` },
    }, (upstreamRes) => {
      answer(res, upstreamRes.statusCode, upstreamRes.headers);
      upstreamRes.pipe(res);
    });

    // A website-only dev session (no emulator suite running) is an expected
    // external condition, not our bug: answer the auth call with a 502 that
    // names the port instead of hanging the request.
    upstream.on('error', (error) => {
      logger.error(`Auth emulator proxy: ${pathname} → :${authPort} failed (${error.message})`);
      answer(res, 502, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(Buffer.from(`Auth emulator on port ${authPort} is not reachable`));
    });

    return req.pipe(upstream);
  };
}

/**
 * Clean-URL resolution, the legacy serve.js contract: pages are flat `.html`
 * files with slash-free URLs, so `/signin` (and a stray `/signin/`) serves
 * `signin.html`. Mirrors production GitHub Pages, which resolves extensionless
 * paths against `.html` files natively.
 * @param {string} outDir
 * @returns {function} connect-style middleware
 */
function devCleanUrls(outDir) {
  const root = path.resolve(outDir);

  return (req, res, next) => {
    const [pathname, query] = (req.url || '').split('?');

    // A malformed percent-escape throws URIError — not a clean-URL
    // candidate, fall through to the static handler.
    let decoded;
    try {
      decoded = decodeURIComponent(pathname);
    } catch (e) {
      return next();
    }

    const clean = decoded.replace(/\/+$/, '');

    if (!clean) {
      return next();
    }

    // Legacy serve.js contract: rewrite only when the request doesn't hit a
    // real file but `<path>.html` exists. No extension sniffing — dotted
    // slugs (/updates/v1.0.0) are page URLs too.
    const original = path.resolve(root, `.${decoded}`);
    const resolved = path.resolve(root, `.${clean}.html`);
    if (
      resolved.startsWith(root + path.sep)
      && jetpack.exists(original) !== 'file'
      && jetpack.exists(resolved) === 'file'
    ) {
      req.url = `${clean}.html${query ? `?${query}` : ''}`;
    }

    return next();
  };
}

/**
 * Dev builds link to THIS server, never the live site (legacy _config_dev.yml
 * url-override parity): site.url is the one root every absolute-URL surface
 * derives from — canonicals/og tags, omega_external, absolute_url, redirect
 * pages, nav — so pointing it at the local origin keeps every click in dev.
 * @param {object} siteData - the loaded site global (mutated)
 * @param {number} port - the resolved dev-server port
 * @param {boolean} [https] - whether the public port speaks TLS (mkcert proxy)
 */
function applyDevSiteUrl(siteData, port, https) {
  siteData.url = `${https ? 'https' : 'http'}://localhost:${port}`;
}

/**
 * Resolve the website port through the allocator (N7). An explicit `--port`
 * flag or a config `ports.website` entry PINS the port (busy = hard error);
 * otherwise start from OMEGA_WEBSITE_PORT (a parent that already allocated)
 * or the classic 4000 and bump +1 while taken.
 */
async function resolveWebsitePort(root, flagPort) {
  const pins = {};

  if (flagPort) {
    if (!(await isPortFree(flagPort))) {
      throw new Error(`Port ${flagPort} (pinned via --port) is already in use — free it or pick another`);
    }
    pins.website = flagPort;
  } else {
    const configPin = loadPortPins(root).website;
    if (typeof configPin === 'number') {
      pins.website = configPin;
    }
  }

  const wanted = { website: websiteWantedPort(root) };
  const { ports, bumped } = await resolvePorts({ wanted, pins });
  return { port: ports.website, bumped: bumped.length > 0 };
}

/**
 * The wanted (pre-allocator) website port: OMEGA_WEBSITE_PORT (a parent that
 * already allocated) or the classic 4000, plus this app's deterministic
 * instance offset (multi-instance targets: an instance wants base + its
 * position in the instances array, so N instances dev side-by-side off the
 * same base). Lenient like loadPortPins — no config means no offset.
 */
function websiteWantedPort(root) {
  const base = envPort('website') || CLASSIC_PORTS.website;

  try {
    if (!hasOmegaConfig(root)) {
      return base;
    }
    const { config, instance } = loadConfig(root, 'web');
    return base + instancePortOffset(config.targets?.web, instance);
  } catch (error) {
    return base;
  }
}

/**
 * Read explicit port pins from the consumer's config `ports` section.
 * Lenient — a missing/broken config means no pins, never a dev-loop failure.
 */
function loadPortPins(root) {
  try {
    if (!hasOmegaConfig(root)) {
      return {};
    }
    const config = loadConfig(root, 'web').config;
    return config.ports && typeof config.ports === 'object' ? config.ports : {};
  } catch (error) {
    return {};
  }
}

/**
 * Merge the live ports files of sibling apps in the same brand (a running
 * backend's resolved emulator map). Dead-pid leftovers are ignored by
 * readPortsFile; our own app dir is skipped (a previous run of THIS server).
 * No brand root (standalone consumer) → empty map, client falls back to the
 * classic ports.
 */
function readSiblingPorts(root) {
  const brandRoot = findBrandRoot(root);
  if (!brandRoot) {
    return {};
  }

  const appsDir = path.join(brandRoot, 'apps');
  const merged = {};

  for (const entry of fs.existsSync(appsDir) ? fs.readdirSync(appsDir, { withFileTypes: true }) : []) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) {
      continue;
    }
    const appDir = path.join(appsDir, entry.name);
    if (path.resolve(appDir) === path.resolve(root)) {
      continue;
    }
    Object.assign(merged, readPortsFile(appDir) || {});
  }

  return merged;
}

/**
 * `--local` prelude: file:-install every @omega.js framework used anywhere in
 * this brand (all apps, walked up from cwd) from the local Omega monorepo,
 * then start the monorepo's src→dist watch as a session-scoped child.
 */
// Exposed for tests (the command function stays the main export)
module.exports.resolveWebsitePort = resolveWebsitePort;
module.exports.websiteWantedPort = websiteWantedPort;
module.exports.readSiblingPorts = readSiblingPorts;
module.exports.devServerOptions = devServerOptions;
module.exports.resolveAssetThemeLayers = resolveAssetThemeLayers;
module.exports.registerTemplateWatchTargets = registerTemplateWatchTargets;
module.exports.applyDevSiteUrl = applyDevSiteUrl;

async function linkBrandToMonorepo() {
  const local = require('@omega.js/devkit/local');
  const monorepoRoot = local.resolveMonorepoRoot();
  const brandRoot = local.findBrandRoot(process.cwd());
  logger.log(`Local mode: linking @omega.js packages from ${monorepoRoot}`);

  for (const appDir of local.discoverApps(brandRoot)) {
    await local.linkLocalPackages({ dir: appDir, monorepoRoot, logger });
  }

  const watch = local.startMonorepoWatch({ monorepoRoot, logger });
  if (watch.child) {
    // Session-scoped: the watch dies with this dev server (no orphans)
    process.on('SIGINT', () => {
      watch.child.kill('SIGTERM');
      process.exit(0);
    });
    process.on('exit', () => watch.child.kill('SIGTERM'));
  }
}
