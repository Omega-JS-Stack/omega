/**
 * Content collections for the OMEGA engine: posts, alternatives, team, and
 * the blog taxonomy aggregated from posts' `post.categories`/`post.tags`
 * (jekyll-uj-powertools' blog-taxonomy generator equivalent). Every
 * collection is mirrored into the template-kit holder so uj_* tags
 * (uj_member) can read it mid-render.
 */

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
  const toDoc = (item) => ({ id: item.inputPath, url: item.url, date: item.date, data: item.data });

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

  eleventyConfig.addCollection('postCategories', (api) => aggregateTaxonomy(api, 'categories'));
  eleventyConfig.addCollection('postTags', (api) => aggregateTaxonomy(api, 'tags'));
}

/**
 * Aggregate the blog taxonomy from posts' `post.categories` / `post.tags`.
 * @param {object} api - Eleventy collection API
 * @param {string} field
 * @returns {Array<{ name: string, slug: string, posts: object[] }>}
 */
function aggregateTaxonomy(api, field) {
  const groups = new Map();
  const posts = api.getFilteredByTag('posts').sort(byDateThenSlug);

  for (const item of posts) {
    for (const name of (item.data.post && item.data.post[field]) || []) {
      if (!groups.has(name)) groups.set(name, { name, slug: slugify(name), posts: [] });
      groups.get(name).posts.push(item);
    }
  }

  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Minimal slug helper (mirrors the corpus generator's slugify).
 * @param {string} text
 * @returns {string}
 */
function slugify(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

module.exports = { registerCollections };
