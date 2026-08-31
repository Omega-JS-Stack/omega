/**
 * Diff-sync a SendGrid record set into the brand's Cloudflare apex zone — the
 * ONE writer both whitelabel operations share (domain authentication's DKIM
 * CNAMEs, link branding's two link CNAMEs).
 *
 * Exact match = untouched, wrong content = patched, missing = created. Every
 * record lands UNPROXIED: SendGrid validates each of them by resolving the
 * host as a plain CNAME, and a proxied record answers with Cloudflare's own
 * addresses instead. No Cloudflare token (or no zone yet) prints the records
 * to add by hand, so a manual fix converges on the rerun.
 */
const chalk = require('chalk').default;

/**
 * @param {object|null} cloudflareApi - The Cloudflare client (null without a token)
 * @param {string} apexDomain - The zone the records belong to
 * @param {Array<{ key: string, record: object }>} records - SendGrid's own
 *   record set, each entry keyed by the name SendGrid gives it
 * @returns {Promise<boolean>} - true when records were written via Cloudflare,
 *   false when they were printed for manual addition
 */
async function syncDnsRecords(cloudflareApi, apexDomain, records) {
  if (!cloudflareApi) {
    console.log(`      ${chalk.yellow('⚠')} No CLOUDFLARE_TOKEN — add these records manually, then rerun:`);
    logManualRecords(records);
    return false;
  }

  const zone = await cloudflareApi.getZoneByName(apexDomain);
  if (!zone) {
    console.log(`      ${chalk.yellow('⚠')} No Cloudflare zone for ${chalk.cyan(apexDomain)} — add these records manually (or rerun once the cloudflare service creates the zone):`);
    logManualRecords(records);
    return false;
  }

  const existing = await cloudflareApi.makeRequest(`/zones/${zone.id}/dns_records?type=CNAME&per_page=100`, { method: 'GET' });
  const existingRecords = existing.result || [];

  for (const { key, record } of records) {
    const type = record.type.toUpperCase();
    const name = record.host;
    const content = record.data;

    const match = existingRecords.find((r) => r.type === type && r.name === name);

    if (match && match.content === content) {
      console.log(`      ${chalk.dim('→')} ${chalk.dim(key)}: ${chalk.cyan(name)} already in place`);
      continue;
    }

    if (match) {
      await cloudflareApi.makeRequest(`/zones/${zone.id}/dns_records/${match.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ type, name, content, ttl: 1, proxied: false }),
      });
      console.log(`      ${chalk.yellow('↻')} ${chalk.dim(key)}: updated ${chalk.cyan(name)}`);
      continue;
    }

    await cloudflareApi.makeRequest(`/zones/${zone.id}/dns_records`, {
      method: 'POST',
      body: JSON.stringify({ type, name, content, ttl: 1, proxied: false, comment: `SendGrid ${key}` }),
    });
    console.log(`      ${chalk.green('✓')} ${chalk.dim(key)}: created ${chalk.cyan(name)}`);
  }

  return true;
}

function logManualRecords(records) {
  for (const { record } of records) {
    console.log(`        ${chalk.cyan(record.type.toUpperCase())} ${record.host} → ${record.data}`);
  }
}

/** The manualRecords shape a warned return carries when nothing was written. */
function manualRecordList(records) {
  return records.map(({ record }) => ({ type: record.type.toUpperCase(), name: record.host, content: record.data }));
}

module.exports = { syncDnsRecords, manualRecordList };
