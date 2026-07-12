/**
 * Deploy executor — the ONE dispatch path for deliberate deploys (D13/D9).
 *
 * Commits never auto-publish: scaffolded workflows carry no push triggers, so
 * publishing is an explicit dispatch of the SAME CI build — from the local
 * CLI (`omega deploy`), a server-side action (the admin post route's
 * content-publish), or any plain HTTP caller. All three converge here: a
 * GitHub REST `workflow_dispatch` call (native fetch, no gh-CLI dependency —
 * Cloud Functions and laptops share the code path; locally the token can
 * still come from `gh auth token`).
 */
const { execSync } = require('node:child_process');

const API_BASE = 'https://api.github.com';

/**
 * Parse a git remote URL into { owner, repo }.
 * Handles ssh (git@github.com:o/r.git), https (https://github.com/o/r.git),
 * and .git-less forms.
 * @param {string} url - remote URL
 * @returns {{ owner: string, repo: string }|null}
 */
function parseRemoteUrl(url) {
  const match = (url || '').trim().match(/github\.com[/:]([^/]+)\/([^/\s]+?)(?:\.git)?$/);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

/**
 * Resolve the GitHub repo for a working directory from its origin remote.
 * @param {object} [options]
 * @param {string} [options.cwd] - repo directory (default: process.cwd())
 * @param {string} [options.remote] - remote name (default: origin)
 * @param {function} [options.execFn] - injectable exec (tests)
 * @returns {{ owner: string, repo: string }}
 */
function resolveRepo(options = {}) {
  const execFn = options.execFn || ((cmd, opts) => execSync(cmd, opts).toString());
  const url = execFn(`git config --get remote.${options.remote || 'origin'}.url`, {
    cwd: options.cwd || process.cwd(),
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const parsed = parseRemoteUrl(url);
  if (!parsed) {
    throw new Error(`Cannot parse a GitHub repo from remote url: ${String(url).trim() || '(none)'}`);
  }
  return parsed;
}

/**
 * Resolve a GitHub token: GH_TOKEN → GITHUB_TOKEN → `gh auth token`.
 * @param {object} [options]
 * @param {object} [options.env] - env map (default: process.env)
 * @param {function} [options.execFn] - injectable exec (tests)
 * @returns {string|null}
 */
function resolveToken(options = {}) {
  const env = options.env || process.env;
  if (env.GH_TOKEN) return env.GH_TOKEN;
  if (env.GITHUB_TOKEN) return env.GITHUB_TOKEN;

  const execFn = options.execFn || ((cmd, opts) => execSync(cmd, opts).toString());
  try {
    const token = execFn('gh auth token', { stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return token || null;
  } catch (e) {
    return null;
  }
}

/**
 * Build a workflow_dispatch plan — the exact REST call a deploy will make.
 * This IS the dry-run output: everything except the send.
 * @param {object} options
 * @param {string} options.owner - repo owner
 * @param {string} options.repo - repo name
 * @param {string} options.workflow - workflow file name (e.g. build.yml)
 * @param {string} [options.ref] - branch/tag to run on (default: main)
 * @param {object} [options.inputs] - workflow_dispatch inputs
 * @returns {{ method: string, url: string, body: object, runsUrl: string }}
 */
function buildDispatch(options) {
  for (const key of ['owner', 'repo', 'workflow']) {
    if (!options[key]) throw new Error(`buildDispatch: missing ${key}`);
  }
  const body = { ref: options.ref || 'main' };
  if (options.inputs && Object.keys(options.inputs).length > 0) body.inputs = options.inputs;

  return {
    method: 'POST',
    url: `${API_BASE}/repos/${options.owner}/${options.repo}/actions/workflows/${options.workflow}/dispatches`,
    body: body,
    runsUrl: `https://github.com/${options.owner}/${options.repo}/actions/workflows/${options.workflow}`,
  };
}

/**
 * Send a dispatch plan to GitHub (204 = accepted).
 * @param {object} plan - buildDispatch() result
 * @param {object} options
 * @param {string} options.token - GitHub token
 * @param {function} [options.fetchFn] - injectable fetch (tests)
 * @returns {Promise<object>} the plan, on success
 */
async function dispatchWorkflow(plan, options = {}) {
  if (!options.token) {
    throw new Error('No GitHub token — set GH_TOKEN in .env or sign in with `gh auth login`');
  }
  const fetchFn = options.fetchFn || fetch;
  const response = await fetchFn(plan.url, {
    method: plan.method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${options.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'omega-deploy',
    },
    body: JSON.stringify(plan.body),
  });

  if (response.status !== 204) {
    const text = await response.text().catch(() => '');
    throw new Error(`workflow_dispatch failed (${response.status}): ${text || response.statusText || 'unknown error'}`);
  }
  return plan;
}

/**
 * The one deploy path: resolve repo + token, build the plan, dispatch — or
 * return the plan untouched when dryRun is set.
 * @param {object} options
 * @param {string} options.workflow - workflow file name
 * @param {string} [options.cwd] - repo dir for remote resolution
 * @param {string} [options.owner] - explicit owner (skips git resolution)
 * @param {string} [options.repo] - explicit repo (skips git resolution)
 * @param {string} [options.ref] - branch (default main)
 * @param {object} [options.inputs] - workflow inputs
 * @param {boolean} [options.dryRun] - build the plan but never send
 * @param {object} [options.env] - env map for token resolution
 * @param {function} [options.fetchFn] - injectable fetch
 * @param {function} [options.execFn] - injectable exec
 * @returns {Promise<{ plan: object, dispatched: boolean }>}
 */
async function deployViaDispatch(options) {
  const target = options.owner && options.repo
    ? { owner: options.owner, repo: options.repo }
    : resolveRepo({ cwd: options.cwd, execFn: options.execFn });

  const plan = buildDispatch({
    owner: target.owner,
    repo: target.repo,
    workflow: options.workflow,
    ref: options.ref,
    inputs: options.inputs,
  });

  if (options.dryRun) {
    return { plan, dispatched: false };
  }

  const token = options.token || resolveToken({ env: options.env, execFn: options.execFn });
  await dispatchWorkflow(plan, { token, fetchFn: options.fetchFn });
  return { plan, dispatched: true };
}

module.exports = {
  parseRemoteUrl,
  resolveRepo,
  resolveToken,
  buildDispatch,
  dispatchWorkflow,
  deployViaDispatch,
};
