/**
 * DNS records helpers — pure logic for building the desired record set,
 * diffing against existing records, normalizing TXT content (SPF/DMARC), and
 * inferring canonical comments. Ported from omega-manager with the company-
 * specific hardcodes moved to config:
 *
 *   dns.spfIncludes    — SPF include list (manager default: google + sendgrid)
 *   dns.dmarcReports   — { rua: [...], ruf: [...] } report addresses (no default)
 *   dns.bimiLogo       — BIMI logo URL (no default; record only emitted when set)
 *   dns.sendgrid       — { id, whitelabel } domain-auth CNAMEs (no default;
 *                        the campaigns service (SendGrid) owns these values),
 *                        plus `linkBrandingValid` — NOT config, the live answer
 *                        the ensure handler reads off SendGrid and folds in
 *                        ([#646](https://github.com/Omega-JS-Stack/omega/issues/646))
 *   dns.records        — custom records (verification TXTs like Ahrefs go here)
 */
const chalk = require('chalk').default;
const { resolveEmailProvider } = require('../../domain/lib/registrars.js');

// =============================================================================
// BUILD REQUIRED STATIC RECORDS
// =============================================================================

function buildRequiredRecords(domain, dnsConfig, isSubdomainProject = false, emailProvider = null) {
  const customRecords = [];
  const defaultRecords = [];

  // -------------------------------------------------------------------------
  // CUSTOM RECORDS - Add any custom records from dns.records array
  // -------------------------------------------------------------------------
  if (dnsConfig?.records && Array.isArray(dnsConfig.records)) {
    for (const record of dnsConfig.records) {
      customRecords.push({
        type: record.type,
        name: record.name === '@' ? domain : (record.name.includes('.') ? record.name : `${record.name}.${domain}`),
        content: record.content,
        proxied: record.proxied !== undefined ? record.proxied : true,
        comment: record.comment || '',
        ...(record.priority !== undefined && { priority: record.priority }),
      });
    }
  }

  const hasCustomOverride = (type, name) =>
    customRecords.some((r) => r.type === type && r.name.toLowerCase() === name.toLowerCase());

  // TXT records coexist at one name (SPF + a verification token at the apex is
  // the normal case) — custom TXT records are ADDITIVE, never suppressing a
  // default. Override suppression applies to the unique-ish types only.
  const addDefault = (record) => {
    if (record.type === 'TXT' || !hasCustomOverride(record.type, record.name)) {
      defaultRecords.push(record);
    }
  };

  // GitHub Pages A + AAAA for apex/subdomain
  addDefault({ type: 'A', name: domain, content: '185.199.108.153', proxied: true, comment: 'GitHub Pages IP' });
  addDefault({ type: 'AAAA', name: domain, content: '2606:50c0:8000::153', proxied: true, comment: 'GitHub Pages IP' });

  // Subdomain projects: no email/verification records — return early
  if (isSubdomainProject) {
    return [...customRecords, ...defaultRecords];
  }

  // www CNAME -> root
  addDefault({ type: 'CNAME', name: `www.${domain}`, content: domain, proxied: true, comment: 'Redirect www to root domain' });

  // MX (email provider)
  if (emailProvider === 'squarespace') {
    addDefault({ type: 'MX', name: domain, content: 'mxa.mailgun.org', priority: 10, comment: 'Squarespace email forwarding' });
    addDefault({ type: 'MX', name: domain, content: 'mxb.mailgun.org', priority: 10, comment: 'Squarespace email forwarding' });
  } else if (emailProvider === 'privateemail') {
    addDefault({ type: 'MX', name: domain, content: 'mx1.privateemail.com', priority: 10, comment: 'Private email forwarding (Namecheap)' });
    addDefault({ type: 'MX', name: domain, content: 'mx2.privateemail.com', priority: 10, comment: 'Private email forwarding (Namecheap)' });
  } else if (emailProvider === 'cloudflare') {
    addDefault({ type: 'MX', name: domain, content: 'route1.mx.cloudflare.net', priority: 36, comment: 'Cloudflare Email Routing' });
    addDefault({ type: 'MX', name: domain, content: 'route2.mx.cloudflare.net', priority: 4, comment: 'Cloudflare Email Routing' });
    addDefault({ type: 'MX', name: domain, content: 'route3.mx.cloudflare.net', priority: 24, comment: 'Cloudflare Email Routing' });
  }

  // SPF
  const spfIncludes = [...(dnsConfig?.spfIncludes || [])];
  if (emailProvider === 'squarespace') spfIncludes.push('mailgun.org');
  else if (emailProvider === 'privateemail') spfIncludes.push('spf.privateemail.com');
  else if (emailProvider === 'cloudflare') spfIncludes.push('_spf.mx.cloudflare.net');

  if (spfIncludes.length > 0) {
    const spfEnforcement = dnsConfig?.spf === 'strict' ? '-all' : '~all';
    const spfContent = `"v=spf1 include:${spfIncludes.join(' include:')} ${spfEnforcement}"`;
    addDefault({ type: 'TXT', name: domain, content: spfContent, comment: 'SPF policy' });
  }

  // DMARC — report addresses (rua/ruf) only when configured
  const dmarcParts = ['v=DMARC1', `p=${dnsConfig?.dmarcPolicy || 'quarantine'}`];
  const reports = dnsConfig?.dmarcReports;
  if (reports?.rua?.length) {
    dmarcParts.push(`rua=${reports.rua.map((a) => `mailto:${a}`).join(',')}`);
  }
  if (reports?.ruf?.length) {
    dmarcParts.push(`ruf=${reports.ruf.map((a) => `mailto:${a}`).join(',')}`);
  }
  dmarcParts.push('pct=100');
  addDefault({
    type: 'TXT', name: `_dmarc.${domain}`,
    content: `"${dmarcParts.join('; ')}"`,
    comment: 'DMARC policy',
  });

  // BIMI — only when a logo URL is configured
  if (dnsConfig?.bimiLogo) {
    addDefault({
      type: 'TXT', name: `default._bimi.${domain}`,
      content: `"v=BIMI1; l=${dnsConfig.bimiLogo}"`,
      comment: 'BIMI logo',
    });
  }

  // SendGrid domain auth — only when the account values are configured
  const sendgrid = dnsConfig?.sendgrid;
  if (sendgrid?.id && sendgrid?.whitelabel) {
    const sgHost = `u${sendgrid.id}.${sendgrid.whitelabel}.sendgrid.net`;
    addDefault({ type: 'CNAME', name: `emailauth.${domain}`, content: sgHost, proxied: false, comment: 'SendGrid email authentication' });
    addDefault({ type: 'CNAME', name: `${sendgrid.id}.${domain}`, content: 'sendgrid.net', proxied: false, comment: 'SendGrid URL branding' });
    // PROXIED, alone among the SendGrid records — but only ONCE SENDGRID SAYS
    // THE BRANDED LINK IS VALID
    // ([#646](https://github.com/Omega-JS-Stack/omega/issues/646)). SendGrid
    // rewrites every link in a transactional email through this host, and it
    // serves NO certificate of its own: `https://emailurl.<domain>` fails
    // certificate validation on every legacy brand checked (2026-08-27), so a
    // click could only ever land on `http://` first and the browser warned the
    // recipient that the site is insecure. Cloudflare's proxy terminates TLS at
    // the edge with the zone's own certificate and forwards to sendgrid.net, so
    // the hop is HTTPS end to end.
    //
    // ORDER MATTERS on a NEW domain: SendGrid validates link branding by looking
    // this record up as a CNAME to sendgrid.net, and a proxied record answers
    // with Cloudflare's addresses instead — so flipping the proxy on before
    // validation locks the branding out of ever validating. `linkBrandingValid`
    // is the live answer the ensure handler reads off SendGrid's
    // `GET /v3/whitelabel/links`: grey-cloud until that says `valid: true`, and
    // the rerun converges once it does (docs/shared/breaking-changes.md).
    addDefault({ type: 'CNAME', name: `emailurl.${domain}`, content: 'sendgrid.net', proxied: sendgrid.linkBrandingValid === true, comment: 'SendGrid URL tracking' });
    addDefault({ type: 'CNAME', name: `s1._domainkey.${domain}`, content: `s1.domainkey.${sgHost}`, proxied: false, comment: 'Sendgrid DKIM key' });
    addDefault({ type: 'CNAME', name: `s2._domainkey.${domain}`, content: `s2.domainkey.${sgHost}`, proxied: false, comment: 'Sendgrid DKIM key' });
  }

  return [...customRecords, ...defaultRecords];
}

