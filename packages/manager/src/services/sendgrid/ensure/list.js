/**
 * Ensure the brand's SendGrid marketing list exists.
 *
 * Resolution order: marketing.campaigns.listId from config → listId from
 * state (a previous run's result) → exact-name lookup → create. The resolved
 * id is written back into omega.json5 (marketing.campaigns.listId, its
 * authoritative home — comment-preserving) and mirrored in state.
 */
const chalk = require('chalk').default;
const { writeBrandConfig } = require('../../../lib/config-write.js');

module.exports = async function ensureList(context) {
  const { sendgridApi: api, brandConfig, serviceData, options = {} } = context;

  const listName = brandConfig.brand.name;
  const configuredId = brandConfig.marketing?.campaigns?.listId;
  const knownId = configuredId || serviceData.listId;

  // 1. Known id (config or state) — verify it still exists
  if (knownId) {
    const list = await api.getList(knownId);
    if (list) {
      console.log(`      ${chalk.green('✓')} List ${chalk.cyan(`"${list.name}"`)} ${chalk.dim(`(${list.id})`)}`);
      if (list.id !== configuredId) {
        writeBrandConfig(context, { 'marketing.campaigns.listId': list.id });
      }
      return { state: { listId: list.id, listName: list.name } };
    }
    console.log(`      ${chalk.yellow('↻')} Known listId ${chalk.cyan(knownId)} no longer exists — falling back to name lookup`);
  }

  // 2. Exact-name lookup
  const existing = await api.getListByName(listName);
  if (existing) {
    console.log(`      ${chalk.green('✓')} Matched list ${chalk.cyan(`"${listName}"`)} ${chalk.dim(`(${existing.id})`)}`);
    writeBrandConfig(context, { 'marketing.campaigns.listId': existing.id });
    return { state: { listId: existing.id, listName } };
  }

  // 3. Create
  if (options.dryRun) {
    console.log(`      ${chalk.dim(`⊘ Dry run — would create list "${listName}"`)}`);
    return { output: { list: { planned: 'create', listName } } };
  }

  const created = await api.createList(listName);
  console.log(`      ${chalk.green('✓')} Created list ${chalk.cyan(`"${listName}"`)} ${chalk.dim(`(${created.id})`)}`);
  writeBrandConfig(context, { 'marketing.campaigns.listId': created.id });

  return { state: { listId: created.id, listName } };
};
