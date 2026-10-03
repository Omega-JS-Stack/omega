/**
 * Ensure Cloudflare Web Analytics (the beacon injected at the edge) matches
 * `edge.providers.cloudflare.webAnalytics.enabled`.
 *
 * Web Analytics is ACCOUNT-level: one RUM site record per zone, whose
 * automatic install injects the beacon into every page the zone serves.
 *
 * 1. Lists the account's RUM sites and finds the one whose ruleset is this zone.
 * 2. Diffs its `enabled` against config.
 * 3. POSTs a missing site (only when enabled) or PUTs the changed flag.
 * A 403 (no "Account Settings Write" on the token) returns warned; the walk continues.
 */
const chalk = require('chalk').default;
const { cacheRead } = require('../lib/read-cache.js');
const { accountId: resolveAccountId } = require('../lib/account-id.js');
const { getZoneId, zoneGate } = require('../lib/ruleset-helper.js');
const { dryRunPlan } = require('../../../lib/run-gates.js');

const PERMISSION_REASON = 'CLOUDFLARE_TOKEN lacks the "Account Settings Write" permission, so Web Analytics was not reconciled: add it to the token';

// Cloudflare answers a missing token permission with HTTP 403, error code 10000
function isForbidden(error) {
  return error.status === 403 || error.errors?.some((e) => e.code === 10000);
}

/**
 * Every RUM site on the account. Later pages are read only when the first
 * page's result_info says there are more.
 */
async function listSites(api, account) {
  const endpoint = `/accounts/${account}/rum/site_info/list`;
  let data = await api.makeRequest(endpoint);
  const sites = [...(data.result || [])];

  while (data.result_info && data.result_info.page * data.result_info.per_page < data.result_info.total_count) {
    data = await api.makeRequest(`${endpoint}?page=${data.result_info.page + 1}`);
    sites.push(...(data.result || []));
  }

  return sites;
}

async function reconcile(context, account) {
  const { cloudflareApi: api, brandRoot, brandConfig, zoneDomain, options = {} } = context;
  const zoneId = getZoneId(context);

  // === READ ===
  const sites = await listSites(api, account);
  const site = sites.find((s) => s.ruleset?.zone_tag === zoneId) || null;
  console.log(`      ${chalk.green('✓')} Read ${chalk.dim(`(${sites.length} items)`)}`);
  cacheRead(brandRoot, 'web-analytics', { count: sites.length, site });

  // === DIFF ===
  const desired = brandConfig?.edge?.providers?.cloudflare?.webAnalytics?.enabled;
  const current = site ? site.ruleset.enabled === true : false;
  if (desired === undefined || desired === current) {
    console.log(`      ${chalk.dim('⊘ No changes needed')}`);
    return { output: { webAnalytics: { updated: false } } };
  }

  const action = site ? 'update' : 'create';
  console.log(`      ${chalk.dim('·')} ${action} ${chalk.cyan(zoneDomain)}: ${chalk.dim(String(current))} => ${chalk.cyan(String(desired))}`);

  if (options.dryRun) {
    return dryRunPlan(`${action} Web Analytics for ${zoneDomain}`, { status: 'success', output: { webAnalytics: { planned: action } } });
  }

  // === WRITE ===
  if (site) {
    await api.makeRequest(`/accounts/${account}/rum/site_info/${site.site_tag}`, {
      method: 'PUT',
      body: JSON.stringify({ auto_install: true, enabled: desired }),
    });
  } else {
    await api.makeRequest(`/accounts/${account}/rum/site_info`, {
      method: 'POST',
      body: JSON.stringify({ zone_tag: zoneId, host: zoneDomain, auto_install: true }),
    });
  }
  console.log(`      ${chalk.green('✓')} Web Analytics ${action}d: ${chalk.cyan(zoneDomain)} (${chalk.cyan(desired ? 'enabled' : 'disabled')})`);

  return { output: { webAnalytics: { updated: true, action } } };
}

module.exports = async function ensureWebAnalytics(context) {
  const gated = zoneGate(context, 'webAnalytics');
  if (gated) return gated;

  const account = await resolveAccountId(context);

  try {
    return await reconcile(context, account);
  } catch (error) {
    if (!isForbidden(error)) throw error;
    console.log(`      ${chalk.yellow('⚠')} ${PERMISSION_REASON}`);
    return { status: 'warned', reason: PERMISSION_REASON, output: { webAnalytics: { error: error.message } } };
  }
};
