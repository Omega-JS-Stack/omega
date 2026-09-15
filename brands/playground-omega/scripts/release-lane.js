// The playground's release lane, shared by both target deploy hooks
// (#900, the rework of #899): PRUNE the target's release family on the
// playground's releases repo down to the newest one, so a deploy leaves exactly
// two releases live.
//
// The VERSION comes from `omega bump` at the brand root (#869), never from this
// hook: the brand root package.json is the one version every target follows, and
// a deploy refuses a target that drifted from it. The per-target bump this lane
// used to do is gone with it.
//
// A fresh version is what makes the deploy publishable at all: the Firefox store
// refuses a version it already holds ("Version 0.0.1 already exists"), and a
// fresh one also never trips electron-publish's two-hour rule, which is what
// #899's delete-and-redeploy was working around.
//
// Playground-only by construction: the releases repo is hard-coded and the
// brand guard runs FIRST, so a copy into another brand fails loudly instead of
// deleting that brand's releases. #192 migrates the target hooks that call this
// into the universal hook system when the desktop runner is reworked.

const { execFileSync } = require('child_process');

const RELEASES_REPO = 'Omega-JS-Stack/playground-releases';
const BRAND_ID = 'playground';
const LOG_TAG = '[playground:hooks]';

/**
 * The default `gh` runner: stdout captured, stderr captured for the error.
 *
 * @param {string[]} args - The `gh` argv.
 * @returns {string} What `gh` printed.
 */
function defaultRun(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * Prepare the playground for a deploy of ONE target: prune its release family.
 *
 * @param {object} ctx - The deploy hook ctx.
 * @param {object} ctx.manager - The target's framework Manager.
 * @param {object} options - The lane options.
 * @param {RegExp} options.tagFamily - Which release tags belong to this target (`/^v\d/`, `/^extension-v/`).
 * @param {Function} [options.run] - The `gh` runner (injected by tests).
 * @returns {Promise<void>}
 * @throws {Error} When the brand is not the playground.
 */
module.exports = async function prepareRelease({ manager }, { tagFamily, run = defaultRun }) {
  const brandId = manager.getConfig().brand.id;

  if (brandId !== BRAND_ID) {
    throw new Error(`scripts/release-lane.js belongs to the playground (brand.id "${BRAND_ID}") and refuses brand "${brandId}": it deletes releases on ${RELEASES_REPO}.`);
  }

  prune({ tagFamily, run });
};

/**
 * Delete every release of this target's family except the newest, so the deploy
 * that follows leaves two live.
 *
 * @param {object} options - The lane options.
 * @param {RegExp} options.tagFamily - Which release tags belong to this target.
 * @param {Function} options.run - The `gh` runner.
 * @returns {void}
 */
function prune({ tagFamily, run }) {
  const releases = JSON.parse(run(['release', 'list', '--repo', RELEASES_REPO, '--json', 'tagName,publishedAt', '--limit', '100']) || '[]');
  const family = releases
    .filter((release) => tagFamily.test(release.tagName))
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

  if (family.length === 0) {
    return console.log(`${LOG_TAG} no ${tagFamily} release on ${RELEASES_REPO}, nothing to prune.`);
  }

  const [newest, ...stale] = family;

  for (const release of stale) {
    run(['release', 'delete', release.tagName, '--repo', RELEASES_REPO, '--cleanup-tag', '--yes']);
    console.log(`${LOG_TAG} deleted release ${release.tagName} and its tag on ${RELEASES_REPO}.`);
  }

  console.log(`${LOG_TAG} kept release ${newest.tagName} on ${RELEASES_REPO} (${stale.length} pruned).`);
}
