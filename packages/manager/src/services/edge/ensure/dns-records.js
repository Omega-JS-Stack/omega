/**
 * Ensure DNS records match `edge.providers.cloudflare.dns` plus the platform record set
 * (GitHub Pages, www, email-provider MX/SPF, DMARC; BIMI only when
 * configured — see lib/dns-records-helpers.js).
 *
 * Subdomain projects only touch records belonging to the subdomain (apex
 * records are owned by the parent brand).
 *
 * The whole SendGrid set is not config at all — this handler asks SendGrid
 * before it diffs: `GET /v3/whitelabel/domains` for the `u<id>.<whitelabel>`
 * host the domain-auth records are built from ([#692]), and
 * `GET /v3/whitelabel/links` for whether `emailurl.<domain>` may be proxied
 * yet ([#646]).
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
  // Tests inject a fake client via context.sendgridApi
  const sendgridApi = context.sendgridApi || (process.env.SENDGRID_API_KEY ? new SendGridAPI() : null);
  const sendgrid = await resolveDomainAuth(context, sendgridApi);
  const { valid: linkBrandingValid, pending: linkBrandingPending } = await resolveLinkBranding(context, sendgridApi, sendgrid);
  const diff = diffRecords({ records, brandConfig, domain, isSubdomainProject, sendgrid, linkBrandingValid });
  if (!diff) {
    console.log(`      ${chalk.dim('⊘ No changes needed')}`);
    if (linkBrandingPending) {
      return { status: 'warned', reason: LINK_BRANDING_PENDING_REASON };
    }
    return;
  }

  if (options.dryRun) {
    // The SendGrid host is READ, never written, so a dry run reads it too and
    // names what it found — the plan covers the same records a real run does
    // ([#692](https://github.com/Omega-JS-Stack/omega/issues/692)).
    const sendgridPlan = sendgrid ? ` (SendGrid domain auth read live: u${sendgrid.id}.${sendgrid.whitelabel}.sendgrid.net)` : '';
    dryRunPlan(`create ${diff.toCreate.length}, update ${diff.toUpdate.length}, delete ${diff.toDelete.length}${sendgridPlan}`);
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
 * The `u<id>.<whitelabel>` host every SendGrid domain-auth record is built
 * from, read LIVE off the account.
 *
 * These are SendGrid's OWN observed facts about the domain, not choices a
 * brand makes, so they are referenced at the source instead of copied into
 * config — a `dns.sendgrid` block drifts the moment the account
 * re-authenticates the domain, and nothing ever wrote it back
 * ([#692](https://github.com/Omega-JS-Stack/omega/issues/692)).
 * `GET /v3/whitelabel/domains` answers with the authentication's own record
 * set, whose `mail_cname` points at exactly the host the record builder
 * rebuilds (`u<id>.<whitelabel>.sendgrid.net`).
 *
 * Every no-answer SKIPS the SendGrid records and says why: no key, no
 * authentication for this domain (the campaigns service creates it), an
 * unreachable API, or a host shape this parser does not know. A subdomain
 * project has no SendGrid records to build at all — the apex record set
 * belongs to the parent brand — so it never asks.
 *
 * @param {object} context - The service context
 * @param {object|null} api - The SendGrid client (null without an API key)
 * @returns {Promise<{ id: string, whitelabel: string }|null>}
 */
