// finalize-release — wraps up a release after the matrix builds finish.
//
// Two modes (one command, --flag selects):
//   --signed-dir <path>   Upload signed Windows artifacts to the releases-repo release
//                         (created earlier by mac/linux's electron-builder --publish).
//                         Used by the windows-sign CI job.
//   --publish             Flip that release from draft → published so electron-updater
//                         can read its feed. Used by the finalize CI job.
//
// The repo is the brand's ONE public releases repo, addressed by @omega.js/config's
// `releasesRepo` from config/omega.json5 alone (#799): the same address the build
// baked into the app's update feed, never the git remote of whatever repo the
// target sits in.
//
// Both modes find the release by LISTING the repo's releases, drafts included
// (#810): `repos.getReleaseByTag` returns published releases only, because a draft
// carries no tag ref, so it 404'd on the very draft electron-builder had just
// created and every run piled up another draft for the same version.
//
// Idempotent: each mode is safe to re-run. An upload whose asset name is already
// on the release replaces it (delete, then upload), publish uses GH's
// "set draft=false" which is a no-op if already published.

const path    = require('path');
const fs      = require('fs');
const jetpack = require('fs-jetpack');

const { getOctokit } = require('../utils/github.js');
const { releasesRepo } = require('@omega.js/config');
const Manager = new (require('../build.js'));

const logger = Manager.logger('finalize-release');

module.exports = async function finalizeRelease(options = {}) {
  const argv = options._ || [];
  // Parse flags from yargs-style options (yargs camelCases --signed-dir → signedDir).
  const signedDir = options.signedDir || options['signed-dir'];
  const doPublish = options.publish === true;

  if (!signedDir && !doPublish) {
    throw new Error('finalize-release: pass --signed-dir <path> or --publish');
  }

  const projectRoot = process.cwd();
  const config      = Manager.getConfig() || {};
  const pkgVersion  = (Manager.getPackage('project') || {}).version;

  if (!pkgVersion) {
    throw new Error('finalize-release: package.json version not found');
  }

  if (!process.env.GH_TOKEN) {
    throw new Error('finalize-release: GH_TOKEN not set in env');
  }

  const octokit = options.octokit || getOctokit();
  if (!octokit) {
    throw new Error('finalize-release: failed to create octokit (missing GH_TOKEN?)');
  }

  // The releases repo (the auto-updater feed source), from config alone.
  const { owner, name, repo } = releasesRepo(config);
  if (!repo) {
    throw new Error('finalize-release: could not address the releases repo. Set repo.providers.github.org (or targets.desktop.releases.owner) and brand.id in config/omega.json5.');
  }

  const releaseTag = `v${pkgVersion}`;

  if (signedDir) {
    await uploadSignedWindows({
      octokit, owner, repo: name, tag: releaseTag,
      signedDir: path.resolve(projectRoot, signedDir),
    });
  }

  if (doPublish) {
    await publishReleasesRepoRelease({
      octokit, owner, repo: name, tag: releaseTag,
    });
  }
};

/**
 * Find the repo's release for a tag, DRAFTS INCLUDED (#810).
 *
 * The newest draft wins: that is the one the current run's electron-builder
 * publish step created, and an older duplicate draft for the same version (what
 * the tag lookup's blindness left behind) never steals the assets. A published
 * release for the tag answers when no draft does.
 *
 * @param {object} args - Lookup args.
 * @param {object} args.octokit - Authenticated octokit client.
 * @param {string} args.owner - Releases repo owner.
 * @param {string} args.repo - Releases repo name.
 * @param {string} args.tag - Release tag, e.g. `v1.2.3`.
 * @returns {Promise<object|null>} The release, or null when the tag has none.
 */
async function findRelease({ octokit, owner, repo, tag }) {
  const releases = await octokit.paginate(octokit.rest.repos.listReleases, {
    owner, repo, per_page: 100,
  });

  const matches = releases.filter((release) => release.tag_name === tag);
  const drafts  = matches
    .filter((release) => release.draft)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  return drafts[0] || matches.find((release) => !release.draft) || null;
}

