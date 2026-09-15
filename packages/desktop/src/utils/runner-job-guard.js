// The box's half of "a self-hosted signer refuses any job that is not a trusted
// dispatch" ([#875](https://github.com/Omega-JS-Stack/omega/issues/875)): the
// three files `omega runner install` writes beside the runner, so the guard the
// listener runs before every job is CONFIGURATION on the box rather than a list
// baked into the shared desktop template.
//
// A runner is registered to ONE owner and serves only that owner's repos, so
// the guard is per box, configured by the box owner (Ian 2026-09-10). The files:
//
//   <runner home>\job-started.js        the hook itself, a copy of src/runner/job-started.js
//   <runner home>\allowed-repos.txt     one `owner/name` (or `owner/*`) per line
//   <runner home>\allowed-actors.txt    one GitHub login per line
//
// and the path of the first one is delivered to each registered runner through
// its own `<runner dir>\.env` as `ACTIONS_RUNNER_HOOK_JOB_STARTED`, the same
// file the private HOME travels in
// ([#807](https://github.com/Omega-JS-Stack/omega/issues/807)).
//
// Where the lists COME from at setup: the orgs this box registered against
// (`<org>/*`, which is exactly the scope a registration already has) and the
// `GH_TOKEN` user's own login. Narrowing `<org>/*` to individual repos, or
// adding a second account, is an edit of the file, which is why an org already
// answered for, by a wildcard or by any repo line, is never appended again.
const path    = require('path');
const jetpack = require('fs-jetpack');

// The hook owns the names of its own list files and the way it READS them, so
// the writer imports both rather than restating either: what this appends is
// what the hook sees, by construction. Requiring the hook here runs nothing
// (its work sits behind `require.main === module`), and the hook file itself
// stays builtins-only for the runner home it is copied into.
const { readList, REPOS_FILE, ACTORS_FILE } = require('../runner/job-started.js');

const HOOK_FILE = 'job-started.js';

const REPOS_HEADER = [
  '# The repositories this box will sign for (#875).',
  '# One `owner/name` per line; `owner/*` is every repo of one owner.',
  '# `npx omega runner install` appends a line for an org it registered and has',
  '# no line for yet, so narrowing one to single repos by hand sticks.',
  '',
].join('\n');

const ACTORS_HEADER = [
  '# The GitHub logins this box will sign for (#875): GITHUB_ACTOR must be one.',
  '# One login per line. A `workflow_dispatch` carries the deploy token\'s user,',
  '# which is the same account, so one line normally answers for every deploy.',
  '',
].join('\n');

/**
 * The three files, by absolute path.
 *
 * @param {string} home - The runner home.
 * @returns {{hook: string, repos: string, actors: string}} The paths.
 */
function jobGuardPaths(home) {
  return {
    hook:   path.join(home, HOOK_FILE),
    repos:  path.join(home, REPOS_FILE),
    actors: path.join(home, ACTORS_FILE),
  };
}

/**
 * The two allow lists, which are the box's CONFIGURATION: an uninstall keeps
 * them the way it keeps the box's `.env`, so a re-install never asks again and
 * a hand-narrowed list is never destroyed. The hook script is install state and
 * goes with the rest.
 *
 * @param {string} home - The runner home.
 * @returns {string[]} The two list paths.
 */
function jobGuardListFiles(home) {
  const { repos, actors } = jobGuardPaths(home);
  return [repos, actors];
}

// Append the lines the file does not answer for yet, and nothing else: a file
// that already answers for every line is not rewritten at all, so running the
// setup twice writes the same bytes once.
function appendMissing(file, header, wanted, answered) {
  const existing = readList(file);
  const missing  = wanted.filter((line) => !existing.some((entry) => answered(entry, line)));
  if (missing.length === 0 && jetpack.exists(file) === 'file') return [];

  const body = existing.length === 0 && jetpack.exists(file) !== 'file'
    ? `${header}${missing.join('\n')}\n`
    : `${(jetpack.read(file) || '').replace(/\n*$/, '\n')}${missing.join('\n')}\n`;
  jetpack.write(file, body);
  return missing;
}

/**
 * Lay the guard down beside the runner, idempotently.
 *
 * The hook script is COPIED from this package on every run, so a box picks up a
 * framework update the next time it installs or starts; the allow lists are the
 * operator's and are only ever appended to.
 *
 * @param {string} home - The runner home.
 * @param {object} [options]
 * @param {string[]} [options.orgs] - The orgs this box is registered against.
 * @param {string} [options.actor] - The GH_TOKEN user's login (absent = leave the actors file alone).
 * @param {object} [options.logger] - Logger for the one line each write prints.
 * @returns {{hook: string, repos: string, actors: string, added: {repos: string[], actors: string[]}}} The paths, and what was appended.
 */
function ensureRunnerJobGuard(home, options) {
  const { orgs = [], actor, logger } = options || {};
  const paths = jobGuardPaths(home);

  jetpack.copy(path.join(__dirname, '..', 'runner', HOOK_FILE), paths.hook, { overwrite: true });

  // An org is answered for by a `<org>/*` line OR by any single repo of it: a
  // person who narrowed `Omega-JS-Stack/*` to one repo does not get the
  // wildcard back on the next install.
  const addedRepos = appendMissing(
    paths.repos,
    REPOS_HEADER,
    orgs.map((org) => `${org}/*`),
    (entry, line) => entry.split('/')[0].toLowerCase() === line.split('/')[0].toLowerCase(),
  );

  // No actor (an offline heal, or a `GET /user` that did not answer) writes the
  // file's header and nothing else: the operator sees the file the hook names,
  // and an empty list refuses every job rather than passing one.
  const addedActors = appendMissing(
    paths.actors,
    ACTORS_HEADER,
    actor ? [actor] : [],
    (entry, line) => entry.toLowerCase() === line.toLowerCase(),
  );

  if (logger) {
    if (addedRepos.length > 0)  logger.log(`  Job guard: added ${addedRepos.join(', ')} to ${paths.repos}`);
    if (addedActors.length > 0) logger.log(`  Job guard: added ${addedActors.join(', ')} to ${paths.actors}`);
  }

  return { ...paths, added: { repos: addedRepos, actors: addedActors } };
}

module.exports = {
  HOOK_FILE,
  REPOS_FILE,
  ACTORS_FILE,
  jobGuardPaths,
  jobGuardListFiles,
  ensureRunnerJobGuard,
};
