/**
 * Search service (`search.providers.searchConsole`) — the brand's Search
 * Console domain property (`sc-domain:{domain}` covers every subdomain),
 * created and verified via a DNS TXT record written through Cloudflare, plus
 * sitemap submission and the GA-association nudge.
 *
 * Runs after the edge service (the zone must exist for TXT verification) and
 * after analytics (the GA property is what ga-link associates with).
 *
 * Auth: GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET in the brand .env (OAuth2;
 * tokens cache to the ONE shared .omega/auth/google-tokens.json store
 * (lib/google-auth.js) alongside the firebase and analytics grants — the
 * webmasters + siteverification scopes ride the same file). No credentials →
 * the service skips.
 */
const { googleTokenStorePath } = require('../../lib/google-auth.js');
const { createServiceRunner } = require('../../lib/service-runner.js');
const { CloudflareAPI } = require('../edge/lib/cloudflare-api.js');
const { getApexDomain } = require('../../lib/domain-utils.js');
const { GoogleSearchConsoleAPI } = require('./lib/search-console-api.js');

module.exports.run = createServiceRunner({
  serviceDir: __dirname,
  setup: async (context) => {
    const searchConsole = context.brandConfig.search?.providers?.searchConsole || {};

    if (searchConsole.enabled === false) {
      return { skip: true, reason: 'search.providers.searchConsole.enabled = false' };
    }

    const domain = (context.brandConfig.brand?.url || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (!domain) {
      return { skip: true, reason: 'no brand.url configured' };
    }

    if (!context.searchConsoleApi && (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET)) {
      return { skip: true, reason: 'no GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET configured (set them in the brand .env)' };
    }

    const apexDomain = getApexDomain(domain);

    // Tests inject fake clients via context.searchConsoleApi / context.cloudflareApi.
    // Cloudflare is only needed when the property still has to be DNS-verified;
    // without a token the property operation prints the record to add manually.
    return {
      searchConsoleApi: context.searchConsoleApi || new GoogleSearchConsoleAPI({
        tokenStorePath: googleTokenStorePath(context.brandRoot),
      }),
      cloudflareApi: context.cloudflareApi
        || (process.env.CLOUDFLARE_TOKEN ? new CloudflareAPI() : null),
      domain,
      apexDomain,
      propertyUrl: `sc-domain:${domain}`,
    };
  },
});
