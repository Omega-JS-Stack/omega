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
const path = require('node:path');
const { execSync, execFileSync } = require('node:child_process');

const { findBrandRoot, discoverTargets, frameworkPackagesOf } = require('./local.js');
const { stageLocalPackages, STAGING_DIR } = require('./pack-local.js');
const { pushSnapshot, waitForWorkflow, ghHeaders } = require('./deploy-snapshot.js');

const API_BASE = 'https://api.github.com';

// The branch a SNAPSHOT lands on, by what the brand is:
// - a nested brand's repo is a MIRROR of the folder, so the snapshot IS that
//   repo's source and it belongs on the default branch;
// - a linked brand that owns its repo gets a snapshot BRANCH instead, so its
//   real history never carries packed tarballs.
const MIRROR_REF = 'main';
const SNAPSHOT_REF = 'omega-deploy';

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
 * The repo a CI dispatch addresses: the BRAND's own repo, from its config
 * ([#799](https://github.com/Omega-JS-Stack/omega/issues/799)). Every framework's
 * deploy verb asks this instead of `resolveRepo` above, because a git remote
 * answers the repo the working tree sits in: inside a brand monorepo nested in
 * another repo (a brand inside the framework monorepo, a target checked out
 * under someone else's tree) that is the ENCLOSING repo, so the dispatch went to
 * a workflow that was never there.
 *
 * Half an address addresses nothing, so it throws rather than POST to
 * `undefined/<name>`.
 *
 * @param {object} config - Composed omega config for the target being deployed.
 * @returns {{ owner: string, repo: string }} the brand repo's owner and bare name
 * @throws {Error} when the config names no repo
 */
function dispatchRepo(config) {
  const { brandRepo } = require('@omega.js/config');
  const { owner, name } = brandRepo(config);

  if (!owner || !name) {
    throw new Error('Could not determine the brand repo to dispatch on. Set repo.providers.github.org (and repo.providers.github.repo when the repo name is not <brand.id>-omega) in config/omega.json5.');
  }

  return { owner, repo: name };
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
    headers: ghHeaders(options.token),
    body: JSON.stringify(plan.body),
  });

  if (response.status !== 204) {
    const text = await response.text().catch(() => '');
    throw new Error(`workflow_dispatch failed (${response.status}): ${text || response.statusText || 'unknown error'}`);
  }
  return plan;
}

// The four things a lane DOES, in one injectable seam (the `steps` shape
// `deploy-precheck` uses): the tests drive the order without a push, a pack or
// a network call, and the defaults are the real modules.
const LANE_STEPS = {
  stage: stageLocalPackages,
  push: pushSnapshot,
  wait: waitForWorkflow,
  sync: syncWorkingTree,
};

/**
 * The one deploy path: resolve repo + token, resolve the LANE, carry the code
 * to GitHub the way that lane says, then dispatch. A dryRun returns the plan
 * untouched instead.
 *
 * The lane runs only when the caller names a `dir` (a local tree). A
 * server-side dispatch (the admin post route) has no working tree at all and
 * addresses code GitHub already has, so it dispatches and nothing else.
 *
 * @param {object} options
 * @param {string} options.workflow - workflow file name
 * @param {string} [options.dir] - any dir inside the brand (turns the lane on)
 * @param {string} [options.cwd] - repo dir for remote resolution
 * @param {string} [options.owner] - explicit owner (skips git resolution)
 * @param {string} [options.repo] - explicit repo (skips git resolution)
 * @param {string} [options.ref] - branch (default: the lane's, else main)
 * @param {object} [options.inputs] - workflow inputs
 * @param {boolean} [options.dryRun] - build the plan but never send
 * @param {boolean} [options.sync] - false skips the commit + push (the push
 *   lane's whole delivery, and a linked own-repo brand's workflow sync)
 * @param {string} [options.message] - commit/snapshot message
 * @param {object} [options.logger] - logger with `log` (silent when omitted)
 * @param {object} [options.env] - env map for token resolution
 * @param {function} [options.fetchFn] - injectable fetch
 * @param {function} [options.execFn] - injectable exec
 * @param {object} [options.steps] - lane step overrides (tests)
 * @returns {Promise<{ plan: object, dispatched: boolean, lane: object|null }>}
 */
async function deployViaDispatch(options) {
  const target = options.owner && options.repo
    ? { owner: options.owner, repo: options.repo }
    : resolveRepo({ cwd: options.cwd, execFn: options.execFn });

  const lane = options.dir ? resolveDeployLane({ dir: options.dir, execFn: options.execFn }) : null;
  const logger = options.logger;

  const plan = buildDispatch({
    owner: target.owner,
    repo: target.repo,
    workflow: options.workflow,
    ref: options.ref || (lane ? lane.ref : null),
    inputs: options.inputs,
  });

  if (options.dryRun) {
    // The plan IS the dry run, the lane included: what would happen, with
    // neither git nor the network touched.
    return { plan, dispatched: false, lane };
  }

  const token = options.token || resolveToken({ env: options.env, execFn: options.execFn });
  const steps = { ...LANE_STEPS, ...(options.steps || {}) };

  if (lane && lane.mode === 'snapshot') {
    // A linked brand that OWNS its repo syncs first: GitHub registers a
    // workflow from the repo's DEFAULT branch (the listing and the dispatch
    // both read the file from there, and the ref only picks the checkout the
    // run uses), and the snapshot branch is not it. So the composed workflow
    // reaches main through the developer's own commit and the snapshot carries
    // only the tarballs ([#872](https://github.com/Omega-JS-Stack/omega/issues/872)).
    // A nested brand has nobody to sync to: the enclosing repo is not the
    // brand's, and the snapshot IS its repo's source.
    if (lane.linked && !lane.nested && options.sync !== false) {
      steps.sync({ cwd: lane.brandRoot, message: options.message, logger });
    }

    if (logger) {
      logger.log(`Snapshotting ${lane.brandRoot} to ${target.owner}/${target.repo}#${plan.body.ref}${lane.linked ? ' (packing its linked packages)' : ''}`);
    }

    // Packed tarballs are files in the tree, so they ride the snapshot like
    // anything else untracked and not ignored.
    const staging = lane.linked
      ? await steps.stage({ dir: lane.brandRoot, log: logger ? (line) => logger.log(line) : undefined })
      : null;

    try {
      steps.push({
        brandRoot: lane.brandRoot,
        owner: target.owner,
        repo: target.repo,
        ref: plan.body.ref,
        token,
        message: options.message,
        // What the stage just wrote has to reach the runner, so the push
        // refuses a tree whose ignore rules would drop it.
        require: staging ? [STAGING_DIR, 'package-lock.json'] : [],
      });
    } finally {
      // ALWAYS, and as early as possible: the push carried the staged shape, so
      // the developer's tree goes back before anything else can fail.
      if (staging) {
        await staging.restore();
      }
    }
  } else if (lane) {
    // A brand with no git repo has nothing to commit or push: the dispatch is
    // the whole lane, on whatever GitHub already holds.
    if (lane.repo && options.sync !== false) {
      steps.sync({ cwd: lane.brandRoot, message: options.message, logger });
    }
  }

  if (lane) {
    // Both lanes wait the same way: GitHub indexes a workflow it has just
    // received a few seconds late, and a brand's FIRST deploy is exactly the
    // push that carries the composed file. The wait reads the default branch,
    // which is where a dispatch reads the workflow from.
    await steps.wait({
      owner: target.owner,
      repo: target.repo,
      workflow: options.workflow,
      ref: plan.body.ref,
      token,
      fetchFn: options.fetchFn,
      logger,
    });
  }

  await dispatchWorkflow(plan, { token, fetchFn: options.fetchFn });
  return { plan, dispatched: true, lane };
}

/**
 * Find every `file:` @omega.js spec in the brand tree. npm resolves the
 * WHOLE workspace tree on any install, so one linked sibling target breaks a
 * CI install even when the deploying target is clean (the cp194 lesson —
 * linking is tree-wide, so detection is too). `resolveDeployLane` reads it
 * to pick the SNAPSHOT lane, which packs the linked frameworks so the runner
 * installs the same code this tree runs
 * ([#872](https://github.com/Omega-JS-Stack/omega/issues/872); this replaces
 * the 2026-07-20 rule that a linked brand built and shipped the artifact from
 * this machine, which is `--direct` now).
 * @param {object} [options]
 * @param {string} [options.dir] - Any directory inside the brand (default cwd).
 * @returns {string[]} One line per offender: `<manifest> → <name>: <spec>`.
 */
function findLocalSpecs(options = {}) {
  const brandRoot = findBrandRoot(options.dir || process.cwd());
  const offenders = [];

  for (const targetDir of discoverTargets(brandRoot)) {
    for (const entry of frameworkPackagesOf(targetDir)) {
      if (entry.spec.startsWith('file:')) {
        const manifest = path.relative(brandRoot, path.join(targetDir, 'package.json')) || 'package.json';
        offenders.push(`${manifest} → ${entry.name}: ${entry.spec}`);
      }
    }
  }

  return offenders;
}

/**
 * The LANE a deploy takes, derived once for every target
 * ([#872](https://github.com/Omega-JS-Stack/omega/issues/872)).
 *
 * Two facts decide it, and neither is a preference:
 * - NESTED: the brand root is not the toplevel of the git repo it sits in (a
 *   brand inside this monorepo), so there is no repo whose contents ARE the
 *   brand for a workflow to run from. Its declared repo is a MIRROR of the
 *   folder, so the snapshot is that repo's source and lands on `main`.
 * - LINKED: the brand tree carries a `file:` @omega.js spec anywhere. A runner
 *   can install none of those, so the packed tarballs have to travel, and they
 *   must never enter the brand's real history: the snapshot goes to its own
 *   branch instead.
 *
 * Neither holding is the ordinary PUSH lane: commit, push the branch the
 * developer is on, dispatch it. A brand outside git altogether (`repo` false)
 * has nothing to commit or push, so its push lane is the dispatch alone.
 *
 * @param {object} [options] - Options.
 * @param {string} [options.dir] - Any directory inside the brand (default cwd).
 * @param {function} [options.execFn] - Injectable exec (tests).
 * @returns {{ mode: string, ref: string, nested: boolean, linked: boolean, repo: boolean, brandRoot: string }}
 *   The lane, plus the brand root every step of it works from.
 */
function resolveDeployLane(options = {}) {
  const brandRoot = findBrandRoot(options.dir || process.cwd());
  const execFn = options.execFn || ((cmd, opts) => execSync(cmd, opts).toString());
  const git = (command) => {
    try {
      return String(execFn(command, { cwd: brandRoot, stdio: ['ignore', 'pipe', 'ignore'] })).trim();
    } catch (e) {
      // A brand outside git at all: there is nothing to snapshot and nothing to
      // push, so the lane is the plain one and the deploy speaks for itself.
      return '';
    }
  };

  const toplevel = git('git rev-parse --show-toplevel');
  const repo = Boolean(toplevel);
  const nested = repo && path.resolve(toplevel) !== path.resolve(brandRoot);
  const linked = findLocalSpecs({ dir: brandRoot }).length > 0;

  if (nested) {
    return { mode: 'snapshot', ref: MIRROR_REF, nested, linked, repo, brandRoot };
  }
  if (linked && !toplevel) {
    // A linked brand has to SNAPSHOT (the packed tarballs travel no other way),
    // and a snapshot is built out of a git index, so no repo is no lane. Said
    // by name HERE, because the push would otherwise die a step later on a raw
    // `fatal: not a git repository` out of `git check-ignore` (#872).
    throw new Error(`${brandRoot} is not inside a git repo, and a linked brand needs a git repo to snapshot from: \`git init\` the brand, or restore registry versions with \`omega i live\`.`);
  }
  if (linked) {
    return { mode: 'snapshot', ref: SNAPSHOT_REF, nested, linked, repo, brandRoot };
  }

  return { mode: 'push', ref: git('git rev-parse --abbrev-ref HEAD') || MIRROR_REF, nested, linked, repo, brandRoot };
}

/**
 * Commit + push the working tree before a dispatch deploy (D13: the push
 * itself triggers NOTHING — scaffolded workflows carry no push triggers).
 * Plain git via argument arrays: universal on consumer machines and
 * injection-safe for the message.
 * @param {object} [options]
 * @param {string} [options.cwd] - Repo directory (default process.cwd()).
 * @param {string} [options.message] - Commit message (default 'Deploy').
 * @param {object} [options.logger] - Logger with log (silent when omitted).
 */
function syncWorkingTree(options = {}) {
  const cwd = options.cwd || process.cwd();
  const message = options.message || 'Deploy';

  execFileSync('git', ['add', '-A'], { cwd, stdio: 'inherit' });

  // `git diff --cached --quiet` exits 1 exactly when something is staged
  let hasStaged = false;
  try {
    execFileSync('git', ['diff', '--cached', '--quiet'], { cwd, stdio: 'ignore' });
  } catch (e) {
    hasStaged = true;
  }

  if (hasStaged) {
    execFileSync('git', ['commit', '-m', message], { cwd, stdio: 'inherit' });
  } else if (options.logger) {
    options.logger.log('Working tree clean — nothing to commit');
  }

  execFileSync('git', ['push'], { cwd, stdio: 'inherit' });
}

module.exports = {
  parseRemoteUrl,
  dispatchRepo,
  resolveRepo,
  resolveToken,
  buildDispatch,
  dispatchWorkflow,
  deployViaDispatch,
  findLocalSpecs,
  resolveDeployLane,
  syncWorkingTree,
};
