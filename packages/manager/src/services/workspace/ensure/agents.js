/**
 * Ensure the brand agent-docs chain (Ian 2026-07-20): root AGENTS.md opens
 * with the framework-guide import, root CLAUDE.md is the one-line
 * `@AGENTS.md` pointer. Consumer content is preserved; a content-bearing
 * CLAUDE.md warns with the move-it message instead of being clobbered.
 */
const chalk = require('chalk').default;

const { ensureAgentsMd, ensureClaudePointer, ensureGuideLink, IMPORT_LINE, CLAUDE_POINTER } = require('../../../lib/agents-md.js');

module.exports = async ({ brandRoot, brand }) => {
  const brandName = brand.config?.brand?.name || brand.id;

  const guide = ensureGuideLink(brandRoot);
  const guideLabel = {
    present: 'node_modules/@omega.js/AGENTS.md links the framework map',
    created: 'Linked node_modules/@omega.js/AGENTS.md at the framework map',
    healed: 'Relinked node_modules/@omega.js/AGENTS.md at the framework map',
    skipped: 'No resolvable framework map yet (pre-install or published without vendored docs) — link skipped',
  }[guide];
  console.log(`      ${chalk.green('✓')} ${guideLabel}`);

  const agents = ensureAgentsMd(brandRoot, brandName);
  const agentsLabel = {
    present: `AGENTS.md imports the framework guide (${IMPORT_LINE})`,
    created: 'Created AGENTS.md with the framework-guide import',
    healed: 'Healed AGENTS.md — framework-guide import moved to line 1 (your content preserved)',
  }[agents];
  console.log(`      ${chalk.green('✓')} ${agentsLabel}`);

  const claude = ensureClaudePointer(brandRoot);
  if (claude === 'content-bearing') {
    console.log(`      ${chalk.yellow('⚠')} CLAUDE.md carries content — move it into AGENTS.md (below the import) and reduce CLAUDE.md to the one-line \`${CLAUDE_POINTER}\` pointer`);
    return { status: 'warned', output: { guide, agents, claude } };
  }
  console.log(`      ${chalk.green('✓')} CLAUDE.md ${claude === 'created' ? 'created as' : 'is'} the \`${CLAUDE_POINTER}\` pointer`);

  if (agents === 'present' && claude === 'present' && (guide === 'present' || guide === 'skipped')) {
    return null;
  }
  return { output: { guide, agents, claude } };
};
