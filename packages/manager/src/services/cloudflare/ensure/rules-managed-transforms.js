/**
 * Ensure Managed Transforms match `cloudflare.rules.managedTransforms`.
 *
 * 1. Reads the current managed_request_headers + managed_response_headers state.
 * 2. Diffs against the config (enable/disable each Cloudflare-named transform).
 * 3. PATCHes the combined updated lists in one call.
 */
const chalk = require('chalk').default;
const { cacheRead } = require('../lib/read-cache.js');
const { getZoneId } = require('../lib/ruleset-helper.js');
const { dryRunPlan } = require('../../../lib/run-gates.js');

const REQUEST_HEADERS_MAP = {
  addClientCertificateHeaders: 'add_client_certificate_headers',
  addVisitorLocationHeaders: 'add_visitor_location_headers',
  removeVisitorIpHeaders: 'remove_visitor_ip_headers',
  addWafCredentialCheckStatusHeader: 'add_waf_credential_check_status_header',
};

const RESPONSE_HEADERS_MAP = {
  removeXPoweredByHeader: 'remove_x-powered-by_header',
  addSecurityHeaders: 'add_security_headers',
};

module.exports = async function ensureManagedTransforms(context) {
  const { cloudflareApi: api, brandRoot, brandConfig, options = {} } = context;
  const zoneId = getZoneId(context);

  // === READ ===
  const data = await api.makeRequest(`/zones/${zoneId}/managed_headers`);
  const managedRequestHeaders = data.result.managed_request_headers || [];
  const managedResponseHeaders = data.result.managed_response_headers || [];

  console.log(`      ${chalk.green('✓')} Read`);
  cacheRead(brandRoot, 'rules-managed-transforms', { managedRequestHeaders, managedResponseHeaders });

  // === DIFF ===
  const managedTransformsConfig = brandConfig?.cloudflare?.rules?.managedTransforms;
  if (!managedTransformsConfig) {
    console.log(`      ${chalk.dim('⊘ No changes needed')}`);
    return;
  }

  let hasChanges = false;
  const updatedRequestHeaders = [...managedRequestHeaders];
  const updatedResponseHeaders = [...managedResponseHeaders];

  const applyDiff = (configSection, map, headersList) => {
    if (!configSection) return;
    for (const [configKey, apiId] of Object.entries(map)) {
      const targetEnabled = configSection[configKey];
      if (targetEnabled === null || targetEnabled === undefined) continue;

      const headerIndex = headersList.findIndex((h) => h.id === apiId);
      const currentEnabled = headerIndex >= 0 ? headersList[headerIndex].enabled : false;

      if (currentEnabled !== targetEnabled) {
        console.log(`      ${chalk.dim('·')} ${apiId}: ${chalk.dim(currentEnabled)} => ${chalk.cyan(targetEnabled)}`);
        hasChanges = true;
        if (headerIndex >= 0) {
          headersList[headerIndex] = { ...headersList[headerIndex], enabled: targetEnabled };
        } else {
          headersList.push({ id: apiId, enabled: targetEnabled });
        }
      }
    }
  };

  applyDiff(managedTransformsConfig.request, REQUEST_HEADERS_MAP, updatedRequestHeaders);
  applyDiff(managedTransformsConfig.response, RESPONSE_HEADERS_MAP, updatedResponseHeaders);

  if (!hasChanges) {
    console.log(`      ${chalk.dim('⊘ No changes needed')}`);
    return;
  }

  if (options.dryRun) {
    return dryRunPlan('update Managed Transforms', { status: 'success', output: { managedTransforms: { planned: true } } });
  }

  // === WRITE ===
  const output = { updated: false };
  try {
    await api.makeRequest(`/zones/${zoneId}/managed_headers`, {
      method: 'PATCH',
      body: JSON.stringify({
        managed_request_headers: updatedRequestHeaders,
        managed_response_headers: updatedResponseHeaders,
      }),
    });
    output.updated = true;
    console.log(`      ${chalk.green('✓')} Managed Transforms updated`);
  } catch (error) {
    output.error = error.message;
    console.error(`      ${chalk.red('✗')} Managed Transforms failed${chalk.dim(`: ${error.message}`)}`);
  }

  return { output: { managedTransforms: output } };
};
