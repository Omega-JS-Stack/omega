/**
 * Ensure the brand-monorepo structure: a root package.json with apps/*
 * workspaces, and an app directory for every enabled target. Apps that map
 * to no target are warned (never silently skipped); enabled targets with no
 * app are errors with the exact dir to create.
 */
const { join } = require('node:path');
const chalk = require('chalk').default;
const jetpack = require('fs-jetpack');

const { TARGET_APP_DIRS } = require('../../../config.js');

module.exports = async ({ brandRoot, brand, apps }) => {
  const problems = [];
  const findings = [];

  // Root package.json must exist and declare apps/* workspaces
  const pkg = jetpack.read(join(brandRoot, 'package.json'), 'json');
  if (!pkg) {
    problems.push('no package.json at the brand root');
  } else {
    const workspaces = Array.isArray(pkg.workspaces) ? pkg.workspaces : [];
    if (!workspaces.includes('apps/*')) {
      problems.push(`root package.json workspaces must include "apps/*" (found: ${JSON.stringify(workspaces)})`);
    }
  }

  // Every enabled target needs at least one app
  for (const target of brand.targets) {
    if (!apps.some((app) => app.target === target)) {
      const suggested = TARGET_APP_DIRS[target] || target;
      problems.push(`enabled target "${target}" has no app — create apps/${suggested}/`);
    }
  }

  // Apps that resolve to no target are suspicious but not fatal
  const unmapped = apps.filter((app) => !app.target);
  for (const app of unmapped) {
    findings.push(`${app.dir} maps to no target — declare one in its omega.json5 or use a conventional dir name`);
  }

  if (problems.length > 0) {
    for (const problem of problems) {
      console.log(`      ${chalk.red('✗')} ${problem}`);
    }
    return { status: 'error', error: problems.join('; '), output: { problems } };
  }

  console.log(`      ${chalk.green('✓')} ${apps.length} app(s): ${apps.map((a) => `${a.name}→${a.target || '?'}`).join(', ')}`);

  if (findings.length > 0) {
    for (const finding of findings) {
      console.log(`      ${chalk.yellow('⚠')} ${finding}`);
    }
    return { status: 'warned', output: { findings } };
  }

  return { output: { apps: apps.map((a) => ({ name: a.name, target: a.target })) } };
};
