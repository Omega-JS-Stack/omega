/**
 * Health-check implementations for the testing service — omega-manager's
 * target-checks helpers rebuilt for brand monorepos. Local checks read the
 * repo; live checks fetch the deployed site/API and shell out to npm/gh.
 *
 * Every check records into a shared recorder whose results shape matches
 * RunSummary's drill-down: passed = [name], warned = [{ name, warning }],
 * failed = [{ name, error }]. Dim notes and dry-run "would" lines are
 * display-only — they never enter the results.
 *
 * Injection seams (all via context.options — they ride runManage options so
 * the full-loop tests stay network-free): options.fetch, options.exec,
 * options.retryDelayMs.
 */

const fs = require('node:fs');
const { execSync } = require('node:child_process');
const path = require('node:path');
const chalk = require('chalk').default;
const jetpack = require('fs-jetpack');

const { TARGET_FRAMEWORKS } = require('../../../config.js');
const { instanceIdFromDirName, resolveInstanceUrl } = require('@omega.js/config');
const { recordDeploy, readDeployRecord } = require('@omega.js/devkit/deploy-record');

const MAX_RETRIES = 3;
const MAX_FILES_SHOWN = 10;

// Mirrors @omega.js/backend: getApiUrl() serves from the `api.` subdomain and
// mounts its routes under /omega (packages/backend route prefix)
const API_SUBDOMAIN = 'api';
const API_HEALTH_PATH = '/omega/test/health';

const FETCH_HEADERS = {
  'Cache-Control': 'no-cache, no-store, must-revalidate',
  'Pragma': 'no-cache',
  'User-Agent': 'OmegaManager/1.0 HealthCheck',
};

/**
 * Create the shared check recorder. Prints each check as it lands and
 * accumulates the results arrays the handler returns.
 *
 * @returns {Object} - { pass, warn, fail, note, would, results, counts }
 */
function createRecorder() {
  const passed = [];
  const warned = [];
  const failed = [];

  return {
    pass(name, detail) {
      passed.push(name);
      console.log(`      ${chalk.green('✓')} ${name}${detail ? chalk.dim(`: ${detail}`) : ''}`);
    },
    warn(name, warning) {
      warned.push({ name, warning });
      console.log(`      ${chalk.yellow('⚠')} ${name}${warning ? `: ${chalk.yellow(warning)}` : ''}`);
    },
    fail(name, error) {
      failed.push({ name, error });
      console.log(`      ${chalk.red('✗')} ${name}${error ? `: ${chalk.red(error)}` : ''}`);
    },
    // Display-only informational line (check not applicable / not verifiable)
    note(name, detail) {
      console.log(`      ${chalk.dim(`– ${name}${detail ? `: ${detail}` : ''}`)}`);
    },
    // Display-only dry-run line for a skipped remote action
    would(action) {
      console.log(`      ${chalk.yellow('⊘')} would ${action} ${chalk.dim('[DRY RUN]')}`);
    },
    results() {
      return { passed, warned, failed };
    },
    counts() {
      return { passed: passed.length, warned: warned.length, failed: failed.length };
    },
  };
}

/**
 * Default exec — thin execSync wrapper so tests can inject a recording fake
 * with the same (command, options) → stdout surface.
 */
function defaultExec(command, options = {}) {
  return execSync(command, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...options });
}

/**
 * Fetch with retry — retries network errors AND non-2xx/3xx statuses with a
 * linear backoff (delayMs, 2×delayMs, …), returning the last response either
 * way. Success (2xx/3xx) returns immediately.
 *
 * @param {Object} ctx - Check context ({ fetchImpl, retryDelayMs })
 * @param {string} url - URL to fetch
 * @returns {Object} - { response, duration } or { error } after all retries
 */
