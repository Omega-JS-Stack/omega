/**
 * Ensure response header transform rules match `cloudflare.rules.responseHeaders`.
 *
 * Different from other ruleset operations: always uses PUT, but targets either
 * the existing ruleset's ID or the phase's entrypoint URL when it doesn't yet
 * exist.
 */
const chalk = require('chalk').default;
const { cacheRead } = require('../lib/read-cache.js');
const { fetchRuleset, getZoneId } = require('../lib/ruleset-helper.js');

const PHASE = 'http_response_headers_transform';

module.exports = async function ensureRulesResponseHeaders(context) {
  const { cloudflareApi: api, brandRoot, brandConfig, options = {} } = context;
  const zoneId = getZoneId(context);

  // === READ ===
  const { ruleset } = await fetchRuleset(api, zoneId, PHASE);
  const readCount = ruleset?.rules?.length || 0;
  console.log(`      ${chalk.green('✓')} Read`);
  cacheRead(brandRoot, 'rules-response-headers', {
    responseTransform: { count: readCount, ruleset },
  });

  // === DIFF ===
  const responseHeadersConfig = brandConfig?.cloudflare?.rules?.responseHeaders;
  if (!responseHeadersConfig || responseHeadersConfig.length === 0) {
    console.log(`      ${chalk.dim('⊘ No changes needed')}`);
    return;
  }

  const existingRules = ruleset?.rules || [];
  const configuredRules = responseHeadersConfig.map((rule) => ({
    description: rule.name,
    expression: rule.expression,
    action: 'rewrite',
    action_parameters: {
      headers: Object.fromEntries(
        Object.entries(rule.headers).map(([name, value]) => [name, { operation: 'set', value }]),
      ),
    },
    enabled: rule.enabled,
  }));

  // Compare ignoring Cloudflare metadata (id, ref, version, last_updated)
  const normalize = (rule) => ({
    description: rule.description,
    expression: rule.expression,
    action: rule.action,
    action_parameters: rule.action_parameters,
    enabled: rule.enabled,
  });
  const rulesChanged = JSON.stringify(existingRules.map(normalize)) !== JSON.stringify(configuredRules.map(normalize));

  if (!rulesChanged) {
    console.log(`      ${chalk.dim('⊘ No changes needed')}`);
    return;
  }

  console.log(`      ${chalk.dim('·')} ${chalk.bold(configuredRules.length)} rules`);

  if (options.dryRun) {
    console.log(`      ${chalk.dim('⊘ Dry run — response header rules update skipped')}`);
    return { status: 'success', output: { responseHeaders: { planned: configuredRules.length } } };
  }

  // === WRITE ===
  const output = { updated: false };
  try {
    const endpoint = ruleset?.id
      ? `/zones/${zoneId}/rulesets/${ruleset.id}`
      : `/zones/${zoneId}/rulesets/phases/${PHASE}/entrypoint`;

    const body = ruleset?.id
      ? { rules: configuredRules, phase: PHASE }
      : { rules: configuredRules };

    await api.makeRequest(endpoint, { method: 'PUT', body: JSON.stringify(body) });
    output.updated = true;
    console.log(`      ${chalk.green('✓')} Response header transform rules updated`);
  } catch (error) {
    output.error = error.message;
    console.error(`      ${chalk.red('✗')} Response header transform rules failed${chalk.dim(`: ${error.message}`)}`);
  }

  return { output: { responseHeaders: output } };
};
