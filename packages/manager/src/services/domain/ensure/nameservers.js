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

module.exports = async function ensureNameservers(context) {
  const { cloudflareApi, namecheapApi, domain, provider, options = {} } = context;

  // === READ: Cloudflare's assigned nameservers ===
  const zone = await cloudflareApi.getZoneByName(domain);

  if (!zone) {
    console.log(`      ${chalk.yellow('⚠')} No Cloudflare zone found for ${chalk.cyan(domain)} — rerun once the cloudflare service creates it`);
    return { status: 'warned', output: { nameservers: { note: 'no Cloudflare zone found' } } };
  }

  const required = [...(zone.name_servers || [])].sort();

  if (required.length === 0) {
    console.log(`      ${chalk.yellow('⚠')} Zone exists but has no assigned nameservers yet (still initializing) — rerun`);
    return { status: 'warned', output: { nameservers: { note: 'zone has no assigned nameservers yet' } } };
  }

  console.log(`      ${chalk.dim('→')} Cloudflare nameservers: ${required.map((ns) => chalk.cyan(ns)).join(', ')}`);

  if (provider === 'namecheap') {
    return await ensureNamecheap(domain, required, namecheapApi, options);
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

  return { status: 'warned', output: { nameservers: { manual: true, provider, required } } };
};

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
    return { status: 'warned', output: { nameservers: { error: error.message } } };
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
    console.log(`      ${chalk.dim('⊘ Dry run — would set Cloudflare nameservers at Namecheap')}`);
    return { output: { nameservers: { planned: 'update', current: currentNs, required } } };
  }

  console.log(`      ${chalk.dim('→')} Setting Cloudflare nameservers at Namecheap...`);

  await api.setCustomNameservers(sld, tld, required);

  console.log(`      ${chalk.green('✓')} Nameservers updated at Namecheap → Cloudflare`);

  return { output: { nameservers: { updated: true, previous: currentNs } } };
}