async function fetchWithRetry(ctx, url) {
  let last = { error: 'unreachable' };

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const start = Date.now();
      const response = await ctx.fetchImpl(url, { headers: FETCH_HEADERS, redirect: 'follow' });
      last = { response, duration: Date.now() - start };

      if (response.status >= 200 && response.status < 400) {
        return last;
      }
    } catch (error) {
      // Node's fetch wraps network errors ("fetch failed") — the cause has
      // the useful message (getaddrinfo ENOTFOUND, ECONNREFUSED, …)
      last = { error: error.cause?.message || error.message };
    }

    if (attempt < MAX_RETRIES) {
      await new Promise((resolve) => setTimeout(resolve, ctx.retryDelayMs * attempt));
    }
  }

  return last;
}

/**
 * npm latest version of a package, cached per run. null when the registry
 * lookup fails (unpublished package, offline) — callers dim out, never warn.
 */
function getLatestVersion(ctx, packageName) {
  if (!(packageName in ctx.versionCache)) {
    try {
      ctx.versionCache[packageName] = ctx.exec(`npm view ${packageName} version`).trim();
    } catch {
      ctx.versionCache[packageName] = null;
    }
  }
  return ctx.versionCache[packageName];
}

/**
 * Compare two x.y.z versions numerically. -1 / 0 / 1.
 */
function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
  }
  return 0;
}

/**
 * Resolve the INSTALLED version of a package via the node_modules climb from
 * a directory — handles file:/workspace refs where the declared range says
 * nothing. null when not installed.
 */
