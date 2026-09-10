/**
 * The playground desktop rehearsal in ONE command
 * ([#802](https://github.com/Omega-JS-Stack/omega/issues/802)).
 *
 *   npm run rehearse:desktop -- --platforms windows [--watch]
 *
 * A workflow only runs from code GitHub already has, so rehearsing a desktop
 * change used to mean a hand commit and a hand push before every
 * `gh workflow run`. Ian (2026-09-05): "wire it so we don't have to do it
 * manually each time."
 *
 * The snapshot lives in a repo of its OWN (Ian 2026-09-07): private,
 * throwaway, rewritten by every run. It cannot live on a branch of this
 * monorepo, because a rehearsal run needs a repo the org's runner group
 * accepts and a workflow on the DEFAULT branch, and it cannot live in the
 * playground's own declared repo either, which is PUBLIC for gh-pages: a
 * public snapshot of this tree would publish the framework source. So nothing
 * rehearsal-shaped exists on omega's own branches at all, and `main` here
 * moves only when Ian ships it.
 *
 * The six steps, and nothing else:
 *
 *   1. regenerate `.github/workflows/playground-desktop.yml` from the desktop
 *      template (scripts/playground-desktop-workflow.js), so the run can never
 *      execute a stale copy. That path is GITIGNORED here: it is rendered per
 *      rehearsal and lives only in the snapshot repo
 *   2. ensure the rehearsal repo exists, creating it PRIVATE the first time
 *   3. publish the playground desktop target's COMPOSED secrets to it, the set
 *      `omega push-secrets` composes for a brand: push-secrets publishes to the
 *      brand's DECLARED repo (omega-playground) and skips a snapshot repo on the
 *      remote mismatch, so the run's build had no keys at all
 *   4. snapshot the WORKING TREE (tracked edits and untracked-not-ignored files
 *      alike, plus the ignored workflow file) into a LOCAL ref outside
 *      `refs/heads/`, and force-push that commit to the rehearsal repo's `main`
 *   5. wait for GitHub to register the pushed workflow on that repo's default
 *      branch (it indexes one a few seconds after the push, and a dispatch
 *      before that 404s), note the run already there, then dispatch
 *   6. find the run it created (the newest run on the branch, once its id is a
 *      different one) and print its URL (`--watch` follows it and exits with
 *      the run's status)
 *
 * The snapshot writes a commit object out of a TEMPORARY index and parks it on
 * `refs/rehearsal/head`, so the working tree, the real index and every local
 * BRANCH are untouched: no stash, no checkout, no branch to clean up, and
 * nothing a `git status` or a `git branch` can see.
 *
 * The pure pieces take an injectable `exec` (`git`/`gh` as the file and an
 * argument array, never a shell string) and an injectable `remote`, so the
 * tests drive them without a push, a create or a dispatch.
 */

