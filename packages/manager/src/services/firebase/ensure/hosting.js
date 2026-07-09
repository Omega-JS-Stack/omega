/**
 * Ensure Firebase Hosting serves the brand's API domains.
 *
 * The default hosting site ({projectId}) gets api.{domain} (Cloud Functions'
 * public endpoint via the backend-manager-proxy worker chain) plus
 * api.{sub}.{domain} for each brand.subdomains entry. The main domain is NOT
 * added — the website hosts elsewhere (GitHub Pages).
 *
 * Per domain, ONE reconciliation pass (omega-manager's interactive
 * verification poll is next up as a verification-poll adoption):
 *   verified  → ensure the Cloudflare CNAME is proxied
 *   pending   → write Firebase's required DNS records (TXT ownership/ACME +
 *               unproxied CNAME), report state, warned — rerun converges
 *   deleted   → undelete, then treat as pending
 *   missing   → create, then treat as pending
 *
 * DNS writes go through Cloudflare (context.cloudflareApi). No token → the
 * required records are printed instead and the operation warns.
 */
const chalk = require('chalk').default;

module.exports = async function ensureHosting(context) {
  const { firebaseApi: api, cloudflareApi, brandConfig, projectId, domain, apexDomain, isSubdomainProject, options = {} } = context;

  if (brandConfig.firebase?.apiSubdomain === false) {
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
    console.log(`      ${chalk.dim(`⊘ Dry run — would create hosting site ${projectId}`)}`);
    return { output: { hosting: { planned: 'create-site' } } };
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

/**
 * One reconciliation pass over a single API domain.
 */
async function ensureApiDomain(context, zone, apiDomain) {
  const { firebaseApi: api, projectId, apexDomain, options = {} } = context;
  const { fullDomain, recordName } = apiDomain;

  let status = await api.checkDomainStatus(projectId, projectId, fullDomain);

  // Fully verified — just make sure the CNAME is proxied
  if (status.verified) {
    console.log(`      ${chalk.green('✓')} Domain verified: ${chalk.cyan(fullDomain)}`);
    await ensureCname(context, zone, recordName, { proxied: true });
    return { domain: fullDomain, status: 'verified' };
  }

  // Soft-deleted → undelete; missing → create. Both then converge as pending.
  if (!status.exists) {
    if (options.dryRun) {
      console.log(`      ${chalk.dim(`⊘ Dry run — would ${status.deleted ? 'restore' : 'add'} domain ${fullDomain}`)}`);
      return { domain: fullDomain, status: 'planned' };
    }

    try {
      if (status.deleted) {
        console.log(`      Restoring deleted domain: ${chalk.cyan(fullDomain)}...`);
        await api.undeleteCustomDomain(projectId, projectId, fullDomain);
        console.log(`      ${chalk.green('✓')} Restored domain`);
      } else {
        console.log(`      Adding domain: ${chalk.cyan(fullDomain)}...`);
        await api.createCustomDomain(projectId, projectId, fullDomain);
        console.log(`      ${chalk.green('✓')} Added domain to Firebase`);
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
  await ensureCname(context, zone, recordName, { proxied: false });

  console.log(`      ${chalk.dim('→')} Rerun after DNS propagates — verification converges on a later pass`);
  return { domain: fullDomain, status: 'pending' };
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
async function ensureCname(context, zone, recordName, { proxied }) {
  const { cloudflareApi, projectId, apexDomain, options = {} } = context;
  const cnameTarget = `${projectId}.web.app`;
  const fullRecordName = `${recordName}.${apexDomain}`;

  if (!cloudflareApi) {
    console.log(`        ${chalk.yellow('→')} Set manually: ${chalk.cyan('CNAME')} ${chalk.cyan(fullRecordName)} → ${cnameTarget}`);
    return;
  }

  try {
    const existing = await findDnsRecord(cloudflareApi, zone.id, fullRecordName, 'CNAME');

    // Never un-proxy a working record; only lift proxied → true after verify
    const needsUpdate = existing
      && (existing.content !== cnameTarget || (proxied === true && existing.proxied === false));

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
