/**
 * Ensure the brand-monorepo structure: a root package.json with targets/*
 * workspaces, and a target directory for every declared target. Dirs that map
 * to no target are warned (never silently skipped); declared targets with no
 * dir are errors with the exact dir to create.
 *
 * ONE check covers every target (#886): a `targets` key IS its folder name, so
 * a declared name either has its `targets/<name>` dir or it does not. Custom
 * targets (#603) need no branch of their own here, and neither does a second
 * target of a type the brand already runs.
 */
const { join } = require('node:path');
const chalk = require('chalk').default;
const jetpack = require('fs-jetpack');

const { targetEntries, targetPath } = require('@omega.js/config');

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

  // Every declared target needs ITS dir (the config validator owns type
  // sanity, so a malformed entry is its error, never doubled here)
  for (const entry of targetEntries(brand.config)) {
    const dir = targetPath(brand.config, entry.name);
    if (!targets.some((found) => found.dir === dir)) {
      problems.push(`declared target "${entry.name}" has no dir, create ${dir}/`);
    }
  }

  // Dirs the brand never declares are suspicious but not fatal. A DECLARED
  // custom dir is neither: the brand said what it is
  const unmapped = targets.filter((entry) => !entry.target && !entry.custom);
  for (const entry of unmapped) {
    findings.push(`${entry.dir} maps to no target: declare \`targets.${entry.name}\` with its \`type\` (\`custom\` when no framework owns it)`);
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
