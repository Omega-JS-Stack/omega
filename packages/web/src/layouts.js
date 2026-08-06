/**
 * Layered layout DELIVERY — ZERO file copying. (The layered resolution
 * itself is `collectLayered()` in ./layers.js.) Two delivery modes:
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
const reads = require('@omega.js/devkit/reads');

/**
 * Register the winning layout files as Eleventy virtual templates so that
 * Jekyll-style `layout: blueprint/index` names resolve verbatim.
 * @param {object} eleventyConfig
 * @param {Map<string, string>} layoutMap - from collectLayered() over _layouts dirs
 */
function registerVirtualLayouts(eleventyConfig, layoutMap) {
  for (const [rel, abs] of layoutMap) {
    eleventyConfig.addTemplate(`_includes/${rel}`, reads.read(abs));
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

module.exports = { registerVirtualLayouts, composeSymlinkFarm };
