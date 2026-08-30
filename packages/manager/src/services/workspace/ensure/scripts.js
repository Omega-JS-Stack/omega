/**
 * Ensure the brand's package.json scripts convention — the root AND each
 * framework target's (npm scripts put node_modules/.bin on PATH, so plain
 * `omega` resolves there). Script VALUES only — no other script, key, or
 * consumer content is ever touched. Idempotent: a converged file rewrites
 * nothing.
 *
 * Root: `deploy: 'omega deploy'` guaranteed plus the start/manage migration
 * (package-scripts.js). Targets: missing scripts fill from the framework's
 * own `projectScripts` manifest declaration — the onboard→dev cycle break
 * (#675): the framework's ensureTarget writes these on the first verb run,
 * but the dev fan-out reaches that verb THROUGH them. The walk only ever
 * FILLS; the framework's own ensureTarget syncs the same keys unconditionally
 * on every verb run and wins from then on. Custom targets (and a
 * custom-server backend, #584) own their scripts and are never touched.
 */
const { join } = require('node:path');
const jetpack = require('fs-jetpack');
const chalk = require('chalk').default;

const { healPackageScripts, healTargetScripts } = require('../../../lib/package-scripts.js');
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

  const targetWork = [];
  const warnings = [];
  for (const entry of targets) {
    // A custom target's scripts are the brand's own contract (#603), and a
    // custom-server backend names its own server command (#584)
    if (!entry.target || entry.projectType === 'custom') continue;

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

    const healed = healTargetScripts(targetPkg, resolved.pkg.projectScripts);
    if (healed.changes.length) targetWork.push({ entry, manifestPath, targetPkg, healed });
  }

  if (!changes.length && !targetWork.length && !warnings.length) {
    console.log(`      ${chalk.green('✓')} Root + target scripts present`);
    return null;
  }

  if (options.dryRun) {
    const parts = [];
    if (changes.length) parts.push(`heal root scripts (${changes.join(', ')})`);
    for (const work of targetWork) {
      parts.push(`heal ${work.entry.dir} scripts (${work.healed.changes.join(', ')})`);
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
    work.targetPkg.scripts = work.healed.scripts;
    jetpack.write(work.manifestPath, `${JSON.stringify(work.targetPkg, null, 2)}\n`);
    console.log(`      ${chalk.green('✓')} Healed ${work.entry.dir} scripts \`${work.healed.changes.join('`, `')}\``);
    output.targetScripts = output.targetScripts || {};
    output.targetScripts[work.entry.name] = work.healed.changes;
  }

  return {
    ...(warnings.length ? { status: 'warned', reason: warnings.join('; ') } : {}),
    output,
  };
};
