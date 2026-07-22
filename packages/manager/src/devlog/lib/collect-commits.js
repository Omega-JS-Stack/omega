/**
 * Devlog collect stage — build the scan worklist (org listings + brand-derived
 * repos) and pull every eligible commit since the window start via the gh CLI.
 * Org listings come with metadata (archived, pushed_at, private, homepage) so
 * inactive repos are pre-filtered; brand repos get a direct commits probe.
 */

const chalk = require('chalk').default;

// Newest-first cap per repo so fleet-wide automated pushes can't drown the digest
const MAX_COMMITS_PER_REPO = 30;

/**
 * Run a paginated `gh api` call and merge multi-page output.
 * `--paginate` concatenates page arrays back-to-back (`[...][...]`), which
 * breaks JSON.parse — join the boundaries before parsing.
 *
 * @param {object} api - GitHubAPI client
 * @param {string} path - API path including query string
 * @returns {Array} Parsed results (empty array when no output)
 */
function runPaginatedJson(api, path) {
  const raw = api.runCommand(['api', path, '--paginate']);

  if (!raw) {
    return [];
  }

  return JSON.parse(raw.replace(/\]\s*\[/g, ','));
}

/**
 * List repos for a GitHub owner — org endpoint first, user endpoint fallback
 * (devlog.orgs may mix orgs and personal accounts).
 *
 * @param {object} api - GitHubAPI client
 * @param {string} owner - Org or user name
 * @returns {Array} Repos
 */
function listReposForOwner(api, owner) {
  try {
    return runPaginatedJson(api, `orgs/${owner}/repos?per_page=100`);
  } catch {
    return runPaginatedJson(api, `users/${owner}/repos?per_page=100`);
  }
}

/**
 * Collect commits since a given date across the full scan worklist: every
 * repo in the configured `orgs` listings PLUS every brand repo derived from
 * the brand configs. Skips archived/excluded repos, merge/bot/fleet commits,
 * and excludeCommits matches.
 *
 * @param {object} params - { api, orgs, brandRepos, since, excludeRepos, excludeCommits, includePrivate }
 * @returns {{ commits: Array, repos: Array<string> }} Commits + active repo full names
 */
function collectCommits({ api, orgs = [], brandRepos = [], since, excludeRepos = [], excludeCommits = [], includePrivate = true }) {
  const sinceIso = since.toISOString();
  const excludePatterns = excludeCommits.map((pattern) => new RegExp(pattern, 'i'));
  const commits = [];
  const activeRepos = [];

  // Build the worklist. Org listings come with metadata (pushed_at, private,
  // homepage) so inactive repos are pre-filtered; brand-derived repos from
  // other orgs have no listing, so they get a direct commits probe instead.
  const seen = new Set();
  const worklist = [];

  for (const owner of orgs) {
    console.log(`${chalk.dim('→')} Listing ${chalk.cyan(owner)}...`);

    for (const repo of listReposForOwner(api, owner)) {
      seen.add(`${owner}/${repo.name}`.toLowerCase());

      const eligible = !repo.archived
        && new Date(repo.pushed_at) >= since
        && !excludeRepos.includes(repo.name)
        && (includePrivate || !repo.private);

      if (eligible) {
        worklist.push({ owner, repo: repo.name, homepage: repo.homepage || '' });
      }
    }
  }

  for (const { owner, repo } of brandRepos) {
    if (!seen.has(`${owner}/${repo}`.toLowerCase())) {
      worklist.push({ owner, repo, homepage: '' });
    }
  }

  console.log(`${chalk.dim('→')} Scanning ${worklist.length} repos...`);

  worklist.forEach(({ owner, repo, homepage }, index) => {
    let raw;

    try {
      raw = runPaginatedJson(api, `repos/${owner}/${repo}/commits?since=${sinceIso}&per_page=100`);
    } catch {
      // Brand-derived repos may not exist yet (404) or be empty (409) — skip quietly
      console.log(`  ${chalk.dim(`[${index + 1}/${worklist.length}]`)} ${owner}/${repo}: ${chalk.dim('unavailable (missing or empty)')}`);
      return;
    }

    const cleaned = raw
      .filter((c) => !c.commit.message.startsWith('Merge '))
      .filter((c) => !c.commit.message.startsWith('📦 Omega:')) // fleet-automation commits — noise, and automated content is banned anyway
      .filter((c) => !excludePatterns.some((pattern) => pattern.test(c.commit.message))) // banned-topic commits never reach the writer
      .filter((c) => !(c.author?.login || '').endsWith('[bot]') && !(c.commit.author?.name || '').endsWith('[bot]'))
      .map((c) => ({
        owner,
        repo,
        homepage,
        sha: c.sha.slice(0, 7),
        message: c.commit.message.split('\n')[0],
        date: c.commit.author?.date,
      }));

    const trimmed = cleaned.length > MAX_COMMITS_PER_REPO
      ? chalk.dim(` (keeping latest ${MAX_COMMITS_PER_REPO})`)
      : '';
    console.log(`  ${chalk.dim(`[${index + 1}/${worklist.length}]`)} ${owner}/${repo}: ${cleaned.length} commits${trimmed}`);

    // API returns newest first, so slice keeps the most recent
    const kept = cleaned.slice(0, MAX_COMMITS_PER_REPO);

    if (kept.length) {
      commits.push(...kept);
      activeRepos.push(`${owner}/${repo}`);
    }
  });

  return { commits, repos: activeRepos };
}

module.exports = { collectCommits };
