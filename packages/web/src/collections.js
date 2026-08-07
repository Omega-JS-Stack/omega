/**
 * Content collections for the OMEGA engine: posts, alternatives, team, and
 * the blog taxonomy aggregated from posts' `post.categories`/`post.tags`
 * (jekyll-uj-powertools' blog-taxonomy generator equivalent), plus the
 * URL-sorted `allByUrl` view the meta-files iterate. Every content
 * collection is mirrored into the template-kit holder so omega_* tags
 * (omega_member) can read it mid-render.
 *
 * A brand's OWN collections (#207, `targets.web.collections`) ride the same
 * registration: one collection keyed by name plus a `<name>Categories`
 * taxonomy over the configured frontmatter field, which is what the
 * synthesized listing/category pages paginate (src/dynamic-pages.js).
 */

// Jekyll-default slugify — taxonomy slugs must match what templates' slugify
// filter produces, so both come from the same template-kit implementation.
const { slugify } = require('@omega.js/template-kit/jekyll-compat');

// Deterministic post order shared by the posts collection AND taxonomy
// aggregation: date desc, slug asc tie-break — same-date posts must order
// identically across builds (proven engine-identical in the bake-off).
const byDateThenSlug = (a, b) => (b.date - a.date) || a.page.fileSlug.localeCompare(b.page.fileSlug);

// The URL sorts of the dateless collections. A brand's own collection uses
// the ascending one: an arbitrary document carries no reliable date (Eleventy
// falls back to the file's mtime, which differs per machine and per clone),
// so URL order is the only order that reproduces across builds.
const byUrlAsc = (a, b) => a.url.localeCompare(b.url);
const byUrlDesc = (a, b) => b.url.localeCompare(a.url);

// The framework's own collections: the consumer dir each one's documents live
// in, the URL base their permalinks and pages hang off (posts publish under
// /blog), and the order the collection lists them in. The engine's directory
// tagging and permalink conventions read this list, and a brand collection
// may not take one of these names (src/dynamic-pages.js).
const BUILT_IN_COLLECTIONS = [
  { name: 'posts', dir: '_posts', base: '/blog', order: byDateThenSlug },
  { name: 'alternatives', dir: '_alternatives', base: '/alternatives', order: byUrlAsc },
  { name: 'team', dir: '_team', base: '/team', order: byUrlAsc },
  { name: 'updates', dir: '_updates', base: '/updates', order: byUrlDesc },
];

/**
 * Register the OMEGA collections on an Eleventy config.
 * @param {object} eleventyConfig
 * @param {Map<string, object[]>} collectionsHolder - template-kit's collection view
 * @param {Array<object>} [dynamicCollections] - the brand's own collections (readCollections' output)
 */
function registerCollections(eleventyConfig, collectionsHolder, dynamicCollections) {
  // Jekyll-style doc id ('/team/ian', '/blog/slug') — the shape the omega_member
  // and omega_post tags match on and derive asset paths from. inputPath only as
  // a fallback for url-less docs.
  const toDoc = (item) => ({
    id: String(item.url || '').replace(/\/+$/, '') || item.inputPath,
    url: item.url,
    date: item.date,
    data: item.data,
  });

  // One registration shape for every collection: the documents the directory
  // tagging marked, in the collection's own order, mirrored into the holder.
  const addContentCollection = ({ name, order }) => {
    eleventyConfig.addCollection(name, (api) => {
      const docs = api.getFilteredByTag(name).sort(order);
      collectionsHolder.set(name, docs.map(toDoc));
      return docs;
    });
  };

  for (const collection of BUILT_IN_COLLECTIONS) addContentCollection(collection);

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

  eleventyConfig.addCollection('postCategories', (api) => aggregateTaxonomy(api, { tag: 'posts', field: 'post.categories', order: byDateThenSlug }));
  eleventyConfig.addCollection('postTags', (api) => aggregateTaxonomy(api, { tag: 'posts', field: 'post.tags', order: byDateThenSlug }));

  // The brand's own collections (#207): the documents, plus the taxonomy the
  // synthesized category pages paginate over.
  for (const collection of dynamicCollections || []) {
    addContentCollection({ name: collection.name, order: byUrlAsc });
    eleventyConfig.addCollection(collection.taxonomy, (api) => aggregateTaxonomy(api, {
      tag: collection.name,
      field: collection.field,
      order: byUrlAsc,
    }));
  }
}

/**
 * Aggregate a collection's taxonomy from a dotted frontmatter field
 * (`post.categories` for the blog, whatever `targets.web.collections.<name>.field`
 * names for a brand collection). Terms are keyed by SLUG — real corpora mix
 * spellings ("Marketing" ×673 vs "marketing" ×11 in somiibo) and case variants
 * would generate duplicate taxonomy pages at the same permalink (Jekyll
 * silently last-write-won; Eleventy hard-errors). The most frequent spelling
 * becomes the display name; a document never lands in the same term twice.
 * @param {object} api - Eleventy collection API
 * @param {object} options
 * @param {string} options.tag - the collection tag to aggregate
 * @param {string} options.field - dotted frontmatter path (a list, or one value)
 * @param {function} options.order - the collection's document order
 * @returns {Array<{ name: string, slug: string, posts: object[] }>}
 */
function aggregateTaxonomy(api, { tag, field, order }) {
  const groups = new Map();
  const posts = api.getFilteredByTag(tag).sort(order);

  for (const item of posts) {
    // A field holding ONE value (legacy UJM's `recipe.cuisine`) is that
    // document's single term — the list form is the blog's.
    const value = field.split('.').reduce((node, key) => (node == null ? node : node[key]), item.data);
    const names = Array.isArray(value) ? value : (typeof value === 'string' ? [value] : []);
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

module.exports = { registerCollections, BUILT_IN_COLLECTIONS };
