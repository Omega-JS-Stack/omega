/**
 * Ensure redirect rules match `cloudflare.rules.redirect`.
 *
 * 1. Reads the http_request_dynamic_redirect entrypoint ruleset (or notes it needs creating).
 * 2. Diffs each configured rule by description — creates missing, updates stale, removes unconfigured.
 * 3. POSTs a new ruleset if missing; PUTs the merged ruleset if updating.
 */
const chalk = require('chalk').default;
const { cacheRead } = require('../lib/read-cache.js');
const { fetchRuleset, applyRuleset, getZoneId, zoneGate } = require('../lib/ruleset-helper.js');

module.exports = async function ensureRulesRedirect(context) {
  const { cloudflareApi: api, brandRoot, brandConfig, options = {} } = context;
  const zoneId = getZoneId(context);
  const gated = zoneGate(context, 'rulesRedirect');
  if (gated) return gated;

  // === READ ===
  const { ruleset, needsCreate } = await fetchRuleset(api, zoneId, 'http_request_dynamic_redirect');
  const readCount = ruleset?.rules?.length || 0;
  console.log(`      ${chalk.green('✓')} Read ${chalk.dim(`(${readCount} items)`)}`);
  cacheRead(brandRoot, 'rules-redirect', { count: readCount, ruleset, needsCreate });

  // === DIFF ===
  const redirectRulesConfig = brandConfig?.cloudflare?.rules?.redirect;
  if (!redirectRulesConfig || !Array.isArray(redirectRulesConfig) || redirectRulesConfig.length === 0) {
    console.log(`      ${chalk.dim('⊘ No changes needed')}`);
    return;
  }

  const modifiedRules = ruleset?.rules ? [...ruleset.rules] : [];
  let hasChanges = false;

  for (const configRule of redirectRulesConfig) {
    const ruleName = configRule.name;
    const ruleIndex = modifiedRules.findIndex((rule) => rule.description === ruleName);
    const currentRule = ruleIndex >= 0 ? modifiedRules[ruleIndex] : null;

    const expectedRule = {
      ...(currentRule || {}),
      action: 'redirect',
      action_parameters: {
        from_value: {
          status_code: configRule.statusCode || 301,
          preserve_query_string: configRule.preserveQueryString !== undefined ? configRule.preserveQueryString : true,
          target_url: configRule.targetUrl || currentRule?.action_parameters?.from_value?.target_url,
        },
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

    const currentParams = currentRule.action_parameters?.from_value || {};
    const expectedParams = expectedRule.action_parameters.from_value;
    const needsUpdate =
      currentParams.status_code !== expectedParams.status_code
      || currentParams.preserve_query_string !== expectedParams.preserve_query_string
      || JSON.stringify(currentParams.target_url) !== JSON.stringify(expectedParams.target_url)
      || currentRule.expression !== expectedRule.expression
      || currentRule.enabled !== expectedRule.enabled;

    if (needsUpdate) {
      console.log(`      ${chalk.dim('·')} update ${chalk.cyan(`"${ruleName}"`)}`);
      modifiedRules[ruleIndex] = expectedRule;
      hasChanges = true;
    }
  }

  // Remove stale rules (in Cloudflare but not in config)
  const configNames = new Set(redirectRulesConfig.map((r) => r.name));
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
    phase: 'http_request_dynamic_redirect',
    name: 'Redirect Rules',
    description: 'Redirect rules managed by Omega Manager',
    label: 'Redirect rules',
    dryRun: options.dryRun,
  });

  return { output: { redirect: output } };
};
