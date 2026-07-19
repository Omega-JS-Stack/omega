/**
 * @omega.js/config repo — the SINGLE derivation of the brand's GitHub repo
 * (owner + name), shared by every surface that targets the brand repo (web
 * `omega deploy --direct`, the manager's github service setup/repo/pages,
 * the backend CMS routes that commit posts).
 *
 * One optional key: `github.repo` — either a bare name ("omega-brand") or
 * an "owner/name" slug ("itw-creative-works/omega-brand"). Defaults: name
 * falls to `brand.id`, owner falls to `github.org`. The slug's owner slot
 * carries the legacy omega-manager orgMain/orgWebsite split (Ian
 * 2026-07-19): most ITW brands house the brand repo under the paid company
 * org (itw-creative-works) while `github.org` keeps naming the brand's own
 * org for org-profile reconciliation. The retired `repoWebsite` URL key
 * (2026-07-19, Ian: "we no longer need it — that was for when the website
 * lived NOT in the monorepo") is superseded by this slug: one repo per
 * brand, named by the brand.
 *
 * Born from the 2026-07-18 launch-night collision: the bare brand-id
 * fallback resolved brand "omega" to Omega-JS-Stack/omega — the framework
 * MONOREPO — instead of the brand repo.
 */

/**
 * Parse a `github.repo` value: "owner/name" slug or bare "name".
 *
 * @param {string} value - e.g. "itw-creative-works/omega-brand" or "omega-brand"
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
 * The brand repo's bare name (no owner).
 *
 * @param {object} config - Composed omega config (brand + app layers).
 * @returns {string} Repo name ('' when nothing in the chain resolves).
 */
function brandRepoName(config) {
  const github = config?.github || {};
  return parseRepoSlug(github.repo).name || config?.brand?.id || '';
}

/**
 * The brand repo's owner (GitHub org or user).
 *
 * @param {object} config - Composed omega config (brand + app layers).
 * @returns {string} Owner ('' when nothing in the chain resolves).
 */
function brandRepoOwner(config) {
  const github = config?.github || {};
  return parseRepoSlug(github.repo).owner || github.org || '';
}

module.exports = { parseRepoSlug, brandRepoName, brandRepoOwner };
