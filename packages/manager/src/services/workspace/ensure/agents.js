/**
 * Ensure the brand agent-docs chain (Ian 2026-07-20): root AGENTS.md opens
 * with the framework-guide import, and the scope link resolves it. Consumer
 * content is preserved.
 */
const chalk = require('chalk').default;

const { ensureAgentsMd, ensureGuideLink, IMPORT_LINE } = require('../../../lib/agents-md.js');
const { dryRunPlan } = require('../../../lib/run-gates.js');

/**
 * Print one item's line and return the verdict the output records: under a
 * dry run, a change the real run would make prints as its plan instead.
 */
function settle(verdict, labels, plans, dryRun) {
  if (dryRun && plans[verdict]) {
    dryRunPlan(plans[verdict]);
    return 'planned';
  }
  console.log(`      ${chalk.green('✓')} ${labels[verdict]}`);
  return verdict;
}

module.exports = async ({ brandRoot, brand, options = {} }) => {
  const brandName = brand.config?.brand?.name || brand.id;
  const dryRun = options.dryRun || false;

  const guide = settle(ensureGuideLink(brandRoot, { dryRun }), {
    present: 'node_modules/@omega.js/AGENTS.md links the framework map',
    created: 'Linked node_modules/@omega.js/AGENTS.md at the framework map',
    healed: 'Relinked node_modules/@omega.js/AGENTS.md at the framework map',
    skipped: 'No resolvable framework map yet (pre-install) — link skipped',
  }, {
    created: 'link node_modules/@omega.js/AGENTS.md at the framework map',
    healed: 'relink node_modules/@omega.js/AGENTS.md at the framework map',
  }, dryRun);

  const agents = settle(ensureAgentsMd(brandRoot, brandName, { dryRun }), {
    present: `AGENTS.md imports the framework guide (${IMPORT_LINE})`,
    created: 'Created AGENTS.md with the framework-guide import',
    healed: 'Healed AGENTS.md — framework-guide import moved to line 1 (your content preserved)',
  }, {
    created: 'create AGENTS.md with the framework-guide import',
    healed: 'move the framework-guide import to line 1 of AGENTS.md',
  }, dryRun);

  if (agents === 'present' && (guide === 'present' || guide === 'skipped')) {
    return null;
  }
  return { output: { guide, agents } };
};