function installedVersion(fromDir, packageName) {
  let dir = path.resolve(fromDir);

  while (true) {
    const pkg = jetpack.read(path.join(dir, 'node_modules', packageName, 'package.json'), 'json');
    if (pkg?.version) {
      return pkg.version;
    }

    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// ── Local checks ────────────────────────────────────────────────────────────

/**
 * Per-app file checks: package.json parses; web apps produced a build;
 * backend apps have their Firebase scaffolding.
 */
function checkAppFiles(recorder, app) {
  const pkg = jetpack.read(path.join(app.path, 'package.json'), 'json');
  if (pkg) {
    recorder.pass(`${app.name}: package.json`);
  } else {
    recorder.fail(`${app.name}: package.json`, 'missing or unparseable');
  }

  if (app.target === 'web') {
    if (fs.existsSync(path.join(app.path, 'dist', 'index.html'))) {
      recorder.pass(`${app.name}: build output`);
    } else {
      recorder.fail(`${app.name}: build output`, 'dist/index.html missing — run the update service');
    }
  }

  if (app.target === 'backend') {
    if (fs.existsSync(path.join(app.path, 'firebase.json'))) {
      recorder.pass(`${app.name}: firebase.json`);
    } else {
      recorder.fail(`${app.name}: firebase.json`, 'missing');
    }
    // Staged output (src/dist pillar) — the backend's build-output twin of
    // web's dist/index.html check
    if (fs.existsSync(path.join(app.path, 'dist', 'package.json'))) {
      recorder.pass(`${app.name}: staged dist/`);
    } else {
      recorder.fail(`${app.name}: staged dist/`, 'dist/package.json missing — run the update service (omega build)');
    }
  }
}

/**
 * Framework version check: the app's installed framework package vs the npm
 * latest. Silent when the app doesn't declare the target's framework;
 * dims out when the registry lookup fails (e.g. package not published yet).
 */
function checkFrameworkVersion(recorder, app, ctx) {
  const framework = TARGET_FRAMEWORKS[app.target];
  if (!framework) return;

  // Deps live on the ONE app manifest for every target (src/dist pillar)
  const pkgDir = app.path;
  const pkg = jetpack.read(path.join(pkgDir, 'package.json'), 'json');
  const declared = pkg?.dependencies?.[framework] || pkg?.devDependencies?.[framework];
  if (!declared) return;

  const installed = installedVersion(pkgDir, framework) || declared.replace(/^[\^~>=<]+/, '');
  const name = `${app.name}: ${framework}`;

  if (!/^\d/.test(installed)) {
    recorder.note(name, `${installed} (not installed — run the update service)`);
    return;
  }

  if (ctx.dryRun) {
    recorder.would(`npm view ${framework} version`);
    return;
  }

  const latest = getLatestVersion(ctx, framework);

  if (!latest) {
    recorder.note(name, `${installed} (could not check latest)`);
  } else if (compareVersions(installed, latest) >= 0) {
    recorder.pass(name, `${installed} (latest: ${latest})`);
  } else {
    recorder.warn(name, `outdated (${installed} → ${latest})`);
  }
}

/**
 * Parse `git status --porcelain` output into { status, file } entries.
 * Lines must NOT be trimmed before slicing — the two status columns can
 * legitimately start with a space (` M path`), so a leading trim shifts
 * the path offset and eats the first character.
 * @param {string} stdout - raw porcelain output
 * @returns {Array<{ status: string, file: string }>}
 */
function parseWorkingTree(stdout) {
  return stdout.split('\n').filter((line) => line.trim()).map((line) => ({
    status: line.substring(0, 2).trim(),
    file: line.substring(3),
  }));
}

/**
 * Working tree check — uncommitted files under the brand root (scoped with
 * `-- .` so a brand nested in a larger workspace only sees its own files).
 * Silent when the brand isn't in a git repository.
 */
function checkWorkingTree(recorder, ctx) {
  let stdout;
  try {
    stdout = ctx.exec('git status --porcelain -- .', { cwd: ctx.brandRoot });
  } catch {
    return;
  }

  const files = parseWorkingTree(stdout);

  if (files.length === 0) {
    recorder.pass('working tree', 'clean');
    return;
  }

  recorder.warn('working tree', `${files.length} uncommitted file${files.length === 1 ? '' : 's'}`);
  for (const { status, file } of files.slice(0, MAX_FILES_SHOWN)) {
    console.log(`        ${chalk.dim(status)} ${chalk.dim(file)}`);
  }
  if (files.length > MAX_FILES_SHOWN) {
    console.log(`        ${chalk.dim(`... and ${files.length - MAX_FILES_SHOWN} more`)}`);
  }
}

// ── Live checks ─────────────────────────────────────────────────────────────

/**
 * Homepage check — the deployed site answers on ITS instance's URL: the
 * instance entry's url (multi-instance targets), falling back to the brand
 * URL for the single-instance world. Deploy records key per instance too, so
 * a never-deployed admin instance nudges without failing a live main.
 */
async function checkHomepage(recorder, app, ctx) {
  const instance = instanceIdFromDirName(app.name, app.target);
  const url = resolveInstanceUrl(ctx.brandConfig.targets?.[app.target], instance, ctx.brandConfig);
  const name = `${app.name}: homepage`;

  if (!url) {
    recorder.warn(name, 'no brand.url configured — cannot check');
    return;
  }

  if (ctx.dryRun) {
    recorder.would(`fetch ${url}`);
    return;
  }

  // No deploy record → a live miss means "not deployed yet", not an outage
  // (never-deployed vs deployed-but-down — Ian 2026-07-17). A live HIT on a
  // record-less brand adopts: the record is per-machine, so fresh clones of
  // deployed brands self-heal here.
  const deployed = readDeployRecord({ dir: ctx.brandRoot, target: app.target, instance });
  const { response, duration, error } = await fetchWithRetry(ctx, url);
  const live = !error && response.status >= 200 && response.status < 400;

  if (live) {
    recorder.pass(name, `${url} → ${response.status} (${duration}ms)`);
    if (!deployed) {
      recordDeploy({ dir: ctx.brandRoot, target: app.target, instance, detail: { adopted: true } });
    }
  } else if (!deployed) {
    recorder.warn(name, `not deployed yet — run \`omega deploy\` when ready (${url})`);
  } else {
    recorder.fail(name, `${url} → ${error || response.status}`);
  }
}

/**
 * API health check — the deployed backend answers on
 * https://api.{host}{API_HEALTH_PATH}, plus a deployed-version comparison
 * from the health payload. Skipped for shared Firebase projects (the owning
 * brand deploys the backend).
 */
async function checkApiHealth(recorder, app, ctx) {
  const name = `${app.name}: API health`;

  if (ctx.brandConfig.firebase?.shared === true) {
    recorder.note(name, 'shared Firebase project (owning brand deploys the backend)');
    return;
  }

  const baseUrl = ctx.brandConfig.brand?.url;
  if (!baseUrl) {
    recorder.warn(name, 'no brand.url configured — cannot check');
    return;
  }

  const host = baseUrl.replace(/^https?:\/\//, '');
  const apiUrl = `https://${API_SUBDOMAIN}.${host}${API_HEALTH_PATH}`;

  if (ctx.dryRun) {
    recorder.would(`fetch ${apiUrl}`);
    return;
  }

  // Same never-deployed vs deployed-but-down split as checkHomepage
  const deployRecord = readDeployRecord({ dir: ctx.brandRoot, target: app.target });
  const { response, duration, error } = await fetchWithRetry(ctx, apiUrl);
  const live = !error && response.status >= 200 && response.status < 400;

  if (!live) {
    if (!deployRecord) {
      recorder.warn(name, `not deployed yet — run \`omega deploy\` when ready (${apiUrl})`);
    } else {
      recorder.fail(name, `${apiUrl} → ${error || response.status}`);
    }
    return;
  }

  recorder.pass(name, `${apiUrl} → ${response.status} (${duration}ms)`);
  if (!deployRecord) {
    recordDeploy({ dir: ctx.brandRoot, target: app.target, detail: { adopted: true } });
  }

  // Deployed-version comparison from the health payload
  let data = null;
  try {
    data = await response.json();
  } catch {
    return;
  }

  const framework = TARGET_FRAMEWORKS[app.target];
  const deployed = data?.backendVersion;
  if (!deployed) return;

  const deployedName = `${app.name}: deployed backend`;
  const latest = getLatestVersion(ctx, framework);

  if (!latest) {
    recorder.note(deployedName, `${deployed} (could not check latest)`);
  } else if (deployed === latest) {
    recorder.pass(deployedName, `${deployed} (up to date)`);
  } else {
    recorder.warn(deployedName, `outdated (${deployed} → ${latest})`);
  }
}

/**
 * GitHub Actions check — latest workflow run of the brand repo. Silent when
 * no github.org is configured (the github service already reports that skip)
 * or when the gh CLI is unavailable.
 */
function checkGitHubActions(recorder, ctx) {
  const github = ctx.brandConfig.github || {};
  if (!github.org) return;

  const repo = `${github.org}/${github.repo || ctx.brandId}`;

  if (ctx.dryRun) {
    recorder.would(`gh run list --repo ${repo}`);
    return;
  }

  let runs;
  try {
    runs = JSON.parse(ctx.exec(`gh run list --repo ${repo} --limit 1 --json status,conclusion,name`));
  } catch {
    recorder.note('GitHub Actions', 'could not check (gh unavailable or no access)');
    return;
  }

  if (!runs.length) {
    recorder.note('GitHub Actions', 'no runs found');
    return;
  }

  const run = runs[0];
  if (run.status === 'completed' && run.conclusion === 'success') {
    recorder.pass('GitHub Actions', `${run.name} → success`);
  } else if (run.status === 'in_progress') {
    recorder.warn('GitHub Actions', `${run.name} → in progress`);
  } else {
    recorder.fail('GitHub Actions', `${run.name} → ${run.conclusion || run.status}`);
  }
}

module.exports = {
  createRecorder,
  defaultExec,
  fetchWithRetry,
  compareVersions,
  installedVersion,
  parseWorkingTree,
  checkAppFiles,
  checkFrameworkVersion,
  checkWorkingTree,
  checkHomepage,
  checkApiHealth,
  checkGitHubActions,
};
