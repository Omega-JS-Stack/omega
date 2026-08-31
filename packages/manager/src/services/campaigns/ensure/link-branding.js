/**
 * Ensure SendGrid link branding for the brand's domain — the `emailurl.`
 * host every transactional link is rewritten through.
 *
 * A valid branding is converged proof. A missing one is created in one pass,
 * exactly like its domain-auth sibling: brand the links in SendGrid (two
 * CNAMEs), diff-sync those records into the Cloudflare apex zone UNPROXIED,
 * then validate — interactive runs poll until SendGrid confirms;
 * non-interactive/dry runs validate ONCE, report warned, and the rerun
 * converges.
 *
 * The records are written HERE and not left to the edge service: on a fresh
 * brand's FIRST walk, edge's live SendGrid read finds no authenticated domain
 * at all, so it writes none of the SendGrid set — and a branding with no CNAME
 * behind it can never validate.
 *
 * Once SendGrid says valid, the record may finally ride Cloudflare's proxy —
 * so this operation patches it to proxied on the spot instead of leaving the
 * flip to a later walk ([#693](https://github.com/Omega-JS-Stack/omega/issues/693)).
 */
const chalk = require('chalk').default;
const { pollWithSpinner } = require('@omega.js/devkit/flows');
const { canPrompt, dryRunPlan } = require('../../../lib/run-gates.js');
const { syncDnsRecords, manualRecordList } = require('../lib/dns-sync.js');

// MUST match the name the edge record set builds (`emailurl.<domain>` in
// services/edge/lib/dns-records-helpers.js) — the branding SendGrid validates
// and the CNAME Cloudflare serves are the same host or neither works.
const SUBDOMAIN = 'emailurl';

// The record set SendGrid returns for a branded link
const DNS_KEYS = ['domain_cname', 'owner_cname'];

module.exports = async function ensureLinkBranding(context) {
  const { sendgridApi: api, cloudflareApi, domain, apexDomain, isSubdomainProject, options = {} } = context;

  // A subdomain project owns no apex records — the parent brand's walk does,
  // which is why the edge service skips the whole SendGrid set for one. A
  // branding created here would wait forever on CNAMEs this brand never writes.
  if (isSubdomainProject) {
    console.log(`      ${chalk.dim(`⊘ Subdomain project — the parent brand owns the link branding for ${apexDomain}`)}`);
    return;
  }

  const host = `${SUBDOMAIN}.${domain}`;

  // === READ: is the host already branded and valid? ===
  const links = await api.getBrandedLinks();
  let branding = findBranding(links, host);

  if (branding?.valid) {
    console.log(`      ${chalk.green('✓')} Link branding ${chalk.cyan(host)} validated`);
    // Catch-up flip only: a branding THIS run did not validate is the edge
    // service's to reconcile (its live read already desired the record
    // proxied), so a grey record here is a raced walk, not a pending step —
    // patch it when Cloudflare is reachable, and never warn about it.
    if (cloudflareApi) {
      await proxyRecord(cloudflareApi, apexDomain, host);
    }
    return { output: { linkBranding: { id: branding.id, valid: true } } };
  }

  if (options.dryRun) {
    const planned = branding ? ['dns-records', 'validate', 'proxy-record'] : ['brand-links', 'dns-records', 'validate', 'proxy-record'];
    return dryRunPlan(`${planned.join(' → ')}`, { output: { linkBranding: { planned } } });
  }

  // === Create the branding when missing ===
  if (!branding) {
    branding = await api.createBrandedLink(domain, SUBDOMAIN);
    console.log(`      ${chalk.green('✓')} Created link branding for ${chalk.cyan(host)}`);
  } else {
    console.log(`      ${chalk.yellow('↻')} Link branding ${chalk.cyan(host)} exists but is not validated — reconciling DNS`);
  }

  const records = DNS_KEYS
    .map((key) => ({ key, record: branding.dns?.[key] }))
    .filter(({ record }) => record);

  if (records.length === 0) {
    throw new Error('SendGrid returned no DNS records for the link branding');
  }

  // === DNS via Cloudflare (or manual guidance) ===
  // Written UNPROXIED, which is the only state SendGrid can validate: it
  // resolves the host as a plain CNAME to sendgrid.net, and a proxied record
  // answers with Cloudflare's own addresses instead.
  const synced = await syncDnsRecords(cloudflareApi, apexDomain, records);

  // === Validate — DNS may need a minute; interactive runs wait it out ===
  const isValid = (validation) => validation?.valid === true;

  let valid = isValid(await api.validateBrandedLink(branding.id));

  if (!valid && canPrompt(options)) {
    const result = await pollWithSpinner({
      check: async () => {
        try {
          return isValid(await api.validateBrandedLink(branding.id)) ? { done: true } : { done: false };
        } catch {
          return { done: false };
        }
      },
      intervalMs: 10000,
      message: `Validating link branding (waiting for SendGrid to resolve ${host})`,
      indent: '      ',
    });
    valid = result.success;
  }

  if (!valid) {
    console.log(`      ${chalk.yellow('⚠')} Validation pending — DNS is likely still propagating, rerun in a few minutes`);
    return {
      status: 'warned',
      reason: 'link branding validation pending — the emailurl CNAME stays unproxied',
      output: { linkBranding: { id: branding.id, valid: false, ...(synced ? {} : { manualRecords: manualRecordList(records) }) } },
    };
  }

  console.log(`      ${chalk.green('✓')} Link branding ${chalk.cyan(host)} validated`);

  // === The flip: a validated branding may ride Cloudflare's proxy ===
  // Edge stays the reconciler — its next live read sees `valid: true` and
  // DESIRES the record proxied, so both services agree on the same state and
  // the rerun is a no-op either way.
  const proxied = await proxyRecord(cloudflareApi, apexDomain, host);

  if (!proxied) {
    return {
      status: 'warned',
      reason: 'link branding validated but the emailurl CNAME could not be proxied',
      output: { linkBranding: { id: branding.id, valid: true, proxied: false } },
    };
  }

  return { output: { linkBranding: { id: branding.id, valid: true, proxied: true } } };
};

