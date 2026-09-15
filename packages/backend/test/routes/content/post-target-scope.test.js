/**
 * Test: GET /content/post reads INSIDE one web target
 * ([#887](https://github.com/Omega-JS-Stack/omega/issues/887)).
 *
 * The read is what the editor loads and what PUT /admin/post writes back over,
 * so a search that can answer with another website's file is how an edit lands
 * on the wrong site. The search is scoped to `targets/<name>/src/_posts`, and a
 * hit outside that folder is not the answer even when GitHub returns it (the
 * `path:` qualifier narrows a code search, it does not bind it).
 *
 * Run: npx omega test backend:routes/content/post-target-scope
 */
const readPost = require('../../../dist/manager/routes/content/post/get.js');
const {
  brandConfig,
  fakeManager,
  recordingCtx,
  githubDouble,
  withGithub,
} = require('../../helpers/_cms-target-harness.js');
const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');

const ONE_WEBSITE = { web: { type: 'web' }, backend: { type: 'backend' } };
const TWO_WEBSITES = { web: { type: 'web' }, community: { type: 'web' }, backend: { type: 'backend' } };

const POST_URL = 'https://acme.com/blog/a-post';
const POST_BODY = [
  '---',
  'post:',
  '  title: A Post',
  '  description: A post about posting',
  '  author: guest',
  '  id: 1234',
  '  tags: []',
  '  categories: []',
  '---',
  '',
  'The body of the post.',
].join('\n');

/** A code-search hit at a path. */
function hit(filePath) {
  return { path: filePath, name: filePath.split('/').pop() };
}

/** Run the read route, returning what it sent and what GitHub saw. */
async function readAgainst(config, settings, github) {
  const Manager = fakeManager(config);
  const ctx = recordingCtx(Manager);

  await withGithub(github, () => readPost({ ctx, Manager, settings, analytics: { event() {} } }));

  return { sent: ctx.sent, calls: github.calls };
}

/** The `q` the route searched with. */
function searchQuery(calls) {
  const search = calls.find((call) => call.url.includes('/search/code'));

  return search ? decodeURIComponent(new URL(search.url).searchParams.get('q')) : null;
}

module.exports = defineCases({
  description: 'GET /content/post: the search is scoped to one web target',
  type: 'group',
  timeout: 15000,

  tests: [
    {
      name: 'the-search-is-scoped-to-the-target-posts-folder',
      auth: 'none',

      async run({ assert }) {
        const filePath = 'targets/web/src/_posts/2026/guest/2026-01-14-a-post.md';
        const github = githubDouble({ searchItems: [hit(filePath)], contents: { [filePath]: POST_BODY } });
        const run = await readAgainst(brandConfig(ONE_WEBSITE), { url: POST_URL }, github);

        assert.equal(run.sent.code, 200, `the read should succeed, got ${run.sent.code}: ${JSON.stringify(run.sent.body)}`);
        assert.match(searchQuery(run.calls), /path:targets\/web\/src\/_posts/, 'the query names the target\'s posts folder');
        assert.equal(run.sent.body.path, filePath, 'the answer is the file inside the target');
        assert.equal(run.sent.body.target, 'web', 'the answer says which website it came from');
      },
    },

    {
      name: 'a-hit-outside-the-target-is-not-the-answer',
      auth: 'none',

      async run({ assert }) {
        // The other website's post, same slug: the folder is what decides.
        const stray = 'targets/community/src/_posts/2026/guest/2026-01-14-a-post.md';
        const github = githubDouble({ searchItems: [hit(stray)], contents: { [stray]: POST_BODY } });
        const run = await readAgainst(brandConfig(TWO_WEBSITES), { url: POST_URL, target: 'web' }, github);

        assert.equal(run.sent.code, 404, `a stray hit must not answer, got ${run.sent.code}`);
        assert.match(run.sent.body, /targets\/web\/src\/_posts/, 'the 404 names the folder that was searched');
        assert.equal(run.calls.filter((call) => call.url.includes('/contents/')).length, 0,
          'a file outside the target is never fetched');
      },
    },

    {
      name: 'the-named-target-is-the-one-read',
      auth: 'none',

      async run({ assert }) {
        const filePath = 'targets/community/src/_posts/2026/guest/2026-01-14-a-post.md';
        const github = githubDouble({ searchItems: [hit(filePath)], contents: { [filePath]: POST_BODY } });
        const run = await readAgainst(brandConfig(TWO_WEBSITES), { url: POST_URL, target: 'community' }, github);

        assert.equal(run.sent.code, 200, `the read should succeed, got ${run.sent.code}: ${JSON.stringify(run.sent.body)}`);
        assert.match(searchQuery(run.calls), /path:targets\/community\/src\/_posts/);
        assert.equal(run.sent.body.target, 'community');
      },
    },

    {
      name: 'several-web-targets-require-the-name',
      auth: 'none',

      async run({ assert }) {
        const github = githubDouble();
        const run = await readAgainst(brandConfig(TWO_WEBSITES), { url: POST_URL }, github);

        assert.equal(run.sent.code, 400);
        assert.match(run.sent.body, /\[web, community\]/);
        assert.equal(run.calls.length, 0, 'nothing may reach GitHub before the target is known');
      },
    },
  ],
});
