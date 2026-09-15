/**
 * The WEBSITE role (#883): one `<brand.id>-<target name>` repo per web target
 * GitHub hosts, holding the BUILT site only, with Pages serving it at the
 * target's url.
 *
 * The built site used to force-push a `gh-pages` branch onto the brand's
 * SOURCE monorepo, which made a private brand impossible on a free org: Pages
 * on a private repo is a paid feature, so the source had to go public for the
 * site to serve. Splitting the roles ends that trade. The site repo carries no
 * source, so it is public whenever it has to be, and the monorepo stays at
 * whatever the brand's own package.json says.
 *
 * Visibility here is therefore NOT the brand's visibility: a private brand on
 * a PAID org gets a private site repo (Pages serves it), and a private brand
 * on a free org gets a public one, because the only other way to serve the
 * site is to publish the source. The plan line says which and why, every run.
 *
 * Pages itself is configured after the branch exists, which the first deploy
 * pushes: a fresh repo reports pending and the next walk finishes the job.
 */
const chalk = require('chalk').default;
const { targetsOfType, hostingProvider, websiteRepo, targetUrl, pagesHost } = require('@omega.js/config');
const { dryRunPlan } = require('../../../lib/run-gates.js');

// GitHub Pages serves the built site from this orphan branch, the one every
// OMEGA web deploy force-pushes.
const PAGES_BRANCH = 'gh-pages';

/**
 * Whether the site repo is private, and the one-line WHY the plan prints.
 *
 * @param {string} visibility - The brand's visibility ('private' | 'public').
 * @param {function} orgPlan - The memoized owner-plan read.
 * @param {string} org - The brand's GitHub org.
 * @returns {{ private: boolean, visibility: string, reason: string }}
 */
function resolveVisibility(visibility, orgPlan, org) {
  if (visibility !== 'private') {
    return { private: false, visibility: 'public', reason: 'the brand is public' };
  }

  const plan = orgPlan();

  // A free owner cannot serve Pages from a private repo at all, so the built
  // site is public: it is a build output, and the source stays private.
  if (plan === 'free') {
    return { private: false, visibility: 'public', reason: 'free plan' };
  }

  return { private: true, visibility: 'private', reason: `${org} is on the ${plan} plan` };
}

/**
 * Reconcile one website repo, and its Pages, per GitHub-hosted web target.
 *
 * @param {object} context - The service context: githubApi, repoOrg, orgPlan,
 *   brandVisibility, brandConfig, options.
 * @returns {Promise<object>} A handler return: `{ status, error?, output }`.
 */
module.exports = async function ensureWebsiteRepos(context) {
  const { brandConfig, options = {}, githubApi: github, repoOrg: block, brandVisibility: visibility, orgPlan } = context;

  const hosted = targetsOfType(brandConfig, 'web').filter((entry) => hostingProvider(brandConfig, entry.name) === 'github');

  if (!hosted.length) {
    console.log(`      ${chalk.dim('⊘ No GitHub-hosted web target, no website repo to own')}`);
    return { status: 'success', output: { website: { skipped: 'no GitHub-hosted web target' } } };
  }

  const repos = [];
  const planned = [];

  for (const entry of hosted) {
    const repo = websiteRepo(brandConfig, entry.name);
    const url = targetUrl(brandConfig, entry.name);
    // The config's ONE derivation, shared with the web deploy that writes the
    // CNAME file: a `*.github.io` address is no custom domain at all (#366).
    const host = pagesHost(brandConfig, entry.name);
    const wanted = resolveVisibility(visibility, orgPlan, block.org);

    console.log(`      ${chalk.cyan(repo.slug)} ${chalk.dim(`(${wanted.visibility}: ${wanted.reason})`)}`);

    let repoResult;
    let pagesResult;

    try {
      repoResult = github.ensureRepo({
        owner: repo.owner,
        name: repo.name,
        private: wanted.private,
        // The WHY is this role's alone, so it travels with the visibility and
        // devkit states it on the create line it composes.
        reason: wanted.reason,
        description: `${brandConfig.brand?.name || brandConfig.brand?.id} website (${entry.name})`,
        ...(url ? { homepage: url } : {}),
      }, { dryRun: options.dryRun });

      pagesResult = github.ensurePages({
        owner: repo.owner,
        name: repo.name,
        branch: PAGES_BRANCH,
        ...(host ? { cname: host } : {}),
      }, { dryRun: options.dryRun, logger: { log: (line) => console.log(`      ${chalk.dim(line)}`) } });
    } catch (error) {
      console.log(`      ${chalk.red('✗')} Could not reconcile ${repo.slug}${chalk.dim(`: ${error.message}`)}`);
      return { status: 'error', error: error.message };
    }

    const lines = [...repoResult.planned, ...pagesResult.planned];

    if (options.dryRun && lines.length) {
      dryRunPlan(lines.join(', '), null);
    } else if (!options.dryRun && lines.length) {
      console.log(`      ${chalk.green('✓')} ${lines.join(', ')}`);
    } else if (!options.dryRun && !pagesResult.pending) {
      console.log(`      ${chalk.green('✓')} ${chalk.cyan(repo.slug)} already configured`);
    }

    planned.push(...lines);
    repos.push({
      target: entry.name,
      slug: repo.slug,
      visibility: wanted.visibility,
      reason: wanted.reason,
      created: repoResult.created,
      changed: repoResult.changed,
      planned: lines,
      ...(pagesResult.pending ? { pagesPending: true } : {}),
    });
  }

  return { status: 'success', output: { website: { repos, planned } } };
};
