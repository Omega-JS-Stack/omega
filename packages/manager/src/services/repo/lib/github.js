/**
 * The repo service's GitHub surface: @omega.js/devkit's github-repo module
 * (the ONE wrapper, #883) plus the three org-Actions reads only this service
 * makes.
 *
 * The manager used to carry its own `gh` client beside devkit's, which is two
 * answers to one question; the transport lives in devkit now and this file is
 * the manager's thin extension of it. Everything below goes through devkit's
 * `gh(args)` (execFile with an argv array, never a shell), so a brand-config
 * value can never inject a command.
 *
 * Auth is the ambient `gh auth` session or a GH_TOKEN/GITHUB_TOKEN in the
 * brand .env, which the walk loads before any service runs; gh honors both.
 * The check runs once, at construction, so the walk names a missing or
 * unauthenticated CLI instead of failing four calls deep.
 */
const {
  gh,
  getRepo,
  ensureRepo,
  getPages,
  ensurePages,
  ownerPlan,
} = require('@omega.js/devkit/github-repo');

/**
 * A missing resource, told from a real failure (devkit's `gh` carries gh's own
 * status line into the message).
 * @param {Error} error - The error gh() threw.
 * @returns {boolean}
 */
function isNotFound(error) {
  return /404|Not Found/i.test(error.message);
}

/**
 * Read a gh api endpoint as JSON.
 * @param {string} endpoint - The api path after `gh api`.
 * @returns {object|null} The parsed body, or null when gh printed nothing.
 */
function read(endpoint) {
  const out = gh(['api', endpoint]);
  return out ? JSON.parse(out) : null;
}

/**
 * Verify the gh CLI is installed and authenticated.
 * @throws {Error} With the one command that fixes it.
 */
function verifyGhCli() {
  try {
    gh(['--version']);
  } catch {
    throw new Error('GitHub CLI (gh) is not installed. Install from: https://cli.github.com/');
  }

  try {
    gh(['auth', 'status']);
  } catch {
    throw new Error('GitHub CLI is not authenticated. Run: gh auth login (or set GH_TOKEN in the brand .env)');
  }
}

/**
 * An account (org or user): the OWNER's type, which is what tells a
 * personal-account brand (no runner groups exist) from an org one (#872).
 * `users/{owner}` answers for both kinds.
 * @param {string} owner - Org or user login.
 * @returns {object|null} The account json, or null when it does not exist.
 */
function getUser(owner) {
  try {
    return read(`users/${owner}`);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

/**
 * The org's Actions runner groups (#872), as `{ total_count, runner_groups }`.
 * Throws on 403/404 (a token without the admin scope), which the runners
 * ensure step reads as "unreadable", never as a refusal.
 * @param {string} org - GitHub org login.
 * @returns {object|null} The groups payload.
 */
function getRunnerGroups(org) {
  return read(`orgs/${org}/actions/runner-groups`);
}

/**
 * The repositories a `visibility: selected` runner group serves (#879), as
 * `{ total_count, repositories }`. Reads the first 100, the page ceiling
 * GitHub allows (a signer group past that is not a shape we build for).
 * Throws on 403/404 like the groups read.
 * @param {string} org - GitHub org login.
 * @param {number} groupId - The runner group's id.
 * @returns {object|null} The repositories payload.
 */
function getRunnerGroupRepositories(org, groupId) {
  return read(`orgs/${org}/actions/runner-groups/${groupId}/repositories?per_page=100`);
}

/**
 * The GitHub surface the repo service's steps call, verified at construction.
 * Tests pass their own object of the same shape through `context.githubApi`.
 * @returns {object} `{ getRepo, ensureRepo, getPages, ensurePages, ownerPlan, getUser, getRunnerGroups, getRunnerGroupRepositories }`.
 */
function createGitHub() {
  verifyGhCli();

  return {
    getRepo,
    ensureRepo,
    getPages,
    ensurePages,
    ownerPlan,
    getUser,
    getRunnerGroups,
    getRunnerGroupRepositories,
  };
}

module.exports = { createGitHub, verifyGhCli };
