// Shared GitHub helpers used by push-secrets and the release pipeline.
//
// WHICH repo a verb addresses is not decided here: the app repo is
// @omega.js/config's `brandRepo` and the releases repo its `releasesRepo`, from
// config/omega.json5 alone (#799). The old package.json/git-remote discovery is
// gone: a brand nested in another repo (a target inside a brand monorepo, the
// playground inside the framework monorepo) resolved to the ENCLOSING repo.
//
// Octokit factory: returns an authenticated client when GH_TOKEN is set. Returns null otherwise so
// callers can choose to no-op or bail with a friendly message.
//
// Repo ensure: idempotently create a repo under <owner> if it doesn't exist. Used by the
// deploy precheck to auto-provision the brand's public releases repo.

// silent: true — pass a no-op logger so transient 404s during polling (e.g. fetching
// in-progress job logs) don't spam the console. Errors still surface via thrown rejections.
function getOctokit(opts = {}) {
  const token = process.env.GH_TOKEN;
  if (!token) return null;
  const { Octokit } = require('@octokit/rest');
  const config = { auth: token };
  if (opts.silent) {
    const noop = () => {};
    config.log = { debug: noop, info: noop, warn: noop, error: noop };
  }
  return new Octokit(config);
}

// Idempotent: returns true if the repo exists (created or already there), false on failure.
// Honors the `owner` distinction between user vs. org — the API endpoints differ.
async function ensureRepo(octokit, owner, repo, opts = {}) {
  const description = opts.description || '';
  const isPrivate = opts.private === true;

  try {
    await octokit.rest.repos.get({ owner, repo });
    return { created: false, exists: true };
  } catch (err) {
    if (err.status !== 404) throw err;
  }

  // Need to create. Check if owner is the authenticated user or an org.
  let isOrg = false;
  try {
    const { data: me } = await octokit.rest.users.getAuthenticated();
    isOrg = me.login.toLowerCase() !== owner.toLowerCase();
  } catch (e) {
    isOrg = true;
  }

  const params = {
    name: repo,
    description,
    private: isPrivate,
    has_issues: true,
    has_projects: false,
    has_wiki: false,
    auto_init: true,
  };

  if (isOrg) {
    await octokit.rest.repos.createInOrg({ org: owner, ...params });
  } else {
    await octokit.rest.repos.createForAuthenticatedUser(params);
  }

  return { created: true, exists: true };
}

module.exports = {
  getOctokit,
  ensureRepo,
};
