/**
 * Ensure the zone exists in Cloudflare.
 *
 * Creates the zone when missing (apex domains only — subdomain projects
 * require the parent zone to exist already). A pending zone reports its
 * nameservers and moves on: the domain service configures them at the
 * registrar when it ports (API providers), or a later run picks the zone up
 * once it activates. omega-manager's interactive browser-open + poll is next
 * up as a verification-poll adoption.
 *
 * State: { zoneId } — later operations in THIS run read it via getZoneId.
 */
const chalk = require('chalk').default;
const { cacheRead } = require('../lib/read-cache.js');

function reportPending(zone) {
  console.log(`      ${chalk.yellow('⚠')} Zone pending — set these nameservers at your domain registrar:`);
  for (const ns of zone.name_servers || []) {
    console.log(`        ${chalk.cyan(ns)}`);
  }
  console.log(`      ${chalk.dim('Rerun after the nameservers propagate (the domain service automates this for API registrars).')}`);
}

module.exports = async function ensureZone(context) {
  const { cloudflareApi: api, brandRoot, domain, zoneDomain, isSubdomainProject, options = {} } = context;

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
      return {
        state: { zoneId: zone.id },
        output: { zone: { status: 'pending', nameservers: zone.name_servers } },
      };
    }

    return {
      state: { zoneId: zone.id },
      output: { zone: { status: zone.status } },
    };
  }

  // For subdomain projects, the parent zone must already exist
  if (isSubdomainProject) {
    throw new Error(`Parent zone "${zoneDomain}" not found in Cloudflare. Add the parent domain first.`);
  }

  // === WRITE: create the zone ===
  if (options.dryRun) {
    console.log(`      ${chalk.dim(`⊘ Dry run — would add zone ${domain} to Cloudflare`)}`);
    return { status: 'success', output: { zone: { planned: 'create' } } };
  }

  console.log(`      Adding zone ${chalk.cyan(domain)} to Cloudflare...`);

  const response = await api.makeRequest('/zones', {
    method: 'POST',
    body: JSON.stringify({
      account: { id: accountId },
      name: domain,
      type: 'full',
    }),
  });

  zone = response.result;

  console.log(`      ${chalk.green('✓')} Zone added ${chalk.dim(`(${zone.id})`)}`);

  if (zone.status === 'pending') {
    reportPending(zone);
    return {
      state: { zoneId: zone.id },
      output: { zone: { created: true, status: 'pending', nameservers: zone.name_servers } },
    };
  }

  return {
    state: { zoneId: zone.id },
    output: { zone: { created: true, status: zone.status } },
  };
};
