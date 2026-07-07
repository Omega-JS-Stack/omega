/**
 * Ensure cache rules match `cloudflare.cacheRules`.
 *
 * 1. Reads the http_request_cache_settings entrypoint ruleset (or notes it needs creating).
 * 2. Diffs each configured rule by description — creates missing, updates stale, removes unconfigured.
 * 3. POSTs a new ruleset if missing; PUTs the merged ruleset if updating.
 */
const chalk = require('chalk').default;
const { cacheRead } = require('../lib/read-cache.js');
const { fetchRuleset, applyRuleset, getZoneId } = require('../lib/ruleset-helper.js');

module.exports = async function ensureCacheRules(context) {
  const { cloudflareApi: api, brandRoot, brandConfig, options = {} } = context;
  const zoneId = getZoneId(context);

  // === READ ===
  const { ruleset, needsCreate } = await fetchRuleset(api, zoneId, 'http_request_cache_settings');
  const readCount = ruleset?.rules?.length || 0;
  console.log(`      ${chalk.green('✓')} Read ${chalk.dim(`(${readCount} items)`)}`);
  cacheRead(brandRoot, 'cache-rules', { count: readCount, ruleset, needsCreate });

  // === DIFF ===
  const cacheRulesConfig = brandConfig?.cloudflare?.cacheRules;
  if (!cacheRulesConfig || !Array.isArray(cacheRulesConfig) || cacheRulesConfig.length === 0) {
    console.log(`      ${chalk.dim('⊘ No changes needed')}`);
    return;
  }

  const modifiedRules = ruleset?.rules ? [...ruleset.rules] : [];
  let hasChanges = false;

  for (const configRule of cacheRulesConfig) {
    const ruleName = configRule.name;
    const ruleIndex = modifiedRules.findIndex((rule) => rule.description === ruleName);
    const currentRule = ruleIndex >= 0 ? modifiedRules[ruleIndex] : null;

    const expectedRule = {
      ...(currentRule || {}),
      action: 'set_cache_settings',
      action_parameters: {
        cache: true,
        edge_ttl: { mode: 'override_origin', default: configRule.edgeTtl || 31536000 },
        browser_ttl: { mode: 'override_origin', default: configRule.browserTtl || 14400 },
      },
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

    const currentEdgeTtl = currentRule.action_parameters?.edge_ttl?.default;
    const currentBrowserTtl = currentRule.action_parameters?.browser_ttl?.default;
    const needsUpdate =
      currentEdgeTtl !== expectedRule.action_parameters.edge_ttl.default
      || currentBrowserTtl !== expectedRule.action_parameters.browser_ttl.default
      || currentRule.enabled !== expectedRule.enabled
      || currentRule.expression !== expectedRule.expression;

    if (needsUpdate) {
      console.log(`      ${chalk.dim('·')} update ${chalk.cyan(`"${ruleName}"`)}`);
      modifiedRules[ruleIndex] = expectedRule;
      hasChanges = true;
    }
  }

  // Remove stale rules (in Cloudflare but not in config)
  const configNames = new Set(cacheRulesConfig.map((r) => r.name));
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
    phase: 'http_request_cache_settings',
    name: 'Cache Rules',
    description: 'Cache rules managed by Omega Manager',
    label: 'Cache rules',
    dryRun: options.dryRun,
  });

  return { output: { cacheRules: output } };
};
