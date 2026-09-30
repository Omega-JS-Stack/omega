/**
 * Ensure the brand root .gitignore (and the company root's, when the brand is
 * company-managed) is the marked file: the framework's Default section healed
 * on every manage, the consumer's Custom section kept verbatim, a file from
 * before the markers converged once. The secrets, the manager state and the
 * run logs never get committed.
 */
const chalk = require('chalk').default;

const { ensureGitignore, renderBrandGitignore, renderCompanyGitignore } = require('../../../lib/gitignore.js');
const { dryRunPlan } = require('../../../lib/run-gates.js');

const LABELS = {
  present: 'has the omega entries',
  created: 'created with the omega entries',
  healed: 'healed: the Default section is current, your Custom section kept',
  converged: 'converged to the marker sections: the omega entries under Default, your lines under Custom',
};

const PLANS = { created: 'create', healed: 'heal', converged: 'converge' };

module.exports = async ({ brandRoot, companyRoot, options = {} }) => {
  const roots = [
    { label: 'brand', root: brandRoot, template: renderBrandGitignore() },
    ...(companyRoot ? [{ label: 'company', root: companyRoot, template: renderCompanyGitignore() }] : []),
  ];

  const summary = {};
  for (const { label, root, template } of roots) {
    const verdict = ensureGitignore(root, template, { dryRun: options.dryRun });
    if (verdict !== 'present' && options.dryRun) {
      dryRunPlan(`${PLANS[verdict]} the ${label} .gitignore`);
      summary[label] = 'planned';
      continue;
    }
    console.log(`      ${chalk.green('✓')} ${label} .gitignore ${LABELS[verdict]}`);
    summary[label] = verdict;
  }

  if (Object.values(summary).every((verdict) => verdict === 'present')) {
    return null;
  }
  return { output: { gitignore: summary } };
};
