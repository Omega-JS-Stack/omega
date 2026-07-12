/**
 * Layered file resolution — SSG-agnostic core of the OMEGA theme system.
 *
 * A "layer chain" is an ordered list of directories (site → active theme →
 * base theme → core); for any relative path the FIRST layer that contains it
 * wins. Both bake-off candidates build their theme layering, page-module
 * unions, and default-page scans on this.
 */
const fs = require('node:fs');
const path = require('node:path');

/**
 * Collect the layered union of files under a list of layer directories.
 * @param {string[]} layerDirs - ordered layer dirs (first wins)
 * @param {RegExp} [filter] - only include matching relative paths
 * @returns {Map<string, string>} relative path → winning absolute path
 */
function collectLayered(layerDirs, filter) {
  const winners = new Map();

  for (const dir of layerDirs) {
    if (!fs.existsSync(dir)) continue;

    for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;

      const rel = path.relative(dir, path.join(entry.parentPath, entry.name));
      if (filter && !filter.test(rel)) continue;
      if (!winners.has(rel)) winners.set(rel, path.join(dir, rel));
    }
  }

  return winners;
}

/**
 * Resolve the ordered theme layer dirs for an active theme. Consumer-local
 * themes win: `<consumerDir>/themes/<id>` beats the packaged `<themesDir>/<id>`,
 * so a brand ships a FULL theme without forking the framework (C3 tier 2 —
 * tier 1 is a consumer main.scss over the stock theme via `omega:main`).
 * The classy base stays in every chain until the C3 reskin folds the base
 * layer into core.
 * @param {object} options
 * @param {string} [options.activeTheme] - theme id (default 'classy')
 * @param {string} [options.consumerDir] - consumer root to probe for local themes
 * @param {string} options.themesDir - packaged themes root
 * @returns {string[]} ordered theme layer dirs (active first, classy base last)
 */
function resolveThemeLayers({ activeTheme, consumerDir, themesDir }) {
  const resolveId = (id) => {
    const local = consumerDir ? path.join(consumerDir, 'themes', id) : null;
    return local && fs.existsSync(local) ? local : path.join(themesDir, id);
  };
  return [...new Set([activeTheme || 'classy', 'classy'])].map(resolveId);
}

module.exports = { collectLayered, resolveThemeLayers };