// =============================================================================
// FIND OBSOLETE MX RECORDS
// =============================================================================

function findObsoleteMxRecords(existingRecords, domain, emailProvider = null) {
  const toDelete = [];

  const providerMxServers = {
    squarespace: ['mailgun.org'],
    privateemail: ['privateemail.com'],
    cloudflare: ['cloudflare.net'],
  };

  const obsoleteServers = [];
  for (const [provider, servers] of Object.entries(providerMxServers)) {
    if (provider !== emailProvider) obsoleteServers.push(...servers);
  }

  for (const record of existingRecords) {
    if (record.type !== 'MX') continue;
    if (record.name.toLowerCase() !== domain.toLowerCase()) continue;

    const content = record.content.toLowerCase();
    if (obsoleteServers.some((server) => content.includes(server))) {
      console.log(`      ${chalk.yellow('⚠')} Obsolete: MX ${chalk.cyan(record.name)} -> ${chalk.dim(record.content)} (wrong provider)`);
      toDelete.push(record);
    }
  }

  return toDelete;
}

// =============================================================================
// VALIDATE DYNAMIC RECORDS (warnings only)
// =============================================================================

function validateDynamicRecords(records, domain) {
  const apiSubdomain = `api.${domain}`;

  const apiCnameRecord = records.find((r) =>
    r.type === 'CNAME' && r.name.toLowerCase() === apiSubdomain.toLowerCase(),
  );
  if (!apiCnameRecord) {
    console.log(`      ${chalk.yellow('⚠')} Missing: CNAME ${chalk.cyan(`api.${domain}`)} (created by Firebase service)`);
  } else if (!apiCnameRecord.proxied) {
    console.log(`      ${chalk.yellow('⚠')} API CNAME not proxied (may need to enable after Firebase verification)`);
  }

  const hasAcmeChallenge = records.some((r) =>
    r.type === 'TXT' && r.name.toLowerCase().startsWith('_acme-challenge.api'),
  );
  if (!hasAcmeChallenge) {
    console.log(`      ${chalk.yellow('⚠')} Missing: TXT ${chalk.cyan(`_acme-challenge.api.${domain}`)} (created by Firebase service)`);
  }

  const hasHostingSite = records.some((r) => {
    if (r.type !== 'TXT' || r.name.toLowerCase() !== apiSubdomain.toLowerCase()) return false;
    const content = r.content.replace(/^"|"$/g, '');
    return content.toLowerCase().includes('hosting-site=');
  });
  if (!hasHostingSite) {
    console.log(`      ${chalk.yellow('⚠')} Missing: TXT ${chalk.cyan(`api.${domain}`)} hosting-site= (created by Firebase service)`);
  }
}

