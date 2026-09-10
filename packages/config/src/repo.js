/**
 * @omega.js/config repo — the SINGLE derivation of the brand's GitHub repo
 * (owner + name), shared by every surface that targets the brand repo (web
 * `omega deploy --direct`, the manager's github service setup/repo/pages,
 * the backend CMS routes that commit posts).
 *
 * One optional key: `repo.providers.github.repo` (or, on a backend load, the
 * target-overlaid `targets.backend.github.repo`, which wins) — either a bare name
 * ("omega-omega") or an "owner/name" slug ("itw-creative-works/omega-omega").
 * Defaults: name falls to `<brand.id>-omega`, owner falls to `repo.providers.github.org`.
 * That name is the `<brand.id>-<role>` repo rule (Ian 2026-09-07,
 * [#809](https://github.com/Omega-JS-Stack/omega/issues/809)): every repo a brand
 * owns is its id plus the role it plays, `omega` for the source monorepo beside
 * the `releases` one below, so nobody types a repo name to get the right one.
 * The slug's owner slot carries the legacy omega-manager orgMain/orgWebsite
 * split (Ian 2026-07-19): most ITW brands house the brand repo under the paid
 * company org (itw-creative-works) while `repo.providers.github.org` keeps
 * naming the brand's own org for org-profile reconciliation. The retired `repoWebsite` URL key
 * (2026-07-19, Ian: "we no longer need it — that was for when the website
 * lived NOT in the monorepo") is superseded by this slug: one repo per
 * brand, named by the brand.
 *
 * Born from the 2026-07-18 launch-night collision: the bare brand-id
 * fallback resolved brand "omega" to Omega-JS-Stack/omega — the framework
 * MONOREPO — instead of the brand repo.
 */

/**
 * Parse a `repo.providers.github.repo` value: "owner/name" slug or bare "name".
 *
 * @param {string} value - e.g. "itw-creative-works/omega-omega" or "omega-omega"
 * @returns {{ owner: string, name: string }} owner is '' for bare names.
 */
function parseRepoSlug(value) {
  const trimmed = (value || '').trim();
  if (!trimmed) return { owner: '', name: '' };
  const slash = trimmed.indexOf('/');
  if (slash === -1) return { owner: '', name: trimmed };
  return { owner: trimmed.slice(0, slash), name: trimmed.slice(slash + 1) };
}

/**
 * The github keys the derivation reads: the shared `repo.providers.github`
 * block, overlaid by the target's own `github` entry (a backend load composes
 * `targets.backend.github` — the CMS's content identity — onto the top level,
 * and per the merge chain the target wins).
 *
 * @param {object} config - Composed omega config (brand + local layers).
 * @returns {object} Merged `{ org, repo, … }` keys.
 */
function githubKeys(config) {
  return { ...(config?.repo?.providers?.github || {}), ...(config?.github || {}) };
}

/**
 * The brand repo's bare name (no owner): a typed slug or bare name, else the
 * `<brand.id>-omega` default of the `<brand.id>-<role>` rule.
 *
 * @param {object} config - Composed omega config (brand + local layers).
 * @returns {string} Repo name ('' when nothing in the chain resolves).
 */
function brandRepoName(config) {
  const github = githubKeys(config);
  // The id half is trimmed like a typed slug: the role suffix is appended to
  // it, so untrimmed whitespace would sit INSIDE the composed name.
  const id = (config?.brand?.id || '').trim();

  return parseRepoSlug(github.repo).name
    || (id ? `${id}-omega` : '');
}

/**
 * The brand repo's owner (GitHub org or user).
 *
 * @param {object} config - Composed omega config (brand + local layers).
 * @returns {string} Owner ('' when nothing in the chain resolves).
 */
function brandRepoOwner(config) {
  const github = githubKeys(config);
  return parseRepoSlug(github.repo).owner || github.org || '';
}

/**
 * The brand repo as ONE finished value: owner, name, and the "owner/name" slug
 * the GitHub API takes. This is the form a FRAMEWORK hands to consumer code —
 * @omega.js/backend exposes it as `config.resolved.github` ([#290](https://github.com/Omega-JS-Stack/omega/issues/290)),
 * because a brand target cannot require this private package and must never
 * re-derive the merge rules for itself.
 *
 * @param {object} config - Composed omega config (brand + local layers).
 * @returns {{ owner: string, name: string, repo: string }} `repo` is the slug, '' unless BOTH halves resolve (half an address addresses nothing).
 */
function brandRepo(config) {
  const owner = brandRepoOwner(config);
  const name = brandRepoName(config);

  return { owner, name, repo: owner && name ? `${owner}/${name}` : '' };
}

/**
 * The releases keys the derivation reads: the desktop target's own `releases`
 * block, overlaid by the top-level one a desktop-resolved config carries (the
 * merge chain overlays `targets.desktop` onto the top level, so the overlay is
 * the resolved value). Both shapes are live: the site global reads a raw config,
 * where the block sits under the target, while every desktop verb reads the
 * resolved one.
 *
 * @param {object} config - Composed omega config (raw or desktop-resolved).
 * @returns {object} Merged `{ enabled, owner, repo }` keys.
 */
function releasesKeys(config) {
  const target = config?.targets?.desktop;
  const entry = target && typeof target === 'object' && !Array.isArray(target) ? target.releases : undefined;

  return { ...(entry || {}), ...(config?.releases || {}) };
}

/**
 * The brand's ONE public releases repo: where the versioned `v<x.y.z>` releases
 * that feed electron-updater live, and where the website's versionless
 * `/releases/latest/download/<asset>` links point ([#620](https://github.com/Omega-JS-Stack/omega/issues/620),
 * [#799](https://github.com/Omega-JS-Stack/omega/issues/799)). One repo per
 * brand, named after it: `<brand.id>-releases` by default, under the brand
 * repo's own owner, so a brand that declares nothing still has an address.
 *
 * This is the ONE home of that rule. Every reader takes it from here (the site
 * global's download links, @omega.js/desktop's electron-builder publish block,
 * its release-repo provisioning, its finalize-release upload), so the feed a
 * shipped app polls and the URL a download button carries can never disagree.
 *
 * @param {object} config - Composed omega config (raw or desktop-resolved).
 * @returns {{ owner: string, name: string, repo: string }} `repo` is the slug, '' unless BOTH halves resolve (half an address addresses nothing).
 */
function releasesRepo(config) {
  const releases = releasesKeys(config);
  const owner = releases.owner || brandRepoOwner(config);
  const name = releases.repo || (config?.brand?.id ? `${config.brand.id}-releases` : '');

  return { owner, name, repo: owner && name ? `${owner}/${name}` : '' };
}

module.exports = { parseRepoSlug, brandRepoName, brandRepoOwner, brandRepo, releasesRepo };
