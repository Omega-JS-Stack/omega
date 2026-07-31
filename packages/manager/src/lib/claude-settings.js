/**
 * Brand Claude settings ([#62](https://github.com/Omega-JS-Stack/omega/issues/62)):
 * a brand's committed `.claude/settings.json` registers the omega marketplace
 * that the INSTALLED `@omega.js/manager` package carries (the plugin is
 * vendored into it at prepare time) and enables the plugin, so every session
 * in that brand — anyone's, on any machine — loads the omega skills and hooks.
 *
 * Gated on a PUBLISHED install: the manager package must carry the vendored
 * `.claude-plugin/marketplace.json` AND be a real installed directory. In the
 * local era the brand's `@omega.js/manager` is a SYMLINK into the monorepo —
 * whose packages/manager carries that same generated marketplace — so the
 * link itself is the signal, and this is a silent no-op —
 * the developer's own user-scope install serves those sessions, and the brand
 * file must never point at a machine-specific monorepo path.
 *
 * Non-clobbering: only the two omega keys are ever written; every other
 * setting in the file is preserved, and an already-correct file is not
 * rewritten.
 */
const fs = require('node:fs');
const { join } = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const jetpack = require('fs-jetpack');

const SETTINGS_FILE = join('.claude', 'settings.json');
const MARKETPLACE_KEY = 'extraKnownMarketplaces';
const PLUGIN_KEY = 'enabledPlugins';
const MARKETPLACE_NAME = 'omega';
const PLUGIN_ID = 'omega@omega';
// Brand-root-relative on purpose: portable to every machine and every clone.
const MANAGER_PATH = './node_modules/@omega.js/manager';
const MANAGER_DIR = join('node_modules', '@omega.js', 'manager');
const VENDORED_MARKETPLACE = join(MANAGER_DIR, '.claude-plugin', 'marketplace.json');

/**
 * The marketplace entry a brand's settings must carry.
 *
 * @returns {object} - The `extraKnownMarketplaces.omega` value
 */
function marketplaceEntry() {
  return { source: { source: 'directory', path: MANAGER_PATH } };
}

/**
 * Does this brand have a PUBLISHED manager install (one carrying the vendored
 * plugin marketplace)?
 *
 * A LOCALLY LINKED manager never counts, whatever it carries: the monorepo's
 * own packages/manager grows the vendored marketplace on every prepare/pack,
 * and `omega i local` symlinks the brand at it — so the file resolves through
 * the link and the marketplace check alone would write settings pointing at
 * one developer's machine. The symlink IS the local era.
 *
 * @param {string} brandRoot - Absolute brand monorepo root
 * @returns {boolean}
 */
function hasVendoredPlugin(brandRoot) {
  let stats;
  try {
    stats = fs.lstatSync(join(brandRoot, MANAGER_DIR));
  } catch {
    return false; // nothing installed yet
  }
  if (stats.isSymbolicLink()) {
    return false;
  }

  return jetpack.exists(join(brandRoot, VENDORED_MARKETPLACE)) === 'file';
}

/**
 * Ensure the brand's `.claude/settings.json` registers and enables the omega
 * plugin from its installed manager package.
 *
 * @param {string} brandRoot - Absolute brand monorepo root
 * @returns {'skipped'|'present'|'created'|'healed'|'invalid'} - What happened
 */
function ensureClaudeSettings(brandRoot) {
  if (!hasVendoredPlugin(brandRoot)) {
    return 'skipped';
  }

  const file = join(brandRoot, SETTINGS_FILE);
  const raw = jetpack.read(file);

  let settings = {};
  if (raw !== undefined) {
    try {
      settings = JSON.parse(raw);
    } catch (error) {
      // A consumer's own malformed file — expected external condition, and
      // never ours to overwrite. The caller warns.
      return 'invalid';
    }
  }

  const marketplaces = settings[MARKETPLACE_KEY] || {};
  const plugins = settings[PLUGIN_KEY] || {};
  if (isDeepStrictEqual(marketplaces[MARKETPLACE_NAME], marketplaceEntry()) && plugins[PLUGIN_ID] === true) {
    return 'present';
  }

  const updated = {
    ...settings,
    [MARKETPLACE_KEY]: { ...marketplaces, [MARKETPLACE_NAME]: marketplaceEntry() },
    [PLUGIN_KEY]: { ...plugins, [PLUGIN_ID]: true },
  };
  jetpack.write(file, `${JSON.stringify(updated, null, 2)}\n`);

  return raw === undefined ? 'created' : 'healed';
}

module.exports = {
  SETTINGS_FILE,
  MARKETPLACE_KEY,
  PLUGIN_KEY,
  MARKETPLACE_NAME,
  PLUGIN_ID,
  MANAGER_PATH,
  MANAGER_DIR,
  VENDORED_MARKETPLACE,
  marketplaceEntry,
  hasVendoredPlugin,
  ensureClaudeSettings,
};