// Libraries
const { execFileSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { parseArgs } = require('node:util');
const jetpack = require('fs-jetpack');
const { collectTargetSecrets } = require('@omega.js/devkit/target-secrets');
const { publishActionsSecrets } = require('@omega.js/devkit/actions-secrets');
// By file path, not by package export: the desktop CLI's command modules are
// internal, and the resolver is what keeps a file-valued secret (CSC_LINK) a
// base64 blob here exactly as it is when the brand publishes it itself.
const { fileValueResolver } = require('../packages/desktop/src/commands/push-secrets.js');
const { renderWorkflow, WORKFLOW } = require('./playground-desktop-workflow.js');

// Constants
const ROOT = path.join(__dirname, '..');
// `<brand.id>-rehearsal`, the third role of the brand repo rule
// ([#808](https://github.com/Omega-JS-Stack/omega/issues/808)); it is renamed
// there with the brand.
const REPO = 'Omega-JS-Stack/omega-playground-rehearsal';
const REPO_DESCRIPTION = 'Playground desktop rehearsal snapshot (throwaway)';
const REMOTE = `https://github.com/${REPO}.git`;
const BRANCH = 'main';
// The snapshot commit is parked OUTSIDE `refs/heads/`, so it is a real ref the
// reuse check reads and never a branch anything here can check out.
const LOCAL_REF = 'refs/rehearsal/head';
const WORKFLOW_FILE = path.basename(WORKFLOW);
// Gitignored here, so the snapshot force-adds it: the run needs the workflow in
// the tree it dispatches from.
const WORKFLOW_PATH = path.relative(ROOT, WORKFLOW);
const TARGET = 'desktop';
const TARGET_DIR = path.join(ROOT, 'brands', 'omega-playground', 'targets', 'desktop');
const STEPS = 6;

// Every detail line sits under its step's `[X/Y]` heading, the publisher's own
// lines included.
const stepLogger = {
  log: (message) => console.log(`        ${message}`),
  warn: (message) => console.warn(`        ${message}`),
  error: (message) => console.error(`        ${message}`),
};

// The snapshot commit says what it is: a throwaway, rewritten by the next run.
const SNAPSHOT_MESSAGE = 'chore(rehearsal): snapshot the working tree for the playground desktop run';

// `brands/omega-playground/package-lock.json` is untracked ON PURPOSE (a brand's
// lockfile never ships, which is why the workflow's target install is
// `npm install`), so the snapshot leaves it behind. Everything else that is
// untracked-but-not-ignored rides along, exactly like the ship's own `git add`.
const EXCLUDED_PATHS = [':!brands/omega-playground/package-lock.json'];

// `%(parent)` is empty for a root commit, which simply misses the reuse check.
const REF_FORMAT = '%(objectname) %(tree) %(parent)';

// A gh call whose FAILURE is expected (a repo that is not there yet, a workflow
// GitHub has not registered) reads its own stderr as an answer, so gh's message
// never lands in the log beside the script's own lines.
const QUIET = { stdio: ['ignore', 'pipe', 'ignore'] };

// The new run appears in `gh run list` a beat after the dispatch returns, never
// instantly: about a minute of polling, then a loud failure. The same budget
// covers the wait for GitHub to register a freshly pushed workflow.
const POLL_ATTEMPTS = 20;
const POLL_INTERVAL_MS = 3000;

/**
 * The `gh` arguments for the newest run on the snapshot branch.
 * @param {string} fields - The `--json` field list.
 * @returns {string[]} The argument array.
 */
function runListArgs(fields) {
  return ['run', 'list', '--repo', REPO, '--workflow', WORKFLOW_FILE, '--branch', BRANCH, '--limit', '1', '--json', fields];
}

/**
 * Run a command and capture its stdout.
 * @param {string} file - The executable (`git`, `gh`).
 * @param {string[]} args - Its arguments, never a shell string.
 * @param {object} [options] - execFileSync options (cwd, env, stdio).
 * @returns {string} The command's stdout.
 */
function execCommand(file, args, options = {}) {
  return execFileSync(file, args, { encoding: 'utf8', ...options });
}

/**
 * Ensure the rehearsal repo exists, creating it PRIVATE the first time.
 *
 * Private is the whole reason this repo exists: the snapshot carries the entire
 * framework source, and the playground's own declared repo is public.
 *
 * @param {object} [options] - Options.
 * @param {Function} [options.exec] - The `gh` runner.
 * @param {object} [options.logger] - `{ log, warn, error }`.
 * @returns {{ created: boolean }} Whether this run created the repo.
 */
function ensureRepo({ exec = execCommand, logger = stepLogger } = {}) {
  try {
    exec('gh', ['repo', 'view', REPO, '--json', 'name'], QUIET);
    logger.log(`${REPO} exists`);

    return { created: false };
  } catch {
    // Any `gh repo view` failure reads as "not there yet"; a create that fails
    // for the real reason (auth, permissions) throws with gh's own message.
    exec('gh', ['repo', 'create', REPO, '--private', '--description', REPO_DESCRIPTION]);
    logger.log(`created ${REPO} (private)`);

    return { created: true };
  }
}

/**
 * Publish the playground desktop target's composed secrets to the REHEARSAL repo.
 *
 * The run builds from a snapshot of this monorepo pushed there, so the secrets
 * its workflow reads have to live on that repo, and `omega push-secrets` cannot
 * put them there: it publishes to the brand's DECLARED repo and skips loudly
 * when the checkout is a different one, which inside this monorepo it always is.
 * So the rehearsal composes the SAME set the brand would publish (the env
 * schema's desktop delivery keys, valued from the target's `.env` cascade,
 * through desktop's own file resolver, so a file-valued signing secret still
 * travels as base64) and sends it here instead.
 *
 * Idempotent by nature: setting a secret replaces it. Key NAMES and the count
 * are logged, never a value (the transport puts values on stdin). A key that
 * fails to land throws by name, so a half-written set is never snapshotted and
 * dispatched.
 *
 * @param {object} [options] - Options.
 * @param {Function} [options.exec] - The `gh` runner.
 * @param {object} [options.logger] - `{ log, warn, error }`.
 * @param {string} [options.targetDir] - The desktop target to compose from.
 * @returns {{ published: string[], failed: Array<{ key: string, message: string }> }} The publish result.
 */
function publishSecrets({ exec = execCommand, logger = stepLogger, targetDir = TARGET_DIR } = {}) {
  const secrets = collectTargetSecrets({
    targetDir,
    target: TARGET,
    resolveValue: fileValueResolver({ targetDir }),
  });
  const keys = Object.keys(secrets);

  // Nothing composed means the target's `.env` cascade is missing, and a run
  // dispatched without its keys dies minutes later inside `npm run package`.
  if (!keys.length) {
    throw new Error(`No desktop secrets composed from ${targetDir}: its .env cascade is missing or empty, and the run's build needs every key the workflow reads.`);
  }

  logger.log(`${keys.length} secret(s) → ${REPO}: ${keys.join(', ')}`);
  const result = publishActionsSecrets({ repo: REPO, secrets, logger, execFn: exec });
  logger.log(`published ${result.published.length}/${keys.length}`);

  // A half-written set is worse than none: the run would build for minutes and
  // die on whichever key never landed. Names and counts only, never a value.
  if (result.failed.length) {
    const names = result.failed.map((failure) => failure.key).join(', ');
    throw new Error(`Failed to publish ${result.failed.length}/${keys.length} secret(s) to ${REPO}: ${names}. Fix the cause (each failure is logged above by key), then re-run.`);
  }

  return result;
}

/**
 * Commit the working tree onto the local `refs/rehearsal/head` and force-push it
 * to the rehearsal repo's `main`, without touching the working tree, the real
 * index or any branch of this repo.
 *
 * @param {object} options - Options.
 * @param {string} options.root - The repo to snapshot.
 * @param {Function} [options.exec] - The command runner.
 * @param {string} [options.indexFile] - The temporary index to build in.
 * @param {string} [options.remote] - Where to push (the rehearsal repo's URL).
 * @returns {{ sha: string, tree: string, reused: boolean }} The snapshot commit.
 */
function snapshotTree({ root, exec = execCommand, indexFile = path.join(os.tmpdir(), `omega-rehearsal-index-${process.pid}`), remote = REMOTE }) {
  const git = (...args) => exec('git', args, { cwd: root, env: { ...process.env, GIT_INDEX_FILE: indexFile } });

  try {
    // Seed the temporary index from HEAD, then stage the whole working tree into
    // it: `git add` writes only the index GIT_INDEX_FILE names.
    git('read-tree', 'HEAD');
    git('add', '-A', '--', '.', ...EXCLUDED_PATHS);
    // The workflow file is gitignored in this repo (it is generated per
    // rehearsal), and it is the ONE file the run cannot start without.
    git('add', '-f', '--', WORKFLOW_PATH);

    const tree = git('write-tree').trim();
    const head = git('rev-parse', 'HEAD').trim();
    const [existingSha, existingTree, existingParent] = git('for-each-ref', `--format=${REF_FORMAT}`, LOCAL_REF).trim().split(' ');

    // Idempotent: the same tree on the same HEAD is the same snapshot, so the
    // run reuses the commit and the push carries nothing new.
    const reused = existingTree === tree && existingParent === head;
    const sha = reused ? existingSha : git('commit-tree', tree, '-p', head, '-m', SNAPSHOT_MESSAGE).trim();

    if (!reused) {
      git('update-ref', LOCAL_REF, sha);
    }

    // The commit is pushed BY SHA, so no local branch is ever created here.
    // Force: two snapshots off one HEAD are siblings, never a fast-forward.
    git('push', '--force', remote, `${sha}:refs/heads/${BRANCH}`);

    return { sha, tree, reused };
  } finally {
    jetpack.remove(indexFile);
  }
}

/**
 * Wait for GitHub to REGISTER the pushed workflow on the rehearsal repo's
 * default branch.
 *
 * A dispatch reads the workflow off the DEFAULT branch, and GitHub takes a few
 * seconds to index one it has just received: the first run against the
 * brand-new repo answered `HTTP 404: workflow playground-desktop.yml not found
 * on the default branch` to both the run probe and the dispatch, and the same
 * command a minute later worked. So the push is followed by a bounded wait
 * rather than by a hand-run second attempt.
 *
 * @param {object} [options] - Options.
 * @param {Function} [options.exec] - The command runner.
 * @param {number} [options.attempts] - The poll budget.
 * @param {Function} [options.sleep] - The wait between polls.
 * @returns {Promise<void>} Resolves once GitHub answers for the workflow.
 */
async function waitForWorkflow({ exec = execCommand, attempts = POLL_ATTEMPTS, sleep = delay } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      // The API answers for a registered workflow and 404s for one it has not
      // indexed yet, which is the exact condition the dispatch is waiting on.
      exec('gh', ['api', `repos/${REPO}/actions/workflows/${WORKFLOW_FILE}`], QUIET);

      return;
    } catch {
      console.log(`        [${attempt}/${attempts}] ${WORKFLOW_FILE} not registered on ${BRANCH} yet…`);
    }

    // The last attempt has nothing left to wait for.
    if (attempt < attempts) {
      await sleep(POLL_INTERVAL_MS);
    }
  }

  throw new Error(`${WORKFLOW_FILE} is still not registered on ${REPO}#${BRANCH} ${Math.round((attempts * POLL_INTERVAL_MS) / 1000)}s after the push. GitHub indexes a pushed workflow within seconds, so this is a push that did not carry the file, or a repo whose default branch is not ${BRANCH}. Check https://github.com/${REPO}/actions`);
}

