/**
 * `omega deploy` — the explicit publish verb (D13: commits never
 * auto-publish). Syncs the working tree (commit + push — push triggers
 * NOTHING), then dispatches the scaffolded build workflow so CI runs the
 * SAME build and publishes to gh-pages.
 *
 * Flags: --dry-run (print the exact dispatch, send nothing; skips sync),
 * --local (production build only — no sync, no dispatch),
 * --no-sync (dispatch without committing/pushing first),
 * --direct (build + push dist straight to the brand repo's gh-pages —
 * the no-CI path: cp117b for the pipeline command, and any brand whose
 * repo has no workflows yet; CI dispatch stays the default verb).
 * Refuses to deploy with local `file:` packages installed.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execSync, execFileSync } = require('node:child_process');
const Logger = require('@omega.js/devkit/logger');
const { deployViaDispatch, findLocalSpecs, syncWorkingTree } = require('@omega.js/devkit/deploy');
const { composedWorkflowName } = require('@omega.js/devkit/ci-workflows');
const { resolvePathPrefix } = require('../path-prefix.js');

const logger = new Logger('omega:deploy');

/**
 * The GitHub Pages custom domain: brand.url's bare host. Shared by the
 * direct-deploy plan AND `omega build`'s dist/CNAME emission (both deploy
 * lanes must publish the file — a gh-pages push without it clears the
 * Pages domain).
 *
 * @param {object} config - Composed omega config (brand + app layers).
 * @returns {string} Bare host ('' when brand.url is unset).
 */
