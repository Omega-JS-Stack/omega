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
 * Collect EVERY layer that provides each relative path, in layer order. The
 * first entry of each list is the winner; the rest are what it shadows —
 * which is what the override map (`omega customize --list`) reports.
 * @param {string[]} layerDirs - ordered layer dirs (first wins)
 * @param {RegExp} [filter] - only include matching relative paths
 * @returns {Map<string, Array<{ dir: string, file: string }>>} relative path → providers
 */
function collectProviders(layerDirs, filter) {
  const providers = new Map();

  for (const dir of layerDirs) {
    if (!fs.existsSync(dir)) continue;

    for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;

      const rel = path.relative(dir, path.join(entry.parentPath, entry.name));
      if (filter && !filter.test(rel)) continue;
      if (!providers.has(rel)) providers.set(rel, []);
      providers.get(rel).push({ dir, file: path.join(dir, rel) });
    }
  }

  return providers;
}

/**
 * Collect the layered union of files under a list of layer directories.
 * @param {string[]} layerDirs - ordered layer dirs (first wins)
 * @param {RegExp} [filter] - only include matching relative paths
 * @returns {Map<string, string>} relative path → winning absolute path
 */
function collectLayered(layerDirs, filter) {
  const winners = new Map();

  for (const [rel, providers] of collectProviders(layerDirs, filter)) {
    winners.set(rel, providers[0].file);
  }

  return winners;
}

/**
 * Resolve the ordered theme layer dirs for an active theme. Consumer-local
 * themes win: `<consumerDir>/themes/<id>` beats the packaged `<themesDir>/<id>`,
 * so a brand ships a FULL theme without forking the framework (C3 tier 2 —
 * tier 1 is a consumer main.scss over the stock theme via `omega:main`).
 * Every chain ends at `themes/base`, the structural markup layer with the
 * neutral `omega-*` vocabulary (#177); themes are skins over it.
 * @param {object} options
 * @param {string} [options.activeTheme] - theme id (default 'classy')
 * @param {string} [options.consumerDir] - consumer root to probe for local themes
 * @param {string} options.themesDir - packaged themes root
 * @returns {string[]} ordered theme layer dirs (active first, base last)
 */
function resolveThemeLayers({ activeTheme, consumerDir, themesDir }) {
  const resolveId = (id) => {
    const local = consumerDir ? path.join(consumerDir, 'themes', id) : null;
    return local && fs.existsSync(local) ? local : path.join(themesDir, id);
  };
  return [...new Set([activeTheme || 'classy', 'base'])].map(resolveId);
}

module.exports = { collectLayered, collectProviders, resolveThemeLayers };
