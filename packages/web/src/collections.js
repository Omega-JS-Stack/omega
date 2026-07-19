/**
 * Content collections for the OMEGA engine: posts, alternatives, team, and
 * the blog taxonomy aggregated from posts' `post.categories`/`post.tags`
 * (jekyll-uj-powertools' blog-taxonomy generator equivalent), plus the
 * URL-sorted `allByUrl` view the meta-files iterate. Every content
 * collection is mirrored into the template-kit holder so uj_* tags
 * (uj_member) can read it mid-render.
 */

// Jekyll-default slugify — taxonomy slugs must match what templates' slugify
// filter produces, so both come from the same template-kit implementation.
const { slugify } = require('@omega.js/template-kit/jekyll-compat');

// Deterministic post order shared by the posts collection AND taxonomy
// aggregation: date desc, slug asc tie-break — same-date posts must order
// identically across builds (proven engine-identical in the bake-off).
const byDateThenSlug = (a, b) => (b.date - a.date) || a.page.fileSlug.localeCompare(b.page.fileSlug);

/**
 * Register the OMEGA collections on an Eleventy config.
 * @param {object} eleventyConfig
 * @param {Map<string, object[]>} collectionsHolder - template-kit's collection view
 */
function registerCollections(eleventyConfig, collectionsHolder) {
  // Jekyll-style doc id ('/team/ian', '/blog/slug') — the shape the uj_member
  // and uj_post tags match on and derive asset paths from. inputPath only as
  // a fallback for url-less docs.
  const toDoc = (item) => ({
    id: String(item.url || '').replace(/\/+$/, '') || item.inputPath,
    url: item.url,
    date: item.date,
    data: item.data,
  });

  eleventyConfig.addCollection('posts', (api) => {
    const posts = api.getFilteredByTag('posts').sort(byDateThenSlug);
    collectionsHolder.set('posts', posts.map(toDoc));
    return posts;
  });

  eleventyConfig.addCollection('alternatives', (api) => {
    const docs = api.getFilteredByTag('alternatives').sort((a, b) => a.url.localeCompare(b.url));
    collectionsHolder.set('alternatives', docs.map(toDoc));
    return docs;
  });

  eleventyConfig.addCollection('team', (api) => {
    const docs = api.getFilteredByTag('team').sort((a, b) => a.url.localeCompare(b.url));
    collectionsHolder.set('team', docs.map(toDoc));
    return docs;
  });

  eleventyConfig.addCollection('updates', (api) => {
    const docs = api.getFilteredByTag('updates').sort((a, b) => b.url.localeCompare(a.url));
    collectionsHolder.set('updates', docs.map(toDoc));
    return docs;
  });

  // Deterministic meta-file emission (sitemap.xml, pages.json): Eleventy's
  // collections.all order varies run-to-run (render/discovery concurrency),
  // so two builds of the SAME tree listed URLs in different orders. The meta
  // templates iterate this URL-sorted copy instead. Byte-order compare (not
  // localeCompare) so the order can never drift across machines/ICU builds.
  eleventyConfig.addCollection('allByUrl', (api) => {
    return api.getAll().sort((a, b) => {
      const au = a.url || '';
      const bu = b.url || '';
      return au < bu ? -1 : au > bu ? 1 : 0;
    });
  });

  eleventyConfig.addCollection('postCategories', (api) => aggregateTaxonomy(api, 'categories'));
  eleventyConfig.addCollection('postTags', (api) => aggregateTaxonomy(api, 'tags'));
}

/**
 * Aggregate the blog taxonomy from posts' `post.categories` / `post.tags`.
 * Terms are keyed by SLUG — real corpora mix spellings ("Marketing" ×673 vs
 * "marketing" ×11 in somiibo) and case variants would generate duplicate
 * taxonomy pages at the same permalink (Jekyll silently last-write-won;
 * Eleventy hard-errors). The most frequent spelling becomes the display
 * name; a post never lands in the same term twice.
 * @param {object} api - Eleventy collection API
 * @param {string} field
 * @returns {Array<{ name: string, slug: string, posts: object[] }>}
 */
function aggregateTaxonomy(api, field) {
  const groups = new Map();
  const posts = api.getFilteredByTag('posts').sort(byDateThenSlug);

  for (const item of posts) {
    const names = (item.data.post && item.data.post[field]) || [];
    const seen = new Set();
    for (const name of names) {
      const slug = slugify(name);
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      if (!groups.has(slug)) groups.set(slug, { name, slug, posts: [], spellings: new Map() });
      const group = groups.get(slug);
      group.spellings.set(name, (group.spellings.get(name) || 0) + 1);
      group.posts.push(item);
    }
  }

  return [...groups.values()]
    .map(({ spellings, ...group }) => ({
      ...group,
      name: [...spellings.entries()].sort((a, b) => b[1] - a[1])[0][0],
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = { registerCollections };
