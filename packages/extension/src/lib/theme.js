/**
 * Theme resolution for the build (#261).
 *
 * `theme.id` is a SHARED omega.json5 key, but each framework owns its own theme
 * set: a brand whose WEBSITE theme is `studymonkey` hands the extension build an
 * id it ships no stylesheet for. The sass loadPath and the webpack `__theme__`
 * alias both pointed straight at `dist/assets/themes/<id>`, so the build died on
 * a raw sass `Can't find stylesheet to import` naming neither the config key nor
 * the extension's valid themes.
 *
 * Resolution now happens HERE, at the framework's own resolve site: an id this
 * framework doesn't ship falls back to the default theme with one actionable
 * warning. Per-target override for the real fix: `targets.extension.theme.id`.
 */
const path = require('path');
const jetpack = require('fs-jetpack');

// The extension's default theme — the fallback, and what an app with no
// theme.id builds with.
const DEFAULT_THEME_ID = 'classy';

// One warning per unknown id, not per resolve site: sass and webpack both
// resolve the same id in a build, and the consumer has ONE thing to fix.
const warnedIds = new Set();

/**
 * List the themes this framework ships (directories; `_`-prefixed ones are
 * scaffolds like `_template`, never selectable).
 * @param {string} themesDir - Absolute path of the framework's themes directory
 * @returns {string[]} theme ids, sorted
 */
function listThemes(themesDir) {
  return (jetpack.list(themesDir) || [])
    .filter((name) => !name.startsWith('_') && jetpack.exists(path.join(themesDir, name)) === 'dir')
    .sort();
}

/**
 * Resolve a configured theme.id against the themes this framework ships.
 * @param {string} [id] - The resolved config's theme.id
 * @param {object} options
 * @param {string} options.themesDir - Absolute path of the framework's themes directory
 * @param {object} [options.logger] - Logger with `warn` (defaults to console)
 * @returns {string} a theme id this framework can build
 */
function resolveThemeId(id, options) {
  const themesDir = options.themesDir;
  const logger = options.logger || console;
  const available = listThemes(themesDir);

  // Nothing to judge against (themes not vendored yet) — pass the id through
  // rather than warn about a set we couldn't read.
  if (available.length === 0) {
    return id || DEFAULT_THEME_ID;
  }

  if (!id) {
    return DEFAULT_THEME_ID;
  }

  if (available.includes(id)) {
    return id;
  }

  if (!warnedIds.has(id)) {
    warnedIds.add(id);
    logger.warn(`Unknown theme.id "${id}" — this is a WEB theme name or a typo; @omega.js/extension ships: ${available.join(', ')}. Building with "${DEFAULT_THEME_ID}". Set targets.extension.theme.id in config/omega.json5 to pick the extension's theme without touching the brand's.`);
  }

  return DEFAULT_THEME_ID;
}

module.exports = { resolveThemeId, listThemes, DEFAULT_THEME_ID };
