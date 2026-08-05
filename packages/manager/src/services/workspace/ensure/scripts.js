/**
 * Ensure the brand root package.json carries a `deploy: 'omega deploy'`
 * script (npm scripts put node_modules/.bin on PATH, so plain `omega`
 * resolves there). Script VALUES only — no other script, key, or consumer
 * content is ever touched. Idempotent: a converged file rewrites nothing.
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

  const { scripts, added } = healPackageScripts(pkg);
  if (!added) {
    console.log(`      ${chalk.green('✓')} Root deploy script present`);
    return null;
  }

  if (options.dryRun) {
    return dryRunPlan(
      `heal root scripts (add deploy: '${DEPLOY_SCRIPT}')`,
      { output: { scripts: 'planned' } },
    );
  }

  pkg.scripts = scripts;
  jetpack.write(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

  console.log(`      ${chalk.green('✓')} Added script \`deploy: '${DEPLOY_SCRIPT}'\``);

  return { output: { scripts: { added } } };
};
