/**
 * POST /admin/repo/content - Write content to GitHub repo
 * Admin/blogger endpoint to write files to GitHub
 */
const { Octokit } = require('@octokit/rest');
const { writeFileBothBranches } = require('../../lib/deploy-branch.js');
const { cmsContext } = require('../../../../helpers/web-target.js');
const env = require('../../../../libraries/env.js');

module.exports = async ({ ctx, omega, user, data, analytics }) => {

  // Require authentication
  if (!user.authenticated) {
    return ctx.respond('Authentication required', { code: 401 });
  }

  // Require admin or blogger
  if (!user.roles.admin && !user.roles.blogger) {
    return ctx.respond('Admin required.', { code: 403 });
  }

  // Check for GitHub configuration
  if (!env.has('GH_TOKEN')) {
    return ctx.respond('GitHub API key not configured.', { code: 500 });
  }

  // The SOURCE repo this commits to, and WHICH website inside it (#887):
  // `path` is SITE-relative, and the target's folder is what turns it into a
  // repo path
  let source;
  let target;
  try {
    ({ source, target } = cmsContext(omega.config, data.target));
  } catch (e) {
    return ctx.respond(e.message, { code: e.code });
  }

  ctx.log('main(): settings', data);

  const bemRepo = { user: source.owner, name: source.name };

  // Setup Octokit
  const octokit = new Octokit({
    auth: env.get('GH_TOKEN'),
  });

  // Check for required values
  if (!data.path) {
    return ctx.respond('Missing required parameter: path', { code: 400 });
  }
  if (!data.content) {
    return ctx.respond('Missing required parameter: content', { code: 400 });
  }

  // Fix other values
  data.type = data.type;
  // `path` stays the caller's site-relative value; `repoPath` is where it lands
  data.target = target.name;
  data.repoPath = `${target.path}/${data.path}`;
  // Always the brand's own repo — caller-supplied values would let a blogger-role
  // user point the shared GH_TOKEN at any repo it can write
  data.githubUser = bemRepo.user;
  data.githubRepo = bemRepo.name;

  ctx.log('main(): Creating file...', data);

  // Upload content
  const uploadResult = await uploadContent(ctx, octokit, data).catch(e => e);
  if (uploadResult instanceof Error) {
    return ctx.respond(uploadResult.message, { code: uploadResult.status || 500 });
  }

  ctx.log('main(): uploadContent', uploadResult);

  // Track analytics
  analytics.event('admin/repo/content', { action: 'write' });

  return ctx.respond(data);
};

// Helper: Upload content to GitHub
async function uploadContent(ctx, octokit, data) {
  const owner = data.githubUser;
  const repo = data.githubRepo;
  const filename = data.repoPath;
  const content = data.content;

  ctx.log('uploadContent(): filename', filename);

  // Get existing file
  const existing = await octokit.rest.repos.getContent({
    owner: owner,
    repo: repo,
    path: filename,
  }).catch(e => e);

  ctx.log('uploadContent(): Existing', existing);

  // Quit if error and it's DIFFERENT than 404
  if (existing instanceof Error && existing?.status !== 404) {
    throw existing;
  }

  // Upload content to BOTH branches (#919): the default branch is the record,
  // and the deploy branch is what CI builds, so content that skipped it would
  // never reach the live site on a brand running local framework packages.
  const { result, deployBranch } = await writeFileBothBranches({
    ctx,
    octokit,
    owner: owner,
    repo: repo,
    path: filename,
    sha: existing?.data?.sha || undefined,
    message: `📦 admin/repo/content ${filename}`,
    content: content,
  });

  data.deployBranch = deployBranch;

  ctx.log('uploadContent(): Result', result);

  return result;
}

// Expose the write for tests
module.exports.uploadContent = uploadContent;
