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

  // Blog index lists them (no empty state)
  const blogUrl = [...pages.keys()].find((u) => u === '/blog/' || u === '/blog');
  assert.ok(blogUrl, 'blog index exists');
  const blog = pages.get(blogUrl);
  assert.ok(blog.includes('Welcome to the blog'), 'blog index lists sample posts');
  assert.ok(blog.includes('classy-post-card__media--pattern'), 'image-less samples use the designed no-media panel');

  // Author-less samples fall back to the brand byline, never a broken row
  assert.ok(blog.includes('BareCo'), 'author fallback renders the brand name');

  // Taxonomy rides along
  const category = [...pages.keys()].find((u) => u.startsWith('/blog/categories/'));
  assert.ok(category, 'sample categories aggregate into taxonomy pages');
});

test('production build never ships sample posts', async () => {
  const pages = await buildBare('production', 'sample-posts-prod');

  assert.strictEqual(pages.get('/blog/welcome-to-the-blog'), undefined, 'no sample post URLs in production');

  const blogUrl = [...pages.keys()].find((u) => u === '/blog/' || u === '/blog');
  assert.ok(blogUrl, '/blog stays alive (generatePageOnEmptyData)');
  assert.ok(!pages.get(blogUrl).includes('Welcome to the blog'), 'blog index carries no sample content');
});

test('a consumer with their own posts never sees samples (dev included)', async () => {
  const { miniData } = require('./lib/build.js');
  const pages = await buildWith(miniData, { environment: 'development' }, 'sample-posts-consumer');

  assert.strictEqual(pages.get('/blog/welcome-to-the-blog'), undefined, 'samples suppressed by consumer posts');
  assert.ok(pages.get('/blog/first-post'), 'consumer posts still render');
});
