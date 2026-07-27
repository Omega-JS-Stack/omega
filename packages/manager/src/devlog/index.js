/**
 * Devlog — auto-generated commit-digest blog posts: collect recent commits
 * across GitHub orgs + brand repos → have Ghostii write a first-person devlog
 * article → publish to the brand's website app (syndication platforms later).
 *
 * Standalone command, not a service: publishing a new post every run is not
 * idempotent reconciliation, so devlog never runs during manage. Stateless by
 * design — every run computes `since = now − lookbackDays` and fetches fresh;
 * nothing is read from or written to .omega/state.json or runs/. Running
 * twice in one window writes two posts about the same commits — the cadence
 * is owned by whoever runs it.
 *
 * Works from a brand root (that brand publishes; company siblings via the
 * .omega/company.json stamp still feed the backlink map) or a company root
 * (--brand, or the single brand with devlog.enabled).
 */

const { join } = require('node:path');

const chalk = require('chalk').default;
const jetpack = require('fs-jetpack');
const { loadEnvChain } = require('@omega.js/config');

const { resolveBrandRoot, loadBrand } = require('../lib/brand.js');
const {
  isCompanyRoot, discoverBrands, loadCompanyConfig, readCompanyMarker,
} = require('../lib/company.js');
const { GitHubAPI } = require('../services/github/lib/github-api.js');
const { collectCommits } = require('./lib/collect-commits.js');
const { buildProjectMap, buildBrandRepos } = require('./lib/project-map.js');
const { generatePost } = require('./lib/generate-post.js');
const { publishToWebsite, renderPostFile } = require('./lib/publish-website.js');

/**
 * Pick the brand that publishes: explicit --brand wins; otherwise exactly one
 * loaded brand must have devlog.enabled.
 *
 * @param {Array} brands - Loaded brands (lib/brand.js loadBrand shape)
 * @param {string} [explicitId] - Brand ID passed via --brand
 * @returns {object} The publishing brand
 */
function pickBrand(brands, explicitId) {
  if (explicitId) {
    const brand = brands.find((b) => b.id === explicitId);
    if (!brand) {
      throw new Error(`Brand not found: ${explicitId} (known: ${brands.map((b) => b.id).join(', ')})`);
    }
    return brand;
  }

  const enabled = brands.filter((b) => b.config.devlog.enabled === true);

  if (enabled.length === 0) {
    throw new Error('No brand has devlog.enabled — set it in the brand\'s config/omega.json5 or pass --brand');
  }
  if (enabled.length > 1) {
    throw new Error(`Multiple brands have devlog.enabled (${enabled.map((b) => b.id).join(', ')}) — pass --brand`);
  }

  return enabled[0];
}

/**
 * Resolve the run context from any cwd: the publishing brand, every sibling
 * brand (they feed the backlink map — the brand configs are the SSOT for
 * where repos live), and the company root when one is in play.
 *
 * @param {string} startDir - Any directory inside a brand or company workspace
 * @param {string} [explicitId] - Brand ID passed via --brand
 * @returns {{ brand: object, brands: Array, companyRoot: string|null }}
 */
function resolveContext(startDir, explicitId) {
  const root = resolveBrandRoot(startDir);

  if (!root) {
    throw new Error(
      `No brand or company workspace found at or above ${startDir} — `
      + 'expected a config/omega.json5 at the root (see docs/shared/config.md).',
    );
  }

  // Company root: every managed brand loads with the company layer; the
  // publishing brand is picked from among them.
  if (isCompanyRoot(root)) {
    const companyConfig = loadCompanyConfig(root);
    const brands = discoverBrands(root).brands.map((b) => loadBrand(b.root, { companyConfig }));

    if (brands.length === 0) {
      throw new Error(`No brands found under ${root} — nothing to devlog about`);
    }

    return { brand: pickBrand(brands, explicitId), brands, companyRoot: root };
  }

  // Brand root: this brand publishes. The company stamp (when present and
  // fresh) layers company defaults AND surfaces the sibling brands for the
  // project map.
  const marker = readCompanyMarker(root);
  let companyRoot = null;
  let companyConfig = null;

  if (marker?.stale) {
    console.log(chalk.yellow(`⚠ .omega/company.json points at ${marker.companyRoot}, which is no longer a company workspace — running standalone`));
  } else if (marker) {
    companyRoot = marker.companyRoot;
    companyConfig = loadCompanyConfig(companyRoot);
  }

  const brand = loadBrand(root, { companyConfig });

  if (explicitId && explicitId !== brand.id) {
    throw new Error(`--brand=${explicitId} does not match this brand root (${brand.id}) — run from the company root to target siblings`);
  }

  let brands = [brand];
  if (companyRoot) {
    const siblings = discoverBrands(companyRoot).brands
      .filter((b) => b.id !== brand.id)
      .map((b) => loadBrand(b.root, { companyConfig }));
    brands = [brand, ...siblings];
  }

  return { brand, brands, companyRoot };
}

