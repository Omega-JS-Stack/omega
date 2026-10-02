/**
 * Brand Claude settings: which copy of the omega plugin a brand session loads.
 * `omega` is the published copy, from GitHub with a sparse checkout; the
 * committed `.claude/settings.json` turns it on and the local copy off.
 * `omega-local` is a linked monorepo's copy, read in place; while the brand is
 * linked to a checkout, the private `.claude/settings.local.json` turns it on and
 * the published copy off, and those keys leave again when the brand goes live.
 * Every file that turns one copy on turns the other off, since both on loads
 * either copy from run to run. Only the omega keys are written, a correct
 * file is not rewritten, and a file that does not parse is never overwritten.
 */
const { join } = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const jetpack = require('fs-jetpack');
const { resolveLinkedMonorepo } = require('@omega.js/devkit/local');

// Posix spellings: the .gitignore line reads LOCAL_SETTINGS_FILE as is.
const SETTINGS_FILE = '.claude/settings.json';
const LOCAL_SETTINGS_FILE = '.claude/settings.local.json';
const MARKETPLACE_KEY = 'extraKnownMarketplaces';
const PLUGIN_KEY = 'enabledPlugins';
const MARKETPLACE_NAME = 'omega';
const LOCAL_MARKETPLACE_NAME = 'omega-local';
const PLUGIN_ID = `omega@${MARKETPLACE_NAME}`;
const LOCAL_PLUGIN_ID = `omega@${LOCAL_MARKETPLACE_NAME}`;
const PLUGIN_REPO = 'Omega-JS-Stack/omega';
// The published manifest and the plugin folder: all a machine needs to fetch.
const SPARSE_PATHS = ['.claude-plugin', 'agent-plugins/claude'];
const LOCAL_MANIFEST = join('.claude-plugin', 'marketplace.local.json');

/**
 * The marketplace entry a brand's committed settings carry: the published copy.
 *
 * @returns {object} - The `extraKnownMarketplaces.omega` value
 */
function marketplaceEntry() {
  return {
    source: { source: 'github', repo: PLUGIN_REPO, sparsePaths: [...SPARSE_PATHS] },
    autoUpdate: true,
  };
}

/**
 * The marketplace entry that names the local copy of one monorepo checkout.
 *
 * @param {string} monorepoRoot - Absolute monorepo root
 * @returns {object} - The `extraKnownMarketplaces['omega-local']` value
 */
function localMarketplaceEntry(monorepoRoot) {
  return { source: { source: 'file', path: join(monorepoRoot, LOCAL_MANIFEST) } };
}

/**
 * Read a JSON settings file.
 *
 * @param {string} file - Absolute path
 * @returns {{ exists: boolean, settings: object|null }} - settings is null when the text is not JSON
 */
function readSettings(file) {
  const raw = jetpack.read(file);
  if (raw === undefined) {
    return { exists: false, settings: {} };
  }
  try {
    return { exists: true, settings: JSON.parse(raw) };
  } catch {
    // A consumer's own malformed file: an expected external condition, and
    // never ours to overwrite. The caller reports it.
    return { exists: true, settings: null };
  }
}

function writeSettings(file, settings) {
  jetpack.write(file, `${JSON.stringify(settings, null, 2)}\n`);
}

/**
 * The settings with one copy declared and on, and the other copy off.
 *
 * @param {object} settings - The parsed file
 * @param {{ name: string, entry: object, on: string, off: string }} copy
 * @returns {object} - A new object; every other key kept
 */
function withCopy(settings, { name, entry, on, off }) {
  return {
    ...settings,
    [MARKETPLACE_KEY]: { ...(settings[MARKETPLACE_KEY] || {}), [name]: entry },
    [PLUGIN_KEY]: { ...(settings[PLUGIN_KEY] || {}), [on]: true, [off]: false },
  };
}

/**
 * The published copy on, the local copy off.
 *
 * @param {object} settings - The parsed file
 * @returns {object}
 */
function withPublished(settings) {
  return withCopy(settings, { name: MARKETPLACE_NAME, entry: marketplaceEntry(), on: PLUGIN_ID, off: LOCAL_PLUGIN_ID });
}

