/**
 * PUT /admin/post - Edit blog post
 * Admin/blogger endpoint to edit existing blog posts via GitHub
 */
const moment = require('moment');
const powertools = require('node-powertools');
const { Octokit } = require('@octokit/rest');

const dispatchDeploy = require('./dispatch-deploy');
const { brandRepoOwner, brandRepoName } = require('@omega.js/config');

module.exports = async ({ ctx, Manager, user, settings, analytics }) => {
  const fetch = Manager.require('wonderful-fetch');

  // Require authentication
  if (!user.authenticated) {
    return ctx.respond('Authentication required', { code: 401 });
  }

  // Require admin or blogger
  if (!user.roles.admin && !user.roles.blogger) {
    return ctx.respond('Admin required.', { code: 403 });
  }

  // Check for GitHub configuration
  if (!process.env.GH_TOKEN) {
    return ctx.respond('GitHub API key not configured.', { code: 500 });
  }

  if (!brandRepoOwner(Manager.config) || !brandRepoName(Manager.config)) {
    return ctx.respond('GitHub repo not configured (set github.repo — "owner/name" or bare name — or github.org + brand.id).', { code: 500 });
  }

  ctx.log('main(): settings', settings);

  const now = ctx.meta.startTime.timestamp;
  const bemRepo = { user: brandRepoOwner(Manager.config), name: brandRepoName(Manager.config) };

  // Setup Octokit
  const octokit = new Octokit({
    auth: process.env.GH_TOKEN,
  });

  // Check for required values
  if (!settings.url) {
    return ctx.respond('Missing required parameter: url', { code: 400 });
  }
  if (!settings.body) {
    return ctx.respond('Missing required parameter: body', { code: 400 });
  }

  // Fix URL
  settings.url = settings.url
    .replace(/blog\//ig, '')
    .replace(/^\/|\/$/g, '')
    .trim();

  // Fix body
  settings.body = settings.body
    .replace(powertools.regexify(`/# ${settings.title}/i`), '')
    .replace(/\n\n\n+/g, '\n\n')
    .trim();

  // Fix other values
  settings.postPath = `_posts/${moment(now).format('YYYY')}/${settings.postPath}`;
  // Always the brand's own repo — caller-supplied values would let a blogger-role
  // user point the shared GH_TOKEN at any repo it can write
  settings.githubUser = bemRepo.user;
  settings.githubRepo = bemRepo.name;

  ctx.log('main(): Editing post...', settings);

  // Fetch existing post using NEW API format
  const fetchedPost = await fetchPost(ctx, settings.url).catch(e => e);
  if (fetchedPost instanceof Error) {
    return ctx.respond(fetchedPost.message, { code: fetchedPost.status || 404 });
  }

  // Upload post
  const uploadResult = await uploadPost(ctx, octokit, settings, fetchedPost).catch(e => e);
  if (uploadResult instanceof Error) {
    return ctx.respond(uploadResult.message, { code: uploadResult.status || 500 });
  }

  ctx.log('main(): uploadPost', uploadResult);

  // D13: content-publish implies deploy (deploy: false opts out)
  await dispatchDeploy(ctx, octokit, settings);

  // Track analytics
  analytics.event('admin/post', { action: 'edit' });

  return ctx.respond(settings);
};

// Helper: Fetch existing post
async function fetchPost(ctx, url) {
  const Manager = ctx.Manager;
  const fetch = Manager.require('wonderful-fetch');

  // Use NEW API format
  const result = await fetch(`${Manager.getApiUrl()}/omega/content/post`, {
    method: 'get',
    response: 'json',
    timeout: 190000,
    tries: 1,
    query: {
      url: url,
    },
  });

  ctx.log('fetchPost(): Result', result);

  return result;
}

// Helper: Upload post to GitHub
async function uploadPost(ctx, octokit, settings, fetchedPost) {
  const filename = fetchedPost.path;
  const sha = fetchedPost.sha;
  const frontmatter = fetchedPost.frontmatter;
  const owner = settings.githubUser;
  const repo = settings.githubRepo;

  // Combine content
  const fullContent = '---\n'
    + `${frontmatter}\n`
    + '---\n'
    + '\n'
    + settings.body;

  // Upload post
  const result = await octokit.rest.repos.createOrUpdateFileContents({
    owner: owner,
    repo: repo,
    path: filename,
    sha: sha,
    message: `📦 admin/post:edit ${filename}`,
    content: Buffer.from(fullContent).toString('base64'),
  });

  ctx.log('uploadPost(): Result', result);

  return result;
}
