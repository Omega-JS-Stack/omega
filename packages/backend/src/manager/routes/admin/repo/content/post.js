/**
 * POST /admin/repo/content - Write content to GitHub repo
 * Admin/blogger endpoint to write files to GitHub
 */
const { Octokit } = require('@octokit/rest');
const { brandRepoOwner, brandRepoName } = require('@omega.js/config');
const env = require('../../../../libraries/env.js');

module.exports = async ({ ctx, Manager, user, settings, analytics }) => {

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

  if (!brandRepoOwner(Manager.config) || !brandRepoName(Manager.config)) {
    return ctx.respond('GitHub repo not configured (set targets.backend.github.repo — "owner/name" or bare name — or repo.providers.github.org + brand.id).', { code: 500 });
  }

  ctx.log('main(): settings', settings);

  const bemRepo = { user: brandRepoOwner(Manager.config), name: brandRepoName(Manager.config) };

  // Setup Octokit
  const octokit = new Octokit({
    auth: env.get('GH_TOKEN'),
  });

  // Check for required values
  if (!settings.path) {
    return ctx.respond('Missing required parameter: path', { code: 400 });
  }
  if (!settings.content) {
    return ctx.respond('Missing required parameter: content', { code: 400 });
  }

  // Fix other values
  settings.type = settings.type;
  // Always the brand's own repo — caller-supplied values would let a blogger-role
  // user point the shared GH_TOKEN at any repo it can write
  settings.githubUser = bemRepo.user;
  settings.githubRepo = bemRepo.name;

  ctx.log('main(): Creating file...', settings);

  // Upload content
  const uploadResult = await uploadContent(ctx, octokit, settings).catch(e => e);
  if (uploadResult instanceof Error) {
    return ctx.respond(uploadResult.message, { code: uploadResult.status || 500 });
  }

  ctx.log('main(): uploadContent', uploadResult);

  // Track analytics
  analytics.event('admin/repo/content', { action: 'write' });

  return ctx.respond(settings);
};

// Helper: Upload content to GitHub
async function uploadContent(ctx, octokit, settings) {
  const owner = settings.githubUser;
  const repo = settings.githubRepo;
  const filename = settings.path;
  const content = settings.content;

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

  // Upload content
  const result = await octokit.rest.repos.createOrUpdateFileContents({
    owner: owner,
    repo: repo,
    path: filename,
    sha: existing?.data?.sha || undefined,
    message: `📦 admin/repo/content ${filename}`,
    content: Buffer.from(content).toString('base64'),
  });

  ctx.log('uploadContent(): Result', result);

  return result;
}
