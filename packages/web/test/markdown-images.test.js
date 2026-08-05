/**
 * Markdown images render as optimized image markup (#193) — the port of
 * jekyll-uj-powertools' markdown-images hook. A `![alt](src)` in prose comes
 * out of template-kit's buildImageHtml (the same builder omega_image uses),
 * `@post/<file>` expands to the rendering post's image dir, and an `@post/`
 * reference off a post fails the build instead of shipping a literal
 * `@post/…` src to production the way the legacy warn did.
 */
const assert = require('node:assert');
const markdownIt = require('markdown-it');
const { test, before } = require('node:test');

const { applyMarkdownImages } = require('../src/markdown-images.js');
const { buildWith: sharedBuildWith, miniData } = require('./lib/build.js');

const buildWith = (siteData, overrides) => sharedBuildWith(siteData, overrides, 'markdown-images-test');

/** A markdown-it configured exactly as the engine configures it. */
function renderer() {
  const md = markdownIt({ html: true });
  applyMarkdownImages(md);
  return md;
}

// A post's data as Eleventy hands it to markdown-it as the render env.
const POST_ENV = { post: { id: 1000001 }, page: { inputPath: './src/_posts/2024-01-15-first-post.md' } };
const PAGE_ENV = { page: { inputPath: './src/pages/about.md' } };

test('a plain markdown image renders the optimized picture markup', () => {
  const html = renderer().render('![A wide shot](/assets/images/mini/shot.jpg)', PAGE_ENV);

  assert.ok(html.includes('<picture>'), 'the responsive builder ran');
  assert.ok(!/<img[^>]*\ssrc="\/assets/.test(html), 'no eager src — the builder lazy-loads');
  assert.ok(html.includes('data-lazy="@src /assets/images/mini/shot.jpg"'), 'the original rides the lazy attribute');
  assert.ok(html.includes('data-lazy="@srcset /assets/images/mini/shot-320px.webp"'), 'the webp ladder is the builder default');
  assert.ok(html.includes('data-lazy="@srcset /assets/images/mini/shot-1024px.jpg"'), 'the original-format ladder too');
  assert.ok(!/\swidth="/.test(html) && !/\sheight="/.test(html), 'no dimensions invented when the author supplies none');
});

test('alt and title survive the rewrite', () => {
  const html = renderer().render('![Ship it "safely" & often](/assets/images/mini/shot.jpg "The hero")', PAGE_ENV);

  assert.ok(html.includes('alt="Ship it &quot;safely&quot; &amp; often"'), 'alt preserved and attribute-escaped');
  assert.ok(html.includes('title="The hero"'), 'title preserved');
});

test('a titleless image carries no empty title attribute', () => {
  assert.ok(!renderer().render('![Alt](/a.jpg)', PAGE_ENV).includes('title='), 'no phantom title');
});

test('an external markdown image takes the builder external lane', () => {
  const html = renderer().render('![Remote](https://cdn.example.com/a.jpg "Remote title")', PAGE_ENV);

  assert.ok(!html.includes('<picture>'), 'no source ladder for an image we cannot resize');
  assert.ok(html.includes('data-lazy="@src https://cdn.example.com/a.jpg"'), 'still lazy-loaded');
  assert.ok(html.includes('alt="Remote"') && html.includes('title="Remote title"'), 'alt/title preserved');
  assert.ok(html.includes('loading="lazy"'), 'the builder default');
});

test('a non-raster local image skips the ladder imagemin never builds', () => {
  const html = renderer().render('![Logo](/assets/images/logo.svg)', PAGE_ENV);

  assert.ok(!html.includes('<picture>'), 'no <source> ladder — imagemin derives none for svg, and a 404d <source> never falls back');
  assert.ok(html.includes('data-lazy="@src /assets/images/logo.svg"'), 'still lazy-loaded');
  assert.ok(html.includes('alt="Logo"'), 'alt preserved');
});

test('the linked form nests without special casing', () => {
  const html = renderer().render('[![The chart](/assets/images/mini/chart.png)](/pricing)', PAGE_ENV);

  assert.ok(/<a href="\/pricing">\s*<picture>/.test(html), 'the anchor wraps the optimized markup');
  assert.ok(html.includes('</picture></a>'), 'and closes around it');
  assert.ok(html.includes('alt="The chart"'), 'the nested image keeps its alt');
});

test('@post/ resolves against the rendering post image dir', () => {
  const html = renderer().render('![The hero](@post/hero.jpg)', POST_ENV);

  assert.ok(html.includes('data-lazy="@src /assets/images/blog/post-1000001/hero.jpg"'), 'the post image dir');
  assert.ok(html.includes('data-lazy="@srcset /assets/images/blog/post-1000001/hero-320px.webp"'), 'and its ladder');
  assert.ok(!html.includes('@post/'), 'the shorthand never reaches the output');
});

test('@post/ off a post fails loudly, naming the file', () => {
  assert.throws(
    () => renderer().render('![The hero](@post/hero.jpg)', PAGE_ENV),
    (error) => {
      assert.match(error.message, /\[@omega\.js\/web:markdown-images\]/, 'tagged');
      assert.match(error.message, /pages\/about\.md/, 'names the offending file');
      assert.match(error.message, /@post\/hero\.jpg/, 'names the offending reference');
      return true;
    },
  );
});

test('a real post build carries the optimized markup', async () => {
  const pages = await buildWith(miniData);
  const post = pages.get('/blog/first-post');

  assert.ok(post, 'the fixture post built');
  assert.ok(post.includes('data-lazy="@src /assets/images/blog/post-1000001/hero.jpg"'), '@post/ resolved through a real build');
  assert.ok(post.includes('title="Mini hero"') && post.includes('alt="The mini hero"'), 'alt/title survive the build');
  assert.ok(/<a href="\/pricing">\s*<picture>/.test(post), 'the linked image survives the build');
  assert.ok(!post.includes('@post/hero.jpg'), 'no raw shorthand in the output');
});
