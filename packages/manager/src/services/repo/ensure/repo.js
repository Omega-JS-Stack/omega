/**
 * The SOURCE role (#883): `<brand.id>-omega`, the monorepo the brand is
 * written in, at the visibility its own package.json states.
 *
 * Missing means created EMPTY: the brand already exists locally and the user
 * pushes to it, so nothing is cloned and no initial commit is made (an
 * `--add-readme` here is a commit the first push has to fight). No homepage
 * either, because the brand's url belongs to the WEBSITE repo that serves it.
 *
 * The step also reports the Pages retirement: a source repo still serving
 * GitHub Pages is the pre-#883 shape, where the built site force-pushed a
 * `gh-pages` branch onto the monorepo. The walk never deletes it, since a
 * custom domain can only be on one repo at a time and the order is the
 * owner's call; it names the two by-hand steps and carries a warned status
 * until they are done.
 */
const chalk = require('chalk').default;
const { dryRunPlan } = require('../../../lib/run-gates.js');

/**
 * Reconcile the brand's source repo, and report the Pages retirement.
 *
 * @param {object} context - The service context: githubApi, sourceRepoInfo,
 *   brandVisibility, brandConfig, options.
 * @returns {Promise<object>} A handler return: `{ status, reason?, state, output }`.
 */
module.exports = async function ensureSourceRepo(context) {
  const { brandConfig, options = {}, githubApi: github, sourceRepoInfo: source, brandVisibility: visibility } = context;

  const isPrivate = visibility === 'private';
  let result;

  try {
    result = github.ensureRepo({
      owner: source.owner,
      name: source.name,
      private: isPrivate,
      description: brandConfig.brand?.description || '',
    }, { dryRun: options.dryRun });
  } catch (error) {
    console.log(`      ${chalk.red('✗')} Could not reconcile ${source.slug}${chalk.dim(`: ${error.message}`)}`);
    return { status: 'error', error: error.message };
  }

  const state = { repo: { fullName: source.slug, private: isPrivate } };

  if (options.dryRun && result.planned.length) {
    dryRunPlan(result.planned.join(', '), null);
    return { ...retirementReport(context, source), state, output: { repo: { planned: result.planned } } };
  }

  if (result.created) {
    console.log(`      ${chalk.green('✓')} Created ${chalk.cyan(source.slug)} (${visibility})`);
    console.log(`      ${chalk.dim(`Push your local repo: git remote add origin https://github.com/${source.slug}.git && git push -u origin main`)}`);
  } else if (result.changed) {
    console.log(`      ${chalk.green('✓')} ${chalk.cyan(source.slug)} updated${chalk.dim(`: ${result.planned.join(', ')}`)}`);
  } else {
    console.log(`      ${chalk.green('✓')} ${chalk.cyan(source.slug)} already configured`);
  }

  return {
    ...retirementReport(context, source),
    state,
    output: { repo: { created: result.created, changed: result.changed, planned: result.planned } },
  };
};

/**
 * The Pages-retirement report: warned while the source repo still serves
 * Pages, silent once it does not.
 *
 * @param {object} context - The service context (githubApi, options).
 * @param {{ owner: string, name: string, slug: string }} source - The source repo.
 * @returns {object} The `{ status, reason }` half of the handler return.
 */
function retirementReport(context, source) {
  const { githubApi: github } = context;

  // One read answers both halves: a repo that does not exist yet 404s the same
  // way a repo with Pages off does, and neither has anything to retire.
  const pages = github.getPages(source.owner, source.name);
  if (!pages) return { status: 'success' };

  const reason = `${source.slug} still serves GitHub Pages: the website moved to its own repo (#883)`;
  console.log(`      ${chalk.yellow('⚠')} ${reason}`);
  console.log(`      ${chalk.dim(`Retire it by hand, in this order: remove the custom domain, then \`gh api -X DELETE repos/${source.slug}/pages\`, then delete the gh-pages branch`)}`);

  return { status: 'warned', reason };
}
