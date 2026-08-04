/**
 * Ensure Firebase Hosting serves the brand's API domains.
 *
 * The default hosting site ({projectId}) gets api.{domain} (Cloud Functions'
 * public endpoint via Firebase Hosting rewrites; a brand whose api domain
 * fronts a dedicated non-Firebase backend routes /omega through the
 * cloudflare omega-api-proxy worker instead) plus
 * api.{sub}.{domain} for each brand.subdomains entry. The main domain is NOT
 * added — the website hosts elsewhere (GitHub Pages).
 *
 * Per domain, one reconciliation pass:
 *   verified  → ensure the Cloudflare CNAME has the right proxy state:
 *               proxied when the zone's TLS coverage reaches the name.
 *               Universal SSL (every plan) covers the apex + one label;
 *               deeper names (api.{sub}.{zone} — subdomain projects) ask
 *               the zone what paid coverage it ACTUALLY has (Total TLS,
 *               Advanced certificate packs — plans differ per brand).
 *               Uncovered names stay DNS-only and Firebase serves the
 *               certificate instead
 *   pending   → write Firebase's required DNS records (TXT ownership/ACME +
 *               unproxied CNAME); interactive runs then poll until Firebase
 *               verifies (writing any NEW records it demands mid-poll — the
 *               ACME challenge appears once ownership passes) and finish by
 *               setting the CNAME's final proxy state; non-interactive/dry
 *               runs report state, warned — rerun converges
 *   deleted   → undelete, then treat as pending
 *   missing   → create, then treat as pending
 *
 * DNS writes go through Cloudflare (context.cloudflareApi). No token → the
 * required records are printed instead and the operation warns.
 */
const chalk = require('chalk').default;
const { pollWithSpinner } = require('@omega.js/devkit/flows');
const { canPrompt, dryRunPlan } = require('../../../lib/run-gates.js');

module.exports = async function ensureHosting(context) {
  const { firebaseApi: api, cloudflareApi, brandConfig, projectId, domain, apexDomain, isSubdomainProject, options = {} } = context;

  if (brandConfig.cloud?.apiSubdomain === false) {
    console.log(chalk.dim('      ⊘ API subdomain disabled in config, skipping'));
    return {};
  }

  // Cloudflare zone for DNS writes (apex zone covers subdomain projects)
  const zone = cloudflareApi ? await cloudflareApi.getZoneByName(apexDomain) : null;
  if (cloudflareApi && !zone) {
    console.log(`      ${chalk.yellow('⚠')} No Cloudflare zone found for ${chalk.cyan(apexDomain)}`);
    return { status: 'warned', output: { hosting: { note: 'no Cloudflare zone' } } };
  }

  // API domains to ensure. For subdomain projects (app.brand.com) the DNS
  // record names stay relative to the apex zone (api.app, not api).
  const subdomainPrefix = isSubdomainProject ? domain.replace(`.${apexDomain}`, '') : '';
  const apiDomains = [{
    fullDomain: `api.${domain}`,
    recordName: subdomainPrefix ? `api.${subdomainPrefix}` : 'api',
  }];

  for (const subdomain of brandConfig.brand?.subdomains || []) {
    if (subdomain) {
      apiDomains.push({
        fullDomain: `api.${subdomain}.${domain}`,
        recordName: subdomainPrefix ? `api.${subdomain}.${subdomainPrefix}` : `api.${subdomain}`,
      });
    }
  }

  // === Hosting site ===
  const sites = await api.listHostingSites(projectId);
  let site = sites.find((s) => s.name?.includes(projectId));

  if (site) {
    console.log(`      ${chalk.green('✓')} Site exists: ${chalk.cyan(projectId)}`);
  } else if (options.dryRun) {
    return dryRunPlan(`create hosting site ${projectId}`, { output: { hosting: { planned: 'create-site' } } });
  } else {
    console.log('      Creating hosting site...');
    try {
      site = await api.createHostingSite(projectId, projectId);
      console.log(`      ${chalk.green('✓')} Created site: ${chalk.cyan(projectId)}`);
    } catch (error) {
      if (!error.message?.includes('already exists')) {
        console.log(`      ${chalk.yellow('⚠')} Could not create site${chalk.dim(`: ${error.message}`)}`);
        return { status: 'warned', output: { hosting: { error: error.message } } };
      }
      console.log(`      ${chalk.green('✓')} Site exists: ${chalk.cyan(projectId)}`);
    }
  }

  // === Custom domains (one pass each) ===
  const results = [];
  for (const apiDomain of apiDomains) {
    results.push(await ensureApiDomain(context, zone, apiDomain));
  }

  const anyPending = results.some((r) => r.status !== 'verified');
  return {
    status: anyPending ? 'warned' : 'success',
    state: { hosting: { siteId: projectId, domains: results } },
  };
};