/**
 * Note the run already on the rehearsal repo's `main`, then dispatch the
 * workflow there.
 *
 * The run is found afterwards by IDENTITY, never by a clock: GitHub stamps
 * `createdAt` in whole seconds while a local timestamp carries milliseconds, so
 * a run created inside the dispatch's own second reads as older than the
 * dispatch — and a local clock running slow would match the PREVIOUS run.
 *
 * @param {object} options - Options.
 * @param {Function} [options.exec] - The command runner.
 * @param {string} options.platforms - The workflow's `platforms` input.
 * @returns {number|null} The newest run's id before the dispatch, `null` if the branch had none.
 */
function dispatchRun({ exec = execCommand, platforms }) {
  const [previous] = JSON.parse(exec('gh', runListArgs('databaseId')));

  exec('gh', ['workflow', 'run', WORKFLOW_FILE, '--repo', REPO, '--ref', BRANCH, '-f', `platforms=${platforms}`]);

  return previous ? previous.databaseId : null;
}

/**
 * Poll for the run the dispatch created: the newest run on the snapshot branch,
 * once it is a DIFFERENT run from the one that was there before the dispatch.
 *
 * @param {object} options - Options.
 * @param {Function} [options.exec] - The command runner.
 * @param {number|null} options.before - The run id `dispatchRun` saw, `null` for none.
 * @param {number} [options.attempts] - The poll budget.
 * @param {Function} [options.sleep] - The wait between polls.
 * @returns {Promise<{ databaseId: number, url: string }>} The run the dispatch created.
 */