/**
 * Main devlog runner: collect commits → map projects → generate post →
 * publish (or preview on --dry-run).
 *
 * @param {string} startDir - Any directory inside the brand/company workspace
 * @param {object} [options] - { brand?, days?, dryRun? }
 * @param {object} [deps] - Test seams: { githubApi?, generatePost? } — prod
 *   callers pass nothing and get the real GitHubAPI + Ghostii pipeline
 * @returns {Promise<{ published: boolean, commits: number, previewPath?: string, posts?: Array }>}
 */
async function runDevlog(startDir, options = {}, deps = {}) {
  console.log(chalk.bold.cyan('Omega Manager — Devlog'));
  console.log('');

  const { brand, brands, companyRoot } = resolveContext(startDir, options.brand);
  const settings = brand.config.devlog;

  if (!settings.enabled) {
    throw new Error(`Devlog is disabled for ${brand.id} — set devlog.enabled: true`);
  }
  if (!settings.orgs.length) {
    throw new Error(`No devlog.orgs configured for ${brand.id}`);
  }

  // Secrets chain: shell env > brand .env > company .env — the shared
  // cascade (files load strongest-first, never overriding what's set)
  loadEnvChain([
    join(brand.root, '.env'),
    companyRoot ? join(companyRoot, '.env') : null,
  ]);

  const days = Number(options.days || settings.lookbackDays);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  console.log(`${chalk.dim('→')} Brand: ${chalk.cyan(brand.config.brand?.name || brand.id)} (${brand.id})`);
  console.log(`${chalk.dim('→')} Window: last ${days} days (since ${since.toISOString()})`);
  console.log('');

  // 1. Brand configs are the SSOT for repos: the backlink map + the full repo
  //    list across every brand (the `orgs` list only adds non-brand repos
  //    like frameworks and tooling)
  const projectMap = buildProjectMap(brands, { excludeRepos: settings.excludeRepos });
  const brandRepos = buildBrandRepos(brands, { excludeRepos: settings.excludeRepos });

  // 2. Collect commits from GitHub
  const api = deps.githubApi || new GitHubAPI();
  const { commits, repos } = collectCommits({
    api,
    orgs: settings.orgs,
    brandRepos,
    since,
    excludeRepos: settings.excludeRepos,
    excludeCommits: settings.excludeCommits,
    includePrivate: settings.includePrivate,
  });

  if (!commits.length) {
    console.log(`${chalk.yellow('⚠')} No commits found in the last ${days} days — nothing to write about`);
    return { published: false, commits: 0 };
  }

  console.log('');
  console.log(`${chalk.green('✓')} Collected ${commits.length} commits across ${repos.length} repos`);

  // 3. Generate the post
  console.log(`${chalk.dim('→')} Generating post via ${settings.provider}...`);
  const generate = deps.generatePost || generatePost;
  const post = await generate({ brandConfig: brand.config, commits, projectMap, days });
  console.log(`${chalk.green('✓')} Generated: ${chalk.cyan(post.title)}`);
  console.log('');

  // 4. Publish (or preview on --dry-run)
  if (options.dryRun) {
    const previewPath = join(brand.root, '.omega', 'devlog', `${post.slug}.md`);
    jetpack.write(previewPath, renderPostFile(brand.config, post));
    console.log(`${chalk.green('✓')} Dry run — preview written to ${chalk.cyan(previewPath)}`);
    return { published: false, commits: commits.length, previewPath };
  }

  const posts = [];
  for (const destination of settings.destinations) {
    if (destination === 'website') {
      const { postPath, url } = publishToWebsite({ brand, post });
      posts.push({ destination, postPath, url });
      console.log(`${chalk.green('✓')} Website: ${chalk.cyan(postPath)}`);
      console.log(`  ${chalk.dim('→')} Live at ${chalk.cyan(url)} after the site build finishes`);
    } else {
      console.log(`${chalk.yellow('⚠')} Destination not implemented yet: ${destination}`);
    }
  }

  return { published: posts.length > 0, commits: commits.length, posts };
}

module.exports = { runDevlog };
