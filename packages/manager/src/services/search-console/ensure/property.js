/**
 * Ensure the domain property (`sc-domain:{domain}`) exists in Search Console.
 *
 * An existing property is converged proof — nothing else to check. A missing
 * one is created in one pass: fetch the DNS_TXT verification token (idempotent
 * — Google returns the same token until it's used), write the TXT record via
 * Cloudflare (stale google-site-verification records at the same name are
 * replaced), then attempt verification ONCE — DNS still propagating reports
 * warned and the rerun converges (omega-manager span an interactive
 * poll-with-spinner here).
 */
const chalk = require('chalk').default;

module.exports = async function ensureProperty(context) {
  const { searchConsoleApi: api, cloudflareApi, domain, apexDomain, propertyUrl, options = {} } = context;

  // === READ: does the domain property already exist? ===
  const sites = await api.listSites();
  const existing = sites.find((site) => site.siteUrl === propertyUrl);

  if (existing) {
    console.log(`      ${chalk.green('✓')} Domain property exists (${chalk.cyan(existing.permissionLevel)})`);
    return { state: { propertyUrl, permissionLevel: existing.permissionLevel } };
  }

  console.log(`      ${chalk.dim('→')} Domain property ${chalk.cyan(propertyUrl)} does not exist yet`);

  if (options.dryRun) {
    console.log(`      ${chalk.dim('⊘ Dry run — would verify the domain (DNS TXT) and add the property')}`);
    return { output: { property: { planned: 'verify-and-add' } } };
  }

  // === Verification token (same token returned until verification succeeds) ===
  const tokenResponse = await api.getVerificationToken(domain, 'DNS_TXT', 'INET_DOMAIN');
  if (!tokenResponse.token) {
    throw new Error('No verification token received from Google Site Verification');
  }
  const token = tokenResponse.token;

  // === TXT record via Cloudflare ===
  // The record lives at the property's own name (apex '@', or the subdomain
  // label for subdomain brands) in the APEX zone
  const recordName = domain === apexDomain ? '@' : domain.replace(`.${apexDomain}`, '');
  const recordFqdn = domain;

  if (!cloudflareApi) {
    console.log(`      ${chalk.yellow('⚠')} No CLOUDFLARE_TOKEN — add this TXT record manually, then rerun:`);
    console.log(`        ${chalk.cyan(recordFqdn)}  TXT  ${chalk.cyan(`"${token}"`)}`);
    return { status: 'warned', output: { property: { manualRecord: { name: recordFqdn, type: 'TXT', content: token } } } };
  }

  const zone = await cloudflareApi.getZoneByName(apexDomain);
  if (!zone) {
    console.log(`      ${chalk.yellow('⚠')} No Cloudflare zone for ${chalk.cyan(apexDomain)} — rerun once the cloudflare service creates it`);
    return { status: 'warned', output: { property: { note: 'no Cloudflare zone yet' } } };
  }

  const records = await cloudflareApi.makeRequest(`/zones/${zone.id}/dns_records?type=TXT&per_page=100`, { method: 'GET' });
  const atName = (records.result || []).filter((r) => r.type === 'TXT' && r.name === recordFqdn);
  const tokenRecord = atName.find((r) => r.content === token || r.content === `"${token}"`);

  if (tokenRecord) {
    console.log(`      ${chalk.dim('→')} Verification TXT record already in place`);
  } else {
    // Stale tokens from older verification attempts just add confusion —
    // replace them (only google-site-verification records are touched)
    for (const stale of atName.filter((r) => r.content.includes('google-site-verification'))) {
      await cloudflareApi.makeRequest(`/zones/${zone.id}/dns_records/${stale.id}`, { method: 'DELETE' });
      console.log(`      ${chalk.dim('↻')} Deleted stale verification record`);
    }

    await cloudflareApi.makeRequest(`/zones/${zone.id}/dns_records`, {
      method: 'POST',
      body: JSON.stringify({
        type: 'TXT',
        name: recordName,
        content: `"${token}"`,
        ttl: 60,
        comment: 'Google domain verification',
      }),
    });
    console.log(`      ${chalk.green('✓')} Verification TXT record added`);
  }

  // === Verify once — DNS may need a minute; the rerun converges ===
  try {
    await api.verifySite(domain, 'DNS_TXT', 'INET_DOMAIN');
    console.log(`      ${chalk.green('✓')} Domain verified`);
  } catch (error) {
    if (!error.message.includes('already verified') && !error.message.includes('already been verified')) {
      console.log(`      ${chalk.yellow('⚠')} Verification pending${chalk.dim(` (${error.message})`)} — DNS is likely still propagating, rerun in a few minutes`);
      return { status: 'warned', output: { property: { pendingVerification: true } } };
    }
  }

  // === Add the property ===
  try {
    await api.addSite(propertyUrl);
    console.log(`      ${chalk.green('✓')} Domain property added to Search Console`);
  } catch (error) {
    if (!error.message.includes('already exists')) {
      throw error;
    }
  }
  console.log(`      ${chalk.dim('→')} Dashboard: https://search.google.com/search-console?resource_id=${encodeURIComponent(propertyUrl)}`);

  return { state: { propertyUrl, verificationMethod: 'DNS_TXT' } };
};