// =============================================================================
// DETERMINE COMMENT FOR EXISTING RECORD
// =============================================================================

function determineComment(record, domain) {
  const name = record.name.toLowerCase();
  const type = record.type.toLowerCase();
  const content = record.content.toLowerCase();

  if (type === 'a' && /^185\.199\.10[89]\.153$|^185\.199\.11[01]\.153$/.test(content)) {
    return 'GitHub Pages IP';
  }
  if (type === 'aaaa' && /^2606:50c0:800[0-3]::153$/.test(content)) {
    return 'GitHub Pages IP';
  }

  if (type === 'cname') {
    if (content.includes('sendgrid.net') && name.match(/^\d+\./)) return 'SendGrid URL branding';
    if (content.includes('.web.app') || content.includes('.firebaseapp.com')) return 'Firebase hosting domain verification (quick setup mode)';
    if (content.includes('sendgrid.net') && name.includes('emailauth')) return 'SendGrid email authentication';
    if (content.includes('sendgrid.net') && name.includes('emailurl')) return 'SendGrid URL tracking';
    if (name.includes('_domainkey') && content.includes('sendgrid.net')) return 'Sendgrid DKIM key';
    if (name.includes('www.') && content === domain) return 'Redirect www to root domain';
  }

  if (type === 'mx') {
    if (content.includes('mailgun.org')) return 'Squarespace email forwarding';
    if (content.includes('privateemail.com')) return 'Private email forwarding (Namecheap)';
  }

  if (type === 'txt') {
    if (name.includes('_acme-challenge')) return 'Firebase hosting domain verification (advanced setup mode)';
    if (content.includes('hosting-site=')) return 'Firebase hosting domain verification (advanced setup mode)';
    if (name.includes('_bimi')) return 'BIMI logo';
    if (name.includes('_dmarc')) return 'DMARC policy';
    if (name.includes('_github') || name.includes('-gh-')) return 'GitHub domain verification';
    if (name.includes('_domainkey') && content.includes('k=rsa')) return 'Squarespace DKIM';
    if (content.includes('ahrefs-site-verification')) return 'Ahrefs domain verification';
    if (content.includes('google-site-verification')) return 'Google domain verification';
    if (content.includes('v=spf1')) return 'SPF policy';
  }

  return record.comment;
}