// ─── TLS coverage (proxy eligibility) ────────────────────────────────────────

/**
 * TLS certificate-host matching: an exact host matches itself; a wildcard
 * (`*.X`) covers exactly ONE label below X — standard certificate semantics,
 * a wildcard never spans two levels.
 */
function certHostMatches(certHost, fullDomain) {
  if (certHost === fullDomain) {
    return true;
  }
  if (!certHost.startsWith('*.')) {
    return false;
  }
  const base = certHost.slice(2);
  return fullDomain.endsWith(`.${base}`)
    && !fullDomain.slice(0, -(base.length + 1)).includes('.');
}

/**
 * Cloudflare Universal SSL (every plan, free included) covers the apex and
 * ONE label below it (*.zone) — never deeper.
 */
function universalSslCovers(fullDomain, zoneName) {
  return fullDomain === zoneName || certHostMatches(`*.${zoneName}`, fullDomain);
}

/**
 * Whether the zone can terminate TLS for fullDomain at the proxy. Universal
 * SSL answers statically; deeper names (api.playground.zone) ask the zone
 * what coverage it ACTUALLY has — plans differ per brand: Total TLS mints a
 * certificate for every proxied hostname, and Advanced certificate packs can
 * carry deeper wildcards. Lookup failures fall back to not-covered — a
 * DNS-only record works on every plan, a wrongly-proxied one never does.
 *
 * @returns {{ covered: boolean, via: string|null }}
 */
async function zoneTlsCoverage(cloudflareApi, zone, fullDomain) {
  if (universalSslCovers(fullDomain, zone.name)) {
    return { covered: true, via: 'universal' };
  }

  try {
    const data = await cloudflareApi.makeRequest(`/zones/${zone.id}/acm/total_tls`);
    if (data.result?.enabled) {
      return { covered: true, via: 'Total TLS' };
    }
  } catch {
    // No ACM entitlement — the endpoint rejects on free zones
  }

  try {
    const data = await cloudflareApi.makeRequest(`/zones/${zone.id}/ssl/certificate_packs`);
    const packs = Array.isArray(data.result) ? data.result : [];
    const pack = packs.find((p) => p.status === 'active'
      && (p.hosts || []).some((host) => certHostMatches(host, fullDomain)));
    if (pack) {
      return { covered: true, via: `the ${pack.type} certificate pack` };
    }
  } catch {
    // Coverage unknown — treat as uncovered
  }

  return { covered: false, via: null };
}

/**
 * One reconciliation pass over a single API domain.
 */
