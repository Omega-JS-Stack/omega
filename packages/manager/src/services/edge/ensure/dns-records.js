/**
 * Ensure DNS records match `edge.providers.cloudflare.dns` plus the platform record set
 * (GitHub Pages, www, email-provider MX/SPF, DMARC; BIMI/SendGrid only when
 * configured — see lib/dns-records-helpers.js).
 *
 * Subdomain projects only touch records belonging to the subdomain (apex
 * records are owned by the parent brand).
 *
 * One record's desired shape is not config at all: `emailurl.<domain>` is
 * proxied only once SendGrid has VALIDATED the branded link, so this handler
 * asks SendGrid before it diffs ([#646]).
 */
const chalk = require('chalk').default;
const { pollWithSpinner } = require('@omega.js/devkit/flows');
const { cacheRead } = require('../lib/read-cache.js');
const { getZoneId, zoneGate } = require('../lib/ruleset-helper.js');
const { diffRecords } = require('../lib/dns-records-helpers.js');
const { SendGridAPI } = require('../../campaigns/lib/sendgrid-api.js');
const { canPrompt, dryRunPlan } = require('../../../lib/run-gates.js');

const LINK_BRANDING_PENDING_REASON = 'SendGrid has not validated the branded link — the emailurl CNAME stays unproxied';

