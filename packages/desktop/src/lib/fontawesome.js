// FontAwesome — the bundled Font Awesome Pro icon library (solid + brands SVGs
// shipped inside EM at assets/icons/font-awesome/), served to renderers on
// demand so consumers get icons with ZERO setup.
//
// Main-side API:
//   manager.fontawesome.get(name, style)  → svg string | null   ('play', 'solid')
//   manager.fontawesome.has(name, style)  → boolean
//
// Renderer-side (preload contextBridge):
//   window.em.fontawesome.get(name, style) → Promise<svg string | null>
//
// Renderers normally never call this directly — EM's renderer bootstrap
// auto-renders any `<i class="fa-solid fa-play">` element by injecting the SVG
// inline (see src/renderer.js _wireFontAwesome). The SVGs ship with
// fill="currentColor" and are served with width/height="1em", so icons inherit
// the surrounding text color and scale with font-size — no icon font, no CSS
// framework, works offline.
//
// Lookups are sanitized (lowercase slug names, style whitelist) so the IPC
// channel can never be used to read outside the icon directories, and cached —
// each icon file is read from disk once per app run.
//
// Icon set: Font Awesome Pro (commercial license — https://fontawesome.com/license).
// Update process mirrors ultimate-jekyll-manager docs/icons.md: download the
// pro-plus web release, replace svgs/solid + svgs/brands under
// src/assets/icons/font-awesome/. Aliases (e.g. search.svg → magnifying-glass)
// are part of the download, so common legacy names resolve too.

const path = require('path');
const jetpack = require('fs-jetpack');

const LoggerLite = require('./logger-lite.js');
const ipc = require('./ipc.js');

const logger = new LoggerLite('fontawesome');

const STYLES = ['solid', 'brands'];
const NAME_REGEX = /^[a-z0-9-]+$/;

// Attributes injected on the <svg> root at serve time (UJM parity): icons size
// to the surrounding font and inherit its color.
const SVG_ATTRIBUTES = 'width="1em" height="1em" fill="currentColor" aria-hidden="true" focusable="false"';

const fontawesome = {
  _initialized: false,
  _manager: null,
  _root: null,
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

  // The SVGs ship inside EM's dist/. When main runs UNBUNDLED (EM's own test
  // harness, plain node) __dirname points there directly; a consumer's
  // webpack-bundled main loses the module's real __dirname, so fall back to
  // the installed package under the app root — valid in dev AND inside a
  // packaged app.asar (fs reads through asar transparently).
  _resolveRoot() {
    const candidates = [path.join(__dirname, '..', 'assets', 'icons', 'font-awesome')];
    try {
      const { app } = require('electron');
      if (app) {
        candidates.push(path.join(app.getAppPath(), 'node_modules', 'electron-manager', 'dist', 'assets', 'icons', 'font-awesome'));
      }
    } catch (e) {
      // Not running under Electron — the unbundled candidate is the only one.
    }
    const found = candidates.find((dir) => jetpack.exists(dir) === 'dir');
    if (!found) {
      logger.warn(`icon assets not found (tried: ${candidates.join(', ')}) — lookups will return null.`);
    }
    return found || candidates[0];
  },

  _registerIpc() {
    if (!ipc._initialized) {
      return;
    }

    ipc.handle('em:fontawesome:get', ({ name, style } = {}) => ({
      svg: fontawesome.get(name, style),
    }));
  },

  // Resolve an icon to its inline-SVG string ('play' → '<svg …>…</svg>').
  // Unknown names, invalid slugs, and unknown styles all return null — a
  // missing icon is a content problem, not a crash.
  get(name, style = 'solid') {
    if (typeof name !== 'string' || !NAME_REGEX.test(name) || !STYLES.includes(style)) {
      return null;
    }

    const key = `${style}/${name}`;
    if (fontawesome._cache.has(key)) {
      return fontawesome._cache.get(key);
    }

    const raw = jetpack.read(path.join(fontawesome._root, style, `${name}.svg`), 'utf8');
    const svg = raw ? raw.replace('<svg ', `<svg ${SVG_ATTRIBUTES} `).trim() : null;
    if (!raw) {
      logger.warn(`unknown icon '${key}'.`);
    }

    fontawesome._cache.set(key, svg);
    return svg;
  },

  has(name, style = 'solid') {
    return fontawesome.get(name, style) !== null;
  },

  // Tear down IPC + cache (idempotent).
  disable() {
    if (ipc._initialized) {
      ipc.unhandle('em:fontawesome:get');
    }
    fontawesome._cache.clear();
    fontawesome._initialized = false;
  },
};

module.exports = fontawesome;