async function ensureApiDomain(context, zone, apiDomain) {
  const { firebaseApi: api, cloudflareApi, projectId, apexDomain, options = {} } = context;
  const { fullDomain, recordName } = apiDomain;

  // Can the proxy terminate TLS for this name? (No Cloudflare client → moot;
  // the DNS helpers only print manual instructions.)
  const tls = zone
    ? await zoneTlsCoverage(cloudflareApi, zone, fullDomain)
    : { covered: true, via: null };

  let status = await api.checkDomainStatus(projectId, projectId, fullDomain);

  // Fully verified — just make sure the CNAME has the right proxy state
  if (status.verified) {
    console.log(`      ${chalk.green('✓')} Domain verified: ${chalk.cyan(fullDomain)}`);
    if (!tls.covered) {
      console.log(`      ${chalk.dim(`No certificate covers ${fullDomain} at the proxy (Universal SSL stops at *.${zone.name}; no Total TLS or deeper cert pack on this zone) — CNAME stays DNS-only, Firebase serves the certificate`)}`);
    } else if (tls.via && tls.via !== 'universal') {
      console.log(`      ${chalk.dim(`${fullDomain} is deeper than *.${zone.name} but ${tls.via} covers it — proxying`)}`);
    }
    await ensureCname(context, zone, recordName, { proxied: tls.covered, tlsCovered: tls.covered });
    return { domain: fullDomain, status: 'verified' };
  }

  // Soft-deleted → undelete; missing → create. Both then converge as pending.
  if (!status.exists) {
    if (options.dryRun) {
      return dryRunPlan(`${status.deleted ? 'restore' : 'add'} domain ${fullDomain}`, { domain: fullDomain, status: 'planned' });
    }

    try {
      if (status.deleted) {
        console.log(`      Restoring deleted domain: ${chalk.cyan(fullDomain)}...`);
        const claim = await api.undeleteCustomDomain(projectId, projectId, fullDomain);
        console.log(`      ${chalk.green('✓')} Restored domain${claim?.pending ? chalk.dim(' (claim pending DNS verification)') : ''}`);
      } else {
        console.log(`      Adding domain: ${chalk.cyan(fullDomain)}...`);
        // A claim still running is pending DNS verification, a normal state (#56)
        const claim = await api.createCustomDomain(projectId, projectId, fullDomain);
        console.log(`      ${chalk.green('✓')} Added domain to Firebase${claim?.pending ? chalk.dim(' (claim pending DNS verification)') : ''}`);
      }
    } catch (error) {
      if (!error.message?.includes('already exists')) {
        console.log(`      ${chalk.yellow('⚠')} Could not add domain${chalk.dim(`: ${error.message}`)}`);
        return { domain: fullDomain, status: 'error', error: error.message };
      }
    }

    status = await api.checkDomainStatus(projectId, projectId, fullDomain);
  } else {
    console.log(`      ${chalk.yellow('⏳')} Domain pending: ${chalk.cyan(fullDomain)} ${chalk.dim(`(${status.ownershipState || 'ownership pending'}, ${status.hostState || 'host pending'})`)}`);
  }

  // Write the DNS records Firebase requires (TXT ownership + ACME challenge;
  // A/AAAA skipped — the CNAME to {projectId}.web.app replaces them)
  await ensureFirebaseDnsRecords(context, zone, status.requiredDnsUpdates, recordName);
  await ensureCname(context, zone, recordName, { proxied: false, tlsCovered: tls.covered });

  // Interactive runs wait for Firebase to verify (DNS propagation)
  if (canPrompt(options)) {
    const verified = await waitForVerification(context, zone, fullDomain, recordName, status);
    if (verified) {
      console.log(`      ${chalk.green('✓')} Domain verified: ${chalk.cyan(fullDomain)}`);
      await ensureCname(context, zone, recordName, { proxied: tls.covered, tlsCovered: tls.covered });
      return { domain: fullDomain, status: 'verified' };
    }
  }

  console.log(`      ${chalk.dim('→')} Rerun after DNS propagates — verification converges on a later pass`);
  return { domain: fullDomain, status: 'pending' };
}

/**
 * Poll Firebase until the domain verifies. Firebase can demand NEW DNS
 * records mid-verification (the ACME challenge appears once ownership
 * passes) — those are written as they show up.
 *
 * @returns {boolean} - Whether the domain reached verified
 */
async function waitForVerification(context, zone, fullDomain, recordName, initialStatus) {
  const { firebaseApi: api, projectId } = context;
  let lastStates = '';
  let lastDnsUpdateCount = (initialStatus.requiredDnsUpdates || []).length;

  const result = await pollWithSpinner({
    check: async () => {
      const status = await api.checkDomainStatus(projectId, projectId, fullDomain);

      if (status.verified) {
        return { done: true };
      }

      const dnsUpdates = status.requiredDnsUpdates || [];
      if (dnsUpdates.length > 0 && dnsUpdates.length !== lastDnsUpdateCount) {
        console.log(`        ${chalk.dim('→')} Firebase requires new DNS records — writing...`);
        await ensureFirebaseDnsRecords(context, zone, dnsUpdates, recordName);
        lastDnsUpdateCount = dnsUpdates.length;
      }

      const states = `${status.ownershipState || 'ownership pending'}, ${status.hostState || 'host pending'}${status.certState ? `, ${status.certState}` : ''}`;
      if (states !== lastStates) {
        console.log(`        ${chalk.dim(`→ ${states}`)}`);
        lastStates = states;
      }

      return { done: false };
    },
    intervalMs: 5000,
    message: 'Waiting for DNS propagation',
    indent: '        ',
  });

  return result.success;
}

// ─── Cloudflare DNS helpers (via the zone-scoped REST endpoints) ─────────────

async function findDnsRecord(cloudflareApi, zoneId, name, type) {
  const data = await cloudflareApi.makeRequest(`/zones/${zoneId}/dns_records?type=${type}&name=${encodeURIComponent(name)}`);
  return data.result?.[0] || null;
}

/**
 * Write Firebase's requiredDnsUpdates into the zone (skipping A/AAAA).
 * Without a Cloudflare client the records are printed for manual setup.
 */