// =============================================================================
// FIX QUOTES ON TXT RECORDS
// =============================================================================

function fixQuotes(record) {
  if (record.type !== 'TXT') return record.content;
  const content = record.content;
  const startsWithQuote = content.startsWith('"');
  const endsWithQuote = content.endsWith('"');
  if (startsWithQuote && endsWithQuote) return content;
  let fixed = content;
  if (!startsWithQuote) fixed = `"${fixed}`;
  if (!endsWithQuote) fixed = `${fixed}"`;
  return fixed;
}

// =============================================================================
// ENFORCE SPF POLICY
// =============================================================================

function enforceSPF(record, content, brandConfig) {
  if (record.type !== 'TXT') return content;
  if (!content.toLowerCase().includes('v=spf1')) return content;

  const spfSetting = brandConfig?.edge?.providers?.cloudflare?.dns?.spf;
  if (!spfSetting) return content;

  const spfQualifiers = { strict: '-all', soft: '~all', neutral: '?all', pass: '+all' };
  const targetQualifier = spfQualifiers[spfSetting];
  if (!targetQualifier) return content;

  return content.replace(/([~\-+?])?all/g, targetQualifier);
}

// =============================================================================
// REORDER DMARC TAGS
// =============================================================================

// Stable rua ordering: configured report addresses first (in config order),
// everything else keeps its original position — so diffs don't churn on
// Cloudflare's arbitrary ordering (omega-manager hardcoded its own addresses
// here; the configured list is the general form)
function reorderRuaEmails(ruaValue, configuredRua = []) {
  const emails = ruaValue.split(',').map((e) => e.trim());
  if (configuredRua.length === 0) return emails.join(',');

  const ranked = emails.map((email, index) => {
    const rank = configuredRua.findIndex((addr) => email.toLowerCase().includes(addr.toLowerCase()));
    return { email, rank: rank === -1 ? configuredRua.length : rank, index };
  });
  ranked.sort((a, b) => a.rank - b.rank || a.index - b.index);
  return ranked.map((r) => r.email).join(',');
}