async function findRun({ exec = execCommand, before, attempts = POLL_ATTEMPTS, sleep = delay }) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const [run] = JSON.parse(exec('gh', runListArgs('databaseId,url')));

    if (run && run.databaseId !== before) {
      return run;
    }

    console.log(`        [${attempt}/${attempts}] no new run on ${BRANCH} yet…`);

    // The last attempt has nothing left to wait for.
    if (attempt < attempts) {
      await sleep(POLL_INTERVAL_MS);
    }
  }

  throw new Error(`No new run of ${WORKFLOW_FILE} on ${BRANCH} appeared within ${Math.round((attempts * POLL_INTERVAL_MS) / 1000)}s of the dispatch. Check https://github.com/${REPO}/actions/workflows/${WORKFLOW_FILE}`);
}

/**
 * The one command: regenerate, ensure the repo, publish, snapshot, dispatch,
 * find (and optionally watch).
 * @returns {Promise<void>}
 */
async function main() {
  const { values } = parseArgs({
    options: {
      platforms: { type: 'string', default: 'all' },
      watch: { type: 'boolean', default: false },
    },
  });

  console.log(`[1/${STEPS}] Rendering ${WORKFLOW_FILE} from the desktop template`);
  const contents = renderWorkflow();
  const changed = jetpack.read(WORKFLOW) !== contents;
  jetpack.write(WORKFLOW, contents);
  console.log(`        ${changed ? 'wrote' : 'unchanged'}`);

  console.log(`[2/${STEPS}] Ensuring the rehearsal repo ${REPO}`);
  ensureRepo();

  console.log(`[3/${STEPS}] Publishing the playground's desktop secrets to ${REPO}`);
  publishSecrets();

  console.log(`[4/${STEPS}] Snapshotting the working tree onto ${REPO}#${BRANCH}`);
  const snapshot = snapshotTree({ root: ROOT });
  console.log(`        ${snapshot.reused ? 'reused' : 'pushed'} ${snapshot.sha}`);

  console.log(`[5/${STEPS}] Dispatching ${WORKFLOW_FILE} (platforms=${values.platforms})`);
  await waitForWorkflow();
  const before = dispatchRun({ platforms: values.platforms });

  console.log(`[6/${STEPS}] Waiting for the run`);
  const run = await findRun({ before });
  console.log(`        ${run.url}`);

  if (values.watch) {
    execCommand('gh', ['run', 'watch', String(run.databaseId), '--repo', REPO, '--exit-status'], { stdio: 'inherit' });
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    // A failed `git`/`gh` carries the child's own exit code, so `--watch` exits
    // with the RUN's status (`gh run watch --exit-status`), not a flat 1.
    process.exit(error.status ?? 1);
  });
}

module.exports = { ensureRepo, publishSecrets, snapshotTree, waitForWorkflow, dispatchRun, findRun, REPO, BRANCH, LOCAL_REF, WORKFLOW_PATH, WORKFLOW_FILE };
