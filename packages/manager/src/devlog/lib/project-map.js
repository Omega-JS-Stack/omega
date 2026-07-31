/**
 * Devlog backlink SSOT — map every known brand repo to its public project
 * (name + URL) so the writer can link each mentioned repo to the product it
 * belongs to. Repos not in the map are treated as standalone and linked to
 * GitHub instead.
 *
 * In the brand-monorepo world every brand is ONE repo (`repo.providers.github.org` +
 * `repo.providers.github.repo || brand id` — the github service's exact derivation);
 * omega-manager's per-target + subdomain repo fan-out collapsed at the
 * redesign. Brands without a repo.providers.github.org are skipped (the github service
 * skips them too).
 */

/**
 * Resolve a loaded brand's repo identity, or null when it has none.
 *
 * @param {object} brand - Loaded brand (lib/brand.js loadBrand shape)
 * @returns {{ owner: string, repo: string }|null}
 */
function brandRepo(brand) {
  const github = brand.config.repo?.providers?.github;

  if (!github.org) {
    return null;
  }

  return { owner: github.org, repo: github.repo || brand.id };
}

/**
 * Build the repo → project map across every loaded brand.
 *
 * @param {Array} brands - Loaded brands
 * @param {object} [params] - { excludeRepos }
 * @returns {Object<string, {project: string, url: string}>} repoName → project
 */
function buildProjectMap(brands, { excludeRepos = [] } = {}) {
  const map = {};

  for (const brand of brands) {
    const identity = brandRepo(brand);

    if (!identity || excludeRepos.includes(identity.repo)) {
      continue;
    }

    map[identity.repo] = {
      project: brand.config.brand?.name || brand.id,
      url: brand.config.brand?.url || '',
    };
  }

  return map;
}

/**
 * Build the complete brand repo list. The brand configs are the SSOT for
 * where every repo lives, so scanning is never limited to the hand-maintained
 * `orgs` list — that list only supplements this with non-brand repos
 * (frameworks, tooling).
 *
 * @param {Array} brands - Loaded brands
 * @param {object} [params] - { excludeRepos }
 * @returns {Array<{ owner: string, repo: string }>} Unique owner/repo pairs
 */
function buildBrandRepos(brands, { excludeRepos = [] } = {}) {
  const seen = new Set();
  const repos = [];

  for (const brand of brands) {
    const identity = brandRepo(brand);

    if (!identity || excludeRepos.includes(identity.repo)) {
      continue;
    }

    const key = `${identity.owner}/${identity.repo}`.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    repos.push(identity);
  }

  return repos;
}

module.exports = { buildProjectMap, buildBrandRepos };
