/**
 * Layered theme resolution for the Eleventy candidate — ZERO file copying.
 *
 * A theme "layer chain" is an ordered list of directories (active theme →
 * base theme → core); for any relative path the FIRST layer that contains it
 * wins. Two delivery modes for layouts:
 *
 * - `virtual` (build): each winning layout file is registered as an Eleventy
 *   v3 virtual template under `_includes/<rel>` — validated in the A1 probe
 *   (layering, cross-layer layout chaining, no page emission).
 * - `farm` (dev): a symlink farm is composed at a fixed dir and used as the
 *   includes directory — symlinks are watchable, virtual templates are not
 *   (their content is captured at config time).
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
 * Register the winning layout files as Eleventy virtual templates so that
 * Jekyll-style `layout: blueprint/index` names resolve verbatim.
 * @param {object} eleventyConfig
 * @param {Map<string, string>} layoutMap - from collectLayered() over _layouts dirs
 */
function registerVirtualLayouts(eleventyConfig, layoutMap) {
  for (const [rel, abs] of layoutMap) {
    eleventyConfig.addTemplate(`_includes/${rel}`, fs.readFileSync(abs, 'utf8'));
  }
}

/**
 * Compose a symlink farm of the winning layout files (dev mode — watchable).
 * Idempotent: the farm is rebuilt from scratch on every call.
 * @param {Map<string, string>} layoutMap
 * @param {string} farmDir - absolute target directory
 */
function composeSymlinkFarm(layoutMap, farmDir) {
  fs.rmSync(farmDir, { recursive: true, force: true });

  for (const [rel, abs] of layoutMap) {
    const target = path.join(farmDir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.symlinkSync(abs, target);
  }
}

module.exports = { collectLayered, registerVirtualLayouts, composeSymlinkFarm };
