/**
 * PUT /admin/post - Edit blog post
 * Admin/blogger endpoint to edit existing blog posts via GitHub
 */
const moment = require('moment');
const powertools = require('node-powertools');
const { Octokit } = require('@octokit/rest');

const dispatchDeploy = require('./dispatch-deploy');
const { writeFileBothBranches } = require('../lib/deploy-branch.js');
const { cmsContext } = require('../../../helpers/web-target.js');
const env = require('../../../libraries/env.js');

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
  if (!env.has('GH_TOKEN')) {
    return ctx.respond('GitHub API key not configured.', { code: 500 });
  }

  // The SOURCE repo this commits to, and WHICH website inside it (#887): the
  // read below is scoped to that target, so an edit lands in the same folder
  // the create wrote to
  let source;
  let target;
  try {
    ({ source, target } = cmsContext(Manager.config, settings.target));
  } catch (e) {
    return ctx.respond(e.message, { code: e.code });
  }

  ctx.log('main(): settings', settings);

  const now = ctx.meta.startTime.timestamp;
  const bemRepo = { user: source.owner, name: source.name };

  // Setup Octokit
  const octokit = new Octokit({
    auth: env.get('GH_TOKEN'),
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
  settings.target = target.name;
  settings.postPath = `${target.path}/src/_posts/${moment(now).format('YYYY')}/${settings.postPath}`;
  // Always the brand's own repo — caller-supplied values would let a blogger-role
  // user point the shared GH_TOKEN at any repo it can write
  settings.githubUser = bemRepo.user;
  settings.githubRepo = bemRepo.name;

  ctx.log('main(): Editing post...', settings);

  // Fetch existing post using NEW API format
  const fetchedPost = await fetchPost(ctx, settings.url, settings.target).catch(e => e);
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
async function fetchPost(ctx, url, target) {
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
      // The read route searches inside THIS target's folder (#887)
      target: target,
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
  const fullContent = `---\n${frontmatter}\n---\n\n${settings.body}`;

  // Upload post to BOTH branches (#919): the default branch is the record, and
  // the deploy branch is what CI builds, so a post that skipped it would never
  // reach the live site on a brand running local framework packages.
  const { result, deployBranch } = await writeFileBothBranches({
    ctx,
    octokit,
    owner: owner,
    repo: repo,
    path: filename,
    sha: sha,
    message: `📦 admin/post:edit ${filename}`,
    content: fullContent,
  });

  settings.deployBranch = deployBranch;

  ctx.log('uploadPost(): Result', result);

  return result;
}

// Expose the write for tests
module.exports.uploadPost = uploadPost;