/**
 * The local copy of one checkout on, the published copy off.
 *
 * @param {object} settings - The parsed file
 * @param {string} monorepoRoot - Absolute monorepo root
 * @returns {object}
 */
function withLocal(settings, monorepoRoot) {
  return withCopy(settings, { name: LOCAL_MARKETPLACE_NAME, entry: localMarketplaceEntry(monorepoRoot), on: LOCAL_PLUGIN_ID, off: PLUGIN_ID });
}

/**
 * The settings with the local keys taken out, and each object they leave
 * empty dropped.
 *
 * @param {object} settings - The parsed file
 * @returns {object}
 */
function withoutLocal(settings) {
  const marketplaces = { ...(settings[MARKETPLACE_KEY] || {}) };
  const plugins = { ...(settings[PLUGIN_KEY] || {}) };
  delete marketplaces[LOCAL_MARKETPLACE_NAME];
  delete plugins[LOCAL_PLUGIN_ID];
  delete plugins[PLUGIN_ID];

  const next = { ...settings, [MARKETPLACE_KEY]: marketplaces, [PLUGIN_KEY]: plugins };
  for (const key of [MARKETPLACE_KEY, PLUGIN_KEY]) {
    if (Object.keys(next[key]).length === 0) {
      delete next[key];
    }
  }
  return next;
}

/**
 * The committed file names the published copy.
 *
 * @returns {'created'|'healed'|'present'|'invalid'}
 */
function ensureCommitted(brandRoot, dryRun) {
  const file = join(brandRoot, SETTINGS_FILE);
  const { exists, settings } = readSettings(file);
  if (settings === null) {
    return 'invalid';
  }

  const next = withPublished(settings);
  if (exists && isDeepStrictEqual(next, settings)) {
    return 'present';
  }
  if (!dryRun) {
    writeSettings(file, next);
  }
  return exists ? 'healed' : 'created';
}

/**
 * The private file names the local copy while the brand is linked, and
 * carries no omega key once it is not. A file left empty is removed.
 *
 * @returns {'written'|'removed'|'present'|'absent'|'invalid'}
 */
function ensureLocal(brandRoot, dryRun) {
  const file = join(brandRoot, LOCAL_SETTINGS_FILE);
  const { exists, settings } = readSettings(file);
  if (settings === null) {
    return 'invalid';
  }

  const monorepoRoot = resolveLinkedMonorepo(brandRoot);
  const next = monorepoRoot ? withLocal(settings, monorepoRoot) : withoutLocal(settings);
  if (isDeepStrictEqual(next, settings)) {
    return monorepoRoot ? 'present' : 'absent';
  }
  if (!dryRun) {
    if (Object.keys(next).length === 0) {
      jetpack.remove(file);
    } else {
      writeSettings(file, next);
    }
  }
  return monorepoRoot ? 'written' : 'removed';
}

/**
 * Ensure both brand settings files name the right copy of the omega plugin.
 *
 * @param {string} brandRoot - Absolute brand monorepo root
 * @param {{ dryRun?: boolean }} [options] - dryRun: the same verdicts, nothing written
 * @returns {{ committed: 'created'|'healed'|'present'|'invalid', local: 'written'|'removed'|'present'|'absent'|'invalid' }}
 */
function ensureClaudeSettings(brandRoot, { dryRun = false } = {}) {
  return {
    committed: ensureCommitted(brandRoot, dryRun),
    local: ensureLocal(brandRoot, dryRun),
  };
}

module.exports = {
  SETTINGS_FILE,
  LOCAL_SETTINGS_FILE,
  MARKETPLACE_KEY,
  PLUGIN_KEY,
  MARKETPLACE_NAME,
  LOCAL_MARKETPLACE_NAME,
  PLUGIN_ID,
  LOCAL_PLUGIN_ID,
  PLUGIN_REPO,
  SPARSE_PATHS,
  LOCAL_MANIFEST,
  marketplaceEntry,
  readSettings,
  writeSettings,
  withLocal,
  ensureClaudeSettings,
};
