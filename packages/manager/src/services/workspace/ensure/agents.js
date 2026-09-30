/**
 * Ensure the brand agent-docs chain: root AGENTS.md imports the manager in its
 * Default section and the retired scope link is gone. The Custom section is
 * preserved.
 */
const chalk = require('chalk').default;

const { ensureAgentsMd, removeRetiredLink, IMPORT_LINE, RETIRED_SUBPATH } = require('@omega.js/devkit/agents-md');
const { dryRunPlan } = require('../../../lib/run-gates.js');

/**
 * Print one item's line and return the verdict the output records: under a
 * dry run, a change the real run would make prints as its plan instead. A
 * verdict with no label prints nothing.
 */
function settle(verdict, labels, plans, dryRun) {
  if (dryRun && plans[verdict]) {
    dryRunPlan(plans[verdict]);
    return 'planned';
  }
  if (labels[verdict]) {
    console.log(`      ${chalk.green('✓')} ${labels[verdict]}`);
  }
  return verdict;
}

module.exports = async ({ brandRoot, options = {} }) => {
  const dryRun = options.dryRun || false;

  const link = settle(removeRetiredLink(brandRoot, { dryRun }), {
    removed: `Removed the retired ${RETIRED_SUBPATH} link`,
  }, {
    removed: `remove the retired ${RETIRED_SUBPATH} link`,
  }, dryRun);

  const agents = settle(ensureAgentsMd(brandRoot, { dryRun }), {
    present: `AGENTS.md imports the omega map (${IMPORT_LINE})`,
    created: 'Created AGENTS.md with the omega map import',
    healed: 'Healed AGENTS.md: the Default section imports the omega map (your Custom section preserved)',
    converged: 'Converged AGENTS.md to the marker sections: the omega map import under Default, your notes under Custom',
  }, {
    created: 'create AGENTS.md with the omega map import',
    healed: 'heal the omega map import in the Default section of AGENTS.md',
    converged: 'converge AGENTS.md to the marker sections: the omega map import under Default, your notes under Custom',
  }, dryRun);

  if (agents === 'present' && link === 'absent') {
    return null;
  }
  return { output: { link, agents } };
};
