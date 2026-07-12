/**
 * D13: content-publish implies deploy. After a post commit lands on the
 * website repo, dispatch its build workflow — `settings.deploy: false` opts
 * out; plain code/config commits deploy nothing (scaffolded workflows carry
 * no push triggers). Non-fatal: the post exists either way; the outcome
 * surfaces in the response payload as `deployDispatched`.
 */
const { buildDispatch, dispatchWorkflow } = require('@omega.js/devkit/deploy');

const WORKFLOW = 'build.yml';

module.exports = async function dispatchDeploy(assistant, octokit, settings) {
  settings.deploy = settings.deploy !== false;
  if (!settings.deploy) {
    return settings;
  }

  const owner = settings.githubUser;
  const repo = settings.githubRepo;

  try {
    // workflow_dispatch needs a real ref — use the repo's default branch
    const { data } = await octokit.rest.repos.get({ owner, repo });
    const plan = buildDispatch({ owner, repo, workflow: WORKFLOW, ref: data.default_branch });

    await dispatchWorkflow(plan, { token: process.env.GH_TOKEN });
    settings.deployDispatched = true;
    assistant.log(`dispatchDeploy(): dispatched ${WORKFLOW} on ${owner}/${repo}@${data.default_branch}`);
  } catch (e) {
    settings.deployDispatched = false;
    assistant.warn(`dispatchDeploy(): deploy dispatch failed (post still committed): ${e.message}`);
  }

  return settings;
};
