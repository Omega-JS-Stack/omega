/**
 * Ensure custom firewall rules match `cloudflare.rules.security`.
 *
 * 1. Reads the http_request_firewall_custom entrypoint ruleset (and managed for cache only).
 * 2. Diffs each configured rule by description (name) — creates/updates `skip`-style rules.
 * 3. PUTs the merged ruleset, or PUT to the phase entrypoint if it doesn't exist yet.
 */
const chalk = require('chalk').default;
const { cacheRead } = require('../lib/read-cache.js');
const { fetchRuleset, getZoneId } = require('../lib/ruleset-helper.js');
const { dryRunPlan } = require('../../../lib/run-gates.js');

const PHASE = 'http_request_firewall_custom';
const MANAGED_PHASE = 'http_request_firewall_managed';

module.exports = async function ensureRulesSecurity(context) {
  const { cloudflareApi: api, brandRoot, brandConfig, options = {} } = context;
  const zoneId = getZoneId(context);

  // === READ ===
  const { ruleset: customRuleset } = await fetchRuleset(api, zoneId, PHASE);
  const { ruleset: managedRuleset } = await fetchRuleset(api, zoneId, MANAGED_PHASE);
  console.log(`      ${chalk.green('✓')} Read`);
  cacheRead(brandRoot, 'rules-security', {
    customRules: { count: customRuleset?.rules?.length || 0, ruleset: customRuleset },
    managedRules: { count: managedRuleset?.rules?.length || 0, ruleset: managedRuleset },
  });

  // === DIFF ===
  const securityRulesConfig = brandConfig?.cloudflare?.rules?.security;
  if (!securityRulesConfig || !Array.isArray(securityRulesConfig) || securityRulesConfig.length === 0) {
    console.log(`      ${chalk.dim('⊘ No changes needed')}`);
    return;
  }

  const modifiedRules = customRuleset?.rules ? [...customRuleset.rules] : [];
  let hasChanges = false;

  for (const configRule of securityRulesConfig) {
    const ruleName = configRule.name;
    const ruleIndex = modifiedRules.findIndex((rule) => rule.description === ruleName);
    const currentRule = ruleIndex >= 0 ? modifiedRules[ruleIndex] : null;

    const actionParameters = {
      products: configRule.skipProducts || currentRule?.action_parameters?.products || [],
    };
    if (configRule.skipPhases) {
      actionParameters.phases = configRule.skipPhases;
    } else if (currentRule?.action_parameters?.phases) {
      actionParameters.phases = currentRule.action_parameters.phases;
    }
    if (configRule.skipRuleset) {
      actionParameters.ruleset = configRule.skipRuleset;
    } else if (currentRule?.action_parameters?.ruleset) {
      actionParameters.ruleset = currentRule.action_parameters.ruleset;
    }

    const expectedRule = {
      ...(currentRule || {}),
      action: configRule.action || 'skip',
      action_parameters: actionParameters,
      expression: configRule.expression || currentRule?.expression,
      description: ruleName,
      enabled: configRule.enabled !== undefined ? configRule.enabled : (currentRule?.enabled ?? true),
      logging: {
        enabled: configRule.logging !== undefined ? configRule.logging : (currentRule?.logging?.enabled ?? false),
      },
    };

    if (!currentRule) {
      console.log(`      ${chalk.dim('·')} create ${chalk.cyan(`"${ruleName}"`)}`);
      modifiedRules.push(expectedRule);
      hasChanges = true;
      continue;
    }

    const currentProducts = JSON.stringify(currentRule.action_parameters?.products || []);
    const currentPhases = JSON.stringify(currentRule.action_parameters?.phases || []);
    const needsUpdate =
      currentRule.action !== expectedRule.action
      || currentProducts !== JSON.stringify(expectedRule.action_parameters.products)
      || currentPhases !== JSON.stringify(expectedRule.action_parameters.phases || [])
      || currentRule.action_parameters?.ruleset !== expectedRule.action_parameters.ruleset
      || currentRule.expression !== expectedRule.expression
      || currentRule.enabled !== expectedRule.enabled
      || (currentRule.logging?.enabled ?? false) !== expectedRule.logging.enabled;

    if (needsUpdate) {
      console.log(`      ${chalk.dim('·')} update ${chalk.cyan(`"${ruleName}"`)}`);
      modifiedRules[ruleIndex] = expectedRule;
      hasChanges = true;
    }
  }

  // Remove stale rules (in Cloudflare but not in config)
  const configNames = new Set(securityRulesConfig.map((r) => r.name));
  const staleIndices = [];
  for (let i = modifiedRules.length - 1; i >= 0; i--) {
    if (modifiedRules[i].description && !configNames.has(modifiedRules[i].description)) {
      console.log(`      ${chalk.dim('·')} remove ${chalk.cyan(`"${modifiedRules[i].description}"`)}`);
      staleIndices.push(i);
      hasChanges = true;
    }
  }
  for (const i of staleIndices) modifiedRules.splice(i, 1);

  if (!hasChanges) {
    console.log(`      ${chalk.dim('⊘ No changes needed')}`);
    return;
  }

  if (options.dryRun) {
    return dryRunPlan('update security rules', { status: 'success', output: { security: { planned: modifiedRules.length } } });
  }

  // === WRITE ===
  const output = { updated: false };
  try {
    const description = customRuleset?.description || '';
    if (customRuleset?.id) {
      await api.makeRequest(`/zones/${zoneId}/rulesets/${customRuleset.id}`, {
        method: 'PUT',
        body: JSON.stringify({ rules: modifiedRules, description }),
      });
      console.log(`      ${chalk.green('✓')} Security rules updated`);
    } else {
      await api.makeRequest(`/zones/${zoneId}/rulesets/phases/${PHASE}/entrypoint`, {
        method: 'PUT',
        body: JSON.stringify({ rules: modifiedRules, description }),
      });
      console.log(`      ${chalk.green('✓')} Security rules created`);
    }
    output.updated = true;
  } catch (error) {
    output.error = error.message;
    console.error(`      ${chalk.red('✗')} Security rules failed${chalk.dim(`: ${error.message}`)}`);
  }

  return { output: { security: output } };
};
