/**
 * The GitHub repo boundary, ONE home
 * ([#883](https://github.com/Omega-JS-Stack/omega/issues/883)).
 *
 * Three lanes used to talk to GitHub their own way: the manager's repo service
 * (a gh-CLI wrapper), @omega.js/desktop's release precheck (an Octokit client
 * with its own `ensureRepo`), and the extension's publish workflow (a `gh
 * release` shell step inside a YAML template). Same four questions, three
 * answers, three places to fix a bug. This module is the answer: every repo a
 * brand owns is created, reconciled and served from here.
 *
 * Transport: the `gh` CLI through execFile with an ARGV ARRAY, never a shell
 * string, so a brand-config value (a description, a homepage, a domain) can
 * never inject a command. `gh` is already required by the manager and ships on
 * every GitHub runner. Auth is the ambient `gh auth` session or a
 * GH_TOKEN/GITHUB_TOKEN in the env, which gh honors on its own: nothing here
 * reads, logs or passes a token.
 *
 * Every ensure is IDEMPOTENT and returns the same shape,
 * `{ created, changed, planned }`, where `planned` is the human-readable list
 * of what the call does (or WOULD do under `dryRun`), so a dry run prints the
 * plan and a real run reports the same lines.
 */

const { execFileSync } = require('node:child_process');

// GitHub Pages serves the built site from one orphan branch, the same one
// every OMEGA web deploy force-pushes.
const DEFAULT_PAGES_BRANCH = 'gh-pages';

// The plan name GitHub reports for a free org, and the answer for an owner
// with no plan to read (a user account): the two cases that cannot host a
// private Pages site.
const FREE_PLAN = 'free';

/**
 * Run `gh` with an argv array and return its trimmed stdout.
 *
 * @param {string[]} args - The argv after `gh` (e.g. ['api', 'repos/o/r']).
 * @param {object} [options]
 * @param {function} [options.execFn] - Injectable `(file, args, opts) => stdout` (tests).
 * @param {number} [options.timeout] - Milliseconds before the call is given up on (default: none).
 * @returns {string} Trimmed stdout ('' when gh printed nothing).
 * @throws {Error} When gh exits non-zero or times out, carrying its stderr.
 */
function gh(args, options = {}) {
  const execFn = options.execFn || execFileSync;

  try {
    return String(execFn('gh', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: options.timeout })).trim();
  } catch (error) {
    const stderr = (error.stderr && error.stderr.toString()) || error.message;
    throw new Error(`gh ${args.join(' ')} failed: ${stderr.trim()}`);
  }
}

/**
 * Run a `gh` call whose output is JSON.
 * @param {string[]} args - The argv after `gh`.
 * @param {object} [options] - See gh().
 * @returns {object|null} The parsed body, or null when gh printed nothing.
 */
function ghJson(args, options = {}) {
  const out = gh(args, options);
  return out ? JSON.parse(out) : null;
}

/**
 * A missing resource, told from a real failure: gh prints the status line, so a
 * 404 is the answer "it does not exist" and anything else is a problem to raise.
 * @param {Error} error - The error gh() threw.
 * @returns {boolean}
 */
function isNotFound(error) {
  return /404|Not Found/i.test(error.message);
}

/**
 * A repository's API record.
 * @param {string} owner - Org or user.
 * @param {string} name - Repo name.
 * @param {object} [options] - See gh().
 * @returns {object|null} The repo json, or null when it does not exist.
 */
