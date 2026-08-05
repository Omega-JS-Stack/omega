/**
 * markdown-images.js — markdown images render as OPTIMIZED image markup.
 *
 * Port of jekyll-uj-powertools lib/hooks/markdown-images.rb: `![alt](src)` in
 * a markdown body renders through the SAME builder the omega_image tag uses
 * (template-kit's buildImageHtml), so hand-written prose gets the responsive
 * <picture> + lazy placeholder every templated image gets — one image-markup
 * SSOT, never a parallel hand-built <img>. Sizes/loading come from the
 * builder's own defaults (the full 320/640/1024 source ladder, webp first),
 * which is exactly what an omega_image call with no options produces.
 *
 * The Ruby did it as a pre_render regex pass that rewrote the source into
 * legacy image-tag calls, and needed a SECOND, earlier pass for the linked form
 * `[![alt](src)](href)` because kramdown promoted the inner image to a block
 * and dropped the wrapping link. markdown-it hands us the image TOKEN instead,
 * already nested inside the link's tokens, so one renderer rule covers both
 * forms and no regex ever touches the author's source.
 *
 * `@post/<file>` resolves against the rendering post's image directory
 * (/assets/images/blog/post-<post.id>/<file> — the same convention
 * template-kit's omega_post `image` property builds). OFF a post it FAILS the
 * build: the Ruby only warned, which shipped a literal `@post/…` src to
 * production, and a broken hero is not something a log line catches.
 */
const { buildImageHtml, buildExternalImage } = require('@omega.js/template-kit/tags/media');

const POST_PREFIX = '@post/';

// imagemin only derives the responsive ladder (-320px.webp, …) for raster
// sources (its own extension gate), so a <picture> for anything else points
// at files that never exist — and a 404'd <source> does NOT fall back to the
// <img>. Non-raster local sources take the plain lazy-<img> lane instead.
const RASTER_RE = /\.(jpe?g|png)$/i;

/**
 * Install the optimized-image renderer on a markdown-it instance. Idempotent:
 * the rule is REPLACED, never wrapped (Eleventy re-runs library amendments
 * whenever it re-initializes an engine).
 * @param {object} md - a markdown-it instance
 */
function applyMarkdownImages(md) {
  md.renderer.rules.image = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const src = resolveSource(token.attrGet('src') || '', env);
    if (!src) return '';

    const imageOptions = {
      // Alt is the token's inline children (markdown-it's own default rule
      // renders them the same way), title the optional ![](src "title") arg.
      alt: self.renderInlineAsText(token.children || [], options, env),
      title: token.attrGet('title') || '',
    };

    const isLocal = !/^https?:\/\//i.test(src);
    if (isLocal && !RASTER_RE.test(src)) return buildExternalImage(src, imageOptions);
    return buildImageHtml(src, imageOptions);
  };
}

/**
 * Expand the `@post/` shorthand against the rendering document.
 * @param {string} src - the authored markdown src
 * @param {object} env - markdown-it env (Eleventy passes the page's data)
 * @returns {string} the resolved src
 */
function resolveSource(src, env) {
  if (!src.startsWith(POST_PREFIX)) return src;

  const postId = env && env.post && env.post.id;
  if (!postId) {
    throw new Error(
      `[@omega.js/web:markdown-images] ${inputPathOf(env)}: "${src}" uses the @post/ shorthand, `
      + 'but this document is not a post (no post.id in its frontmatter). '
      + '@post/ only resolves inside a _posts entry — write an absolute /assets/... path here.',
    );
  }

  return `/assets/images/blog/post-${postId}/${src.slice(POST_PREFIX.length)}`;
}

function inputPathOf(env) {
  return (env && env.page && env.page.inputPath) || 'unknown markdown file';
}

module.exports = { applyMarkdownImages };
