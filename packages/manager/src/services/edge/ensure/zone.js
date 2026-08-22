/**
 * Ensure the zone exists in Cloudflare.
 *
 * Creates the zone when missing — for subdomain projects that means the
 * PARENT zone (playground.omegajs.dev → creates omegajs.dev): the zone is
 * a prerequisite resource the brand's records live in, and creating it is
 * inert until the registrar's nameservers point at it (which the domain
 * service automates for API registrars, right after this service). A
 * pending zone reports its nameservers; when the registrar is a manual
 * one, interactive runs open its nameserver page and poll until the zone
 * activates. Non-interactive/dry runs just report — a later run picks the
 * zone up once it activates.
 *
 * The resolved id goes two places: `state: { zoneId }` for the later
 * operations in THIS run (they read it via getZoneId), and CONFIG, at
 * `edge.providers.cloudflare.zone` (#434) — the id `omega purge` targets
 * from a build, where no Cloudflare token is in play. The resolved value
 * always wins: a stale hand-set id is drift and gets patched.
 */
const chalk = require('chalk').default;
const { openBrowserAndPoll, pollWithSpinner } = require('@omega.js/devkit/flows');
const { cacheRead } = require('../lib/read-cache.js');
const { API_PROVIDERS, REGISTRAR_NAMESERVER_URLS, resolveRegistrar } = require('../../domain/lib/registrars.js');
const { writeBrandConfig } = require('../../../lib/config-write.js');
const { canPrompt, dryRunPlan } = require('../../../lib/run-gates.js');

const CONFIG_PATH = 'edge.providers.cloudflare.zone';

/**
 * Land the resolved zone id in omega.json5 (drift-gated) and hand back the
 * within-run carry every later operation reads.
 *
 * @param {Object} context - Handler context
 * @param {Object} zone - The resolved Cloudflare zone
 * @returns {Object} The handler's `state` block
 */
function landZoneId(context, zone) {
  if (context.brandConfig.edge?.providers?.cloudflare?.zone !== zone.id) {
    writeBrandConfig(context, { [CONFIG_PATH]: zone.id });
  }

  return { zoneId: zone.id };
}

function reportPending(zone) {
  console.log(`      ${chalk.yellow('⚠')} Zone pending — set these nameservers at your domain registrar:`);
  for (const ns of zone.name_servers || []) {
    console.log(`        ${chalk.cyan(ns)}`);
  }
}

/**
 * Interactive wait for a pending zone: opens the registrar's nameserver page
 * (when domain.providers names one with a known dashboard) and re-reads the
 * zone until Cloudflare reports it active.
 *
 * @returns {Object|null} - The active zone, or null (deferred/skipped —
 *   the caller returns its pending shape)
 */
async function waitForActiveZone(context, zone) {
  const { cloudflareApi: api, brandConfig, zoneDomain, options = {} } = context;
  const provider = resolveRegistrar(brandConfig);

  // API registrars: the domain service sets the nameservers right after this
  // service. No provider yet: nothing to open (fresh brand). Non-interactive
  // and dry runs never sit in a poll.
  if (!canPrompt(options) || !provider || API_PROVIDERS.has(provider)) {
    console.log(`      ${chalk.dim('Rerun after the nameservers propagate (the domain service automates this for API registrars).')}`);
    return null;
  }

  const check = async () => {
    const fresh = (await api.makeRequest(`/zones/${zone.id}`)).result;
    return fresh.status === 'active' ? { done: true, result: fresh } : { done: false };
  };

  // provider is user config — unknown registrars poll without a browser step
  const registrarUrl = REGISTRAR_NAMESERVER_URLS[provider]?.(zoneDomain);
  const result = registrarUrl
    ? await openBrowserAndPoll({
      url: registrarUrl,
      label: `the ${provider} nameserver settings`,
      promptMessage: `Set the nameservers above at ${provider}.`,
      waitMessage: 'Checking nameservers',
      check,
      intervalMs: 10000,
      indent: '      ',
    })
    : await pollWithSpinner({
      check,
      intervalMs: 10000,
      message: 'Checking nameservers',
      indent: '      ',
    });

  if (result.success) {
    console.log(`      ${chalk.green('✓')} Nameservers configured — zone is active`);
    return result.result;
  }

  console.log(`      ${chalk.dim('⊘ Zone still pending — rerun to check again later')}`);
  return null;
}

module.exports = async function ensureZone(context) {
  const { cloudflareApi: api, brandRoot, zoneDomain, isSubdomainProject, options = {} } = context;

  // === READ ===
  const accounts = await api.makeRequest('/accounts');
  if (!accounts.result || accounts.result.length === 0) {
    throw new Error('No Cloudflare account found for this token');
  }
  const accountId = accounts.result[0].id;

  const allZones = await api.getAllZones();
  let zone = allZones.find((z) => z.name === zoneDomain);
  cacheRead(brandRoot, 'zone', { accountId, zone: zone || null });

  if (zone) {
    console.log(`      ${chalk.green('✓')} Zone exists: ${chalk.cyan(zoneDomain)} ${chalk.dim(`(${zone.status})`)}`);
    console.log(`      ${chalk.dim(`Dashboard: https://dash.cloudflare.com/${accountId}/${zoneDomain}`)}`);

    if (zone.status === 'pending' && !isSubdomainProject) {
      reportPending(zone);
      const activeZone = await waitForActiveZone(context, zone);
      if (!activeZone) {
        return {
          state: landZoneId(context, zone),
          output: { zone: { status: 'pending', nameservers: zone.name_servers } },
        };
      }
      zone = activeZone;
    }

    return {
      state: landZoneId(context, zone),
      output: { zone: { status: zone.status } },
    };
  }

  // === WRITE: create the zone (the PARENT zone for subdomain projects —
  // inert until the registrar points at it, so records under the subdomain
  // can land in the same run) ===
  if (isSubdomainProject) {
    console.log(`      ${chalk.yellow('⚠')} Parent zone ${chalk.cyan(zoneDomain)} not in Cloudflare yet — creating it (subdomain project)`);
  }

  if (options.dryRun) {
    return dryRunPlan(`add zone ${zoneDomain} to Cloudflare`, { status: 'success', output: { zone: { planned: 'create' } } });
  }

  console.log(`      Adding zone ${chalk.cyan(zoneDomain)} to Cloudflare...`);

  const response = await api.makeRequest('/zones', {
    method: 'POST',
    body: JSON.stringify({
      account: { id: accountId },
      name: zoneDomain,
      type: 'full',
    }),
  });

  zone = response.result;

  console.log(`      ${chalk.green('✓')} Zone added ${chalk.dim(`(${zone.id})`)}`);

  if (zone.status === 'pending') {
    reportPending(zone);
    const activeZone = await waitForActiveZone(context, zone);
    if (!activeZone) {
      return {
        state: landZoneId(context, zone),
        output: { zone: { created: true, status: 'pending', nameservers: zone.name_servers } },
      };
    }
    zone = activeZone;
  }

  return {
    state: landZoneId(context, zone),
    output: { zone: { created: true, status: zone.status } },
  };
};
