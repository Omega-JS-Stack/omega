/**
 * Ensure the brand-monorepo repo exists on GitHub with the right settings.
 *
 * Missing → created EMPTY (the brand already exists locally — the user pushes
 * to it; no template, no clone: that's onboarding's job). Existing → diff
 * visibility + homepage, patch only the drift (omega-manager's exact repo
 * reconciliation, minus per-target repos).
 *
 * State: { repo: { fullName, htmlUrl, private } } → .omega/state.json —
 * later services (analytics, seo, …) read the repo identity from here.
 */
const chalk = require('chalk').default;

module.exports = async function ensureRepo(context) {
  const { brandId, brandConfig, options = {}, githubApi: api } = context;

  const github = brandConfig.github;
  const repoName = github.repo || brandId;
  const fullName = `${github.org}/${repoName}`;
  const isPrivate = github.private !== false;
  const homepage = brandConfig.brand?.url || '';

  const repo = api.getRepo(github.org, repoName);

  // ── Missing: create it ─────────────────────────────────────────────────────
  if (!repo) {
    if (options.dryRun) {
      console.log(`      ${chalk.dim(`⊘ Dry run — would create ${fullName} (${isPrivate ? 'private' : 'public'})`)}`);
      return { status: 'success', output: { repo: { planned: 'create' } } };
    }

    console.log(`      Creating ${chalk.cyan(fullName)}...`);

    try {
      const created = api.createRepo(github.org, repoName, {
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

  const state = { repo: { fullName, htmlUrl: repo.html_url, private: isPrivate } };

  if (Object.keys(updates).length === 0) {
    console.log(`      ${chalk.green('✓')} ${chalk.cyan(fullName)} already configured`);
    return { status: 'success', state };
  }

  if (options.dryRun) {
    console.log(`      ${chalk.dim('⊘ Dry run — repo update skipped')}`);
    return { status: 'success', state, output: { repo: { planned: Object.keys(updates) } } };
  }

  try {
    api.updateRepo(github.org, repoName, updates);
    console.log(`      ${chalk.green('✓')} ${chalk.cyan(fullName)} updated`);
    return { status: 'success', state, output: { repo: { updated: Object.keys(updates) } } };
  } catch (error) {
    console.log(`      ${chalk.red('✗')} Failed to update repo${chalk.dim(`: ${error.message}`)}`);
    return { status: 'error', error: error.message };
  }
};
