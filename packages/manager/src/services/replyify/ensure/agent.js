/**
 * Ensure the brand's Replyify agent has the correct filter + knowledge.
 *
 * Filter = the brand's Gmail query (config/replyify.md `---filter---`
 * section, or auto-generated to:(@domain)) ANDed with the baseline
 * exclusion filter. Knowledge = the packaged baseline + the file's
 * knowledge section appended (omega-manager read `.brands/{id}/replyify.md`).
 *
 * Diff-synced on the managed leaf fields and patched with a leaf mask so
 * Replyify-owned fields (owner, id, metadata, other settings) survive —
 * omega-manager merge-wrote on every run with no dry-run guard, and
 * silently created an orphan agent document when the id was wrong; a
 * missing agent is a visible error now (agents are created in the
 * Replyify dashboard).
 */
const { join } = require('node:path');
const fs = require('node:fs');
const chalk = require('chalk').default;
const { getBaselineKnowledge, getBaselineFilter } = require('../lib/baseline.js');
const { parseKnowledgeFile } = require('../lib/knowledge-file.js');

function extractDomain(websiteUrl) {
  return websiteUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
}

/**
 * The default Gmail filter query — everything addressed to the brand's domain
 */
function generateFilterQuery(domain) {
  return `(\n  to:(\n    @${domain}\n  )\n)`;
}

module.exports = async function ensureAgent(context) {
  const { brandConfig, brandRoot, db, agentId, options } = context;
  const dryRun = options?.dryRun || false;

  const brandName = brandConfig.brand.name;
  const websiteUrl = brandConfig.brand.url;
  const domain = extractDomain(websiteUrl);

  // Brand-specific filter + knowledge file
  const knowledgePath = join(brandRoot, 'config', 'replyify.md');
  const rawContent = fs.existsSync(knowledgePath) ? fs.readFileSync(knowledgePath, 'utf8') : '';
  const brandFile = parseKnowledgeFile(rawContent);

  // Brand filter (file or auto-generated), merged with the baseline exclusions
  const brandFilter = brandFile.filterQuery || generateFilterQuery(domain);
  const filterQuery = `${brandFilter}\nAND\n${getBaselineFilter(brandConfig, domain)}`;

  const baseline = getBaselineKnowledge(brandConfig, domain);
  const knowledge = brandFile.knowledge ? `${baseline}\n\n${brandFile.knowledge}` : baseline;

  const desired = {
    name: `${brandName} - Customer Service`,
    settings: {
      filter: { query: filterQuery },
      brand: {
        name: brandName,
        about: brandConfig.brand.description || '',
        website: websiteUrl,
        knowledge,
      },
    },
  };

  const fieldPaths = [
    'name',
    'settings.filter.query',
    'settings.brand.name',
    'settings.brand.about',
    'settings.brand.website',
    'settings.brand.knowledge',
  ];

  const agent = await db.getDoc(`agents/${agentId}`);

  if (!agent) {
    console.log(`      ${chalk.red('✗')} Agent ${chalk.cyan(agentId)} not found in Replyify — check inbound.email.providers.replyify.agentId (agents are created at ${chalk.cyan('https://replyify.app')})`);
    return { status: 'error', error: `agent ${agentId} not found` };
  }

  const settings = agent.settings || {};
  const drifted = agent.name !== desired.name
    || settings.filter?.query !== filterQuery
    || settings.brand?.name !== brandName
    || settings.brand?.about !== desired.settings.brand.about
    || settings.brand?.website !== websiteUrl
    || settings.brand?.knowledge !== knowledge;

  if (!drifted) {
    console.log(`      ${chalk.green('✓')} Agent ${chalk.dim(agentId)} in sync ${chalk.dim(`(${desired.name})`)}`);
    console.log(`        ${chalk.dim(`Knowledge: ${knowledge.length} chars (baseline + ${brandFile.knowledge.length} brand-specific)`)}`);
    return { state: { agentId }, output: { agent: { synced: true } } };
  }

  if (dryRun) {
    console.log(`      ${chalk.yellow('[DRY RUN]')} Would update agent ${chalk.cyan(agentId)} ${chalk.dim(`(${desired.name}, ${knowledge.length} chars knowledge)`)}`);
    return { output: { agent: { planned: 'update' } } };
  }

  await db.patchDoc(`agents/${agentId}`, desired, fieldPaths);

  console.log(`      ${chalk.green('✓')} Agent ${chalk.dim(agentId)} updated ${chalk.dim(`(${desired.name})`)}`);
  console.log(`        ${chalk.dim(`Knowledge: ${knowledge.length} chars (baseline + ${brandFile.knowledge.length} brand-specific)`)}`);

  return { state: { agentId }, output: { agent: { updated: true } } };
};