module.exports = async function ensureDnsRecords(context) {
  const { cloudflareApi: api, brandRoot, brandConfig, domain, isSubdomainProject, options = {} } = context;
  const zoneId = getZoneId(context);
  const gated = zoneGate(context, 'dnsRecords');
  if (gated) return gated;

  // === READ ===
  const data = await api.makeRequest(`/zones/${zoneId}/dns_records`);
  const records = data.result;
  console.log(`      ${chalk.green('✓')} Read ${chalk.dim(`(${records.length} items)`)}`);
  cacheRead(brandRoot, 'dns-records', { count: records.length, records });

  // === DIFF ===
  const { valid: linkBrandingValid, pending: linkBrandingPending } = await resolveLinkBranding(context);
  const diff = diffRecords({ records, brandConfig, domain, isSubdomainProject, linkBrandingValid });
  if (!diff) {
    console.log(`      ${chalk.dim('⊘ No changes needed')}`);
    if (linkBrandingPending) {
      return { status: 'warned', reason: LINK_BRANDING_PENDING_REASON };
    }
    return;
  }

  if (options.dryRun) {
    dryRunPlan(`create ${diff.toCreate.length}, update ${diff.toUpdate.length}, delete ${diff.toDelete.length}`);
    return {
      status: 'success',
      output: { dns: { planned: { create: diff.toCreate.length, update: diff.toUpdate.length, delete: diff.toDelete.length } } },
    };
  }

  // === WRITE ===
  const output = { created: [], updated: [], deleted: [], errors: [] };

  for (const record of diff.toCreate) {
    try {
      await api.makeRequest(`/zones/${zoneId}/dns_records`, {
        method: 'POST',
        body: JSON.stringify({
          type: record.type,
          name: record.name,
          content: record.content,
          ttl: record.ttl || 1,
          proxied: record.proxied ?? false,
          priority: record.priority,
          comment: record.comment,
        }),
      });
      output.created.push({ name: record.name, type: record.type });
      console.log(`      ${chalk.green('✓')} Created ${chalk.cyan(`${record.type} ${record.name}`)}`);
    } catch (error) {
      output.errors.push({ name: record.name, type: record.type, error: error.message });
      console.error(`      ${chalk.red('✗')} Failed to create ${chalk.cyan(`${record.type} ${record.name}`)}${chalk.dim(`: ${error.message}`)}`);
    }
  }

  for (const record of diff.toUpdate) {
    try {
      await api.makeRequest(`/zones/${zoneId}/dns_records/${record.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          type: record.type,
          name: record.name,
          content: record.content,
          ttl: record.ttl,
          proxied: record.proxied,
          comment: record.comment,
          priority: record.priority,
        }),
      });
      output.updated.push({ name: record.name, type: record.type });
      console.log(`      ${chalk.green('✓')} Updated ${chalk.cyan(`${record.type} ${record.name}`)}`);
    } catch (error) {
      output.errors.push({ name: record.name, type: record.type, error: error.message });
      console.error(`      ${chalk.red('✗')} Failed to update ${chalk.cyan(`${record.type} ${record.name}`)}${chalk.dim(`: ${error.message}`)}`);
    }
  }

  for (const record of diff.toDelete) {
    try {
      await api.makeRequest(`/zones/${zoneId}/dns_records/${record.id}`, { method: 'DELETE' });
      output.deleted.push({ name: record.name, type: record.type, content: record.content });
      console.log(`      ${chalk.green('✓')} Deleted ${chalk.cyan(`${record.type} ${record.name}`)} (${chalk.dim(record.content)})`);
    } catch (error) {
      output.errors.push({ name: record.name, type: record.type, error: error.message });
      console.error(`      ${chalk.red('✗')} Failed to delete ${chalk.cyan(`${record.type} ${record.name}`)}${chalk.dim(`: ${error.message}`)}`);
    }
  }

  const parts = [];
  if (output.created.length > 0) parts.push(`${chalk.bold(output.created.length)} created`);
  if (output.updated.length > 0) parts.push(`${chalk.bold(output.updated.length)} updated`);
  if (output.deleted.length > 0) parts.push(`${chalk.bold(output.deleted.length)} deleted`);
  if (output.errors.length > 0) parts.push(`${chalk.bold(output.errors.length)} errors`);
  if (parts.length > 0) {
    console.log(`      Summary: ${parts.join(', ')}`);
  }

  const reasons = [];
  if (output.errors.length > 0) {
    reasons.push(`${output.errors.length} record(s) failed: ${output.errors.map((e) => e.name).join(', ')}`);
  }
  if (linkBrandingPending) {
    reasons.push(LINK_BRANDING_PENDING_REASON);
  }

  return {
    status: reasons.length > 0 ? 'warned' : 'success',
    ...(reasons.length > 0 ? { reason: reasons.join('; ') } : {}),
    output: { dns: output },
  };
};

/**
 * Has SendGrid VALIDATED the branded link host for this brand's domain?
 *
 * SendGrid validates `emailurl.<domain>` by resolving it as a CNAME to
 * sendgrid.net, and a Cloudflare-proxied record answers with the edge's own
 * addresses instead — so proxying it BEFORE validation locks the branding out
 * of ever validating, and every emailed link stays broken. This is the read
 * that keeps the flip in order: grey-cloud until `GET /v3/whitelabel/links`
 * reports `valid: true` for the host
 * ([#646](https://github.com/Omega-JS-Stack/omega/issues/646)).
 *
 * An interactive run WAITS for that answer rather than leaving the flip to a
 * later walk ([#662](https://github.com/Omega-JS-Stack/omega/issues/662)):
 * `pollWithSpinner` re-asks SendGrid until the branding validates and the
 * diff below proxies the CNAME in this same walk. Skipping the wait (or a
 * non-interactive run) keeps the record grey and the rerun message.
 *
 * No API key, no entry, or an unreachable SendGrid all answer NO: the
 * unproxied record is the safe half of the pair (a plain-HTTP hop, which is
 * where every brand already is), while a wrong YES is unrecoverable without a
 * hand edit.
 *
 * @param {object} context - The service context (tests inject `sendgridApi`)
 * @returns {Promise<{ valid: boolean, pending: boolean }>} - `pending` is a
 *   configured branding that did not validate: the warned reason's condition.
 */
async function resolveLinkBranding(context) {
  const { brandConfig, domain, isSubdomainProject, options = {} } = context;
  const sendgrid = brandConfig?.edge?.providers?.cloudflare?.dns?.sendgrid;

  // No SendGrid records to gate: none configured, or a subdomain project, whose
  // record set stops at the GitHub Pages pair (the apex belongs to the parent).
  if (isSubdomainProject || !sendgrid?.id || !sendgrid?.whitelabel) {
    return { valid: false, pending: false };
  }

  const api = context.sendgridApi || (process.env.SENDGRID_API_KEY ? new SendGridAPI() : null);
  const host = `emailurl.${domain}`;

  let valid = api ? await isBrandedLinkValid(api, host, true) : false;

  // Wait it out: SendGrid validates minutes after the CNAME lands, and the
  // proxy flip belongs to THIS walk (#662). Ticks stay quiet — the first read
  // already reported an unreachable API.
  if (!valid && api && canPrompt(options)) {
    const result = await pollWithSpinner({
      check: async () => (await isBrandedLinkValid(api, host) ? { done: true } : { done: false }),
      intervalMs: 10000,
      message: `Waiting for SendGrid to validate ${host}`,
      indent: '      ',
    });
    valid = result.success;
  }

  if (!valid) {
    console.log(`      ${chalk.yellow('⚠')} ${chalk.cyan(`CNAME ${host}`)} stays unproxied — SendGrid has not validated the branded link${api ? '' : ' (no SENDGRID_API_KEY)'}. Rerun ${chalk.cyan('omega manage')} once it has, and the record flips to proxied so emailed links land on HTTPS.`);
  }

  return { valid, pending: !valid };
}

/**
 * One read of SendGrid's branded-link list: is `host` validated?
 *
 * @param {object} api - The SendGrid client
 * @param {string} host - The branded link host (`emailurl.<domain>`)
 * @param {boolean} [logError] - Report an unreachable API (the first read only)
 * @returns {Promise<boolean>}
 */
async function isBrandedLinkValid(api, host, logError = false) {
  try {
    const links = await api.getBrandedLinks();
    const branding = (links || []).find((link) => `${link.subdomain}.${link.domain}`.toLowerCase() === host.toLowerCase());
    return branding?.valid === true;
  } catch (error) {
    if (logError) {
      console.log(`      ${chalk.yellow('⚠')} Could not read SendGrid link branding${chalk.dim(`: ${error.message}`)}`);
    }
    return false;
  }
}
