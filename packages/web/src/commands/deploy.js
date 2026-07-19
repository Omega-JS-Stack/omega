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
const { execSync } = require('node:child_process');
const Logger = require('@omega.js/devkit/logger');
const { deployViaDispatch } = require('@omega.js/devkit/deploy');

const logger = new Logger('omega:deploy');

const WORKFLOW = 'build.yml';

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
 * The direct-deploy plan from the app's composed config: the brand repo
 * (shared @omega.js/config derivation: github.repo → repo_website's repo →
 * brand.id) and the Pages custom domain (brand.url's host).
 *
 * @param {object} config - Composed omega config (brand + app layers).
 * @returns {{ repo: string, pushUrl: string, branch: string, cname: string }}
 */
function buildDirectPlan(config) {
  const { brandRepoName } = require('@omega.js/config');
  const github = config.github || {};
  if (!github.org) {
    throw new Error('Direct deploy needs github.org in config/omega.json5 (the brand repo owner) — or use the CI dispatch deploy');
  }

  const repoName = brandRepoName(config);
  if (!repoName) {
    throw new Error('Direct deploy needs github.repo, github.repo_website, or brand.id to name the brand repo');
  }

  const cname = pagesHost(config);
  if (!cname) {
    throw new Error('Direct deploy needs brand.url (the Pages custom domain)');
  }

  const repo = `${github.org}/${repoName}`;
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
  logger.log('Building (production, cached-only translation)...');
  execSync('npm run build -- --cached-only', { stdio: 'inherit' });

  if (!fs.existsSync(path.join(dist, 'index.html')) && !fs.existsSync(path.join(dist, '404.html'))) {
    throw new Error(`Build produced no site in ${dist} — refusing to push an empty branch`);
  }

  logger.log(`Pushing dist → ${plan.repo}#${plan.branch} (CNAME ${plan.cname})...`);
  fs.writeFileSync(path.join(dist, 'CNAME'), plan.cname);
  fs.writeFileSync(path.join(dist, '.nojekyll'), '');
  fs.rmSync(path.join(dist, '.git'), { recursive: true, force: true });

  const git = (cmd) => execSync(`git ${cmd}`, { cwd: dist, stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    git(`init -q -b ${plan.branch}`);
    git('add -A');
    git(`-c commit.gpgsign=false commit -q -m "Deploy ${plan.cname} (omega deploy --direct)"`);
    git(`push -q -f ${plan.pushUrl} ${plan.branch}`);
  } finally {
    fs.rmSync(path.join(dist, '.git'), { recursive: true, force: true });
  }

  require('@omega.js/devkit/deploy-record').recordDeploy({ dir: process.cwd(), target: 'web', detail: { method: 'direct' } });
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

  // Direct deploys build LOCALLY and push only the built output — local
  // file: packages are fine there (the monorepo model). The guard below
  // protects the CI-dispatch path, where CI rebuilds from pushed source.
  if (options.direct) {
    return deployDirect({ dryRun });
  }

  // Check for local packages — real deploys only; a dry-run publishes
  // nothing, so it may always show the plan
  const allDeps = JSON.stringify(project.dependencies || {}) + JSON.stringify(project.devDependencies || {});
  if (!dryRun && allDeps.includes('file:')) {
    throw new Error('Please remove local packages before deploying!');
  }

  if (options.local) {
    logger.log('Building (local only — no dispatch)...');
    execSync('npm run build', { stdio: 'inherit' });
    return;
  }

  if (!dryRun && options.sync !== false) {
    logger.log('Syncing (commit + push — publishes nothing by itself)...');
    execSync(`npu sync --message='Deploy'`, { stdio: 'inherit' });
  }

  const { plan, dispatched } = await deployViaDispatch({ workflow: WORKFLOW, dryRun });

  if (dispatched) {
    require('@omega.js/devkit/deploy-record').recordDeploy({ dir: process.cwd(), target: 'web', detail: { method: 'dispatch' } });
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
