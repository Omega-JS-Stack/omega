/**
 * Reconcile the brand root's composed CI workflows (#636) — the ratified
 * example of a dropped config key becoming a real removal: take
 * `targets.extension` out of omega.json5 and the `extension-*.yml` files a
 * previous manage composed at the brand root are DELETED on the next walk.
 *
 * The compose itself stays where it is, in each framework's own scaffold
 * (`@omega.js/devkit/ci-workflows`), which is per-target by construction — and
 * a dropped target's framework never runs again, so nothing there could ever
 * clean up after it. The full enabled-target set is knowable in exactly one
 * place, HERE: the workspace service already owns the brand root's own files
 * and runs first in every walk, boot lane included.
 *
 * LIVE means the config still enables it, not that the dir is still on disk:
 * removing `targets/<dir>` wholesale is deliberately out of scope (the dir
 * mixes human app code), so the dir outlives the key and only the generated
 * files go. Custom targets (`type: 'custom'`) are live whenever declared —
 * they have no framework, so they compose nothing anyway.
 *
 * The deletion's own safety is devkit's double lock (the GENERATED header plus
 * the composed naming): the brand's own hand-written workflows live in that
 * same dir and are never candidates.
 */
const chalk = require('chalk').default;

const { reconcileComposedWorkflows } = require('@omega.js/devkit/ci-workflows');

module.exports = async ({ brandRoot, brand, targets, options }) => {
  const dryRun = options?.dryRun || false;

  const liveTargets = targets
    .filter((entry) => entry.custom || (entry.target && brand.enabledTargets.includes(entry.target)))
    .map((entry) => entry.name);

  const { removed } = reconcileComposedWorkflows({
    brandRoot,
    liveTargets,
    dryRun,
    logger: { log: () => {}, warn: () => {} },
  });

  if (removed.length === 0) {
    console.log(`      ${chalk.green('✓')} Composed workflows match the enabled targets`);
    return null;
  }

  if (dryRun) {
    console.log(`      ${chalk.yellow('[DRY RUN]')} Would remove ${chalk.cyan(removed.length)} composed workflow(s) for dropped targets: ${removed.join(', ')}`);
    return { output: { workflows: { planned: removed.length } } };
  }

  console.log(`      ${chalk.yellow('↺')} Removed ${chalk.bold(removed.length)} composed workflow(s) for dropped targets ${chalk.dim(`(${removed.join(', ')})`)}`);
  return { output: { workflows: { removed: removed.length } } };
};
