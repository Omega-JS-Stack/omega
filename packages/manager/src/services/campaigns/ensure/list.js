/**
 * Ensure the brand's SendGrid marketing list exists.
 *
 * Resolution order: marketing.campaigns.providers.sendgrid.listId from
 * config → exact-name lookup → create. The resolved id is written back into
 * omega.json5 (marketing.campaigns.providers.sendgrid.listId, its ONE
 * authoritative home — comment-preserving).
 */
const chalk = require('chalk').default;
const { writeBrandConfig } = require('../../../lib/config-write.js');
const { dryRunPlan } = require('../../../lib/run-gates.js');

module.exports = async function ensureList(context) {
  const { sendgridApi: api, brandConfig, options = {} } = context;

  const listName = brandConfig.brand.name;
  const configuredId = brandConfig.marketing?.campaigns?.providers?.sendgrid?.listId;

  // 1. Configured id — verify it still exists
  if (configuredId) {
    const list = await api.getList(configuredId);
    if (list) {
      console.log(`      ${chalk.green('✓')} List ${chalk.cyan(`"${list.name}"`)} ${chalk.dim(`(${list.id})`)}`);
      if (list.id !== configuredId) {
        writeBrandConfig(context, { 'marketing.campaigns.providers.sendgrid.listId': list.id });
      }
      return { state: { listId: list.id, listName: list.name } };
    }
    console.log(`      ${chalk.yellow('↻')} Configured listId ${chalk.cyan(configuredId)} no longer exists — falling back to name lookup`);
  }

  // 2. Exact-name lookup
  const existing = await api.getListByName(listName);
  if (existing) {
    console.log(`      ${chalk.green('✓')} Matched list ${chalk.cyan(`"${listName}"`)} ${chalk.dim(`(${existing.id})`)}`);
    writeBrandConfig(context, { 'marketing.campaigns.providers.sendgrid.listId': existing.id });
    return { state: { listId: existing.id, listName } };
  }

  // 3. Create
  if (options.dryRun) {
    return dryRunPlan(`create list "${listName}"`, { output: { list: { planned: 'create', listName } } });
  }

  const created = await api.createList(listName);
  console.log(`      ${chalk.green('✓')} Created list ${chalk.cyan(`"${listName}"`)} ${chalk.dim(`(${created.id})`)}`);
  writeBrandConfig(context, { 'marketing.campaigns.providers.sendgrid.listId': created.id });

  return { state: { listId: created.id, listName } };
};
