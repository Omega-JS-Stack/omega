/**
 * deploy-snapshot: push a brand folder to its repo as a MIRROR, then wait for
 * GitHub to see the workflow there
 * ([#872](https://github.com/Omega-JS-Stack/omega/issues/872)).
 *
 * A workflow only ever runs from code GitHub already has. A brand that is not
 * its own repo's toplevel (a brand inside this monorepo) and a brand carrying
 * `file:` links (whose packed tarballs must never enter its real history) both
 * hit the same wall: there is nothing to dispatch against. So the deploy pushes
 * what it has, as it is (Ian, 2026-09-10: "we just push the contents of the
 * repository whenever we need to use it"), and dispatches that.
 *
 * The commit is built OUT OF THE WAY: a temporary index, no branch, no stash,
 * no checkout, nothing a `git status` or a `git branch` can see, and the working
 * tree the developer is looking at is never touched. Its ROOT is the BRAND
 * FOLDER, never the enclosing repo's, so the mirror is a brand checkout and not
 * a copy of whatever tree the brand happens to live in, and it is PARENTLESS:
 * a mirror carries no history, which is also what keeps a public brand repo
 * from receiving the private tree it was cut from.
 *
 * What rides is what the brand's own ignore rules allow: tracked files plus
 * untracked-not-ignored ones, which is exactly how the staged `omega_modules/`
 * tarballs and the regenerated lockfile reach the runner.
 *
 * The token travels in the environment (`http.extraheader` through
 * GIT_CONFIG_*), never in argv, where every `ps` on the machine would read it.
 * The header is the BASIC form (`x-access-token:<token>`, base64), the one the
 * checkout action uses: git over https ignores a bearer header and falls back
 * to a username prompt (proven on the first playground push, #872).
 */

// Libraries
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const jetpack = require('fs-jetpack');

/**
 * The base64 credential git over https accepts for a token: the checkout
 * action's `x-access-token` basic form. A bearer header is ignored by the git
 * endpoints (they are not the REST API), so the push would prompt and fail.
 * @param {string} token - GitHub token
 * @returns {string} base64 of `x-access-token:<token>`
 */
function gitAuthValue(token) {
  return Buffer.from(`x-access-token:${token}`).toString('base64');
}

// Constants
const API_BASE = 'https://api.github.com';
const SNAPSHOT_MESSAGE = 'chore(deploy): snapshot the brand for this run';
// GitHub indexes a freshly pushed workflow a few seconds after the push, and a
// dispatch before that 404s: about a minute of polling, then a loud failure.
const POLL_ATTEMPTS = 20;
const POLL_INTERVAL_MS = 3000;

/** Run a command and capture its stdout (a file and an argument array, never a shell string). */
function execCommand(file, args, options = {}) {
  return execFileSync(file, args, { encoding: 'utf8', ...options });
}

/**
 * Push the brand folder to `<owner>/<repo>` at `ref` as a force-pushed mirror.
 *
 * @param {object} options - Options.
 * @param {string} options.brandRoot - The brand folder to snapshot.
 * @param {string} options.owner - The mirror repo's owner.
 * @param {string} options.repo - The mirror repo's bare name.
 * @param {string} options.ref - The branch to overwrite (`main` for a mirror).
 * @param {string} options.token - The GitHub token, carried in the env.
 * @param {string} [options.message] - The snapshot commit's message.
 * @param {string[]} [options.require] - Brand-relative paths that MUST ride
 *   (the staged `omega_modules/` and lockfile of a linked brand).
 * @param {Function} [options.execFn] - The command runner (tests).
 * @param {string} [options.indexFile] - The temporary index to build in.
 * @returns {string} The pushed commit sha.
 */
