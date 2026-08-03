/**
 * The layered upstream registry — the one view of "what upstreams exist",
 * shared by the router and the CLI.
 *
 * Two layers: the BUNDLED defaults that ship in `servers/` inside this
 * package, then the user's OVERLAY at `~/.omega/mcp-router/servers/`. The
 * merge is SHALLOW and field-level — an overlay entry's top-level keys win
 * over the bundled entry's, so:
 *
 *   {"enabled": false}                     turns a bundled default off
 *   {"args": [...]}                        re-points one field of a default
 *   a full entry under a new name          adds a private upstream
 *
 * Every WRITE lands in the overlay, never in the bundled dir — for a consumer
 * the bundled dir lives inside node_modules, which nothing may edit.
 */

const fs = require('node:fs');
const path = require('node:path');

const { log } = require('./log.js');
const { BUNDLED_SERVERS_DIR, overlayServersDir } = require('./paths.js');

/**
 * Resolve the two layer directories for a call.
 *
 * @param {object} [options] - `{ bundledDir, overlayDir }` overrides (tests pass fixtures)
 * @returns {{bundledDir: string, overlayDir: string}} The layers, weakest first
 */
function layers(options = {}) {
  return {
    bundledDir: options.bundledDir || BUNDLED_SERVERS_DIR,
    overlayDir: options.overlayDir || overlayServersDir(),
  };
}

/**
 * Read one layer's `<name>/config.json`.
 *
 * @param {string} dir - A layer directory
 * @param {string} name - Upstream name
 * @returns {object|null} The parsed config, or null when absent/unreadable (unreadable logs loudly)
 */
function readLayer(dir, name) {
  const file = path.join(dir, name, 'config.json');
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    // One malformed config must never take down the whole registry.
    log('error', `Skipping ${file}: unreadable config.json (${err.message})`);
    return null;
  }
}

/**
 * Every upstream name either layer knows about.
 *
 * @param {object} [options] - `{ bundledDir, overlayDir }`
 * @returns {string[]} Sorted names
 */
function names(options) {
  const { bundledDir, overlayDir } = layers(options);
  const found = new Set();
  for (const dir of [bundledDir, overlayDir]) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // a missing layer is normal: no overlay yet, or a bare checkout
    }
    for (const entry of entries) {
      if (entry.isDirectory() && fs.existsSync(path.join(dir, entry.name, 'config.json'))) found.add(entry.name);
    }
  }
  return [...found].sort();
}

/**
 * The merged RAW config for one upstream — bundled fields with the overlay's
 * top-level keys layered over them.
 *
 * @param {string} name - Upstream name
 * @param {object} [options] - `{ bundledDir, overlayDir }`
 * @returns {object|null} The merged config, or null when neither layer has it
 */
function mergedConfig(name, options) {
  const { bundledDir, overlayDir } = layers(options);
  const bundled = readLayer(bundledDir, name);
  const overlay = readLayer(overlayDir, name);
  if (!bundled && !overlay) return null;
  return { ...(bundled || {}), ...(overlay || {}) };
}

/**
 * Normalize a raw config into the shape the router and CLI consume.
 *
 * @param {string} name - Upstream name
 * @param {object} config - A merged raw config
 * @param {object} sources - `{ bundled: boolean, overlay: boolean }`
 * @returns {object} The registry entry
 */
function normalize(name, config, sources) {
  return {
    name,
    enabled_on_disk: config.enabled === true,
    default: config.default === 'on-demand' ? 'on-demand' : 'auto',
    locked: config.locked === true,
    command: config.command,
    args: config.args || [],
    env: config.env || {},
    tools: Array.isArray(config.tools) ? config.tools : [],
    bundled: sources.bundled,
    overlaid: sources.overlay,
  };
}

/**
 * One upstream's layered entry.
 *
 * @param {string} name - Upstream name
 * @param {object} [options] - `{ bundledDir, overlayDir }`
 * @returns {object|null} The registry entry, or null when unknown
 */
function loadUpstream(name, options) {
  const { bundledDir, overlayDir } = layers(options);
  const config = mergedConfig(name, { bundledDir, overlayDir });
  if (!config) return null;
  return normalize(name, config, {
    bundled: readLayer(bundledDir, name) !== null,
    overlay: readLayer(overlayDir, name) !== null,
  });
}

/**
 * The whole layered registry.
 *
 * @param {object} [options] - `{ bundledDir, overlayDir }`
 * @returns {object} name → registry entry
 */
function loadUpstreams(options) {
  const { bundledDir, overlayDir } = layers(options);
  const upstreams = {};
  for (const name of names({ bundledDir, overlayDir })) {
    const entry = loadUpstream(name, { bundledDir, overlayDir });
    // Both layers unreadable — readLayer already said so.
    if (entry) upstreams[name] = entry;
  }
  return upstreams;
}

/**
 * Is this name a bundled default?
 *
 * @param {string} name - Upstream name
 * @param {object} [options] - `{ bundledDir }`
 * @returns {boolean} True when the package ships it
 */
function isBundled(name, options) {
  const { bundledDir } = layers(options);
  return fs.existsSync(path.join(bundledDir, name, 'config.json'));
}

/**
 * The user's overlay entry as written on disk, unmerged.
 *
 * @param {string} name - Upstream name
 * @param {object} [options] - `{ overlayDir }`
 * @returns {object|null} The overlay config, or null when there is none
 */
function readOverlayEntry(name, options) {
  const { overlayDir } = layers(options);
  return readLayer(overlayDir, name);
}

/**
 * Merge fields into the overlay entry and write it. This is the ONLY write
 * path: a bundled default is never touched, it is only shadowed.
 *
 * @param {string} name - Upstream name
 * @param {object} patch - Top-level keys to set
 * @param {object} [options] - `{ overlayDir }`
 * @returns {object} The overlay entry as written
 */
function patchOverlayEntry(name, patch, options) {
  const { overlayDir } = layers(options);
  const next = { ...(readLayer(overlayDir, name) || {}), ...patch };
  const dir = path.join(overlayDir, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

/**
 * The one refusal message for a locked upstream, shared by every caller that
 * flips `enabled` on: the CLI and the router's meta-tool say the same thing.
 *
 * @param {string} name - Upstream name
 * @returns {string} The refusal, naming the field and the shell escape hatch
 */
function lockedRefusal(name) {
  return `Upstream "${name}" is locked (locked: true in its overlay config.json) and will not be enabled. `
    + `Remove that field to unlock it, or run \`omega-mcp enable ${name} --force\` from the shell.`;
}

/**
 * Delete an overlay entry — a bundled default under the same name comes back.
 *
 * @param {string} name - Upstream name
 * @param {object} [options] - `{ overlayDir }`
 * @returns {boolean} True when something was removed
 */
function removeOverlayEntry(name, options) {
  const { overlayDir } = layers(options);
  const dir = path.join(overlayDir, name);
  if (!fs.existsSync(path.join(dir, 'config.json'))) return false;
  fs.rmSync(dir, { recursive: true });
  return true;
}

module.exports = {
  layers,
  names,
  mergedConfig,
  loadUpstream,
  loadUpstreams,
  isBundled,
  readOverlayEntry,
  lockedRefusal,
  patchOverlayEntry,
  removeOverlayEntry,
};
