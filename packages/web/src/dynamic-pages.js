/**
 * Dynamic pages (#207) — the successor to jekyll-uj-powertools' dynamic-pages
 * generator: a brand that declares a collection in
 * `targets.web.collections` gets its listing page (paginated) and one page per
 * category, generated, with no page files to hand-author.
 *
 *   targets.web.collections: {
 *     docs: { field: 'doc.category', size: 12, title: 'Docs', description: '…' },
 *   }
 *
 * `field` is the dotted frontmatter path the categories group on (legacy's
 * `recipe.cuisine`), holding either one value or a list. The generated pages
 * are SOURCE STRINGS registered as virtual templates on the same lane as the
 * framework's default pages (engine.js): they paginate real collections, they
 * step aside for a consumer page at the same permalink, and they carry
 * `eleventyExcludeFromCollections` in their own frontmatter because Eleventy
 * reads that key off RAW frontmatter when it expands pagination.
 *
 * The URL contract, all flat `.html` output (extensionless URLs, no trailing
 * slash — the engine's Jekyll parity):
 *   <base>              the listing, page 1        (base defaults to /<name>)
 *   <base>/<n>          listing pages 2..n
 *   <base>/categories/<slug>
 *   <base>/<slug>       the documents themselves (engine.js permalink lane)
 */
const { BUILT_IN_COLLECTIONS } = require('./collections.js');

// The listing's default page size — the blog's `per_page` (defaults/pages/blog.md).
const DEFAULT_SIZE = 6;

// A collection name is a URL segment AND a directory name (`_docs`), so it is
// held to the same shape as an instance id: lowercase, starts with a letter.
const NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

// A dotted frontmatter path — `category`, `doc.category`, `recipe.cuisine`.
const FIELD_PATTERN = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/;

// A YAML double-quoted scalar, and its body alone. JSON's string escapes are a
// subset of YAML's, so a brand's title can hold quotes, colons and Liquid
// without breaking the generated frontmatter.
const yaml = (value) => JSON.stringify(String(value));
const escapeYaml = (value) => yaml(value).slice(1, -1);

/**
 * Read and validate the `collections` config block. Every problem is an ERROR:
 * a collection that silently fails to register generates no pages at all, and
 * an empty section of a site reads exactly like an unwritten one.
 * @param {object} [config] - the raw targets.web.collections value
 * @returns {Array<object>} one entry per collection (empty when unset)
 * @throws {Error} on a bad shape, a built-in name, or a missing/invalid field
 */
function readCollections(config) {
  if (config === undefined || config === null) return [];

  if (typeof config !== 'object' || Array.isArray(config)) {
    throw new Error(
      `targets.web.collections must be a map of collection name → settings `
      + `— got ${Array.isArray(config) ? 'array' : typeof config}`,
    );
  }

  return Object.entries(config).map(([name, value]) => readCollection(name, value));
}

/**
 * Read one collection entry.
 * @param {string} name - the collection name (the config key)
 * @param {object} value - its settings
 * @returns {object} the resolved collection
 */
function readCollection(name, value) {
  const at = `targets.web.collections.${name}`;

  if (!NAME_PATTERN.test(name)) {
    throw new Error(
      `${at} is not a usable collection name — a name is lowercase, starts with a letter, `
      + `and holds only letters, digits and dashes (it names both the _${name} directory and the URL)`,
    );
  }

  if (BUILT_IN_COLLECTIONS.some((collection) => collection.name === name)) {
    throw new Error(
      `${at} is already an OMEGA collection — the built-in collections are `
      + `${BUILT_IN_COLLECTIONS.map((collection) => collection.name).join(', ')}, and they bring their own pages. `
      + `Name your collection something else.`,
    );
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${at} must be an object of settings (field, size, title, description, permalink) — got ${Array.isArray(value) ? 'array' : typeof value}`);
  }

  if (typeof value.field !== 'string' || !FIELD_PATTERN.test(value.field)) {
    throw new Error(
      `${at}.field must be the dotted frontmatter path the category pages group on `
      + `(e.g. "${name.replace(/s$/, '')}.category") — got ${JSON.stringify(value.field)}`,
    );
  }

  if (value.size !== undefined && (!Number.isInteger(value.size) || value.size < 1)) {
    throw new Error(`${at}.size must be a positive integer (documents per listing page) — got ${JSON.stringify(value.size)}`);
  }

  for (const key of ['title', 'description']) {
    if (value[key] !== undefined && typeof value[key] !== 'string') {
      throw new Error(`${at}.${key} must be a string — got ${typeof value[key]}`);
    }
  }

  if (value.permalink !== undefined
      && (typeof value.permalink !== 'string' || !/^\/[^\s{}]*[^\s{}/]$/.test(value.permalink))) {
    throw new Error(
      `${at}.permalink must be the collection's URL base — a rooted path with no trailing slash `
      + `("/guides"), which every one of its pages hangs off — got ${JSON.stringify(value.permalink)}`,
    );
  }

  const title = value.title || titleCase(name);

  return {
    name,
    // Documents live in `_<name>/`, the Jekyll collection-directory convention
    // every built-in collection already follows.
    dir: `_${name}`,
    base: value.permalink || `/${name}`,
    field: value.field,
    // The namespace the documents keep their own fields under (`doc.title` for
    // a `doc.category` field) — the generated layouts read a document's title
    // through it, then fall back to a bare `title`.
    namespace: value.field.includes('.') ? value.field.split('.')[0] : '',
    taxonomy: `${name}Categories`,
    size: value.size === undefined ? DEFAULT_SIZE : value.size,
    title,
    description: value.description || `Browse the ${title} collection.`,
  };
}