function getRepo(owner, name, options = {}) {
  try {
    return ghJson(['api', `repos/${owner}/${name}`], options);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

/**
 * Create a repo when it is missing, else reconcile the two facts a brand
 * declares about it: its visibility and its homepage. The description is a
 * create-time value (nothing derives it after the fact).
 *
 * @param {object} repo - The repo to ensure.
 * @param {string} repo.owner - Org or user.
 * @param {string} repo.name - Repo name.
 * @param {boolean} [repo.private] - Visibility (default private).
 * @param {string} [repo.description] - Set when the repo is created.
 * @param {string} [repo.homepage] - The repo's url field, reconciled on drift.
 * @param {string} [repo.reason] - Why this visibility, stated on the create line
 *   the plan prints. The CALLER owns the why (a website repo is public because
 *   the org is on the free plan, which only the manage walk knows), so it hands
 *   the words in rather than reformatting a line it matched by string.
 * @param {boolean} [repo.autoInit] - Create with a first commit. A repo that
 *   must carry a commit before anything can publish to it (the releases repo:
 *   a release needs a tag, and a tag needs a commit) asks for it; a repo whose
 *   history is pushed from a machine never does, since an initial commit it did
 *   not make is a push it has to fight.
 * @param {object} [options]
 * @param {boolean} [options.dryRun] - Build the plan and touch nothing.
 * @param {function} [options.execFn] - Injectable exec (tests).
 * @returns {{ created: boolean, changed: boolean, planned: string[] }}
 */
function ensureRepo(repo, options = {}) {
  const { owner, name } = repo;
  const slug = `${owner}/${name}`;
  const isPrivate = repo.private !== false;
  const existing = getRepo(owner, name, options);

  if (!existing) {
    const planned = [`create ${slug} (${isPrivate ? 'private' : 'public'}${repo.reason ? `: ${repo.reason}` : ''})`];
    if (options.dryRun) return { created: false, changed: false, planned };

    const args = ['repo', 'create', slug, isPrivate ? '--private' : '--public'];
    if (repo.description) args.push('--description', repo.description);
    if (repo.homepage) args.push('--homepage', repo.homepage);
    if (repo.autoInit) args.push('--add-readme');
    gh(args, options);

    return { created: true, changed: false, planned };
  }

  const fields = [];
  const planned = [];

  if (existing.private !== isPrivate) {
    fields.push('-F', `private=${isPrivate}`);
    planned.push(`${slug}: ${isPrivate ? 'public -> private' : 'private -> public'}`);
  }

  if (repo.homepage && existing.homepage !== repo.homepage) {
    fields.push('-f', `homepage=${repo.homepage}`);
    planned.push(`${slug}: homepage -> ${repo.homepage}`);
  }

  if (!fields.length) return { created: false, changed: false, planned };
  if (options.dryRun) return { created: false, changed: false, planned };

  gh(['api', `repos/${slug}`, '-X', 'PATCH', ...fields], options);

  return { created: false, changed: true, planned };
}

/**
 * A repo's GitHub Pages configuration.
 * @param {string} owner - Org or user.
 * @param {string} name - Repo name.
 * @param {object} [options] - See gh().
 * @returns {object|null} The pages json, or null when Pages is off.
 */
function getPages(owner, name, options = {}) {
  try {
    return ghJson(['api', `repos/${owner}/${name}/pages`], options);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

/**
 * Whether a branch exists on a repo.
 * @param {string} owner - Org or user.
 * @param {string} name - Repo name.
 * @param {string} branch - Branch name.
 * @param {object} [options] - See gh().
 * @returns {boolean}
 */
function branchExists(owner, name, branch, options = {}) {
  try {
    ghJson(['api', `repos/${owner}/${name}/branches/${branch}`], options);
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

/**
 * Point GitHub Pages at the deploy branch and, when the target has one, at its
 * custom domain. Idempotent: a repo already serving that branch at that domain
 * is left alone.
 *
 * Pages cannot be configured before the branch exists, and the branch is what
 * the FIRST deploy pushes, so a fresh website repo reports `pending` instead of
 * failing: the next walk after the first deploy finishes the job.
 *
 * @param {object} pages - What to serve.
 * @param {string} pages.owner - Org or user.
 * @param {string} pages.name - Repo name.
 * @param {string} [pages.branch] - Source branch (default gh-pages).
 * @param {string} [pages.cname] - Custom domain (the host the target is served at).
 * @param {object} [options]
 * @param {boolean} [options.dryRun] - Build the plan and touch nothing.
 * @param {function} [options.execFn] - Injectable exec (tests).
 * @param {object} [options.logger] - `{ log }` (default: console).
 * @returns {{ created: boolean, changed: boolean, planned: string[], pending?: boolean }}
 */
function ensurePages(pages, options = {}) {
  const { owner, name, cname } = pages;
  const branch = pages.branch || DEFAULT_PAGES_BRANCH;
  const slug = `${owner}/${name}`;
  const logger = options.logger || console;

  if (!branchExists(owner, name, branch, options)) {
    logger.log(`${slug} has no ${branch} branch yet: Pages configures after the first deploy`);
    return { created: false, changed: false, planned: [], pending: true };
  }

  const existing = getPages(owner, name, options);
  const planned = [];

  if (!existing) {
    planned.push(`pages ${slug}: ${branch}${cname ? ` -> ${cname}` : ''}`);
    if (options.dryRun) return { created: false, changed: false, planned };

    gh(['api', `repos/${slug}/pages`, '-X', 'POST', '-f', `source[branch]=${branch}`, '-f', 'source[path]=/'], options);
    if (cname) gh(['api', `repos/${slug}/pages`, '-X', 'PUT', '-f', `cname=${cname}`], options);

    return { created: true, changed: false, planned };
  }

  const sourceBranch = existing.source ? existing.source.branch : undefined;
  let changed = false;

  if (sourceBranch !== branch) {
    planned.push(`pages ${slug}: ${sourceBranch || 'none'} -> ${branch}`);
    if (!options.dryRun) {
      gh(['api', `repos/${slug}/pages`, '-X', 'PUT', '-f', `source[branch]=${branch}`, '-f', 'source[path]=/'], options);
      changed = true;
    }
  }

  if (cname && existing.cname !== cname) {
    planned.push(`pages ${slug}: domain -> ${cname}`);
    if (!options.dryRun) {
      gh(['api', `repos/${slug}/pages`, '-X', 'PUT', '-f', `cname=${cname}`], options);
      changed = true;
    }
  }

  return { created: false, changed, planned };
}

/**
 * An owner's GitHub plan, which is what says whether a private repo may serve
 * Pages at all: only a paid org can. A USER owner and an org whose plan the
 * token cannot read both answer `free`, the half that cannot, because guessing
 * the other way publishes a site the brand meant to keep private.
 *
 * @param {string} owner - Org or user.
 * @param {object} [options] - See gh().
 * @returns {string} 'free' or the plan name.
 */
function ownerPlan(owner, options = {}) {
  let org;
  try {
    org = ghJson(['api', `orgs/${owner}`], options);
  } catch (error) {
    if (isNotFound(error)) return FREE_PLAN;
    throw error;
  }

  return (org && org.plan && org.plan.name) || FREE_PLAN;
}

module.exports = {
  gh,
  getRepo,
  ensureRepo,
  getPages,
  ensurePages,
  ownerPlan,
  DEFAULT_PAGES_BRANCH,
  FREE_PLAN,
};
