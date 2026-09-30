/**
 * Ensure the brand .env (and the company .env when the brand is
 * company-managed) is converged onto the marker template (lib/env-order.js):
 * the Default section rewritten with every set value kept, the Custom section
 * verbatim. A converged file rewrites nothing; a file the converge would
 * change a value in (a line dotenv reads another way, e.g. `KEY: value`) is
 * left untouched with a note, never a failure.
 */
const { join } = require('node:path');
const jetpack = require('fs-jetpack');
const chalk = require('chalk').default;

const { convergeEnv } = require('../../../lib/env-order.js');
const { dryRunPlan } = require('../../../lib/run-gates.js');

module.exports = async (context) => {
  const { brandRoot, companyRoot, options = {} } = context;

  const roots = [
    { label: 'brand', root: brandRoot },
    ...(companyRoot ? [{ label: 'company', root: companyRoot }] : []),
  ];

  const summary = {};
  for (const { label, root } of roots) {
    const envPath = join(root, '.env');
    if (!jetpack.exists(envPath)) {
      console.log(`      ${chalk.dim(`⊘ no ${label} .env yet`)}`);
      summary[label] = 'missing';
      continue;
    }

    const result = convergeEnv(jetpack.read(envPath));

    if (result.skipped) {
      console.log(`      ${chalk.dim(`⊘ ${label} .env left as-is (${result.skipped})`)}`);
      summary[label] = 'skipped';
      continue;
    }
    if (!result.changed) {
      console.log(`      ${chalk.green('✓')} ${label} .env sections (current)`);
      summary[label] = 'current';
      continue;
    }
    if (options.dryRun) {
      dryRunPlan(`converge the ${label} .env onto its Default/Custom sections`);
      summary[label] = 'planned';
      continue;
    }

    jetpack.write(envPath, result.content);
    console.log(`      ${chalk.green('✓')} ${label} .env converged onto its Default/Custom sections`);
    summary[label] = 'converged';
  }

  return { output: { envOrder: summary } };
};