/**
 * Title-case a collection name for the default page title ('case-studies' →
 * 'Case Studies').
 * @param {string} name
 * @returns {string}
 */
function titleCase(name) {
  return name.split('-').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

/**
 * The URL of a listing page. Page 1 IS the collection's base — the blog's
 * shape, so /docs and /docs/2 read as one series.
 * @param {object} collection
 * @param {number} pageNumber - Eleventy's 0-based pagination.pageNumber
 * @returns {string}
 */
function listingUrl(collection, pageNumber) {
  return pageNumber > 0 ? `${collection.base}/${pageNumber + 1}` : collection.base;
}

/**
 * The URL of one category page.
 * @param {object} collection
 * @param {string} slug
 * @returns {string}
 */
function categoryUrl(collection, slug) {
  return `${collection.base}/categories/${slug}`;
}

/**
 * The YAML block every generated page carries: the collection facts its
 * layouts render from (`resolved.collection.*`).
 * @param {object} collection
 * @returns {string}
 */
function collectionBlock(collection) {
  return [
    'collection:',
    `  name: ${yaml(collection.name)}`,
    `  base: ${yaml(collection.base)}`,
    `  namespace: ${yaml(collection.namespace)}`,
    `  taxonomy: ${yaml(collection.taxonomy)}`,
    `  title: ${yaml(collection.title)}`,
    `  description: ${yaml(collection.description)}`,
  ].join('\n');
}

/**
 * The generated pages of one collection: the paginated listing, and the
 * per-category pages. `urlOf` is the page's URL at RENDER time (the listing's
 * page number and the category's slug are only known there), which is both the
 * permalink and the suppression key the engine's gate asks about.
 * @param {object} collection - a readCollections entry
 * @returns {Array<{ virtual: string, label: string, raw: string, url?: string, urlOf: function }>}
 */
function collectionPages(collection) {
  const block = collectionBlock(collection);

  return [
    {
      virtual: `omega-dynamic/${collection.name}/index.html`,
      label: `targets.web.collections.${collection.name} (listing)`,
      // The one URL known at config time — the collision report's half of the
      // picture, exactly like a framework default page's permalink.
      url: collection.base,
      raw: [
        '---',
        'layout: blueprint/collection/index',
        '',
        `# Generated by @omega.js/web from targets.web.collections.${collection.name} (#207).`,
        block,
        '',
        'meta:',
        `  title: "${escapeYaml(collection.title)} - {{ site.brand.name }}"`,
        `  description: ${yaml(collection.description)}`,
        `  breadcrumb: ${yaml(collection.title)}`,
        '',
        'pagination:',
        `  data: collections.${collection.name}`,
        `  size: ${collection.size}`,
        // The listing survives an empty collection — a brand that declared it
        // before writing anything still gets the page (and its empty state).
        '  generatePageOnEmptyData: true',
        // Eleventy reads this off RAW frontmatter when it expands pagination,
        // before any computed data exists (test/collections-gate.test.js).
        'eleventyExcludeFromCollections: true',
        '---',
        '',
      ].join('\n'),
      urlOf: (data) => {
        const pageNumber = data.pagination && data.pagination.pageNumber;
        return listingUrl(collection, typeof pageNumber === 'number' ? pageNumber : 0);
      },
    },
    {
      virtual: `omega-dynamic/${collection.name}/categories.html`,
      label: `targets.web.collections.${collection.name} (categories)`,
      raw: [
        '---',
        'layout: blueprint/collection/category',
        '',
        `# Generated by @omega.js/web from targets.web.collections.${collection.name} (#207).`,
        block,
        '',
        'pagination:',
        `  data: collections.${collection.taxonomy}`,
        '  size: 1',
        '  alias: category',
        'eleventyExcludeFromCollections: true',
        '---',
        '',
      ].join('\n'),
      urlOf: (data) => {
        // Eleventy's computed-data dependency pass probes with proxies, so the
        // slug is only a string on a real render — no term, no page.
        const slug = data.category && data.category.slug;
        return typeof slug === 'string' && slug ? categoryUrl(collection, slug) : null;
      },
    },
  ];
}

module.exports = { readCollections, collectionPages };
