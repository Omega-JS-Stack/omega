// The Octokit factory for the release pipeline (uploads, the draft flip).
//
// WHICH repo a verb addresses is not decided here: the source repo is
// @omega.js/config's `sourceRepo` and the releases repo its `releasesRepo`,
// from config/omega.json5 alone (#799). The old package.json/git-remote
// discovery is gone: a brand nested in another repo (a target inside a brand
// monorepo, the playground inside the framework monorepo) resolved to the
// ENCLOSING repo.
//
// CREATING a repo is not decided here either (#883): every repo a brand owns
// is created and reconciled by `@omega.js/devkit/github-repo`'s ensureRepo, the
// one home the manage walk and the web deploy use too. This file's own copy is
// gone with it.
//
// Octokit factory: returns an authenticated client when GH_TOKEN is set. Returns null otherwise so
// callers can choose to no-op or bail with a friendly message.

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

module.exports = {
  getOctokit,
};