function reorderDMARC(record, content, brandConfig) {
  if (record.type !== 'TXT') return content;
  if (!content.toLowerCase().includes('v=dmarc1')) return content;

  let dmarcContent = content;
  const hasQuotes = dmarcContent.startsWith('"') && dmarcContent.endsWith('"');
  if (hasQuotes) dmarcContent = dmarcContent.slice(1, -1);

  const tags = {};
  const tagPairs = dmarcContent.split(';').map((tag) => tag.trim()).filter(Boolean);
  for (const pair of tagPairs) {
    const [key, ...valueParts] = pair.split('=');
    if (key && valueParts.length > 0) {
      tags[key.trim()] = valueParts.join('=').trim();
    }
  }

  const dnsConfig = brandConfig?.edge?.providers?.cloudflare?.dns;
  const dmarcSetting = dnsConfig?.dmarcPolicy;
  if (dmarcSetting && ['none', 'quarantine', 'reject'].includes(dmarcSetting)) {
    tags.p = dmarcSetting;
  }

  if (tags.rua) {
    tags.rua = reorderRuaEmails(tags.rua, dnsConfig?.dmarcReports?.rua || []);
  }

  const orderedKeys = ['v', 'p', 'rua', 'ruf', 'pct', 'adkim', 'aspf', 'ri', 'fo', 'rf'];
  const parts = [];
  for (const key of orderedKeys) {
    if (tags[key] !== undefined) parts.push(`${key}=${tags[key]}`);
  }
  for (const key in tags) {
    if (!orderedKeys.includes(key)) parts.push(`${key}=${tags[key]}`);
  }

  let result = parts.join('; ');
  if (hasQuotes) result = `"${result}"`;
  return result;
}

// =============================================================================
// TXT IDENTITY
// =============================================================================

// Multiple TXT records live at one name, so "does this required TXT exist"
// can't be name+type alone (the apex SPF would match a verification token and
// never be created). Policy records match by kind — content drift is the
// update pass's job (enforceSPF/reorderDMARC); everything else matches by
// exact content.
function txtKind(content = '') {
  const stripped = content.replace(/^"|"$/g, '');
  const lower = stripped.toLowerCase();
  if (lower.startsWith('v=spf1')) return 'spf';
  if (lower.startsWith('v=dmarc1')) return 'dmarc';
  if (lower.startsWith('v=bimi1')) return 'bimi';
  return stripped;
}

// =============================================================================
// DIFF RECORDS - main entry point used by ensure handler
// =============================================================================

