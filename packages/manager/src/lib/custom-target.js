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
 * or synthesized: no script, no verb.
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
const chalk = require('chalk').default;
const jetpack = require('fs-jetpack');

const { isCustomTargetEntry, normalizeTargetInstances, instanceTargetDir } = require('@omega.js/config');
const { runCommand } = require('./run-command.js');

// The verbs, in the order a full pass runs them. Build before test before
// deploy is the only order that can be right; start and clean are the ends.
const CUSTOM_VERBS = ['start', 'build', 'test', 'deploy', 'clean'];

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

/**
 * Run one verb on a custom target. Present script → `npm run <verb>` in the
 * target dir (under the target's own Node — runCommand's .nvmrc rule, same as
 * every framework leg). Absent → the loud skip.
 *
 * @param {object} entry - A discoverTargets entry ({ name, dir, path }).
 * @param {string} verb - One of CUSTOM_VERBS.
 * @param {object} [deps] - Test seam: { run } replaces runCommand.
 * @returns {Promise<{ verb, ran: boolean, skipped?: boolean, success?: boolean, error?: string }>}
 */
async function runCustomVerb(entry, verb, deps = {}) {
  const scripts = targetScripts(entry.path);

  if (!scripts[verb]) {
    console.log(`  ${chalk.dim('⊘')} ${chalk.bold(entry.name)} ${chalk.dim(`— no "${verb}" script in ${entry.dir}/package.json, skipped`)}`);
    return { verb, ran: false, skipped: true };
  }

  console.log(`  ${chalk.cyan('→')} ${chalk.bold(entry.name)} ${chalk.dim(`— npm run ${verb} (${scripts[verb]})`)}`);
  const result = await (deps.run || runCommand)('npm', ['run', verb], entry.path);

  return { verb, ran: true, success: result.success, ...(result.error ? { error: result.error } : {}) };
}

/**
 * Run several verbs on a custom target, in the given order.
 *
 * @param {object} entry - A discoverTargets entry.
 * @param {string[]} verbs - Verbs to run, in order.
 * @param {object} [deps] - Test seam: { run } replaces runCommand.
 * @returns {Promise<Array<object>>} One runCustomVerb result per verb.
 */
async function runCustomVerbs(entry, verbs, deps = {}) {
  const results = [];
  for (const verb of verbs) {
    results.push(await runCustomVerb(entry, verb, deps));
  }
  return results;
}

module.exports = {
  CUSTOM_VERBS,
  customTargetNames,
  customTargetDirs,
  targetScripts,
  runCustomVerb,
  runCustomVerbs,
};
