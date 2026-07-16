/**
 * Ensure the brand's Chatsy agent has the correct settings + knowledge.
 *
 * Knowledge = baseline (data/baseline-knowledge.md with brand values +
 * generated pricing) + the brand repo's config/chatsy.md when present
 * (omega-manager read `.brands/{id}/chatsy.md`). The agent image comes
 * from brand.images.brandmark — omega-manager hardcoded the company CDN;
 * without a brandmark the image field simply isn't managed.
 *
 * Diff-synced on the managed leaf fields and patched with a leaf mask so
 * Chatsy-owned fields (owner, id, metadata, other settings) survive —
 * omega-manager merge-wrote on every run with no dry-run guard, and
 * silently created an orphan agent document when the id was wrong; a
 * missing agent is a visible error now (agents are created in the Chatsy
 * dashboard).
 */
const { join } = require('node:path');
const fs = require('node:fs');
const chalk = require('chalk').default;
const { getBaselineKnowledge } = require('../lib/baseline-knowledge.js');
const { absoluteBrandImage } = require('../../../lib/brand.js');

module.exports = async function ensureChat(context) {
  const { brandConfig, brandRoot, db, agentId, options } = context;
  const dryRun = options?.dryRun || false;

  const brandName = brandConfig.brand.name;
  const websiteUrl = brandConfig.brand.url;

  // Brand-specific knowledge file (plain text, appended after the baseline)
  const knowledgePath = join(brandRoot, 'config', 'chatsy.md');
  const brandKnowledge = (fs.existsSync(knowledgePath) ? fs.readFileSync(knowledgePath, 'utf8') : '')
    .trim()
    .replaceAll('{website}', websiteUrl);

  const baseline = getBaselineKnowledge(brandConfig);
  const knowledge = brandKnowledge ? `${baseline}\n\n${brandKnowledge}` : baseline;

  const image = absoluteBrandImage(brandConfig, 'brandmark');

  const desired = {
    name: `${brandName} Support`,
    settings: {
      welcomeMessage: `Welcome to the ${brandName} Support chat! How can I help you?`,
      agent: {
        language: 'EN',
        ...(image ? { image } : {}),
      },
      autoTranslate: true,
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
    'settings.welcomeMessage',
    'settings.agent.language',
    ...(image ? ['settings.agent.image'] : []),
    'settings.autoTranslate',
    'settings.brand.name',
    'settings.brand.about',
    'settings.brand.website',
    'settings.brand.knowledge',
  ];

  const agent = await db.getDoc(`agents/${agentId}`);

  if (!agent) {
    console.log(`      ${chalk.red('✗')} Agent ${chalk.cyan(agentId)} not found in Chatsy — check chatsy.agentId (agents are created at ${chalk.cyan('https://chatsy.ai')})`);
    return { status: 'error', error: `agent ${agentId} not found` };
  }

  const settings = agent.settings || {};
  const drifted = agent.name !== desired.name
    || settings.welcomeMessage !== desired.settings.welcomeMessage
    || settings.agent?.language !== 'EN'
    || (image && settings.agent?.image !== image)
    || settings.autoTranslate !== true
    || settings.brand?.name !== brandName
    || settings.brand?.about !== desired.settings.brand.about
    || settings.brand?.website !== websiteUrl
    || settings.brand?.knowledge !== knowledge;

  if (!drifted) {
    console.log(`      ${chalk.green('✓')} Agent ${chalk.dim(agentId)} in sync ${chalk.dim(`(${desired.name})`)}`);
    console.log(`        ${chalk.dim(`Knowledge: ${knowledge.length} chars (baseline + ${brandKnowledge.length} brand-specific)`)}`);
    return { state: { agentId }, output: { chat: { synced: true } } };
  }

  if (dryRun) {
    console.log(`      ${chalk.yellow('[DRY RUN]')} Would update agent ${chalk.cyan(agentId)} ${chalk.dim(`(${desired.name}, ${knowledge.length} chars knowledge)`)}`);
    return { output: { chat: { planned: 'update' } } };
  }

  await db.patchDoc(`agents/${agentId}`, desired, fieldPaths);

  console.log(`      ${chalk.green('✓')} Agent ${chalk.dim(agentId)} updated ${chalk.dim(`(${desired.name})`)}`);
  console.log(`        ${chalk.dim(`Knowledge: ${knowledge.length} chars (baseline + ${brandKnowledge.length} brand-specific)`)}`);

  return { state: { agentId }, output: { chat: { updated: true } } };
};
