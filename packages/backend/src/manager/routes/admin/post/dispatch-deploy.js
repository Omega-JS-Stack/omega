/**
 * D13: content-publish implies deploy. After a post commit lands on the
 * website repo, dispatch its build workflow — `settings.deploy: false` opts
 * out; plain code/config commits deploy nothing (scaffolded workflows carry
 * no push triggers). Non-fatal: the post exists either way; the outcome
 * surfaces in the response payload as `deployDispatched`.
 */
const { buildDispatch, dispatchWorkflow, SNAPSHOT_REF } = require('@omega.js/devkit/deploy');
const { composedWorkflowNameFor } = require('@omega.js/devkit/ci-workflows');
const { deployBranchHead } = require('../lib/deploy-branch.js');
const env = require('../../../libraries/env.js');

const WORKFLOW = 'build.yml';

module.exports = async function dispatchDeploy(ctx, octokit, settings) {
  settings.deploy = settings.deploy !== false;
  if (!settings.deploy) {
    return settings;
  }

  const owner = settings.githubUser;
  const repo = settings.githubRepo;
  // The post landed in the brand's SOURCE monorepo, where every target's CI is
  // composed under a per-target name (#265), so the workflow this dispatches
  // is the one the post's own web target owns (#887). devkit owns that naming
  // rule; nothing here restates it. The backend holds the target NAME and no
  // checkout to resolve a path against, so it asks the name-taking form.
  const workflow = composedWorkflowNameFor(settings.target, WORKFLOW);

  try {
    // The DEPLOY branch, never the default one (#919): CI only ever builds
    // `omega-deploy` (#915), which is where the last local deploy left the
    // framework tarballs, the rewritten manifests and the lockfile. A dispatch
    // of the default branch would install `file:` specs that name folders the
    // runner does not have. The branch name and the branch-exists read are both
    // the publish lib's, so the routes that WRITE the branch and the one that
    // dispatches it can never disagree about whether it is there.
    if (!await deployBranchHead({ octokit, owner, repo })) {
      // No fallback to building the default branch: a green run of the wrong
      // tree is worse than a post that waits for a deploy.
      throw new Error(`no deploy branch yet: run omega deploy once from the brand (${owner}/${repo} has no ${SNAPSHOT_REF})`);
    }

    const plan = buildDispatch({ owner, repo, workflow: workflow, ref: SNAPSHOT_REF });

    await dispatchWorkflow(plan, { token: env.get('GH_TOKEN') });
    settings.deployDispatched = true;
    ctx.log(`dispatchDeploy(): dispatched ${workflow} on ${owner}/${repo}@${SNAPSHOT_REF}`);
  } catch (e) {
    settings.deployDispatched = false;
    ctx.warn(`dispatchDeploy(): deploy dispatch failed (post still committed): ${e.message}`);
  }

  return settings;
};
