/**
 * Cloudflare service — reconciles the brand's zone to `cloudflare: {}` in
 * omega.json5: zone existence, DNS records, email routing, zone settings,
 * rulesets (cache/redirect/configuration/response-headers/security/managed-
 * transforms), speed tests, and workers. Ported from omega-manager; every
 * handler follows read → diff → write because Cloudflare requires fetching
 * current state before patching.
 *
 * Auth: CLOUDFLARE_TOKEN in the brand .env. No token → the service skips.
 *
 * Subdomain projects (brand.url is not an apex domain) use the parent zone
 * and only run zone + dns-records — zone-level settings belong to the parent
 * brand.
 *
 * Each handler caches its read step to .omega/cache/cloudflare/{op}.json.
 */
const chalk = require('chalk').default;
const { REQUIRES } = require('../../config.js');
const { createServiceRunner } = require('../../lib/service-runner.js');
const { CloudflareAPI } = require('./lib/cloudflare-api.js');
const { getApexDomain } = require('../../lib/domain-utils.js');
const { ensureEnvSecrets } = require('../../lib/env-secrets.js');

// Operations allowed for subdomain projects (zone-level settings are skipped)
const SUBDOMAIN_OPERATIONS = new Set(['zone', 'dns-records']);

module.exports.run = createServiceRunner({
  serviceDir: __dirname,
  setup: async (context) => {
    const cloudflare = context.brandConfig.edge?.providers?.cloudflare || {};

    if (cloudflare.enabled === false) {
      return { skip: true, reason: 'edge.providers.cloudflare.enabled = false' };
    }

    if (!context.cloudflareApi) {
      const gate = await ensureEnvSecrets(context, REQUIRES.cloudflare.env);
      if (gate) return gate;
    }

    const domain = (context.brandConfig.brand?.url || '').replace(/^https?:\/\//, '');
    if (!domain) {
      return { skip: true, reason: 'no brand.url configured' };
    }

    // Tests inject a fake client via context.cloudflareApi
    const api = context.cloudflareApi || new CloudflareAPI();

    const apexDomain = getApexDomain(domain);
    const isSubdomainProject = domain !== apexDomain;
    const zoneDomain = apexDomain;
    const zone = await api.getZoneByName(zoneDomain);

    if (isSubdomainProject) {
      console.log(`    Subdomain project detected: ${chalk.cyan(domain)}`);
      console.log(`    Using parent zone: ${chalk.cyan(zoneDomain)}`);
    }

    const filteredOperations = isSubdomainProject
      ? context.operations.filter((op) => SUBDOMAIN_OPERATIONS.has(op.name))
      : context.operations;

    return {
      cloudflareApi: api,
      domain,           // Full domain (e.g. app.mybrand.com)
      zoneDomain,       // Apex/zone domain (e.g. mybrand.com)
      isSubdomainProject,
      zoneId: zone?.id || null,
      zone,
      operations: filteredOperations,
    };
  },
});
