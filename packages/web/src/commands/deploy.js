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

// GitHub's own Pages host — the address a PROJECT site already serves at, so a
// brand.url naming one is never a custom domain ([#366](https://github.com/Omega-JS-Stack/omega/issues/366)).
const DEFAULT_PAGES_HOST = /(^|\.)github\.io$/i;

/**
 * brand.url split where the host ends: the two facts every derivation below
 * reasons from. Parsed by hand, not through `new URL()`, because brand.url is
 * allowed to arrive without a scheme.
 *
 * @param {object} config - Composed omega config (brand + local layers).
 * @returns {{ host: string, path: string }} '' each when brand.url is unset.
 */
function brandUrlParts(config) {
  const value = String(config.brand?.url || '').replace(/^https?:\/\//, '');
  const slash = value.indexOf('/');

  return slash === -1
    ? { host: value, path: '' }
    : { host: value.slice(0, slash), path: value.slice(slash) };
}

/**
 * The GitHub Pages custom domain: brand.url's bare host. Shared by the
 * direct-deploy plan AND `omega build`'s dist/CNAME emission (both deploy
 * lanes must publish the file — a gh-pages push without it clears the
 * Pages domain).
 *
 * A `*.github.io` host is NOT one ([#366](https://github.com/Omega-JS-Stack/omega/issues/366)):
 * the #355 contract has a project site's brand.url carry its Pages path, so
 * reading that as a custom domain would flip the plan — a CNAME claiming
 * `<owner>.github.io`, the build mounted at `/`, and every asset 404ing at the
 * address the deploy actually publishes to.
 *
 * @param {object} config - Composed omega config (brand + local layers).
 * @returns {string} Bare host ('' when brand.url is unset or names a Pages address).
 */
function pagesHost(config) {
  const { host } = brandUrlParts(config);

  return DEFAULT_PAGES_HOST.test(host) ? '' : host;
}

/**
 * The brand repo this deploy addresses, from the first source that names it:
 * the config slug (the shared @omega.js/config derivation), then the CI
 * environment, then — when a working tree is offered — that tree's own `origin`
 * remote ([#361](https://github.com/Omega-JS-Stack/omega/issues/361): a brand
 * cloned without a slug in its config still knows which repo it is). CI derives
 * without a tree and stops at GITHUB_REPOSITORY.
 *
 * @param {object} config - Composed omega config (brand + local layers).
 * @param {object} env - Environment to read.
 * @param {string} [cwd] - Working tree whose origin remote may name it (omitted → no git probe).
 * @returns {{ owner: string, name: string }} '' for whatever never resolved.
 */
function resolveRepoSlug(config, env, cwd) {
  const { brandRepoOwner, brandRepoName, parseRepoSlug } = require('@omega.js/config');
  let owner = brandRepoOwner(config);
  let name = brandRepoName(config);

  if (!owner || !name) {
    const fromEnv = parseRepoSlug(env.GITHUB_REPOSITORY);
    owner = owner || fromEnv.owner;
    name = name || fromEnv.name;
  }

  if ((!owner || !name) && cwd) {
    const { resolveRepo } = require('@omega.js/devkit/deploy');
    try {
      const remote = resolveRepo({ cwd });
      owner = owner || remote.owner;
      name = name || remote.repo;
    } catch (e) {
      // No remote, or not a GitHub one — the plan's guard names the ways out
    }
  }

  return { owner, name };
}

/**
 * The base path this deploy publishes under ([#358](https://github.com/Omega-JS-Stack/omega/issues/358)) —
 * the `OMEGA_PATH_PREFIX` the #355 build lanes mount every root-relative URL
 * under, filled from facts a deploy already resolves so an ordinary gh-pages
 * brand never sees an env var:
 *
 *   brand.url = a domain    → the site serves at that domain's ROOT (the CNAME
 *                             both lanes publish cannot carry a path) → `/`.
 *   brand.url = a *.github.io
 *                address     → the path it carries IS the mount (#366) →
 *                             `/<name>/`; a bare Pages host falls through.
 *   brand.url unset         → the default project address
 *                             `https://<owner>.github.io/<name>/` → `/<name>/`,
 *                             from the same slug the direct plan names the repo
 *                             with.
 *
 * An explicitly exported value WINS: publisher machinery (workkit's publish
 * reads the mount point off the Pages API) knows better than this derivation.
 * A blank export is an ABSENCE, not a value — an Actions secret that was never
 * set renders as an empty string, and that must not suppress the autofill.
 * Normalization is #355's (src/path-prefix.js), never a second copy.
 *
 * @param {object} config - Composed omega config (brand + local layers).
 * @param {object} [env] - Environment to read (defaults to process.env).
 * @param {string} [cwd] - Working tree whose origin remote may name the repo
 *   (the direct lane passes its own; CI derives without one).
 * @returns {string} '/' (domain root) or '/<name>/' (project address).
 */
function deployPathPrefix(config, env, cwd) {
  env = env || process.env;

  const explicit = String(env.OMEGA_PATH_PREFIX || '').trim();
  if (explicit) return explicit;

  if (pagesHost(config)) return '/';

  // A `*.github.io` brand.url names its own mount (#366): the path it carries
  // IS the base path, so setting brand.url to the Pages address the deploy
  // advises can never move the build. A bare Pages host names no project and
  // falls through to the slug.
  const fromBrandUrl = resolvePathPrefix(brandUrlParts(config).path);
  if (fromBrandUrl) return `${fromBrandUrl}/`;

  // ONE slug resolution with the direct plan: the address a plan publishes to
  // and the base path its build mounts under can never disagree.
  const prefix = resolvePathPrefix(resolveRepoSlug(config, env, cwd).name);

  return prefix ? `${prefix}/` : '/';
}

/**
 * `deployPathPrefix` for a target dir, loading that target's composed config —
 * the entry point for callers holding no config yet. The scaffolded CI
 * workflow runs exactly this (`@omega.js/web/deploy`) from the target dir, so
 * the dispatch lane and the direct lane derive through ONE function.
 *
 * @param {string} [dir] - The consumer target dir (defaults to cwd).
 * @param {object} [env] - Environment to read (defaults to process.env).
 * @returns {string} '/' or '/<name>/'.
 */
function targetPathPrefix(dir, env) {
  const { loadConfig } = require('@omega.js/config');
  const { config } = loadConfig(dir || process.cwd(), 'web');

  return deployPathPrefix(config || {}, env);
}

/**
 * The direct-deploy plan from the target's composed config: the brand repo
 * (resolveRepoSlug), the Pages custom domain (brand.url's host), the address
 * the deploy will serve at, and the base path its build mounts under.
 *
 * TWO shapes, because GitHub Pages has two ([#361](https://github.com/Omega-JS-Stack/omega/issues/361)):
 * a CUSTOM DOMAIN (brand.url names a domain of the brand's own) publishes a
 * CNAME and serves at that domain's root, and a PROJECT site serves at
 * `https://<owner>.github.io/<name>/` with no CNAME at all — the ordinary
 * gh-pages case, which used to be refused here and was therefore reachable only
 * through the CI dispatch lane. A project site's brand.url names its PAGES
 * address (#355/#366), which keeps the project shape rather than switching it.
 *
 * @param {object} config - Composed omega config (brand + local layers).
 * @param {object} [options]
 * @param {object} [options.env] - Environment to read (defaults to process.env).
 * @param {string} [options.cwd] - Working tree to resolve the repo from (defaults to cwd).
 * @returns {{ repo: string, pushUrl: string, branch: string, cname: string, url: string, pathPrefix: string }} `cname` is '' for a project site.
 */
function buildDirectPlan(config, options) {
  const env = (options && options.env) || process.env;
  const cwd = (options && options.cwd) || process.cwd();
  const { owner, name } = resolveRepoSlug(config, env, cwd);

  if (!owner) {
    throw new Error('Direct deploy needs an owner for the brand repo: repo.providers.github.org (or an owner in the repo.providers.github.repo slug) in config/omega.json5, GITHUB_REPOSITORY, or a git origin remote — or use the CI dispatch deploy');
  }

  if (!name) {
    throw new Error('Direct deploy needs repo.providers.github.repo or brand.id to name the brand repo (GITHUB_REPOSITORY and a git origin remote name it too) — or use the CI dispatch deploy');
  }

  const repo = `${owner}/${name}`;
  const brandUrl = brandUrlParts(config);
  const cname = pagesHost(config);
  const pathPrefix = deployPathPrefix(config, env, cwd);
  // A project site serves under the SAME base path the build mounts every URL
  // under, so the two can never drift apart (#358 derives both). Its host comes
  // from brand.url when that names the Pages address, so the plan reports the
  // address the brand declared rather than a second derivation of it (#366).
  const projectHost = brandUrl.host || `${owner.toLowerCase()}.github.io`;
  const url = cname ? `https://${cname}` : `https://${projectHost}${pathPrefix}`;

  // Absolute URLs (canonical, og:url, hreflang alternates, sitemap) build from
  // brand.url, so a project site that leaves it unset emits wrong or empty
  // canonicals on every page (#366). Nothing is derived on its behalf — the
  // address this plan resolved to IS the value, so the warning names it, in the
  // form the docs write it: no trailing slash, ready to compose a page URL onto.
  if (!brandUrl.host) {
    logger.warn(`brand.url is unset — canonical, og:url and sitemap URLs will not resolve. Set brand.url to "${url.replace(/\/$/, '')}" in the brand's config/omega.json5.`);
  }

  return {
    repo,
    pushUrl: `https://github.com/${repo}.git`,
    branch: 'gh-pages',
    cname,
    url,
    pathPrefix,
  };
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
    logger.log(`  build, then push ${dist} → ${plan.pushUrl} (${plan.branch}), ${plan.cname ? `CNAME ${plan.cname}` : `project site ${plan.url} (no CNAME)`}`);
    return;
  }

  // Cached-only translation: a deploy must never hang on a live LLM pass
  // (provider limits/outages) — cold language pairs skip with the standard
  // warning, and `omega translate` owns filling the cache.
  // The base path travels with the build (#358): this lane builds LOCALLY, so
  // it is the lane that must hand `omega build` the mount point.
  logger.log('Building (production, cached-only translation)...');
  const env = { ...process.env, OMEGA_PATH_PREFIX: plan.pathPrefix };
  execSync('npm run build -- --cached-only', { stdio: 'inherit', env });

  if (!fs.existsSync(path.join(dist, 'index.html')) && !fs.existsSync(path.join(dist, '404.html'))) {
    throw new Error(`Build produced no site in ${dist} — refusing to push an empty branch`);
  }

  logger.log(`Pushing dist → ${plan.repo}#${plan.branch} (${plan.cname ? `CNAME ${plan.cname}` : 'project site — no CNAME'})...`);
  // A project site has no custom domain to claim, and an empty CNAME file
  // would claim one: the step belongs to the domain shape only.
  if (plan.cname) {
    fs.writeFileSync(path.join(dist, 'CNAME'), plan.cname);
  }
  fs.writeFileSync(path.join(dist, '.nojekyll'), '');
  fs.rmSync(path.join(dist, '.git'), { recursive: true, force: true });

  // Config-derived values (pushUrl/branch/cname) pass as their own argv
  // elements — no shell parses them.
  const git = (...args) => execFileSync('git', args, { cwd: dist, stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    git('init', '-q', '-b', plan.branch);
    git('add', '-A');
    git('-c', 'commit.gpgsign=false', 'commit', '-q', '-m', `Deploy ${plan.cname || plan.url} (omega deploy --direct)`);
    git('push', '-q', '-f', plan.pushUrl, plan.branch);
  } finally {
    fs.rmSync(path.join(dist, '.git'), { recursive: true, force: true });
  }

  // Records key per instance (multi-instance targets): this target deploys ITS
  // instance, so targets/website-admin lands under web:admin, main stays web
  const { targetInstance } = require('@omega.js/config');
  require('@omega.js/devkit/deploy-record').recordDeploy({ dir: process.cwd(), target: 'web', instance: targetInstance(process.cwd(), 'web'), detail: { method: 'direct' } });
  logger.log(`Deployed — ${plan.url} serves once Pages picks up the push.`);
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

  // Inside a brand monorepo the target's CI lives in the BRAND ROOT's workflows
  // dir under a per-target name (#265) — dispatch what setup actually composed.
  const WORKFLOW = composedWorkflowName({
    targetDir: process.cwd(),
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
  // linked SIBLING breaks the CI install — or any file: dep in THIS target) →
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
    const { targetInstance } = require('@omega.js/config');
    require('@omega.js/devkit/deploy-record').recordDeploy({ dir: process.cwd(), target: 'web', instance: targetInstance(process.cwd(), 'web'), detail: { method: 'dispatch' } });
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
module.exports.targetPathPrefix = targetPathPrefix;