function pagesHost(config) {
  return (config.brand?.url || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
}

/**
 * The base path this deploy publishes under ([#358](https://github.com/Omega-JS-Stack/omega/issues/358)) —
 * the `OMEGA_PATH_PREFIX` the #355 build lanes mount every root-relative URL
 * under, filled from facts a deploy already resolves so an ordinary gh-pages
 * brand never sees an env var:
 *
 *   brand.url set   → the site serves at that domain's ROOT (the CNAME both
 *                     lanes publish cannot carry a path) → `/`.
 *   brand.url unset → the default project address
 *                     `https://<owner>.github.io/<name>/` → `/<name>/`, from
 *                     the same slug the direct plan names the repo with.
 *
 * An explicitly exported value WINS: publisher machinery (workkit's publish
 * reads the mount point off the Pages API) knows better than this derivation.
 * A blank export is an ABSENCE, not a value — an Actions secret that was never
 * set renders as an empty string, and that must not suppress the autofill.
 * Normalization is #355's (src/path-prefix.js), never a second copy.
 *
 * @param {object} config - Composed omega config (brand + app layers).
 * @param {object} [env] - Environment to read (defaults to process.env).
 * @returns {string} '/' (domain root) or '/<name>/' (project address).
 */
function deployPathPrefix(config, env) {
  env = env || process.env;

  const explicit = String(env.OMEGA_PATH_PREFIX || '').trim();
  if (explicit) return explicit;

  if (pagesHost(config)) return '/';

  // CI derives the same value remotely: the checked-out config normally
  // carries the slug, and GITHUB_REPOSITORY names the repo when it does not.
  const { brandRepoName, parseRepoSlug } = require('@omega.js/config');
  const name = brandRepoName(config) || parseRepoSlug(env.GITHUB_REPOSITORY).name;
  const prefix = resolvePathPrefix(name);

  return prefix ? `${prefix}/` : '/';
}

/**
 * `deployPathPrefix` for an app dir, loading that app's composed config —
 * the entry point for callers holding no config yet. The scaffolded CI
 * workflow runs exactly this (`@omega.js/web/deploy`) from the app dir, so
 * the dispatch lane and the direct lane derive through ONE function.
 *
 * @param {string} [dir] - The consumer app dir (defaults to cwd).
 * @param {object} [env] - Environment to read (defaults to process.env).
 * @returns {string} '/' or '/<name>/'.
 */
function appPathPrefix(dir, env) {
  const { loadConfig } = require('@omega.js/config');
  const { config } = loadConfig(dir || process.cwd(), 'web');

  return deployPathPrefix(config || {}, env);
}

/**
 * The direct-deploy plan from the app's composed config: the brand repo
 * (shared @omega.js/config derivation from the repo.providers.github.repo
 * slug — name → brand.id, owner → repo.providers.github.org) and the
 * Pages custom domain (brand.url's host).
 *
 * @param {object} config - Composed omega config (brand + app layers).
 * @returns {{ repo: string, pushUrl: string, branch: string, cname: string }}
 */
function buildDirectPlan(config) {
  const { brandRepoName, brandRepoOwner } = require('@omega.js/config');
  const owner = brandRepoOwner(config);
  if (!owner) {
    throw new Error('Direct deploy needs repo.providers.github.org (or an owner in the repo.providers.github.repo slug) in config/omega.json5 — or use the CI dispatch deploy');
  }

  const repoName = brandRepoName(config);
  if (!repoName) {
    throw new Error('Direct deploy needs repo.providers.github.repo or brand.id to name the brand repo');
  }

  const cname = pagesHost(config);
  if (!cname) {
    throw new Error('Direct deploy needs brand.url (the Pages custom domain)');
  }

  const repo = `${owner}/${repoName}`;
  return { repo, pushUrl: `https://github.com/${repo}.git`, branch: 'gh-pages', cname };
}

/**
 * Build, then push dist to the brand repo's gh-pages (CNAME + .nojekyll
 * included). GitHub auto-enables Pages on a gh-pages push; the manager's
 * github service reconciles the Pages settings on its next run.
 */
function deployDirect({ dryRun }) {
  const { loadConfig } = require('@omega.js/config');
  const { config, errors } = loadConfig(process.cwd(), 'web');
  if (!config) {
    throw new Error(`Could not load the omega config${errors?.length ? `: ${errors.join('; ')}` : ''}`);
  }

  const plan = buildDirectPlan(config);
  const dist = path.join(process.cwd(), 'dist');

  if (dryRun) {
    logger.log('DRY RUN — direct deploy would:');
    logger.log(`  build, then push ${dist} → ${plan.pushUrl} (${plan.branch}), CNAME ${plan.cname}`);
    return;
  }

  // Cached-only translation: a deploy must never hang on a live LLM pass
  // (provider limits/outages) — cold language pairs skip with the standard
  // warning, and `omega translate` owns filling the cache.
  // The base path travels with the build (#358): this lane builds LOCALLY, so
  // it is the lane that must hand `omega build` the mount point.
  logger.log('Building (production, cached-only translation)...');
  const env = { ...process.env, OMEGA_PATH_PREFIX: deployPathPrefix(config) };
  execSync('npm run build -- --cached-only', { stdio: 'inherit', env });

  if (!fs.existsSync(path.join(dist, 'index.html')) && !fs.existsSync(path.join(dist, '404.html'))) {
    throw new Error(`Build produced no site in ${dist} — refusing to push an empty branch`);
  }

  logger.log(`Pushing dist → ${plan.repo}#${plan.branch} (CNAME ${plan.cname})...`);
  fs.writeFileSync(path.join(dist, 'CNAME'), plan.cname);
  fs.writeFileSync(path.join(dist, '.nojekyll'), '');
  fs.rmSync(path.join(dist, '.git'), { recursive: true, force: true });

  // Config-derived values (pushUrl/branch/cname) pass as their own argv
  // elements — no shell parses them.
  const git = (...args) => execFileSync('git', args, { cwd: dist, stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    git('init', '-q', '-b', plan.branch);
    git('add', '-A');
    git('-c', 'commit.gpgsign=false', 'commit', '-q', '-m', `Deploy ${plan.cname} (omega deploy --direct)`);
    git('push', '-q', '-f', plan.pushUrl, plan.branch);
  } finally {
    fs.rmSync(path.join(dist, '.git'), { recursive: true, force: true });
  }

  // Records key per instance (multi-instance targets): this app deploys ITS
  // instance, so apps/website-admin lands under web:admin, main stays web
  const { appInstance } = require('@omega.js/config');
  require('@omega.js/devkit/deploy-record').recordDeploy({ dir: process.cwd(), target: 'web', instance: appInstance(process.cwd(), 'web'), detail: { method: 'direct' } });
  logger.log(`Deployed — https://${plan.cname} serves once Pages picks up the push.`);
  return purgeAfterPublish(config);
}

/**
 * Post-publish Cloudflare purge (the content just changed — clear the
 * zone's edge cache). Skips cleanly without a token; a purge FAILURE is a
 * warning, never a failed deploy — the site is already live.
 * @param {object} config - composed web config
 */
async function purgeAfterPublish(config) {
  const { purgeZoneCache } = require('../purge.js');
  try {
    const result = await purgeZoneCache({ config });
    if (result.status === 'purged') {
      logger.log(`Cloudflare cache purged (zone ${result.zoneName || result.zone}).`);
    } else {
      logger.log(`Cloudflare purge skipped — ${result.reason}.`);
    }
  } catch (error) {
    logger.warn(`Cloudflare purge failed (site is live; run \`omega purge\` to retry): ${error.message}`);
  }
}

module.exports = async function (options) {
  options = options || {};
  const dryRun = options.dryRun || options['dry-run'];
  const project = require(path.join(process.cwd(), 'package.json'));

  // Inside a brand monorepo the app's CI lives in the BRAND ROOT's workflows
  // dir under a per-app name (#265) — dispatch what setup actually composed.
  const WORKFLOW = composedWorkflowName({
    appDir: process.cwd(),
    brandRoot: require('@omega.js/config').resolveSeedMode(process.cwd()).brandRoot,
    workflow: 'build.yml',
  });

  // Direct deploys build LOCALLY and push only the built output — local
  // file: packages are fine there (the monorepo model). The guard below
  // protects the CI-dispatch path, where CI rebuilds from pushed source.
  if (options.direct) {
    return deployDirect({ dryRun });
  }

  if (options.local) {
    logger.log('Building (local only — no dispatch)...');
    execSync('npm run build', { stdio: 'inherit' });
    return;
  }

  // Linked local packages (tree-wide @omega.js file: specs — cp194: one
  // linked SIBLING breaks the CI install — or any file: dep in THIS app) →
  // the DIRECT lane automatically. Mirrored rule (Ian 2026-07-20): a linked
  // brand ships the LOCAL framework — build here, push output; CI dispatch
  // is only for registry-clean trees.
  const allDeps = JSON.stringify(project.dependencies || {}) + JSON.stringify(project.devDependencies || {});
  if (findLocalSpecs({ dir: process.cwd() }).length > 0 || allDeps.includes('file:')) {
    logger.log('Linked local packages detected — deploying via the DIRECT lane (local build, output-only push). CI dispatch resumes after `omega i live`.');
    return deployDirect({ dryRun });
  }

  if (!dryRun && options.sync !== false) {
    logger.log('Syncing (commit + push — publishes nothing by itself)...');
    syncWorkingTree({ message: 'Deploy', logger });
  }

  const { plan, dispatched } = await deployViaDispatch({ workflow: WORKFLOW, dryRun });

  if (dispatched) {
    const { appInstance } = require('@omega.js/config');
    require('@omega.js/devkit/deploy-record').recordDeploy({ dir: process.cwd(), target: 'web', instance: appInstance(process.cwd(), 'web'), detail: { method: 'dispatch' } });
    logger.log(`Dispatched ${WORKFLOW} — CI builds and publishes this deploy.`);
    logger.log(`Watch: ${plan.runsUrl}`);
  } else {
    logger.log('DRY RUN — would send:');
    logger.log(`  ${plan.method} ${plan.url}`);
    logger.log(`  body: ${JSON.stringify(plan.body)}`);
    logger.log(`  then watch: ${plan.runsUrl}`);
  }
};

module.exports.buildDirectPlan = buildDirectPlan;
module.exports.pagesHost = pagesHost;
module.exports.deployPathPrefix = deployPathPrefix;
module.exports.appPathPrefix = appPathPrefix;