function pushSnapshot(options) {
  const {
    brandRoot,
    owner,
    repo,
    ref,
    token,
    message = SNAPSHOT_MESSAGE,
    execFn = execCommand,
    indexFile = path.join(os.tmpdir(), `omega-snapshot-index-${process.pid}`),
  } = options;

  for (const key of ['brandRoot', 'owner', 'repo', 'ref', 'token']) {
    if (!options[key]) {
      throw new Error(`pushSnapshot: missing ${key}`);
    }
  }

  const git = (...args) => execFn('git', args, { cwd: brandRoot, env: { ...process.env, GIT_INDEX_FILE: indexFile } });

  try {
    // What rides is what the brand's ignore rules allow, so a rule that covers
    // the staged files is a snapshot the runner cannot install: the push would
    // succeed and `npm ci` would die minutes later, a machine away, on a file:
    // spec pointing at nothing. Checked BEFORE the push, so the deploy stops
    // here with the fix in its hand.
    assertNotIgnored({ git, paths: options.require || [] });

    const toplevel = git('rev-parse', '--show-toplevel').trim();
    // Index paths are always repo-root relative, so the prefix is what turns
    // the enclosing repo's tree into the brand's own.
    const prefix = path.relative(toplevel, path.resolve(brandRoot)).split(path.sep).join('/');

    // Seed the temporary index from HEAD, then stage the brand folder into it:
    // `git add` writes only the index GIT_INDEX_FILE names, and seeding is what
    // keeps a tracked-but-ignored file (there ON PURPOSE) in the snapshot.
    // A brand whose repo has no commit yet has nothing to seed from.
    if (hasCommit(git)) {
      git('read-tree', 'HEAD');
    }
    git('add', '-A', '--', '.');

    const tree = git('write-tree').trim();
    const brandTree = prefix ? subtreeOf(git, tree, prefix) : tree;
    // Parentless: a mirror is a snapshot, not a history, and the tree it was
    // cut from is nobody's business on the brand's own repo.
    const sha = git('commit-tree', brandTree, '-m', message).trim();

    // Pushed BY SHA, so no local branch is ever created here. Force: two
    // snapshots are siblings, never a fast-forward.
    execFn('git', ['push', '--force', `https://github.com/${owner}/${repo}.git`, `${sha}:refs/heads/${ref}`], {
      cwd: brandRoot,
      env: {
        ...process.env,
        GIT_INDEX_FILE: indexFile,
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
        GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${gitAuthValue(token)}`,
      },
    });

    return sha;
  } finally {
    jetpack.remove(indexFile);
  }
}

/**
 * Refuse a snapshot whose ignore rules would drop the files it exists to carry
 * ([#872](https://github.com/Omega-JS-Stack/omega/issues/872)).
 *
 * A brand that ignores build output by name (`omega_modules/`, a committed-by-
 * nobody `package-lock.json`) catches the staged packages with it, and the
 * snapshot then carries `file:` specs pointing at tarballs that never travelled.
 *
 * @param {object} options - Options.
 * @param {Function} options.git - The bound git runner (cwd = the brand root).
 * @param {string[]} options.paths - Brand-relative paths that must ride.
 * @throws {Error} Naming every ignored path and the rule to drop.
 */
function assertNotIgnored({ git, paths }) {
  const ignored = paths.filter((entry) => isIgnored(git, entry));

  if (ignored.length) {
    throw new Error(`This brand's git ignore rules hide ${ignored.join(' and ')}, which the deploy just staged and the snapshot has to carry. A pushed snapshot without them installs nothing on the runner (every linked package is a file: spec pointing at a tarball that never travelled). Drop the rule from the .gitignore that matches (\`git check-ignore -v ${ignored[0]}\` names the file and line), or un-ignore it with a \`!${ignored[0]}\` line, then re-run the deploy.`);
  }
}

/** Is one path ignored here? `git check-ignore` answers by exit code (1 = no). */
function isIgnored(git, entry) {
  try {
    git('check-ignore', '-q', '--', entry);
    return true;
  } catch (error) {
    if (error.status === 1) {
      return false;
    }
    throw error;
  }
}

/** Does this repo have a commit to seed the index from? */
function hasCommit(git) {
  try {
    git('rev-parse', '--verify', 'HEAD');
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * The tree object of one directory inside a tree: the brand folder, promoted to
 * the root of what gets committed.
 * @param {Function} git - The bound git runner.
 * @param {string} tree - The enclosing tree's id.
 * @param {string} prefix - The brand folder, repo-root relative.
 * @returns {string} The subtree's id.
 */
function subtreeOf(git, tree, prefix) {
  // `--full-tree`: a path is read from the REPO ROOT, and this runs inside the
  // brand folder, where the prefix names nothing.
  const entry = git('ls-tree', '--full-tree', tree, '--', prefix).trim();
  const match = entry.match(/^\d+ tree ([0-9a-f]+)\t/);

  if (!match) {
    throw new Error(`Could not read the brand folder ${prefix} out of the snapshot tree (got: ${entry || 'nothing'})`);
  }

  return match[1];
}

/** The headers every GitHub REST call here carries. */
function ghHeaders(token) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'omega-deploy',
  };
}

/**
 * Point a repo's DEFAULT branch back at `main` when published output has taken
 * it over ([#872](https://github.com/Omega-JS-Stack/omega/issues/872)).
 *
 * GitHub registers a workflow from the DEFAULT branch: the listing this step
 * polls and the dispatch that follows both read the file from there, and the
 * `ref` only picks which checkout the run uses. A brand whose first web deploy
 * created `gh-pages` on an empty repo has GitHub pointing at the published
 * site, where no workflow file will ever be, so the poll would 404 to the end
 * of its budget. Built output is never the default branch (the same rule the
 * manager's repo ensure applies), and a deploy is often what CREATES that
 * state, so the fix belongs here too.
 *
 * Only for a snapshot that landed on `main`: the branch it would flip TO is the
 * one just pushed, so a snapshot branch has nothing to claim.
 *
 * @param {object} options - Options.
 * @param {string} options.owner - The repo's owner.
 * @param {string} options.repo - The repo's bare name.
 * @param {string} options.ref - The ref the snapshot went to.
 * @param {string} options.token - The GitHub token.
 * @param {Function} options.fetchFn - The fetch to use.
 * @param {object} [options.logger] - Logger with `log` (silent when omitted).
 * @returns {Promise<boolean>} true when the default branch was moved.
 */
async function flipDefaultBranch({ owner, repo, ref, token, fetchFn, logger }) {
  if (ref !== 'main') {
    return false;
  }

  const url = `${API_BASE}/repos/${owner}/${repo}`;
  const headers = ghHeaders(token);
  const read = await fetchFn(url, { headers });

  if (read.status !== 200) {
    return false;
  }

  const current = (await read.json()).default_branch;
  if (current !== 'gh-pages') {
    return false;
  }

  const patch = await fetchFn(url, { method: 'PATCH', headers, body: JSON.stringify({ default_branch: 'main' }) });

  if (logger) {
    logger.log(patch.status === 200
      ? `${owner}/${repo}'s default branch was gh-pages (published output), and GitHub registers workflows from the default branch: moved it back to main.`
      : `${owner}/${repo}'s default branch is gh-pages, where no workflow lives, and moving it back to main failed (${patch.status}). Set the default branch by hand and re-run the deploy.`);
  }

  return patch.status === 200;
}

/**
 * Wait for GitHub to REGISTER a workflow on the repo the snapshot just reached.
 *
 * GitHub takes a few seconds to index a workflow it has just received, and a
 * dispatch before that answers `404: workflow not found`. So the push is
 * followed by a bounded wait rather than by a hand-run second attempt.
 *
 * @param {object} options - Options.
 * @param {string} options.owner - The repo's owner.
 * @param {string} options.repo - The repo's bare name.
 * @param {string} options.workflow - The workflow file name.
 * @param {string} options.ref - The ref the snapshot went to (for the failure).
 * @param {string} options.token - The GitHub token.
 * @param {Function} [options.fetchFn] - Injectable fetch (tests).
 * @param {number} [options.attempts] - The poll budget.
 * @param {number} [options.delayMs] - The wait between polls.
 * @param {object} [options.logger] - Logger with `log` (silent when omitted).
 * @returns {Promise<void>} Resolves once GitHub answers for the workflow.
 */
async function waitForWorkflow(options) {
  const {
    owner, repo, workflow, ref, token, logger,
    fetchFn = fetch,
    attempts = POLL_ATTEMPTS,
    delayMs = POLL_INTERVAL_MS,
  } = options;

  const url = `${API_BASE}/repos/${owner}/${repo}/actions/workflows/${workflow}`;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const response = await fetchFn(url, { headers: ghHeaders(token) });

    if (response.status === 200) {
      return;
    }

    // The first miss is where a wrong DEFAULT branch shows itself: everything
    // else about the push succeeded. Checked once, then the poll goes on.
    if (attempt === 1) {
      await flipDefaultBranch({ owner, repo, ref, token, fetchFn, logger });
    }

    if (logger) {
      logger.log(`[${attempt}/${attempts}] ${workflow} is not registered on ${owner}/${repo} yet...`);
    }

    // The last attempt has nothing left to wait for.
    if (attempt < attempts) {
      await delay(delayMs);
    }
  }

  throw new Error(`${workflow} is still not registered on ${owner}/${repo} (pushed to ${ref}) ${Math.round((attempts * delayMs) / 1000)}s after the push. GitHub indexes a pushed workflow within seconds, so this is a push that did not carry the file, or a repo whose default branch is not where the workflow landed. Check https://github.com/${owner}/${repo}/actions`);
}

module.exports = { pushSnapshot, waitForWorkflow, ghHeaders, SNAPSHOT_MESSAGE };
