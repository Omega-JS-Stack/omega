/**
 * Ensure SendGrid domain authentication for the brand's domain.
 *
 * A valid authentication is converged proof. A missing one is created in one
 * pass: authenticate in SendGrid (automatic_security → 3 CNAMEs), diff-sync
 * the records into the Cloudflare apex zone (exact-match = untouched, wrong
 * content = patched, missing = created), then validate — interactive runs
 * poll until DNS propagates and SendGrid confirms; non-interactive/dry runs
 * validate ONCE, report warned, and the rerun converges. No Cloudflare token
 * → the records to add manually, and validation is still attempted so a
 * manual fix converges on rerun.
 */
const chalk = require('chalk').default;
const { pollWithSpinner } = require('@omega.js/devkit/flows');
const { canPrompt, dryRunPlan } = require('../../../lib/run-gates.js');
const { syncDnsRecords, manualRecordList } = require('../lib/dns-sync.js');

const SUBDOMAIN = 'emailauth';

// The record set automatic_security returns
const DNS_KEYS = ['mail_cname', 'dkim1', 'dkim2'];

module.exports = async function ensureDomainAuth(context) {
  const { sendgridApi: api, cloudflareApi, domain, apexDomain, options = {} } = context;

  // === READ: is the domain already authenticated and valid? ===
  const domains = await api.getAuthenticatedDomains();
  let domainAuth = domains.find((d) => d.domain === domain);

  if (domainAuth?.valid) {
    console.log(`      ${chalk.green('✓')} Domain ${chalk.cyan(domain)} authenticated`);
    return { output: { domainAuth: { id: domainAuth.id, valid: true } } };
  }

  if (options.dryRun) {
    const planned = domainAuth ? ['dns-records', 'validate'] : ['authenticate-domain', 'dns-records', 'validate'];
    return dryRunPlan(`${planned.join(' → ')}`, { output: { domainAuth: { planned } } });
  }

  // === Create the authentication when missing ===
  if (!domainAuth) {
    domainAuth = await api.authenticateDomain(domain, SUBDOMAIN);
    console.log(`      ${chalk.green('✓')} Created domain authentication for ${chalk.cyan(domain)}`);
  } else {
    console.log(`      ${chalk.yellow('↻')} Domain ${chalk.cyan(domain)} exists but is not validated — reconciling DNS`);
  }

  const records = DNS_KEYS
    .map((key) => ({ key, record: domainAuth.dns?.[key] }))
    .filter(({ record }) => record);

  if (records.length === 0) {
    throw new Error('SendGrid returned no DNS records for the domain authentication');
  }

  // === DNS via Cloudflare (or manual guidance) ===
  const synced = await syncDnsRecords(cloudflareApi, apexDomain, records);

  // === Validate — DNS may need a minute; interactive runs wait it out ===
  const isValid = (validation) => Boolean(validation?.validation_results
    && Object.values(validation.validation_results).every((r) => r.valid));

  let valid = isValid(await api.validateDomain(domainAuth.id));

  if (!valid && canPrompt(options)) {
    const result = await pollWithSpinner({
      check: async () => {
        try {
          return isValid(await api.validateDomain(domainAuth.id)) ? { done: true } : { done: false };
        } catch {
          return { done: false };
        }
      },
      intervalMs: 10000,
      message: 'Validating domain authentication (waiting for DNS propagation)',
      indent: '      ',
    });
    valid = result.success;
  }

  if (valid) {
    console.log(`      ${chalk.green('✓')} Domain ${chalk.cyan(domain)} validated`);
    return { output: { domainAuth: { id: domainAuth.id, valid: true } } };
  }

  console.log(`      ${chalk.yellow('⚠')} Validation pending — DNS is likely still propagating, rerun in a few minutes`);
  return {
    status: 'warned',
    reason: 'domain validation pending — DNS is still propagating',
    output: { domainAuth: { id: domainAuth.id, valid: false, ...(synced ? {} : { manualRecords: manualRecordList(records) }) } },
  };
};
