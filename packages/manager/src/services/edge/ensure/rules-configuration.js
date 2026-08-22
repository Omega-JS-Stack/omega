/**
 * Ensure configuration rules match `edge.providers.cloudflare.rules.configuration`.
 *
 * 1. Reads the http_config_settings entrypoint ruleset (or notes it needs creating).
 * 2. Diffs each configured rule by description — creates missing, updates stale, removes unconfigured.
 * 3. POSTs a new ruleset if missing; PUTs the merged ruleset if updating.
 */
const chalk = require('chalk').default;
const { cacheRead } = require('../lib/read-cache.js');
const { fetchRuleset, applyRuleset, getZoneId, zoneGate } = require('../lib/ruleset-helper.js');

module.exports = async function ensureRulesConfiguration(context) {
  const { cloudflareApi: api, brandRoot, brandConfig, options = {} } = context;
  const zoneId = getZoneId(context);
  const gated = zoneGate(context, 'rulesConfiguration');
  if (gated) return gated;

  // === READ ===
  const { ruleset, needsCreate } = await fetchRuleset(api, zoneId, 'http_config_settings');
  const readCount = ruleset?.rules?.length || 0;
  console.log(`      ${chalk.green('✓')} Read ${chalk.dim(`(${readCount} items)`)}`);
  cacheRead(brandRoot, 'rules-configuration', { count: readCount, ruleset, needsCreate });

  // === DIFF ===
  const configRulesConfig = brandConfig?.edge?.providers?.cloudflare?.rules?.configuration;
  if (!configRulesConfig || !Array.isArray(configRulesConfig) || configRulesConfig.length === 0) {
    console.log(`      ${chalk.dim('⊘ No changes needed')}`);
    return;
  }

  const modifiedRules = ruleset?.rules ? [...ruleset.rules] : [];
  let hasChanges = false;

  for (const configRule of configRulesConfig) {
    const ruleName = configRule.name;
    const ruleIndex = modifiedRules.findIndex((rule) => rule.description === ruleName);
    const currentRule = ruleIndex >= 0 ? modifiedRules[ruleIndex] : null;

    const expectedRule = {
      ...(currentRule || {}),
      action: 'set_config',
      action_parameters: configRule.settings || {},
      expression: configRule.expression || currentRule?.expression,
      description: ruleName,
      enabled: configRule.enabled !== undefined ? configRule.enabled : (currentRule?.enabled ?? true),
    };

    if (!currentRule) {
      console.log(`      ${chalk.dim('·')} create ${chalk.cyan(`"${ruleName}"`)}`);
      modifiedRules.push(expectedRule);
      hasChanges = true;
      continue;
    }

    const currentParams = JSON.stringify(currentRule.action_parameters || {});
    const needsUpdate =
      currentParams !== JSON.stringify(expectedRule.action_parameters)
      || currentRule.expression !== expectedRule.expression
      || currentRule.enabled !== expectedRule.enabled;

    if (needsUpdate) {
      console.log(`      ${chalk.dim('·')} update ${chalk.cyan(`"${ruleName}"`)}`);
      modifiedRules[ruleIndex] = expectedRule;
      hasChanges = true;
    }
  }

  // Remove stale rules (in Cloudflare but not in config)
  const configNames = new Set(configRulesConfig.map((r) => r.name));
  const staleIndices = [];
  for (let i = modifiedRules.length - 1; i >= 0; i--) {
    if (modifiedRules[i].description && !configNames.has(modifiedRules[i].description)) {
      console.log(`      ${chalk.dim('·')} remove ${chalk.cyan(`"${modifiedRules[i].description}"`)}`);
      staleIndices.push(i);
      hasChanges = true;
    }
  }
  for (const i of staleIndices) modifiedRules.splice(i, 1);

  if (!hasChanges && !needsCreate) {
    console.log(`      ${chalk.dim('⊘ No changes needed')}`);
    return;
  }

  // === WRITE ===
  const output = await applyRuleset(api, zoneId, {
    ruleset,
    needsCreate,
    rules: modifiedRules,
    phase: 'http_config_settings',
    name: 'Configuration Rules',
    description: 'Configuration rules managed by Omega Manager',
    label: 'Configuration rules',
    dryRun: options.dryRun,
  });

  return { output: { configuration: output } };
};
