/**
 * Ensure the brand's package.json scripts convention — the root AND each
 * framework target's (npm scripts put node_modules/.bin on PATH, so plain
 * `omega` resolves there). Script VALUES only — no other key or consumer
 * content is ever touched. Idempotent: a converged file rewrites nothing.
 *
 * Root: `deploy: 'omega deploy'` guaranteed plus the start/manage migration
 * (package-scripts.js). Targets: every key the framework declares in its own
 * `projectScripts` is FRAMEWORK-owned and is rewritten to the default here,
 * exactly as that framework's ensureTarget does on every verb run (#689) —
 * one policy, two writers, so a consumer customizes behavior through hook
 * points and never by editing a standard script. The walk running it at all
 * is the onboard→dev cycle break (#675): the dev fan-out reaches those verbs
 * THROUGH these scripts, so a freshly scaffolded target needs them before any
 * verb has ever run. Keys the consumer added are never touched.
 *
 * The exceptions: a custom TARGET maps to no framework at all (#603), so it
 * is skipped whole; a custom-server backend is skipped PER KEY (#584) — the
 * verbs its mode refuses are the brand's own, named by the framework's
 * `projectScriptsCustomOwned` declaration.
 */
const { join } = require('node:path');
const jetpack = require('fs-jetpack');
const chalk = require('chalk').default;

const { healPackageScripts, syncTargetScripts } = require('../../../lib/package-scripts.js');
const { resolveFrameworkPackage } = require('../../../lib/framework-bin.js');
const { TARGET_FRAMEWORKS } = require('../../../config.js');
const { dryRunPlan } = require('../../../lib/run-gates.js');

module.exports = async ({ brandRoot, targets = [], options = {} }) => {
  const pkgPath = join(brandRoot, 'package.json');
  const raw = jetpack.read(pkgPath);
  if (!raw) {
    console.log(`      ${chalk.dim('⊘ no root package.json yet (the structure operation scaffolds it)')}`);
    return { output: { scripts: 'missing' } };
  }

  let pkg;
  try {
    pkg = JSON.parse(raw);
  } catch (e) {
    console.log(`      ${chalk.yellow('⚠')} Root package.json doesn't parse (${e.message}) — fix it by hand`);
    return { status: 'warned', reason: "root package.json doesn't parse", output: { scripts: 'unparseable' } };
  }

  const { scripts, changes } = healPackageScripts(pkg);
  // What the walk could not read, carried into the run summary below
  const warnings = [];

  const targetWork = [];
  for (const entry of targets) {
    // A custom target's scripts are the brand's own contract (#603) — no
    // framework declares them, so there is nothing to sync against
    if (!entry.target) continue;

    const framework = TARGET_FRAMEWORKS[entry.target];
    const resolved = framework ? resolveFrameworkPackage(entry.path, framework) : null;
    // Not installed yet (pre-`npm install`), or a framework that declares no
    // projectScripts — nothing to fill from; the next walk heals it
    if (!resolved || !resolved.pkg.projectScripts) continue;

    const manifestPath = join(entry.path, 'package.json');
    const targetRaw = jetpack.read(manifestPath);
    if (!targetRaw) continue;

    let targetPkg;
    try {
      targetPkg = JSON.parse(targetRaw);
    } catch (e) {
      console.log(`      ${chalk.yellow('⚠')} ${entry.dir}/package.json doesn't parse (${e.message}) — fix it by hand`);
      warnings.push(`${entry.dir}/package.json doesn't parse`);
      continue;
    }

    // A custom-server backend owns the keys whose verbs its mode refuses
    // (#584) — the framework declares WHICH, so no list lives here (#689)
    const brandOwnedKeys = entry.projectType === 'custom' ? (resolved.pkg.projectScriptsCustomOwned || []) : [];

    const synced = syncTargetScripts(targetPkg, resolved.pkg.projectScripts, brandOwnedKeys);
    if (synced.changes.length) targetWork.push({ entry, manifestPath, targetPkg, synced });
  }

  if (!changes.length && !targetWork.length && !warnings.length) {
    console.log(`      ${chalk.green('✓')} Root + target scripts present`);
    return null;
  }

  // A warnings-only run has nothing to plan (a target manifest that will not
  // parse): it falls through to the warned return below, so `--dry-run` reports
  // the same status a real run would.
  if (options.dryRun && (changes.length || targetWork.length)) {
    const parts = [];
    if (changes.length) parts.push(`heal root scripts (${changes.join(', ')})`);
    for (const work of targetWork) {
      parts.push(`sync ${work.entry.dir} scripts (${work.synced.changes.join(', ')})`);
    }
    return dryRunPlan(parts.join('; '), {
      output: {
        ...(changes.length ? { scripts: 'planned' } : {}),
        ...(targetWork.length ? { targetScripts: 'planned' } : {}),
      },
    });
  }

  const output = {};

  if (changes.length) {
    pkg.scripts = scripts;
    jetpack.write(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
    console.log(`      ${chalk.green('✓')} Healed root scripts \`${changes.join('`, `')}\``);
    output.scripts = { changed: changes };
  }

  for (const work of targetWork) {
    work.targetPkg.scripts = work.synced.scripts;
    jetpack.write(work.manifestPath, `${JSON.stringify(work.targetPkg, null, 2)}\n`);
    // The skipped keys are named per key: a custom-server backend's own verbs
    // are absent by design, not by omission
    const brandOwned = work.synced.skipped.length ? chalk.dim(` (brand-owned, untouched: ${work.synced.skipped.join(', ')})`) : '';
    console.log(`      ${chalk.green('✓')} Synced ${work.entry.dir} scripts \`${work.synced.changes.join('`, `')}\`${brandOwned}`);
    output.targetScripts = output.targetScripts || {};
    output.targetScripts[work.entry.name] = work.synced.changes;
  }

  return {
    ...(warnings.length ? { status: 'warned', reason: warnings.join('; ') } : {}),
    output,
  };
};