/** The account's branding entry for this host (ids are account-scoped). */
function findBranding(links, host) {
  return (links || []).find((link) => `${link.subdomain}.${link.domain}`.toLowerCase() === host.toLowerCase()) || null;
}

/**
 * Patch the branded-link CNAME to proxied.
 *
 * @returns {boolean} - true when the record rides the proxy, false when the
 *   manual line was printed instead
 */
async function proxyRecord(cloudflareApi, apexDomain, host) {
  if (!cloudflareApi) {
    logManualFlip('No CLOUDFLARE_TOKEN', host);
    return false;
  }

  const zone = await cloudflareApi.getZoneByName(apexDomain);
  if (!zone) {
    logManualFlip(`No Cloudflare zone for ${apexDomain}`, host);
    return false;
  }

  const existing = await cloudflareApi.makeRequest(`/zones/${zone.id}/dns_records?type=CNAME&per_page=100`, { method: 'GET' });
  const match = (existing.result || []).find((r) => r.type === 'CNAME' && r.name === host);

  // The DNS sync above writes this record, so reaching here means the zone
  // answered without it (a hand-deleted record, or a read that raced a write).
  if (!match) {
    console.log(`      ${chalk.yellow('⚠')} No ${chalk.cyan(`CNAME ${host}`)} record in the zone — add ${chalk.cyan(`${host} → sendgrid.net`)} first, then rerun ${chalk.cyan('omega manage')} and it flips to proxied.`);
    return false;
  }

  if (match.proxied === true) {
    console.log(`      ${chalk.dim('→')} ${chalk.cyan(host)} already proxied`);
    return true;
  }

  await cloudflareApi.makeRequest(`/zones/${zone.id}/dns_records/${match.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ type: 'CNAME', name: host, content: match.content, ttl: 1, proxied: true, comment: match.comment }),
  });
  console.log(`      ${chalk.green('✓')} Proxied ${chalk.cyan(host)} — emailed links now land on HTTPS`);
  return true;
}

function logManualFlip(why, host) {
  console.log(`      ${chalk.yellow('⚠')} ${why} — turn the proxy ON for ${chalk.cyan(`CNAME ${host}`)} manually (orange cloud), or rerun ${chalk.cyan('omega manage')} once Cloudflare is reachable.`);
}
