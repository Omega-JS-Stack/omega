/**
 * Sample posts — a post-less brand gets a living blog in development only:
 *  1. dev build + no consumer _posts → packaged sample posts render on the
 *     posts lane (/blog/<slug>, blog index lists them, no-media monogram)
 *  2. production build → zero sample posts, blog index falls back to the
 *     empty state (generatePageOnEmptyData keeps /blog alive)
 *  3. the FIRST consumer post suppresses every sample (mini-site fixture)
 */
const fs = require('node:fs');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');

const { buildSite, buildWith, BARE } = require('./lib/build.js');

const bareData = JSON.parse(fs.readFileSync(path.join(BARE, 'site-data.json'), 'utf8'));

/**
 * Build the bare (post-less) fixture and index rendered pages by URL.
 * @param {string} environment
 * @param {string} name - namespace for output/farm dirs
 * @returns {Promise<Map<string, string>>}
 */
function buildBare(environment, name) {
  return buildSite(BARE, bareData, { environment }, name);
}

module.exports = defineCases({
  type: 'group',
  description: 'sample-posts',
  tests: [
    {
      name: 'dev build without consumer posts injects the sample posts',
      run: async (ctx) => {
        const pages = await buildBare('development', 'sample-posts-dev');

        // Sample posts render on the real posts lane
        const welcome = pages.get('/blog/welcome-to-the-blog');
        ctx.expect(welcome, 'sample post gets its /blog/<slug> URL').toBeTruthy();
        ctx.expect(welcome.includes('Welcome to the blog'), 'post title renders').toBeTruthy();

        // Blog index lists them newest-first (no empty state)
        const blogUrl = [...pages.keys()].find((u) => u === '/blog/' || u === '/blog');
        ctx.expect(blogUrl, 'blog index exists').toBeTruthy();
        const blog = pages.get(blogUrl);
        ctx.expect(blog.includes('Ship the docs with the diff'), 'blog index lists the newest sample posts').toBeTruthy();

        // Author-less samples fall back to the brand byline, never a broken row
        ctx.expect(blog.includes('BareCo'), 'author fallback renders the brand name').toBeTruthy();

        // Taxonomy rides along
        const category = [...pages.keys()].find((u) => u.startsWith('/blog/categories/'));
        ctx.expect(category, 'sample categories aggregate into taxonomy pages').toBeTruthy();

        // 11 samples at pagination size 6 → a real page 2 (Ian 2026-07-16:
        // pagination must be VISIBLE with sample content). The two image-less
        // samples are the oldest, so the designed no-media panel proves there.
        const page2 = [...pages.keys()].find((u) => u === '/blog/page/2' || u === '/blog/page/2/');
        ctx.expect(page2, 'sample volume exercises pagination (page 2 exists)').toBeTruthy();
        ctx.expect(pages.get(page2).includes('Welcome to the blog'), 'oldest samples paginate to page 2').toBeTruthy();
        ctx.expect(pages.get(page2).includes('omega-post-card__media--pattern'), 'image-less samples use the designed no-media panel').toBeTruthy();

        // Sample updates ride the same lane (/updates release feed)
        const update = pages.get('/updates/v1.3.0');
        ctx.expect(update, 'sample update gets its /updates/<version> URL').toBeTruthy();
        const updatesUrl = [...pages.keys()].find((u) => u === '/updates/' || u === '/updates');
        ctx.expect(pages.get(updatesUrl).includes('1.3.0'), 'updates index lists sample releases').toBeTruthy();
      },
    },

    {
      name: 'production build never ships sample posts',
      run: async (ctx) => {
        const pages = await buildBare('production', 'sample-posts-prod');

        ctx.expect(pages.get('/blog/welcome-to-the-blog'), 'no sample post URLs in production').toBe(undefined);

        const blogUrl = [...pages.keys()].find((u) => u === '/blog/' || u === '/blog');
        ctx.expect(blogUrl, '/blog stays alive (generatePageOnEmptyData)').toBeTruthy();
        ctx.expect(!pages.get(blogUrl).includes('Welcome to the blog'), 'blog index carries no sample content').toBeTruthy();

        ctx.expect(pages.get('/updates/v1.3.0'), 'no sample update URLs in production').toBe(undefined);
      },
    },

    {
      name: 'a consumer with their own posts never sees samples (dev included)',
      run: async (ctx) => {
        const { miniData } = require('./lib/build.js');
        const pages = await buildWith(miniData, { environment: 'development' }, 'sample-posts-consumer');

        ctx.expect(pages.get('/blog/welcome-to-the-blog'), 'samples suppressed by consumer posts').toBe(undefined);
        ctx.expect(pages.get('/blog/first-post'), 'consumer posts still render').toBeTruthy();
      },
    },
  ],
});
