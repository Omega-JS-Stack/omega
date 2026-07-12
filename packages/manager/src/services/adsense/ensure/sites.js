/**
 * Ensure the brand's domain is present in AdSense and report its approval
 * state.
 *
 * The Management API v2 has no writes, so presence with a READY state is the
 * converged proof and everything else is guidance: missing → interactive runs
 * open the add-site console page and poll until the site appears,
 * non-interactive/dry runs warn with the deep-link (rerun converges once it
 * appears); non-READY → warned with what Google is waiting on.
 */
const chalk = require('chalk').default;
const { openBrowserAndPoll } = require('@omega.js/devkit/flows');
const { canPrompt } = require('../../../lib/run-gates.js');

// AdSense site approval states → run status + operator guidance
const STATES = {
  READY: { status: 'success', label: 'Ready (serving ads)' },
  GETTING_READY: { status: 'warned', label: 'Getting ready — Google is reviewing the site; rerun once approved' },
  REQUIRES_REVIEW: { status: 'warned', label: 'Requires review — request one in the AdSense console' },
  NEEDS_ATTENTION: { status: 'warned', label: 'Needs attention — resolve the issues in the AdSense console' },
};

module.exports = async function ensureSites(context) {
  const { adsenseApi, accountId, domain, options = {} } = context;

  const sitesUrl = `https://adsense.google.com/adsense/u/0/${accountId}/sites/list?url=${domain}`;
  const matchesDomain = (entry) => entry.domain === domain || entry.domain === `www.${domain}`;

  const sites = await adsenseApi.listSites(accountId);
  const site = sites.find(matchesDomain);

  if (site) {
    return reportSite(site, sitesUrl);
  }

  console.log(`      ${chalk.yellow('⚠')} ${chalk.cyan(domain)} is not added to AdSense ${chalk.dim('(no API exists to add it)')}`);

  // Interactive runs open the add-site page and poll until it appears
  if (canPrompt(options)) {
    const result = await openBrowserAndPoll({
      url: sitesUrl,
      promptMessage: `Add ${chalk.cyan(domain)} as a site in the AdSense console.`,
      waitMessage: 'Waiting for the site to appear',
      check: async () => {
        const fresh = (await adsenseApi.listSites(accountId)).find(matchesDomain);
        return fresh ? { done: true, result: fresh } : { done: false };
      },
      intervalMs: 5000,
      indent: '        ',
    });

    if (result.success && result.result) {
      return reportSite(result.result, sitesUrl);
    }
  }

  console.log(`      ${chalk.dim('→')} Add the site at: ${chalk.cyan(sitesUrl)}`);
  console.log(`      ${chalk.dim('→')} (rerun converges once it appears)`);
  return { status: 'warned', output: { sites: { domain, state: null, addUrl: sitesUrl } } };
};

/**
 * Report a present site's approval state (READY = success, anything else =
 * warned with the console deep-link).
 */
function reportSite(site, sitesUrl) {
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
}
