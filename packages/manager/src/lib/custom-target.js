/**
 * Custom targets (#603) — the ONE home for a target the framework does not
 * own: a Render API, a worker, a script. It is declared like any other target
 * (`targets.<name>: { type: 'custom' }`, or the array form for instances), and
 * everything it can DO comes from its own package.json scripts:
 *
 *   start · build · test · deploy · clean
 *
 * The manager runs each verb through `npm run <verb>` when the script is
 * there and SKIPS IT LOUDLY when it is not — a verb that quietly did nothing
 * is indistinguishable from one that worked. Nothing is inferred, defaulted,
 * or synthesized: no script, no verb. This module holds only what a custom
 * target IS (its names, its dirs, the scripts it declares); the run itself has
 * one home for every target type, `framework-bin.js`'s `resolveTargetRun`.
 *
 * What a custom target does NOT get is every framework service op — there is
 * no framework to reconcile. Discovery leaves `entry.target` null, so the
 * `filter((entry) => entry.target)` every service already applies skips them
 * by construction; the ONE deliberate exception reads `entry.custom`: the
 * workspace service recognizes the dir (agent docs, settings, the structure
 * check) instead of warning it unmapped. Nothing is composed into its own .env
 * file (#678); it INHERITS the brand keys instead — manage.js loads the env
 * chain into process.env before it spawns anything, so a custom target started
 * by `omega dev`/`omega deploy` has them. A standalone run inside the target
 * dir does not: there is no @omega.js/config in there to walk the cascade.
 */
const path = require('node:path');
const jetpack = require('fs-jetpack');

const { isCustomTargetEntry, normalizeTargetInstances, instanceTargetDir } = require('@omega.js/config');

/**
 * The custom target NAMES a brand config declares.
 *
 * @param {object} brandConfig - The merged brand config.
 * @returns {string[]} Target names, in config order.
 */
function customTargetNames(brandConfig) {
  const targets = brandConfig?.targets;
  if (!targets || typeof targets !== 'object') {
    return [];
  }

  return Object.keys(targets).filter((name) => isCustomTargetEntry(targets[name]));
}

/**
 * The target DIRS those declarations expect under targets/ — the shared
 * multi-instance mapping (`main` → the bare dir, any other id → `<name>-<id>`).
 *
 * @param {object} brandConfig - The merged brand config.
 * @returns {string[]} Directory basenames.
 */
function customTargetDirs(brandConfig) {
  return customTargetNames(brandConfig).flatMap((name) => normalizeTargetInstances(brandConfig.targets[name])
    .map((instance) => instanceTargetDir(name, instance.id)));
}

/**
 * A target dir's package.json scripts — the whole verb surface of a custom
 * target. An unreadable or absent package.json declares nothing.
 *
 * @param {string} targetPath - Absolute path to the target dir.
 * @returns {Object<string, string>} Script name → command.
 */
function targetScripts(targetPath) {
  const pkg = jetpack.read(path.join(targetPath, 'package.json'), 'json');
  return (pkg && typeof pkg.scripts === 'object' && pkg.scripts) || {};
}

module.exports = {
  customTargetNames,
  customTargetDirs,
  targetScripts,
};
