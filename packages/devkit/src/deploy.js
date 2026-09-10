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

/**
 * Find every `file:` @omega.js spec in the brand tree. npm resolves the
 * WHOLE workspace tree on any install, so one linked sibling target breaks a
 * CI install even when the deploying target is clean (the cp194 lesson —
 * linking is tree-wide, so detection is too). Deploy verbs use this to
 * AUTO-SELECT their local-artifact lane (mirrored rule, Ian 2026-07-20:
 * a linked brand ships the LOCAL framework — build here, ship the artifact;
 * CI dispatch is only for registry-clean trees).
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
 * Throw when the brand tree carries `file:` @omega.js specs — for lanes with
 * no local-artifact fallback where dispatching would only burn a CI run.
 * @param {object} [options]
 * @param {string} [options.dir] - Any directory inside the brand (default cwd).
 * @throws {Error} Listing every file:-spec'd @omega.js dependency, per target.
 */
function assertNoLocalSpecs(options = {}) {
  const offenders = findLocalSpecs(options);
  if (offenders.length > 0) {
    throw new Error(
      'Local file: packages are linked somewhere in this brand — CI cannot install them.\n'
      + `  ${offenders.join('\n  ')}\n`
      + 'Deploy from the local-artifact lane, or restore registry specs first (omega i live).'
    );
  }
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
  assertNoLocalSpecs,
  syncWorkingTree,
};
