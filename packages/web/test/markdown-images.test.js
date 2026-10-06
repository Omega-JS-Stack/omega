/**
 * Markdown images render as optimized image markup (#193) — the port of
 * jekyll-uj-powertools' markdown-images hook. A `![alt](src)` in prose comes
 * out of template-kit's buildImageHtml (the same builder omega_image uses),
 * `@post/<file>` expands to the rendering post's image dir, and an `@post/`
 * reference off a post fails the build instead of shipping a literal
 * `@post/…` src to production the way the legacy warn did.
 */
const markdownIt = require('markdown-it');
const defineCases = require('@omega.js/devkit/test/define-cases');

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

module.exports = defineCases({
  type: 'group',
  description: 'markdown-images',
  tests: [
    {
      name: 'a plain markdown image renders the optimized picture markup',
      run: (ctx) => {
        const html = renderer().render('![A wide shot](/assets/images/mini/shot.jpg)', PAGE_ENV);

        ctx.expect(html.includes('<picture>'), 'the responsive builder ran').toBeTruthy();
        ctx.expect(!/<img[^>]*\ssrc="\/assets/.test(html), 'no eager src — the builder lazy-loads').toBeTruthy();
        ctx.expect(html.includes('data-lazy="@src /assets/images/mini/shot.jpg"'), 'the original rides the lazy attribute').toBeTruthy();
        ctx.expect(html.includes('data-lazy="@srcset /assets/images/mini/shot-320px.webp"'), 'the webp ladder is the builder default').toBeTruthy();
        ctx.expect(html.includes('data-lazy="@srcset /assets/images/mini/shot-1024px.jpg"'), 'the original-format ladder too').toBeTruthy();
        ctx.expect(!/\swidth="/.test(html) && !/\sheight="/.test(html), 'no dimensions invented when the author supplies none').toBeTruthy();
      },
    },

    {
      name: 'alt and title survive the rewrite',
      run: (ctx) => {
        const html = renderer().render('![Ship it "safely" & often](/assets/images/mini/shot.jpg "The hero")', PAGE_ENV);

        ctx.expect(html.includes('alt="Ship it &quot;safely&quot; &amp; often"'), 'alt preserved and attribute-escaped').toBeTruthy();
        ctx.expect(html.includes('title="The hero"'), 'title preserved').toBeTruthy();
      },
    },

    {
      name: 'a titleless image carries no empty title attribute',
      run: (ctx) => {
        ctx.expect(!renderer().render('![Alt](/a.jpg)', PAGE_ENV).includes('title='), 'no phantom title').toBeTruthy();
      },
    },

    {
      name: 'an external markdown image takes the builder external lane',
      run: (ctx) => {
        const html = renderer().render('![Remote](https://cdn.example.com/a.jpg "Remote title")', PAGE_ENV);

        ctx.expect(!html.includes('<picture>'), 'no source ladder for an image we cannot resize').toBeTruthy();
        ctx.expect(html.includes('data-lazy="@src https://cdn.example.com/a.jpg"'), 'still lazy-loaded').toBeTruthy();
        ctx.expect(html.includes('alt="Remote"') && html.includes('title="Remote title"'), 'alt/title preserved').toBeTruthy();
        ctx.expect(html.includes('loading="lazy"'), 'the builder default').toBeTruthy();
      },
    },

    {
      name: 'a non-raster local image skips the ladder imagemin never builds',
      run: (ctx) => {
        const html = renderer().render('![Logo](/assets/images/logo.svg)', PAGE_ENV);

        ctx.expect(!html.includes('<picture>'), 'no <source> ladder — imagemin derives none for svg, and a 404d <source> never falls back').toBeTruthy();
        ctx.expect(html.includes('data-lazy="@src /assets/images/logo.svg"'), 'still lazy-loaded').toBeTruthy();
        ctx.expect(html.includes('alt="Logo"'), 'alt preserved').toBeTruthy();
      },
    },

    {
      name: 'the linked form nests without special casing',
      run: (ctx) => {
        const html = renderer().render('[![The chart](/assets/images/mini/chart.png)](/pricing)', PAGE_ENV);

        ctx.expect(/<a href="\/pricing">\s*<picture>/.test(html), 'the anchor wraps the optimized markup').toBeTruthy();
        ctx.expect(html.includes('</picture></a>'), 'and closes around it').toBeTruthy();
        ctx.expect(html.includes('alt="The chart"'), 'the nested image keeps its alt').toBeTruthy();
      },
    },

    {
      name: '@post/ resolves against the rendering post image dir',
      run: (ctx) => {
        const html = renderer().render('![The hero](@post/hero.jpg)', POST_ENV);

        ctx.expect(html.includes('data-lazy="@src /assets/images/blog/post-1000001/hero.jpg"'), 'the post image dir').toBeTruthy();
        ctx.expect(html.includes('data-lazy="@srcset /assets/images/blog/post-1000001/hero-320px.webp"'), 'and its ladder').toBeTruthy();
        ctx.expect(!html.includes('@post/'), 'the shorthand never reaches the output').toBeTruthy();
      },
    },

    {
      name: '@post/ off a post fails loudly, naming the file',
      run: (ctx) => {
        ctx.expect(() => renderer().render('![The hero](@post/hero.jpg)', PAGE_ENV)).toThrow((error) => {
            ctx.expect(error.message, 'tagged').toMatch(/\[@omega\.js\/web:markdown-images\]/);
            ctx.expect(error.message, 'names the offending file').toMatch(/pages\/about\.md/);
            ctx.expect(error.message, 'names the offending reference').toMatch(/@post\/hero\.jpg/);
            return true;
          });
      },
    },

    {
      name: 'a real post build carries the optimized markup',
      run: async (ctx) => {
        const pages = await buildWith(miniData);
        const post = pages.get('/blog/first-post');

        ctx.expect(post, 'the fixture post built').toBeTruthy();
        ctx.expect(post.includes('data-lazy="@src /assets/images/blog/post-1000001/hero.jpg"'), '@post/ resolved through a real build').toBeTruthy();
        ctx.expect(post.includes('title="Mini hero"') && post.includes('alt="The mini hero"'), 'alt/title survive the build').toBeTruthy();
        ctx.expect(/<a href="\/pricing">\s*<picture>/.test(post), 'the linked image survives the build').toBeTruthy();
        ctx.expect(!post.includes('@post/hero.jpg'), 'no raw shorthand in the output').toBeTruthy();
      },
    },
  ],
});
