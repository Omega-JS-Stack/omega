// FontAwesome — the Font Awesome icon server: resolves icons from the
// @fortawesome/fontawesome-free npm package (a runtime dependency — nothing
// vendored) and serves them to renderers on demand, so consumers get icons
// with ZERO setup.
//
// Main-side API:
//   manager.fontawesome.get(name, style)  → svg string | null   ('play', 'solid')
//   manager.fontawesome.has(name, style)  → boolean
//
// Renderer-side (preload contextBridge):
//   window.em.fontawesome.get(name, style) → Promise<svg string | null>
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
// Lookups are sanitized (lowercase slug names, style whitelist) so the IPC
// channel can never be used to read outside the icon directories, and
// cached — each icon file is read from disk once per app run.

const path = require('path');
const jetpack = require('fs-jetpack');
const {
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
  _root: null,
  _aliasMap: null,
  _cache: new Map(),

  initialize(manager) {
    if (fontawesome._initialized) {
      return;
    }

    fontawesome._manager = manager;
    fontawesome._root = fontawesome._resolveRoot();

    fontawesome._registerIpc();

    fontawesome._initialized = true;
  },

  // The @fortawesome/fontawesome-free package root ({svgs,metadata} live
  // under it). A declared runtime dependency, so it resolves in dev and
  // inside a packaged app.asar alike.
  _resolveRoot() {
    try {
      return path.dirname(require.resolve('@fortawesome/fontawesome-free/package.json'));
    } catch (e) {
      logger.warn('@fortawesome/fontawesome-free not resolvable — icon lookups will return null.');
      return null;
    }
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
  // brands fallback). Null name (no alias) or unresolved root → null.
  _read(name, style) {
    if (!name || !fontawesome._root) {
      return null;
    }
    for (const rel of candidateRelPaths(name, style)) {
      const raw = jetpack.read(path.join(fontawesome._root, 'svgs', rel), 'utf8');
      if (raw) {
        return injectSvgAttributes(raw);
      }
    }
    return null;
  },

  // Alias slug → canonical slug from fontawesome-free's metadata, built
  // once per app run ('search' → 'magnifying-glass').
  _alias(name) {
    if (!fontawesome._aliasMap) {
      let map = new Map();
      const raw = fontawesome._root
        && jetpack.read(path.join(fontawesome._root, 'metadata', 'icon-families.json'), 'utf8');
      if (raw) {
        try {
          map = buildAliasMap(JSON.parse(raw));
        } catch (e) {
          logger.warn('could not parse icon-families.json — aliases disabled.');
        }
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
