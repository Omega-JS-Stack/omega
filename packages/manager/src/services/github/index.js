/**
 * GitHub service — ensures the brand's GitHub presence matches config:
 * org profile, the brand-monorepo repo, and GitHub Pages. The monorepo
 * cousin of omega-manager's github service (which managed one repo per
 * target); here a brand is ONE repo.
 *
 * Config (brand omega.json5 `github` key):
 *   org      — repo owner (GitHub org or user). No default; unset = service skips.
 *   shared   — org shared with other brands → org-level reconciliation skipped.
 *   repo     — optional "owner/name" slug or bare name; name defaults to the
 *              brand id, owner to github.org (@omega.js/config brandRepoName/
 *              brandRepoOwner — shared with deploy --direct).
 *   private  — repo visibility (manager default: true).
 *   location — org profile location; only reconciled when set.
 */
const chalk = require('chalk').default;
const { brandRepoName, brandRepoOwner } = require('@omega.js/config');
const { createServiceRunner } = require('../../lib/service-runner.js');
const { GitHubAPI } = require('./lib/github-api.js');

// Operations that touch org-level settings — skipped when the org is shared
// with other brands (one brand must not rewrite a shared org's profile)
const SHARED_SKIP_OPERATIONS = new Set(['org']);

module.exports.run = createServiceRunner({
  serviceDir: __dirname,
  setup: (context) => {
    const github = context.brandConfig.github || {};

    if (github.enabled === false) {
      return { skip: true, reason: 'github.enabled = false' };
    }

    if (!github.org) {
      return { skip: true, reason: 'no github.org configured (set github.org in config/omega.json5)' };
    }

    const repoName = brandRepoName(context.brandConfig);
    const repoOwner = brandRepoOwner(context.brandConfig);
    console.log(`    Repo: ${chalk.cyan(`${repoOwner}/${repoName}`)}${github.shared === true ? chalk.dim(' (shared org)') : ''}`);

    // Tests inject a fake client via context.githubApi; the real one verifies
    // gh is installed + authenticated at construction
    const result = { githubApi: context.githubApi || new GitHubAPI() };

    if (github.shared === true) {
      result.operations = context.operations.filter((op) => !SHARED_SKIP_OPERATIONS.has(op.name));
    }

    return result;
  },
});