async function uploadSignedWindows({ octokit, owner, repo, tag, signedDir }) {
  if (!jetpack.exists(signedDir)) {
    logger.warn(`No signed dir at ${signedDir} — nothing to upload.`);
    return;
  }

  const files = (jetpack.list(signedDir) || []).filter((f) => {
    if (!f.includes('.')) return false;
    if (f.endsWith('.blockmap')) return false;
    if (f.endsWith('.yml')) return false;
    return true;
  });

  if (files.length === 0) {
    logger.warn(`No signed files in ${signedDir}.`);
    return;
  }

  // Find the release for the tag, drafts included. Normally mac/linux's
  // electron-builder publish step has already created it (as a draft). For
  // partial-platform runs (`--platforms windows` on a brand-new version) it
  // doesn't exist yet, and in that case we create it ourselves as a draft so we
  // have a place to attach signed assets. The `finalize` job is the one gated on
  // all-platforms before flipping draft → published, so a draft created here just
  // sits until a full run completes.
  let release = await findRelease({ octokit, owner, repo, tag });
  if (!release) {
    logger.log(`No release at ${owner}/${repo}@${tag} yet: creating draft so we have somewhere to upload signed assets...`);
    const { data } = await octokit.rest.repos.createRelease({
      owner, repo,
      tag_name: tag,
      name: tag,
      body: `Draft release auto-created by @omega.js/desktop for partial-platform run. Will be filled in by subsequent runs and published once all platforms have built.`,
      draft: true,
      prerelease: false,
    });
    release = data;
  }

  logger.log(`Uploading ${files.length} signed file(s) to ${owner}/${repo}@${tag} (release id ${release.id})...`);

  // Replace any existing assets with the same name.
  const { data: existing } = await octokit.rest.repos.listReleaseAssets({
    owner, repo, release_id: release.id, per_page: 100,
  });
  const existingByName = new Map(existing.map((a) => [a.name, a]));

  for (const filename of files) {
    const src = path.join(signedDir, filename);
    const data = fs.readFileSync(src);

    const old = existingByName.get(filename);
    if (old) {
      logger.log(`  ↻ ${filename} is already on the release (asset ${old.id}): replacing it.`);
      await octokit.rest.repos.deleteReleaseAsset({ owner, repo, asset_id: old.id });
    }

    await octokit.rest.repos.uploadReleaseAsset({
      owner, repo, release_id: release.id,
      name: filename,
      data,
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': data.length,
      },
    });

    logger.log(`  ✓ ${filename} (${(data.length / 1024 / 1024).toFixed(1)}MB) → ${owner}/${repo}@${tag}`);
  }

  // Also upload the latest.yml / .blockmap auto-updater metadata if present.
  const meta = (jetpack.list(signedDir) || []).filter((f) => f.endsWith('.yml') || f.endsWith('.blockmap'));
  for (const filename of meta) {
    const src  = path.join(signedDir, filename);
    const data = fs.readFileSync(src);
    const old  = existingByName.get(filename);
    if (old) {
      logger.log(`  ↻ ${filename} is already on the release (asset ${old.id}): replacing it.`);
      await octokit.rest.repos.deleteReleaseAsset({ owner, repo, asset_id: old.id });
    }
    await octokit.rest.repos.uploadReleaseAsset({
      owner, repo, release_id: release.id,
      name: filename,
      data,
      headers: { 'content-type': 'application/octet-stream', 'content-length': data.length },
    });
    logger.log(`  ✓ ${filename} (auto-updater feed) → ${owner}/${repo}@${tag}`);
  }
}

async function publishReleasesRepoRelease({ octokit, owner, repo, tag }) {
  const release = await findRelease({ octokit, owner, repo, tag });

  if (!release) {
    throw new Error(`Release ${tag} not found at ${owner}/${repo}. Did the build/publish job succeed?`);
  }

  if (!release.draft && !release.prerelease) {
    logger.log(`✓ ${owner}/${repo}@${tag} already published (draft=false, prerelease=false).`);
  } else {
    await octokit.rest.repos.updateRelease({
      owner, repo, release_id: release.id,
      draft: false,
      prerelease: false,
    });
    logger.log(`✓ Flipped ${owner}/${repo}@${tag} to published (was draft=${release.draft}, prerelease=${release.prerelease}).`);
  }

  // Sanity check — ensure the auto-updater feeds are present so electron-updater works.
  const { data: assets } = await octokit.rest.repos.listReleaseAssets({
    owner, repo, release_id: release.id, per_page: 100,
  });
  const names = assets.map((a) => a.name);

  const expected = ['latest.yml', 'latest-mac.yml', 'latest-linux.yml'];
  const missing  = expected.filter((feed) => !names.includes(feed));

  if (missing.length > 0) {
    logger.warn(`Auto-updater feeds missing from ${owner}/${repo}@${tag}: ${missing.join(', ')}`);
    logger.warn('  electron-updater will fail for these platforms until the feed yml is uploaded.');
  } else {
    logger.log(`✓ All auto-updater feeds present (${expected.join(', ')}).`);
  }

  logger.log(`Release URL: https://github.com/${owner}/${repo}/releases/tag/${tag}`);
}

module.exports.findRelease = findRelease;
