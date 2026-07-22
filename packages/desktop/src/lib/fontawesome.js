// FontAwesome — the Font Awesome icon server: resolves icons from the
// brand's best available icon set and serves them to renderers on demand,
// so consumers get icons with ZERO setup. Roots, best-first (cp111):
//
//   1. OMEGA_FONTAWESOME_ROOT — a fontawesome.com download dir
//      (contains svgs/ + metadata/); no npm token needed.
//   2. @fortawesome/fontawesome-pro — installed by the BRAND app with its
//      own FA npm token (a prod dependency there, so it ships in the asar).
//      Never a dependency of @omega.js/desktop itself — license.
//   3. @fortawesome/fontawesome-free — the declared-dependency floor
//      (nothing vendored). Stays in the chain under a brand set, so a
//      partial Pro supply never loses icons the free set has.
//
// Main-side API:
//   manager.fontawesome.get(name, style)  → svg string | null   ('play', 'solid')
//   manager.fontawesome.has(name, style)  → boolean
//
// Renderer-side (preload contextBridge):
//   window.desktop.fontawesome.get(name, style) → Promise<svg string | null>
//
// Renderers normally never call this directly — @omega.js/desktop's renderer
// bootstrap auto-renders any `<i class="fa-solid fa-play">` element by
// injecting the SVG inline (see src/renderer.js _wireFontAwesome). Served
// SVGs size to the surrounding font and inherit its color — no icon font,
// no CSS framework, works offline (fs reads through asar transparently in
// packaged apps).
//
// Icon SEMANTICS (valid names/styles, candidate order incl. the brands
// fallback, the injected root attributes, alias mapping) live in
// @omega.js/client's icon-core (C4 cp108) — the SAME module web's
// build-time uj_icon tag uses, so lookup rules and rendered markup can
// never drift between the surfaces. Aliases ('search' →
// 'magnifying-glass') resolve through fontawesome-free's own metadata.
//
// Lookups are sanitized (lowercase slug names, path-safe style slugs) so
// the IPC channel can never be used to read outside the icon directories,
// and cached — each icon file is read from disk once per app run.

const path = require('path');
const jetpack = require('fs-jetpack');
const {
  PACKAGES,
  isValidIconName,
  isValidStyle,
  injectSvgAttributes,
  candidateRelPaths,
  buildAliasMap,
} = require('@omega.js/client/modules/icon-core.js');

const LoggerLite = require('./logger-lite.js');
const ipc = require('./ipc.js');

const logger = new LoggerLite('fontawesome');

const fontawesome = {
  _initialized: false,
  _manager: null,
  _roots: [],
  _aliasMap: null,
  _cache: new Map(),

  initialize(manager) {
    if (fontawesome._initialized) {
      return;
    }

    fontawesome._manager = manager;
    fontawesome._roots = fontawesome._resolveRoots();

    fontawesome._registerIpc();

    fontawesome._initialized = true;
  },

  // The icon package roots ({svgs,metadata} live under each), best-first:
  // OMEGA_FONTAWESOME_ROOT dir → Pro npm install → the free floor (a
  // declared runtime dependency, so it resolves in dev and inside a
  // packaged app.asar alike). Preference order is icon-core's PACKAGES —
  // the same chain web builds use.
  _resolveRoots() {
    const roots = [];

    const envRoot = process.env.OMEGA_FONTAWESOME_ROOT;
    if (envRoot) {
      if (jetpack.exists(path.join(envRoot, 'svgs')) === 'dir') {
        logger.log(`brand icon set active — OMEGA_FONTAWESOME_ROOT=${envRoot}`);
        roots.push(envRoot);
      } else {
        logger.warn(`OMEGA_FONTAWESOME_ROOT has no svgs/ dir — ignored (${envRoot}).`);
      }
    }

    for (const pkg of PACKAGES) {
      try {
        const root = path.dirname(require.resolve(`${pkg}/package.json`));
        if (roots.length === 0 && pkg === PACKAGES[0]) {
          logger.log('Font Awesome Pro npm set active.');
        }
        roots.push(root);
      } catch (e) {
        // Pro is brand-supplied and usually absent; a missing FREE set is
        // a real problem.
        if (pkg === PACKAGES[PACKAGES.length - 1]) {
          logger.warn(`${pkg} not resolvable — icon lookups may return null.`);
        }
      }
    }

    if (roots.length === 0) {
      logger.warn('no Font Awesome set resolvable — icon lookups will return null.');
    }
    return roots;
  },

  _registerIpc() {
    if (!ipc._initialized) {
      return;
    }

    ipc.handle('desktop:fontawesome:get', ({ name, style } = {}) => ({
      svg: fontawesome.get(name, style),
    }));
  },

  // Resolve an icon to its inline-SVG string ('play' → '<svg …>…</svg>').
  // Unknown names, invalid slugs, and unknown styles all return null — a
  // missing icon is a content problem, not a crash.
  get(name, style = 'solid') {
    if (!isValidIconName(name) || !isValidStyle(style)) {
      return null;
    }

    const key = `${style}/${name}`;
    if (fontawesome._cache.has(key)) {
      return fontawesome._cache.get(key);
    }

    const svg = fontawesome._read(name, style)
      || fontawesome._read(fontawesome._alias(name), style);
    if (!svg) {
      logger.warn(`unknown icon '${key}'.`);
    }

    fontawesome._cache.set(key, svg);
    return svg;
  },

  has(name, style = 'solid') {
    return fontawesome.get(name, style) !== null;
  },

  // Read one icon through icon-core's candidate order (style dir, then the
  // brands fallback), across the root chain best-first. Null name (no
  // alias) or no resolved roots → null.
  _read(name, style) {
    if (!name) {
      return null;
    }
    for (const root of fontawesome._roots) {
      for (const rel of candidateRelPaths(name, style)) {
        const raw = jetpack.read(path.join(root, 'svgs', rel), 'utf8');
        if (raw) {
          return injectSvgAttributes(raw);
        }
      }
    }
    return null;
  },

  // Alias slug → canonical slug from the richest metadata in the root
  // chain, built once per app run ('search' → 'magnifying-glass').
  _alias(name) {
    if (!fontawesome._aliasMap) {
      let map = new Map();
      for (const root of fontawesome._roots) {
        const raw = jetpack.read(path.join(root, 'metadata', 'icon-families.json'), 'utf8');
        if (!raw) {
          continue;
        }
        try {
          map = buildAliasMap(JSON.parse(raw));
        } catch (e) {
          logger.warn('could not parse icon-families.json — aliases disabled.');
        }
        break;
      }
      fontawesome._aliasMap = map;
    }
    return fontawesome._aliasMap.get(name) || null;
  },

  // Tear down IPC + caches (idempotent).
  disable() {
    if (ipc._initialized) {
      ipc.unhandle('desktop:fontawesome:get');
    }
    fontawesome._cache.clear();
    fontawesome._aliasMap = null;
    fontawesome._initialized = false;
  },
};

module.exports = fontawesome;
