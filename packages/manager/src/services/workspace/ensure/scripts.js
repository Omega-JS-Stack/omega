/**
 * Ensure the brand root package.json's scripts speak the current verb (Ian
 * 2026-07-21): legacy `omega-manager` script values heal to the `omega`
 * dispatcher (args preserved — npm scripts put node_modules/.bin on PATH,
 * so plain `omega` resolves there), and a `deploy: 'omega deploy'` script
 * exists. Script VALUES only — no other script, key, or consumer content
 * is ever touched. Idempotent: a converged file rewrites nothing.
 */
const { join } = require('node:path');
const jetpack = require('fs-jetpack');
const chalk = require('chalk').default;

const { healPackageScripts, DEPLOY_SCRIPT } = require('../../../lib/package-scripts.js');
const { dryRunPlan } = require('../../../lib/run-gates.js');

module.exports = async ({ brandRoot, options = {} }) => {
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
    return { status: 'warned', output: { scripts: 'unparseable' } };
  }

  const { scripts, renamed, added, changed } = healPackageScripts(pkg);
  if (!changed) {
    console.log(`      ${chalk.green('✓')} Root scripts use \`omega\` (deploy script present)`);
    return null;
  }

  if (options.dryRun) {
    return dryRunPlan(
      `heal root scripts (${[...renamed.map((name) => `${name}: omega-manager → omega`), ...(added ? [`add deploy: '${DEPLOY_SCRIPT}'`] : [])].join(', ')})`,
      { output: { scripts: 'planned' } },
    );
  }

  pkg.scripts = scripts;
  jetpack.write(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

  for (const name of renamed) {
    console.log(`      ${chalk.green('✓')} Healed script \`${name}\` — omega-manager → omega (args preserved)`);
  }
  if (added) {
    console.log(`      ${chalk.green('✓')} Added script \`deploy: '${DEPLOY_SCRIPT}'\``);
  }

  return { output: { scripts: { renamed, added } } };
};