async function resolveDomainAuth({ domain, isSubdomainProject }, api) {
  if (isSubdomainProject) return null;

  if (!api) {
    console.log(`      ${chalk.yellow('⚠')} SendGrid records skipped — no ${chalk.cyan('SENDGRID_API_KEY')} to read the domain authentication with`);
    return null;
  }

  let domains;
  try {
    domains = await api.getAuthenticatedDomains();
  } catch (error) {
    console.log(`      ${chalk.yellow('⚠')} SendGrid records skipped — could not read the domain authentication${chalk.dim(`: ${error.message}`)}`);
    return null;
  }

  const auth = (domains || []).find((entry) => (entry.domain || '').toLowerCase() === domain.toLowerCase());
  if (!auth) {
    console.log(`      ${chalk.yellow('⚠')} SendGrid records skipped — no authenticated domain for ${chalk.cyan(domain)} in SendGrid (the campaigns service creates it)`);
    return null;
  }

  const host = auth.dns?.mail_cname?.data;
  const parsed = /^u([^.]+)\.([^.]+)\.sendgrid\.net$/i.exec(host || '');
  if (!parsed) {
    console.log(`      ${chalk.yellow('⚠')} SendGrid records skipped — domain-auth host ${chalk.cyan(host || '(none)')} is not ${chalk.dim('u<id>.<whitelabel>.sendgrid.net')}`);
    return null;
  }

  return { id: parsed[1], whitelabel: parsed[2] };
}

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
 * An unreachable SendGrid answers NO: the unproxied record is the safe half of
 * the pair (a plain-HTTP hop, which is where every brand already is), while a
 * wrong YES is unrecoverable without a hand edit. No API key never reaches
 * here — the domain-auth read skipped the whole set first.
 *
 * NO ENTRY is the one NO that is not pending: the campaigns service creates
 * the branding later in this same walk
 * ([#693](https://github.com/Omega-JS-Stack/omega/issues/693)), so waiting on
 * it here would never end. That case says so and moves on.
 *
 * @param {object} context - The service context
 * @param {object|null} api - The SendGrid client (null without an API key)
 * @param {object|null} sendgrid - The live domain-auth values, when there are
 *   SendGrid records to gate at all
 * @returns {Promise<{ valid: boolean, pending: boolean }>} - `pending` is a
 *   live branding that did not validate: the warned reason's condition.
 */
async function resolveLinkBranding(context, api, sendgrid) {
  const { domain, options = {} } = context;

  // No SendGrid records to gate: the domain-auth read found none (and already
  // said why), or a subdomain project, whose record set stops at the GitHub
  // Pages pair (the apex belongs to the parent).
  if (!sendgrid) {
    return { valid: false, pending: false };
  }

  const host = `emailurl.${domain}`;

  const branding = await readBrandedLink(api, host, true);

  // Nothing to WAIT for HERE: the account has no link branding for this host
  // yet, and the campaigns service creates it LATER IN THIS SAME WALK
  // ([#693](https://github.com/Omega-JS-Stack/omega/issues/693)) — waiting on
  // it before that would never end. The record still lands (grey), which is
  // exactly the state SendGrid validates against.
  if (branding === null) {
    console.log(`      ${chalk.yellow('⚠')} ${chalk.cyan(`CNAME ${host}`)} stays unproxied — SendGrid has no link branding for that host yet. The campaigns service creates and validates it later in this run (when campaigns is enabled for this brand), then flips ${chalk.cyan(`CNAME ${host}`)} to proxied.`);
    return { valid: false, pending: false };
  }

  let valid = branding?.valid === true;

  // Wait it out: SendGrid validates minutes after the CNAME lands, and the
  // proxy flip belongs to THIS walk (#662). Ticks stay quiet — the first read
  // already reported an unreachable API.
  if (!valid && canPrompt(options)) {
    const result = await pollWithSpinner({
      check: async () => ((await readBrandedLink(api, host))?.valid === true ? { done: true } : { done: false }),
      intervalMs: 10000,
      message: `Waiting for SendGrid to validate ${host}`,
      indent: '      ',
    });
    valid = result.success;
  }

  if (!valid) {
    console.log(`      ${chalk.yellow('⚠')} ${chalk.cyan(`CNAME ${host}`)} stays unproxied — SendGrid has not validated the branded link. Rerun ${chalk.cyan('omega manage')} once it has, and the record flips to proxied so emailed links land on HTTPS.`);
  }

  return { valid, pending: !valid };
}

/**
 * One read of SendGrid's branded-link list: this host's entry.
 *
 * The caller needs all three answers apart, because only ONE of them is worth
 * waiting on: an entry that exists and is not valid yet is minutes away, while
 * a missing entry arrives from the campaigns service later in the walk, not
 * from any wait here.
 *
 * @param {object} api - The SendGrid client
 * @param {string} host - The branded link host (`emailurl.<domain>`)
 * @param {boolean} [logError] - Report an unreachable API (the first read only)
 * @returns {Promise<object|null|undefined>} The branding entry; `null` when the
 *   account has none for this host; `undefined` when the read itself failed.
 */
async function readBrandedLink(api, host, logError = false) {
  try {
    const links = await api.getBrandedLinks();
    return (links || []).find((link) => `${link.subdomain}.${link.domain}`.toLowerCase() === host.toLowerCase()) || null;
  } catch (error) {
    if (logError) {
      console.log(`      ${chalk.yellow('⚠')} Could not read SendGrid link branding${chalk.dim(`: ${error.message}`)}`);
    }
    return undefined;
  }
}