function diffRecords({ records, brandConfig, domain, isSubdomainProject, linkBrandingValid = false }) {
  let dnsConfig = brandConfig?.edge?.providers?.cloudflare?.dns;

  if (!dnsConfig && !isSubdomainProject) {
    return null;
  }

  // SendGrid's live word on the branded link rides IN on the sendgrid block —
  // the same shape `{ id, whitelabel }` arrive in, so the record builder reads
  // one object and stays pure ([#646]).
  if (dnsConfig?.sendgrid) {
    dnsConfig = { ...dnsConfig, sendgrid: { ...dnsConfig.sendgrid, linkBrandingValid } };
  }

  // For subdomain projects, filter records to only those belonging to this subdomain
  let relevantRecords = records;
  if (isSubdomainProject) {
    relevantRecords = records.filter((r) => {
      const name = r.name.toLowerCase();
      const subDomain = domain.toLowerCase();
      return name === subDomain || name.endsWith(`.${subDomain}`);
    });
  }

  const emailProvider = resolveEmailProvider(brandConfig);
  const requiredRecords = buildRequiredRecords(domain, dnsConfig, isSubdomainProject, emailProvider);
  const toCreate = [];
  const configOverrides = [];
  const uniqueRecordTypes = ['CNAME'];

  for (const required of requiredRecords) {
    const existing = relevantRecords.find((r) =>
      r.name.toLowerCase() === required.name.toLowerCase() && r.type === required.type
      && (required.type !== 'TXT' || txtKind(r.content) === txtKind(required.content)),
    );

    if (!existing) {
      console.log(`      ${chalk.yellow('⚠')} Missing: ${chalk.cyan(`${required.type} ${required.name}`)}`);
      toCreate.push(required);
    } else if (uniqueRecordTypes.includes(required.type)) {
      const contentDiff = existing.content !== required.content;
      const proxiedDiff = required.proxied !== undefined && existing.proxied !== required.proxied;
      if (contentDiff || proxiedDiff) {
        const reasons = [];
        if (contentDiff) reasons.push(`${chalk.dim(existing.content)} => ${chalk.cyan(required.content)}`);
        if (proxiedDiff) reasons.push(`proxied: ${existing.proxied} => ${required.proxied}`);
        console.log(`      ${chalk.dim('·')} Override: ${chalk.cyan(`${required.type} ${required.name}`)} (${reasons.join(', ')})`);
        configOverrides.push({
          ...existing,
          content: contentDiff ? required.content : existing.content,
          comment: required.comment || existing.comment,
          proxied: required.proxied !== undefined ? required.proxied : existing.proxied,
        });
      }
    }
  }

  const toDelete = isSubdomainProject ? [] : findObsoleteMxRecords(relevantRecords, domain, emailProvider);

  const replaceableTypes = ['A', 'AAAA', 'CNAME'];
  for (const existing of relevantRecords) {
    if (!replaceableTypes.includes(existing.type)) continue;
    const requiredForThisName = requiredRecords.filter((r) =>
      r.type === existing.type && r.name.toLowerCase() === existing.name.toLowerCase(),
    );
    if (requiredForThisName.length > 0) {
      const isInRequired = requiredForThisName.some((r) => r.content === existing.content);
      if (!isInRequired) {
        console.log(`      ${chalk.dim('·')} Replace: ${chalk.cyan(`${existing.type} ${existing.name}`)} (${chalk.dim(existing.content)} not in config)`);
        toDelete.push(existing);
      }
    }
  }

  const toUpdate = [...configOverrides];
  const overrideIds = new Set(configOverrides.map((r) => r.id));

  const requiredByKey = new Map(
    requiredRecords.map((r) => [`${r.type}:${r.name.toLowerCase()}`, r]),
  );

  for (const existing of relevantRecords) {
    if (toDelete.some((d) => d.id === existing.id) || overrideIds.has(existing.id)) continue;

    const newComment = determineComment(existing, domain);
    let newContent = fixQuotes(existing);

    if (!isSubdomainProject) {
      newContent = enforceSPF(existing, newContent, brandConfig);
      newContent = reorderDMARC(existing, newContent, brandConfig);
    }

    const required = requiredByKey.get(`${existing.type}:${existing.name.toLowerCase()}`);
    const expectedProxied = required?.proxied;
    const proxiedChanged = expectedProxied !== undefined && existing.proxied !== expectedProxied;

    const commentChanged = newComment !== existing.comment;
    const contentChanged = newContent !== existing.content;

    if (commentChanged || contentChanged || proxiedChanged) {
      const changes = [];
      if (commentChanged) changes.push(`comment: "${existing.comment || ''}" => "${newComment}"`);
      if (contentChanged) changes.push('content changed');
      if (proxiedChanged) changes.push(`proxied: ${existing.proxied} => ${expectedProxied}`);
      console.log(`      ${chalk.dim('·')} Update: ${chalk.cyan(`${existing.type} ${existing.name}`)} (${changes.join(', ')})`);
      toUpdate.push({
        ...existing,
        comment: newComment,
        content: newContent,
        ...(proxiedChanged && { proxied: expectedProxied }),
      });
    }
  }

  if (!isSubdomainProject) {
    validateDynamicRecords(relevantRecords, domain);
  }

  if (toCreate.length === 0 && toUpdate.length === 0 && toDelete.length === 0) {
    return null;
  }

  return { toCreate, toUpdate, toDelete };
}

module.exports = {
  buildRequiredRecords,
  findObsoleteMxRecords,
  validateDynamicRecords,
  determineComment,
  fixQuotes,
  enforceSPF,
  reorderDMARC,
  diffRecords,
};
