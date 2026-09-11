/**
 * `omega deploy` — the explicit publish verb (D13: commits never
 * auto-publish). Delivers the brand to its repo and dispatches the scaffolded
 * build workflow so CI runs the SAME build and publishes to gh-pages.
 *
 * ONE lane, the same one every target takes
 * ([#872](https://github.com/Omega-JS-Stack/omega/issues/872)): the executor
 * resolves it from the brand (`@omega.js/devkit/deploy`'s resolveDeployLane):
 * a nested or linked brand packs its local frameworks and force-pushes a
 * SNAPSHOT of the brand folder, an ordinary brand commits and pushes. Then it
 * waits for the workflow and dispatches. A linked tree no longer switches
 * itself to the direct lane; `--direct` is how a human asks for that.
 *
 * Every run starts with the local scaffold the retired `omega setup` used to
 * own (ensureTarget) and its NETWORK half as a precheck: the brand's .env keys
 * are published as repo secrets so CI has what the scaffolded workflow asks
 * for. `--no-secrets` opts out.
 *
 * Flags: --dry-run (print the exact dispatch, send nothing; skips the push),
 * --local (production build only: no push, no dispatch),
 * --no-sync (dispatch without committing/pushing first: the push lane, and a linked own-repo brand's workflow sync),
 * --direct (build + push dist straight to the brand repo's gh-pages —
 * the no-CI path: the pipeline command's lane, and any brand whose
 * repo has no workflows yet; CI dispatch stays the default verb).
 */
const fs = require('node:fs');
const path = require('node:path');
const { execSync, execFileSync } = require('node:child_process');
const Logger = require('@omega.js/devkit/logger');
const { deployViaDispatch, dispatchRepo } = require('@omega.js/devkit/deploy');
const { composedWorkflowName } = require('@omega.js/devkit/ci-workflows');
const { ensureTarget } = require('./lib/ensure-target.js');
const { deployPrecheck } = require('./lib/deploy-precheck.js');
const { resolvePathPrefix } = require('../path-prefix.js');

const logger = new Logger('deploy');

// GitHub's own Pages host — the address a PROJECT site already serves at, so a
// brand.url naming one is never a custom domain ([#366](https://github.com/Omega-JS-Stack/omega/issues/366)).
const DEFAULT_PAGES_HOST = /(^|\.)github\.io$/i;

/**
 * The URL this deploy PUBLISHES to, split where the host ends: the two facts
 * every derivation below reasons from. Parsed by hand, not through
 * `new URL()`, because the value is allowed to arrive without a scheme.
 *
 * The resolved config's top-level `url` answers first: it is THIS instance's
 * own public url ([#588](https://github.com/Omega-JS-Stack/omega/issues/588),
 * derived from the instance id or declared on its entry), so a
 * `targets/website-admin` deploy writes admin.acme.test into the CNAME and
 * mounts the build there instead of publishing over the main site. `brand.url`
 * is the fallback, which IS the answer for the single-instance world.
 *
 * @param {object} config - Composed omega config (brand + local layers).
 * @returns {{ host: string, path: string }} '' each when no URL is known.
 */
function brandUrlParts(config) {
  const value = String(config.url || config.brand?.url || '').replace(/^https?:\/\//, '');
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
 * A target's composed config, with validation findings treated as FATAL — the
 * deploy lanes' twin of the build's loadSiteData
 * ([#426](https://github.com/Omega-JS-Stack/omega/issues/426)). Every finding
 * the loader returns names a key nothing will read at runtime, so deriving a
 * deploy address or publishing from that config ships a site the config does
 * not describe. The build refuses the same file; these lanes refuse it first.
 *
 * @param {string} dir - The consumer target dir.
 * @returns {object} The resolved config.
 * @throws {Error} When the config carries validation findings.
 */
function loadDeployConfig(dir) {
  const { loadConfig, formatErrors } = require('@omega.js/config');
  const { config, errors } = loadConfig(dir, 'web');

  if (errors && errors.length) {
    throw new Error(`config/omega.json5 is invalid:\n${formatErrors(errors)}`);
  }

  return config;
}

/**
 * The repo this target's CI dispatch addresses: the brand's own, from the
 * config it just loaded ([#799](https://github.com/Omega-JS-Stack/omega/issues/799)).
 * A git remote answers the repo the working tree SITS IN, which inside a brand
 * nested in another repo is the enclosing one, so the dispatch went to a
 * workflow that was never there. The rule is `@omega.js/devkit/deploy`'s
 * `dispatchRepo`, the same call desktop's release verbs and the extension's
 * deploy make. Exported for tests.
 *
 * @returns {{ owner: string, repo: string }} owner and bare repo name
 * @throws {Error} when the config names no repo
 */
function dispatchAddress() {
  return dispatchRepo(loadDeployConfig(process.cwd()));
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
  return deployPathPrefix(loadDeployConfig(dir || process.cwd()), env);
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
  // Fatal BEFORE anything is planned, printed or pushed — including a dry run,
  // whose whole job is to say what a real run would do (#426).
  const config = loadDeployConfig(process.cwd());

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

  // The local half of the retired `omega setup` (#675) — idempotent, offline,
  // and quiet on a converged target. Runs before the manifest is read: it is
  // what writes that manifest on a virgin target.
  ensureTarget({ projectDir: process.cwd(), log: (line) => logger.log(line), warn: (line) => logger.warn(line) });

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

  // The NETWORK half of the retired setup, as a precheck before the dispatch:
  // the workflow reads its secrets from the repo, so they are published here
  // rather than by a command someone had to remember (#675). A dry run sends
  // nothing, so it publishes nothing either.
  if (!dryRun) {
    await deployPrecheck({ projectDir: process.cwd(), options, logger });
  }

  // ONE lane for all four targets ([#872](https://github.com/Omega-JS-Stack/omega/issues/872)):
  // the executor resolves it from the BRAND (`dir`): a nested or linked brand
  // packs its local frameworks and pushes a snapshot, a registry-clean brand
  // that is its own repo syncs and pushes. Then it waits for the workflow and
  // dispatches. `--no-sync` skips the push on both lanes that have one.
  const { owner, repo } = dispatchAddress();
  const { plan, dispatched, lane } = await deployViaDispatch({
    workflow: WORKFLOW,
    owner,
    repo,
    dir: process.cwd(),
    dryRun,
    sync: options.sync !== false,
    logger,
  });

  if (dispatched) {
    const { targetInstance } = require('@omega.js/config');
    require('@omega.js/devkit/deploy-record').recordDeploy({ dir: process.cwd(), target: 'web', instance: targetInstance(process.cwd(), 'web'), detail: { method: 'dispatch' } });
    logger.log(`Dispatched ${WORKFLOW} (${lane.mode} lane, ref ${lane.ref}): CI builds and publishes this deploy.`);
    logger.log(`Watch: ${plan.runsUrl}`);
  } else {
    logger.log(`DRY RUN (${lane.mode} lane, ref ${lane.ref}), would send:`);
    logger.log(`  ${plan.method} ${plan.url}`);
    logger.log(`  body: ${JSON.stringify(plan.body)}`);
    logger.log(`  then watch: ${plan.runsUrl}`);
  }
};

module.exports.buildDirectPlan = buildDirectPlan;
module.exports.dispatchAddress = dispatchAddress;
module.exports.pagesHost = pagesHost;
module.exports.deployPathPrefix = deployPathPrefix;
module.exports.targetPathPrefix = targetPathPrefix;
