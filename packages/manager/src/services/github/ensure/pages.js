/**
 * Ensure GitHub Pages serves the brand's website from the brand repo:
 * gh-pages source branch + custom domain from brand.url.
 *
 * A missing gh-pages branch is NOT an error — it appears with the first
 * deploy (omega-manager treated it the same way). Old-world subdomain Pages
 * repos ({brand}-{sub}-website) don't map to the monorepo (one Pages site
 * per repo) — multi-site hosting is an open design question for the
 * cloudflare port.
 */
const chalk = require('chalk').default;
const { brandRepoName } = require('@omega.js/config');
const { dryRunPlan } = require('../../../lib/run-gates.js');

module.exports = async function ensurePages(context) {
  const { brand, brandConfig, options = {}, githubApi: api } = context;

  if (!brand.targets.includes('web')) {
    console.log(`      ${chalk.dim('⊘ No web target — Pages not needed')}`);
    return { status: 'success', output: { pages: { skipped: 'no web target' } } };
  }

  const github = brandConfig.github;
  const repoName = brandRepoName(brandConfig);
  const domain = (brandConfig.brand?.url || '').replace(/^https?:\/\//, '');

  // The branch only exists once the site has deployed at least once
  if (!api.branchExists(github.org, repoName, 'gh-pages')) {
    console.log(`      ${chalk.yellow('⚠')} No gh-pages branch yet — deploy the website first`);
    return { status: 'success', output: { pages: { skipped: 'no gh-pages branch' } } };
  }

  try {
    // Source: enabled, serving from gh-pages
    let pages = api.getPages(github.org, repoName);

    if (!pages) {
      if (options.dryRun) {
        return dryRunPlan('enable Pages on gh-pages', { status: 'success', output: { pages: { planned: ['enable', 'domain'] } } });
      }
      console.log(`      Enabling Pages on gh-pages...`);
      api.enablePages(github.org, repoName, { branch: 'gh-pages', path: '/' });
      console.log(`      ${chalk.green('✓')} Pages enabled`);
      pages = api.getPages(github.org, repoName);
    } else if (pages.source?.branch !== 'gh-pages') {
      if (options.dryRun) {
        dryRunPlan(`switch source branch ${pages.source?.branch} → gh-pages`);
      } else {
        console.log(`      Updating source branch to gh-pages...`);
        api.updatePages(github.org, repoName, { branch: 'gh-pages', path: '/' });
        console.log(`      ${chalk.green('✓')} Source branch updated`);
      }
    }

    // Custom domain
    if (pages?.cname !== domain) {
      if (options.dryRun) {
        return dryRunPlan(`set domain to ${domain}`, { status: 'success', output: { pages: { planned: ['domain'] } } });
      }
      console.log(`      Setting domain to ${chalk.cyan(domain)}...`);
      api.setPagesDomain(github.org, repoName, domain);
      console.log(`      ${chalk.green('✓')} Domain set to ${chalk.cyan(domain)}`);
      return { status: 'success', state: { pages: { domain } }, output: { pages: { updated: ['domain'] } } };
    }

    console.log(`      ${chalk.green('✓')} Pages serving ${chalk.cyan(domain)} from gh-pages`);
    return { status: 'success', state: { pages: { domain } } };
  } catch (error) {
    console.log(`      ${chalk.red('✗')} Pages configuration failed${chalk.dim(`: ${error.message}`)}`);
    return { status: 'warned', output: { pages: { error: error.message } } };
  }
};
