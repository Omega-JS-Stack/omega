/**
 * Ensure the registrar's nameservers point to Cloudflare.
 *
 * Flow:
 * 1. Fetch the Cloudflare zone to get its assigned nameservers
 * 2. namecheap: read current nameservers via API, set them when mismatched
 * 3. manual registrars: an active zone proves they're already set (success);
 *    a pending zone prints the values to set and returns warned
 *
 * omega-manager split SLD/TLD by popping the last dot-label, which breaks
 * multi-part TLDs (mybrand.co.uk → SLD "mybrand.co", TLD "uk"); this port
 * uses the public suffix list instead.
 */
const chalk = require('chalk').default;
const psl = require('psl');
const { pollWithSpinner } = require('@omega.js/devkit/flows');
const { canPrompt, dryRunPlan } = require('../../../lib/run-gates.js');

// A freshly created zone gets its nameservers within seconds; a zone still
// bare after this many reads is not going to fill in while we watch (#662).
const ZONE_NS_READS = 6;
const ZONE_NS_INTERVAL_MS = 5000;

module.exports = async function ensureNameservers(context) {
  const { cloudflareApi, namecheapApi, domain, provider, options = {} } = context;

  // Nameservers live at the REGISTRABLE domain — for subdomain projects
  // (playground.omegajs.dev) that's the parent (omegajs.dev): the zone the
  // cloudflare service manages, and the domain the registrar actually holds.
  const zoneName = psl.get(domain) || domain;
  if (zoneName !== domain) {
    console.log(`      ${chalk.dim(`Subdomain project — managing nameservers for parent ${zoneName}`)}`);
  }

  // === READ: Cloudflare's assigned nameservers ===
  let zone = await cloudflareApi.getZoneByName(zoneName);

  if (!zone) {
    console.log(`      ${chalk.yellow('⚠')} No Cloudflare zone found for ${chalk.cyan(zoneName)} — rerun once the cloudflare service creates it`);
    return { status: 'warned', reason: 'no Cloudflare zone found for the zone', output: { nameservers: { note: 'no Cloudflare zone found' } } };
  }

  // A zone created earlier in THIS walk (the edge service) may still be
  // initializing — wait for its nameservers instead of leaving the registrar
  // to a second run (#662). Bounded: the poll gives up on its own.
  if ((zone.name_servers || []).length === 0 && canPrompt(options)) {
    zone = await waitForAssignedNameservers(cloudflareApi, zoneName, zone);
  }

  const required = [...(zone.name_servers || [])].sort();

  if (required.length === 0) {
    console.log(`      ${chalk.yellow('⚠')} Zone exists but has no assigned nameservers yet (still initializing) — rerun`);
    return { status: 'warned', reason: 'the zone has no assigned nameservers yet', output: { nameservers: { note: 'zone has no assigned nameservers yet' } } };
  }

  console.log(`      ${chalk.dim('→')} Cloudflare nameservers: ${required.map((ns) => chalk.cyan(ns)).join(', ')}`);

  if (provider === 'namecheap') {
    return await ensureNamecheap(zoneName, required, namecheapApi, options);
  }

  // === Manual registrars — no read API, but the zone status is proof enough:
  // an active zone means the nameservers already point to Cloudflare
  if (zone.status === 'active') {
    console.log(`      ${chalk.green('✓')} Zone is active — nameservers already pointing to Cloudflare`);
    return { output: { nameservers: { alreadySet: true } } };
  }

  console.log(`      ${chalk.yellow('⚠')} ${provider} requires manual nameserver configuration`);
  console.log(`      Set these nameservers at your registrar:`);
  for (const ns of required) {
    console.log(`        ${chalk.cyan(ns)}`);
  }

  return { status: 'warned', reason: `${provider} requires manual nameserver configuration`, output: { nameservers: { manual: true, provider, required } } };
};

/**
 * Re-read the zone until Cloudflare has assigned its nameservers, bounded to
 * ZONE_NS_READS attempts (ENTER checks now, `s` skips).
 *
 * @returns {Promise<object>} - The zone: the assigned one, or the bare zone
 *   handed in when the wait ran out or was skipped.
 */
async function waitForAssignedNameservers(api, zoneName, zone) {
  let reads = 0;
  let assigned = null;

  const result = await pollWithSpinner({
    check: async () => {
      reads += 1;
      const fresh = await api.getZoneByName(zoneName);
      if ((fresh?.name_servers || []).length > 0) {
        assigned = fresh;
        return { done: true };
      }
      return reads >= ZONE_NS_READS ? { done: true, error: 'still initializing' } : { done: false };
    },
    intervalMs: ZONE_NS_INTERVAL_MS,
    message: `Waiting for Cloudflare to assign nameservers for ${zoneName}`,
    indent: '      ',
  });

  return result.success && assigned ? assigned : zone;
}

async function ensureNamecheap(domain, required, api, options) {
  const { sld, tld } = psl.parse(domain);

  // Read current nameservers. Fails for domains not in the Namecheap account
  // (e.g. not purchased yet) — warn instead of failing the brand.
  console.log(`      ${chalk.dim('→')} Checking current nameservers at Namecheap...`);
  let current;
  try {
    current = await api.getDns(sld, tld);
  } catch (error) {
    console.log(`      ${chalk.yellow('⚠')} Could not read nameservers at Namecheap${chalk.dim(`: ${error.message}`)}`);
    console.log(`      ${chalk.dim('→')} Domain not in your Namecheap account yet (not purchased?). Rerun after purchase.`);
    return { status: 'warned', reason: 'could not read the nameservers at Namecheap', output: { nameservers: { error: error.message } } };
  }

  const currentNs = [...current.nameservers].sort();
  const alreadySet = required.length === currentNs.length
    && required.every((ns, i) => ns === currentNs[i]);

  if (alreadySet) {
    console.log(`      ${chalk.green('✓')} Nameservers already pointing to Cloudflare`);
    return { output: { nameservers: { alreadySet: true } } };
  }

  console.log(`      ${chalk.dim('→')} Current: ${currentNs.join(', ') || '(default/none)'}`);

  // === WRITE ===
  if (options.dryRun) {
    return dryRunPlan('set Cloudflare nameservers at Namecheap', { output: { nameservers: { planned: 'update', current: currentNs, required } } });
  }

  console.log(`      ${chalk.dim('→')} Setting Cloudflare nameservers at Namecheap...`);

  await api.setCustomNameservers(sld, tld, required);

  console.log(`      ${chalk.green('✓')} Nameservers updated at Namecheap → Cloudflare`);

  return { output: { nameservers: { updated: true, previous: currentNs } } };
}
