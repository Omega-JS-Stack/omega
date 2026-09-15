/**
 * The DEPLOY branch, for every admin publish that writes repo content
 * ([#919](https://github.com/Omega-JS-Stack/omega/issues/919)).
 *
 * The default branch is the record: the brand's source repo is where the site
 * is authored, and a post belongs in its history. The DEPLOY branch is what CI
 * builds ([#915](https://github.com/Omega-JS-Stack/omega/issues/915)): it
 * carries the framework tarballs, the rewritten manifests and the lockfile the
 * last local deploy pushed, so a brand on LOCAL (unpublished) framework
 * packages installs on the runner exactly as a published one would. A post
 * committed only to the default branch is a post that never builds there.
 *
 * Two writers, because the admin routes write repo content two ways, and both
 * halves of every publish have to reach both branches:
 * - `writeFileBothBranches` for a ONE-file contents-API write (the post edit,
 *   the content route);
 * - `commitTreeToDeployBranch` for a Git Trees commit (the post CREATE, which
 *   lands the article and its images in one commit).
 *
 * The branch NAME is devkit's, never typed here, and the branch-exists read is
 * ONE function both writers call.
 *
 * A brand nobody has deployed locally yet has no deploy branch: the write lands
 * on the default branch alone and the caller is told so, rather than the post
 * being lost to a 404 nobody reads.
 */
const { SNAPSHOT_REF } = require('@omega.js/devkit/deploy');

/**
 * The deploy branch's head, and the one read that answers whether it exists.
 *
 * @param {object} options - Options.
 * @param {object} options.octokit - The authenticated Octokit.
 * @param {string} options.owner - The source repo's owner.
 * @param {string} options.repo - The source repo's bare name.
 * @returns {Promise<{ sha: string }|null>} The head, or null when the brand has
 *   never been deployed locally.
 * @throws {Error} On any failure but a 404: a token that cannot READ the ref
 *   (401), a repo it cannot reach (403) or GitHub being down is not the same
 *   answer as a branch nobody has pushed yet, and must never be told as one.
 */
async function deployBranchHead({ octokit, owner, repo }) {
  const head = await octokit.rest.git.getRef({ owner, repo, ref: `heads/${SNAPSHOT_REF}` }).catch((e) => {
    if (e.status === 404) return null;
    throw e;
  });

  return head ? { sha: head.data.object.sha } : null;
}

/** The ONE line a publish prints when the brand has no deploy branch yet. */
function warnNoDeployBranch(ctx, { owner, repo, what }) {
  ctx.warn(`deploy-branch(): no ${SNAPSHOT_REF} branch on ${owner}/${repo}, so ${what} is on the default branch only. Run \`omega deploy\` once from the brand.`);
}

/**
 * Write ONE file to both branches (contents API).
 *
 * @param {object} options - Options.
 * @param {object} options.ctx - The request context (its `log`/`warn`).
 * @param {object} options.octokit - The authenticated Octokit.
 * @param {string} options.owner - The source repo's owner.
 * @param {string} options.repo - The source repo's bare name.
 * @param {string} options.path - The file's repo path.
 * @param {string} options.message - The commit message, used on both branches.
 * @param {string} options.content - The file's contents (utf8, base64 encoded here).
 * @param {string} [options.sha] - The file's existing sha ON THE DEFAULT BRANCH.
 * @returns {Promise<{ result: object, deployBranch: boolean }>} The default
 *   branch's write, and whether the deploy branch received it too.
 */
async function writeFileBothBranches({ ctx, octokit, owner, repo, path, message, content, sha }) {
  const encoded = Buffer.from(content).toString('base64');

  // The record, first and unconditionally: whatever happens to the deploy
  // branch, the post exists in the branch the site is authored on.
  const result = await octokit.rest.repos.createOrUpdateFileContents({
    owner, repo, path, sha, message, content: encoded,
  });

  if (!await deployBranchHead({ octokit, owner, repo })) {
    warnNoDeployBranch(ctx, { owner, repo, what: path });
    return { result, deployBranch: false };
  }

  // The file's sha on THAT branch: the two branches hold different commits, so
  // the default branch's sha would be rejected as out of date here.
  const existing = await octokit.rest.repos.getContent({ owner, repo, path, ref: SNAPSHOT_REF }).catch((e) => e);

  if (existing instanceof Error && existing.status !== 404) {
    throw existing;
  }

  await octokit.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path,
    branch: SNAPSHOT_REF,
    sha: existing instanceof Error ? undefined : existing?.data?.sha,
    message,
    content: encoded,
  });

  ctx.log(`deploy-branch(): ${path} written to the default branch and ${SNAPSHOT_REF}`);

  return { result, deployBranch: true };
}

/**
 * Commit an already-built TREE to the deploy branch: the twin of the default
 * branch's Git Trees commit, on top of whatever that branch holds.
 *
 * The blobs are the caller's: a blob is a repo-level object, so the very items
 * the default-branch tree was built from are reused here and nothing uploads
 * twice. Only the tree, the commit and the ref differ, because the two branches
 * hold different history.
 *
 * @param {object} options - Options.
 * @param {object} options.ctx - The request context (its `log`/`warn`).
 * @param {object} options.octokit - The authenticated Octokit.
 * @param {string} options.owner - The source repo's owner.
 * @param {string} options.repo - The source repo's bare name.
 * @param {object[]} options.tree - The tree items (path, mode, type, sha).
 * @param {string} options.message - The commit message.
 * @param {string} options.what - What is being committed, for the warning line.
 * @returns {Promise<{ deployBranch: boolean, sha: string|null }>} Whether the
 *   deploy branch received the commit, and the sha it landed at.
 */
async function commitTreeToDeployBranch({ ctx, octokit, owner, repo, tree, message, what }) {
  const head = await deployBranchHead({ octokit, owner, repo });

  if (!head) {
    warnNoDeployBranch(ctx, { owner, repo, what });
    return { deployBranch: false, sha: null };
  }

  const base = await octokit.rest.git.getCommit({ owner, repo, commit_sha: head.sha });
  const written = await octokit.rest.git.createTree({
    owner, repo, base_tree: base.data.tree.sha, tree,
  });
  const commit = await octokit.rest.git.createCommit({
    owner, repo, message, tree: written.data.sha, parents: [head.sha],
  });

  await octokit.rest.git.updateRef({ owner, repo, ref: `heads/${SNAPSHOT_REF}`, sha: commit.data.sha });

  ctx.log(`deploy-branch(): ${what} committed to ${SNAPSHOT_REF} as ${commit.data.sha}`);

  return { deployBranch: true, sha: commit.data.sha };
}

module.exports = { writeFileBothBranches, commitTreeToDeployBranch, deployBranchHead };
