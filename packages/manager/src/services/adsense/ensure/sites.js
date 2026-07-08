/**
 * Ensure the brand's domain is present in AdSense and report its approval
 * state.
 *
 * The Management API v2 has no writes, so presence with a READY state is the
 * converged proof and everything else is guidance: missing → warned with the
 * add-site console deep-link (no API exists to add a site — rerun converges
 * once it appears), non-READY → warned with what Google is waiting on.
 */
const chalk = require('chalk').default;

// AdSense site approval states → run status + operator guidance
const STATES = {
  READY: { status: 'success', label: 'Ready (serving ads)' },
  GETTING_READY: { status: 'warned', label: 'Getting ready — Google is reviewing the site; rerun once approved' },
  REQUIRES_REVIEW: { status: 'warned', label: 'Requires review — request one in the AdSense console' },
  NEEDS_ATTENTION: { status: 'warned', label: 'Needs attention — resolve the issues in the AdSense console' },
};

module.exports = async function ensureSites(context) {
  const { adsenseApi, accountId, domain } = context;

  const sitesUrl = `https://adsense.google.com/adsense/u/0/${accountId}/sites/list?url=${domain}`;

  const sites = await adsenseApi.listSites(accountId);
  const site = sites.find((entry) => entry.domain === domain || entry.domain === `www.${domain}`);

  if (!site) {
    console.log(`      ${chalk.yellow('⚠')} ${chalk.cyan(domain)} is not added to AdSense`);
    console.log(`      ${chalk.dim('→')} No API exists to add it — add the site at: ${chalk.cyan(sitesUrl)}`);
    console.log(`      ${chalk.dim('→')} (rerun converges once it appears)`);
    return { status: 'warned', output: { sites: { domain, state: null, addUrl: sitesUrl } } };
  }

  const state = site.state || 'STATE_UNSPECIFIED';
  const display = STATES[state] || { status: 'warned', label: state };

  if (display.status === 'success') {
    console.log(`      ${chalk.green('✓')} ${chalk.cyan(site.domain)}: ${display.label}`);
  } else {
    console.log(`      ${chalk.yellow('⚠')} ${chalk.cyan(site.domain)}: ${display.label}`);
    console.log(`      ${chalk.dim('→')} ${chalk.cyan(sitesUrl)}`);
  }

  if (site.autoAdsEnabled !== undefined) {
    console.log(`      ${chalk.dim('→')} Auto ads: ${site.autoAdsEnabled ? 'enabled' : 'disabled'}`);
  }

  return {
    status: display.status,
    output: {
      sites: {
        domain: site.domain,
        state,
        autoAdsEnabled: site.autoAdsEnabled,
      },
    },
  };
};
