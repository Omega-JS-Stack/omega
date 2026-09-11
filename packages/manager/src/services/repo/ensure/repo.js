/**
 * Ensure the brand-monorepo repo exists on GitHub with the right settings.
 *
 * Missing → created EMPTY (the brand already exists locally — the user pushes
 * to it; no template, no clone: that's onboarding's job). Existing → diff
 * visibility + homepage, patch only the drift (omega-manager's exact repo
 * reconciliation, minus per-target repos).
 *
 * The repo identity is pure derivation from config (repo.providers.github +
 * brand.id), so nothing about it is persisted — every service that needs it
 * derives it the same way.
 */
const chalk = require('chalk').default;
const { brandRepoName, brandRepoOwner } = require('@omega.js/config');
const { dryRunPlan } = require('../../../lib/run-gates.js');

module.exports = async function ensureRepo(context) {
  const { brandConfig, options = {}, githubApi: api } = context;

  const github = brandConfig.repo?.providers?.github;
  const repoName = brandRepoName(brandConfig);
  const repoOwner = brandRepoOwner(brandConfig);
  const fullName = `${repoOwner}/${repoName}`;
  const isPrivate = github.private !== false;
  const homepage = brandConfig.brand?.url || '';

  const repo = api.getRepo(repoOwner, repoName);

  // ── Missing: create it ─────────────────────────────────────────────────────
  if (!repo) {
    if (options.dryRun) {
      return dryRunPlan(`create ${fullName} (${isPrivate ? 'private' : 'public'})`, { status: 'success', output: { repo: { planned: 'create' } } });
    }

    console.log(`      Creating ${chalk.cyan(fullName)}...`);

    try {
      const created = api.createRepo(repoOwner, repoName, {
        isPrivate,
        description: brandConfig.brand?.description || '',
        homepage,
      });

      console.log(`      ${chalk.green('✓')} Created: ${chalk.cyan(created.html_url)}`);
      console.log(`      ${chalk.dim(`Push your local repo: git remote add origin ${created.html_url}.git && git push -u origin main`)}`);

      return {
        status: 'success',
        state: { repo: { fullName, htmlUrl: created.html_url, private: isPrivate } },
        output: { repo: { created: true } },
      };
    } catch (error) {
      console.log(`      ${chalk.red('✗')} Failed to create repo${chalk.dim(`: ${error.message}`)}`);
      return { status: 'error', error: error.message };
    }
  }

  // ── Exists: reconcile settings ─────────────────────────────────────────────
  const updates = {};

  if (repo.private !== isPrivate) {
    updates.private = isPrivate;
    console.log(`      private: ${repo.private} ${chalk.dim('→')} ${chalk.cyan(isPrivate)}`);
  }

  if (homepage && repo.homepage !== homepage) {
    updates.homepage = homepage;
    console.log(`      homepage: "${repo.homepage || '(none)'}" ${chalk.dim('→')} "${chalk.cyan(homepage)}"`);
  }

  // Built output is never the default branch (#872): a first deploy that
  // creates gh-pages on an empty repo leaves GitHub pointing the repo (and
  // every workflow dispatch, which reads the DEFAULT branch) at the
  // published site. Only ever flipped back to a `main` that exists.
  if (repo.default_branch === 'gh-pages' && api.branchExists(repoOwner, repoName, 'main')) {
    updates.default_branch = 'main';
    console.log(`      default_branch: ${repo.default_branch} ${chalk.dim('→')} ${chalk.cyan('main')}`);
  }

  const state = { repo: { fullName, htmlUrl: repo.html_url, private: isPrivate } };

  if (Object.keys(updates).length === 0) {
    console.log(`      ${chalk.green('✓')} ${chalk.cyan(fullName)} already configured`);
    return { status: 'success', state };
  }

  if (options.dryRun) {
    return dryRunPlan('update repo settings', { status: 'success', state, output: { repo: { planned: Object.keys(updates) } } });
  }

  try {
    api.updateRepo(repoOwner, repoName, updates);
    console.log(`      ${chalk.green('✓')} ${chalk.cyan(fullName)} updated`);
    return { status: 'success', state, output: { repo: { updated: Object.keys(updates) } } };
  } catch (error) {
    console.log(`      ${chalk.red('✗')} Failed to update repo${chalk.dim(`: ${error.message}`)}`);
    return { status: 'error', error: error.message };
  }
};