async function ensureFirebaseDnsRecords(context, zone, requiredDnsUpdates, recordName) {
  const { cloudflareApi, apexDomain, options = {} } = context;
  const updates = Array.isArray(requiredDnsUpdates) ? requiredDnsUpdates : [];

  for (const update of updates) {
    const { domainName } = update;
    const records = update.desired?.records || [];

    for (const record of records) {
      const { type, rdata } = record;

      if (type === 'A' || type === 'AAAA') {
        continue;
      }

      if (!cloudflareApi) {
        console.log(`        ${chalk.yellow('→')} Set manually: ${chalk.cyan(type)} ${chalk.cyan(domainName)} → ${rdata}`);
        continue;
      }

      if (options.dryRun) {
        console.log(`        ${chalk.dim(`⊘ Dry run — would ensure ${type} ${domainName}`)}`);
        continue;
      }

      const comment = type === 'TXT' && domainName.includes('_acme-challenge')
        ? 'Firebase SSL certificate verification'
        : 'Firebase Hosting';

      try {
        const existing = await findDnsRecord(cloudflareApi, zone.id, domainName, type);

        if (existing) {
          if (existing.content !== rdata) {
            await cloudflareApi.makeRequest(`/zones/${zone.id}/dns_records/${existing.id}`, {
              method: 'PATCH',
              body: JSON.stringify({ content: rdata, comment, ttl: 60 }),
            });
            console.log(`        ${chalk.green('✓')} Updated ${chalk.cyan(type)}: ${chalk.cyan(domainName)}`);
          }
        } else {
          const name = domainName === apexDomain ? apexDomain : domainName.replace(`.${apexDomain}`, '');
          await cloudflareApi.makeRequest(`/zones/${zone.id}/dns_records`, {
            method: 'POST',
            body: JSON.stringify({ type, name, content: rdata, comment, ttl: 60 }),
          });
          console.log(`        ${chalk.green('✓')} Created ${chalk.cyan(type)}: ${chalk.cyan(domainName)}`);
        }
      } catch (error) {
        console.log(`        ${chalk.yellow('⚠')} ${chalk.cyan(type)} record error for ${chalk.cyan(domainName)}${chalk.dim(`: ${error.message}`)}`);
      }
    }
  }
}

/**
 * Ensure the CNAME to {projectId}.web.app exists with the desired proxy state
 * (unproxied while verification is pending, proxied once verified).
 */
async function ensureCname(context, zone, recordName, { proxied, tlsCovered = true }) {
  const { cloudflareApi, projectId, apexDomain, options = {} } = context;
  const cnameTarget = `${projectId}.web.app`;
  const fullRecordName = `${recordName}.${apexDomain}`;

  if (!cloudflareApi) {
    console.log(`        ${chalk.yellow('→')} Set manually: ${chalk.cyan('CNAME')} ${chalk.cyan(fullRecordName)} → ${cnameTarget}`);
    return;
  }

  try {
    const existing = await findDnsRecord(cloudflareApi, zone.id, fullRecordName, 'CNAME');

    // Never un-proxy a working record (verify-cycle flapping) — EXCEPT when
    // the zone's TLS coverage can't reach the name, where proxied can never
    // complete a handshake and the record must come back down to DNS-only.
    const needsUpdate = existing
      && (existing.content !== cnameTarget
        || (proxied === true && existing.proxied === false)
        || (proxied === false && existing.proxied === true && !tlsCovered));

    if (existing && !needsUpdate) {
      return;
    }

    if (options.dryRun) {
      console.log(`        ${chalk.dim(`⊘ Dry run — would ${existing ? 'update' : 'create'} CNAME ${fullRecordName} → ${cnameTarget}`)}`);
      return;
    }

    if (existing) {
      await cloudflareApi.makeRequest(`/zones/${zone.id}/dns_records/${existing.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ content: cnameTarget, comment: 'Firebase Hosting', ttl: 60, proxied }),
      });
      console.log(`        ${chalk.green('✓')} Updated CNAME: ${chalk.cyan(recordName)} → ${chalk.cyan(cnameTarget)} ${chalk.dim(`(proxied: ${proxied})`)}`);
    } else {
      await cloudflareApi.makeRequest(`/zones/${zone.id}/dns_records`, {
        method: 'POST',
        body: JSON.stringify({ type: 'CNAME', name: recordName, content: cnameTarget, comment: 'Firebase Hosting', ttl: 60, proxied }),
      });
      console.log(`        ${chalk.green('✓')} Created CNAME: ${chalk.cyan(recordName)} → ${chalk.cyan(cnameTarget)} ${chalk.dim(`(proxied: ${proxied})`)}`);
    }
  } catch (error) {
    console.log(`        ${chalk.yellow('⚠')} CNAME error for ${chalk.cyan(recordName)}${chalk.dim(`: ${error.message}`)}`);
  }
}

module.exports.universalSslCovers = universalSslCovers;
module.exports.certHostMatches = certHostMatches;
