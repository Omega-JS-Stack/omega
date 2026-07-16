/**
 * Sample posts — a post-less brand gets a living blog in development only:
 *  1. dev build + no consumer _posts → packaged sample posts render on the
 *     posts lane (/blog/<slug>, blog index lists them, no-media monogram)
 *  2. production build → zero sample posts, blog index falls back to the
 *     empty state (generatePageOnEmptyData keeps /blog alive)
 *  3. the FIRST consumer post suppresses every sample (mini-site fixture)
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const { configureOmega } = require('../src/index.js');
const { buildWith } = require('./lib/build.js');

const PKG = path.resolve(__dirname, '..');
const BARE = path.join(__dirname, 'fixtures', 'bare-site');
const bareData = JSON.parse(fs.readFileSync(path.join(BARE, 'site-data.json'), 'utf8'));

/**
 * Build the bare (post-less) fixture and index rendered pages by URL.
 * @param {string} environment
 * @param {string} name - namespace for output/farm dirs
 * @returns {Promise<Map<string, string>>}
 */
async function buildBare(environment, name) {
  const Eleventy = require('@11ty/eleventy').default;
  const elev = new Eleventy(BARE, path.join(PKG, '.omega', `${name}-out`), {
    quietMode: true,
    configPath: false,
    config: (eleventyConfig) => {
      eleventyConfig.setUseTemplateCache(false);
      return configureOmega(eleventyConfig, {
        consumerDir: BARE,
        siteData: bareData,
        environment,
        farmDir: path.join(PKG, '.omega', `${name}-farm`),
        assetManifest: {
          js: { main: '/assets/js/main-TEST.js', pages: {} },
          css: { main: '/assets/css/main-TEST.css', pages: {}, themePages: {} },
        },
      });
    },
  });
  const results = await elev.toJSON();
  return new Map(results.map((r) => [r.url, r.content]));
}

test('dev build without consumer posts injects the sample posts', async () => {
  const pages = await buildBare('development', 'sample-posts-dev');

  // Sample posts render on the real posts lane
  const welcome = pages.get('/blog/welcome-to-the-blog');
  assert.ok(welcome, 'sample post gets its /blog/<slug> URL');
  assert.ok(welcome.includes('Welcome to the blog'), 'post title renders');

  // Blog index lists them newest-first (no empty state)
  const blogUrl = [...pages.keys()].find((u) => u === '/blog/' || u === '/blog');
  assert.ok(blogUrl, 'blog index exists');
  const blog = pages.get(blogUrl);
  assert.ok(blog.includes('Ship the docs with the diff'), 'blog index lists the newest sample posts');

  // Author-less samples fall back to the brand byline, never a broken row
  assert.ok(blog.includes('BareCo'), 'author fallback renders the brand name');

  // Taxonomy rides along
  const category = [...pages.keys()].find((u) => u.startsWith('/blog/categories/'));
  assert.ok(category, 'sample categories aggregate into taxonomy pages');

  // 11 samples at pagination size 6 → a real page 2 (Ian 2026-07-16:
  // pagination must be VISIBLE with sample content). The two image-less
  // samples are the oldest, so the designed no-media panel proves there.
  const page2 = [...pages.keys()].find((u) => u === '/blog/page/2' || u === '/blog/page/2/');
  assert.ok(page2, 'sample volume exercises pagination (page 2 exists)');
  assert.ok(pages.get(page2).includes('Welcome to the blog'), 'oldest samples paginate to page 2');
  assert.ok(pages.get(page2).includes('classy-post-card__media--pattern'), 'image-less samples use the designed no-media panel');

  // Sample updates ride the same lane (/updates release feed)
  const update = pages.get('/updates/v1.3.0');
  assert.ok(update, 'sample update gets its /updates/<version> URL');
  const updatesUrl = [...pages.keys()].find((u) => u === '/updates/' || u === '/updates');
  assert.ok(pages.get(updatesUrl).includes('1.3.0'), 'updates index lists sample releases');
});

test('production build never ships sample posts', async () => {
  const pages = await buildBare('production', 'sample-posts-prod');

  assert.strictEqual(pages.get('/blog/welcome-to-the-blog'), undefined, 'no sample post URLs in production');

  const blogUrl = [...pages.keys()].find((u) => u === '/blog/' || u === '/blog');
  assert.ok(blogUrl, '/blog stays alive (generatePageOnEmptyData)');
  assert.ok(!pages.get(blogUrl).includes('Welcome to the blog'), 'blog index carries no sample content');

  assert.strictEqual(pages.get('/updates/v1.3.0'), undefined, 'no sample update URLs in production');
});

test('a consumer with their own posts never sees samples (dev included)', async () => {
  const { miniData } = require('./lib/build.js');
  const pages = await buildWith(miniData, { environment: 'development' }, 'sample-posts-consumer');

  assert.strictEqual(pages.get('/blog/welcome-to-the-blog'), undefined, 'samples suppressed by consumer posts');
  assert.ok(pages.get('/blog/first-post'), 'consumer posts still render');
});
