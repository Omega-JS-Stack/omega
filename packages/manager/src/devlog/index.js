/**
 * Devlog — auto-generated commit-digest blog posts: collect recent commits
 * across GitHub orgs + brand repos → have Ghostii write a first-person devlog
 * article → publish to the brand's website target (syndication platforms later).
 *
 * Standalone command, not a service: publishing a new post every run is not
 * idempotent reconciliation, so devlog never runs during manage. Stateless by
 * design — every run computes `since = now − lookbackDays` and fetches fresh;
 * nothing is read from or written to .omega/runs/. Running
 * twice in one window writes two posts about the same commits — the cadence
 * is owned by whoever runs it.
 *
 * Runs from a brand root: that brand publishes, and its own config is the
 * SSOT for the repos the post links to.
 */

const { join } = require('node:path');

const chalk = require('chalk').default;
const jetpack = require('fs-jetpack');
const { loadEnvRoots, chosenProvider, resolveCompany } = require('@omega.js/config');

const { resolveBrandRoot, loadBrand } = require('../lib/brand.js');
const { gh } = require('@omega.js/devkit/github-repo');
const { verifyGhCli } = require('../services/repo/lib/github.js');
const { collectCommits } = require('./lib/collect-commits.js');
const { buildProjectMap, buildBrandRepos } = require('./lib/project-map.js');
const { generatePost } = require('./lib/generate-post.js');
const { publishToWebsite, renderPostFile } = require('./lib/publish-website.js');

/**
 * Resolve the run context from any cwd: the publishing brand and the company
 * tree under it, when the brand names one (#677): the company `.env` is a
 * layer of this run's secrets like any other.
 *
 * @param {string} startDir - Any directory inside a brand
 * @param {string} [explicitId] - Brand ID passed via --brand
 * @returns {{ brand: object, brands: Array, companyDir: string|null }}
 */
function resolveContext(startDir, explicitId) {
  const root = resolveBrandRoot(startDir);

  if (!root) {
    throw new Error(
      `No brand found at or above ${startDir}: `
      + 'expected a config/omega.json5 at the root (see docs/shared/config.md).',
    );
  }

  const brand = loadBrand(root);

  if (explicitId && explicitId !== brand.id) {
    throw new Error(`--brand=${explicitId} does not match this brand root (${brand.id})`);
  }

  return { brand, brands: [brand], companyDir: resolveCompany(root).dir };
}

/**
 * Main devlog runner: collect commits → map projects → generate post →
 * publish (or preview on --dry-run).
 *
 * @param {string} startDir - Any directory inside the brand
 * @param {object} [options] - { brand?, days?, dryRun? }
 * @param {object} [deps] - Test seams: { githubApi?, generatePost? }; prod
 *   callers pass nothing and get the real gh CLI + Ghostii pipeline
 * @returns {Promise<{ published: boolean, commits: number, previewPath?: string, posts?: Array }>}
 */
async function runDevlog(startDir, options = {}, deps = {}) {
  console.log(chalk.bold.cyan('Omega Manager — Devlog'));
  console.log('');

  const { brand, brands, companyDir } = resolveContext(startDir, options.brand);

  if (!brand.config.devlog.enabled) {
    throw new Error(`Devlog is disabled for ${brand.id} — set devlog.enabled: true`);
  }

  // The writer is a KEY under devlog.providers (#425) and its settings live
  // inside it — the role level carries only `enabled`.
  const writer = chosenProvider(brand.config.devlog.providers);
  if (!writer) {
    throw new Error(`No devlog writer configured for ${brand.id} — add devlog.providers.ghostii`);
  }
  const settings = brand.config.devlog.providers[writer];

  if (!settings.orgs.length) {
    throw new Error(`No devlog.providers.${writer}.orgs configured for ${brand.id}`);
  }

  // Secrets chain: shell env > brand .env > company .env — the shared
  // cascade (files load strongest-first, never overriding what's set), each
  // layer overlaid by its own `.env.<environment>` file (#586). `production`
  // is PINNED, never the shell's answer: a devlog run reads REAL GitHub and
  // publishes with the brand's real writer account.
  loadEnvRoots([brand.root, companyDir], { environment: 'production' });

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

  // 2. Collect commits from GitHub. The listings are plain `gh api` reads, so
  //    they ride devkit's ONE gh wrapper (#883) behind the same verify the
  //    walk does, which names a missing or unauthenticated CLI up front.
  let api = deps.githubApi;
  if (!api) {
    verifyGhCli();
    api = { runCommand: (args) => gh(args) };
  }
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
  console.log(`${chalk.dim('→')} Generating post via ${writer}...`);
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
