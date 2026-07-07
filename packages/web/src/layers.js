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

module.exports = { collectLayered };
