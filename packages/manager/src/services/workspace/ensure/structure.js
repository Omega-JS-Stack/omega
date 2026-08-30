/**
 * Ensure the brand-monorepo structure: a root package.json with targets/*
 * workspaces, and a target directory for every enabled target. Dirs that map
 * to no target are warned (never silently skipped); enabled targets with no
 * dir are errors with the exact dir to create.
 *
 * Multi-instance targets: an ARRAY-form target expects one dir PER
 * instance (`main` → the canonical dir, any other id → `<canonical>-<id>`) —
 * an enabled instance without its dir is the same create-this-dir error. The
 * single-object form keeps today's any-dir-of-the-type check untouched.
 *
 * Custom targets (#603) map to no framework by design, so they are checked BY
 * DIR (the declaration names it) and never counted among the unmapped — this
 * service is one of the two ops that see them at all.
 */
const { join } = require('node:path');
const chalk = require('chalk').default;
const jetpack = require('fs-jetpack');

const { normalizeTargetInstances, instanceTargetDir, isCustomTargetEntry } = require('@omega.js/config');
const { TARGET_DIRS } = require('../../../config.js');
const { customTargetDirs } = require('../../../lib/custom-target.js');

module.exports = async ({ brandRoot, brand, targets }) => {
  const problems = [];
  const findings = [];

  // Root package.json must exist and declare targets/* workspaces
  const pkg = jetpack.read(join(brandRoot, 'package.json'), 'json');
  if (!pkg) {
    problems.push('no package.json at the brand root');
  } else {
    const workspaces = Array.isArray(pkg.workspaces) ? pkg.workspaces : [];
    if (!workspaces.includes('targets/*')) {
      problems.push(`root package.json workspaces must include "targets/*" (found: ${JSON.stringify(workspaces)})`);
    }
  }

  // Every enabled target needs at least one dir; the multi-instance array
  // form needs every instance's exact dir (the config validator owns id
  // sanity — malformed entries are its errors, never doubled here)
  for (const target of brand.enabledTargets) {
    const declared = brand.config?.targets?.[target];

    // A custom target's dirs are named by its own declaration, one per
    // instance — the same create-this-dir error, checked by name
    if (isCustomTargetEntry(declared)) {
      for (const dir of customTargetDirs({ targets: { [target]: declared } })) {
        if (!targets.some((entry) => entry.name === dir)) {
          problems.push(`enabled custom target "${target}" has no dir — create targets/${dir}/`);
        }
      }
      continue;
    }

    if (Array.isArray(declared)) {
      for (const instance of normalizeTargetInstances(declared)) {
        if (typeof instance?.id !== 'string') continue;
        const dir = instanceTargetDir(target, instance.id);
        if (!targets.some((entry) => entry.name === dir)) {
          problems.push(`enabled target "${target}" instance "${instance.id}" has no dir — create targets/${dir}/`);
        }
      }
      continue;
    }

    if (!targets.some((entry) => entry.target === target)) {
      const suggested = TARGET_DIRS[target] || target;
      problems.push(`enabled target "${target}" has no dir — create targets/${suggested}/`);
    }
  }

  // Dirs that resolve to no target are suspicious but not fatal — a DECLARED
  // custom dir is neither: the brand said what it is
  const unmapped = targets.filter((entry) => !entry.target && !entry.custom);
  for (const entry of unmapped) {
    findings.push(`${entry.dir} maps to no target — declare one in its omega.json5, use a conventional dir name, or declare it \`type: 'custom'\``);
  }

  if (problems.length > 0) {
    for (const problem of problems) {
      console.log(`      ${chalk.red('✗')} ${problem}`);
    }
    return { status: 'error', error: problems.join('; '), output: { problems } };
  }

  console.log(`      ${chalk.green('✓')} ${targets.length} target(s): ${targets.map((entry) => `${entry.name}→${entry.target || (entry.custom ? 'custom' : '?')}`).join(', ')}`);

  if (findings.length > 0) {
    for (const finding of findings) {
      console.log(`      ${chalk.yellow('⚠')} ${finding}`);
    }
    return { status: 'warned', reason: findings.join('; '), output: { findings } };
  }

  return { output: { targets: targets.map((entry) => ({ name: entry.name, target: entry.target })) } };
};
