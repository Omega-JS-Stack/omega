/**
 * The index posture (#564, found by the optiic blind verify): the robots meta
 * and sitemap.xml must AGREE about every page.
 *
 * The optiic build emitted 255 `<loc>` entries where the legacy UJM sitemap
 * had 745 — 310 tag pages, 120 category pages and 34 `/blog/page/N` were
 * missing from the sitemap while every one of them still shipped
 * `<meta name="robots" content="index">`. Ian's ruling settles which way each
 * family goes, and makes the two signals ONE decision: `meta.index: false` is
 * what both read, so a page cannot be noindex and in the sitemap (or the
 * reverse) ever again.
 *
 *   INDEXED   posts, authored pages, collection items, CATEGORY pages
 *   NOINDEX   tag pages, /blog/page/N, auth, account, checkout, 404, /test
 */
const assert = require('node:assert');
const { test, before } = require('node:test');

const { buildWith, miniData } = require('./lib/build.js');

let pages;
let sitemap;

before(async () => {
  pages = await buildWith(miniData, { environment: 'development' }, 'index-posture');
  sitemap = pages.get('/sitemap.xml');
  assert.ok(sitemap, 'the sitemap built');
});

/** Is this URL listed in sitemap.xml? (the root entry drops the trailing slash) */
const inSitemap = (url) => sitemap.includes(`<loc>${miniData.url}${url === '/' ? '' : url}</loc>`);

/** The robots content a built page ships. */
function robots(url) {
  const html = pages.get(url);
  assert.ok(html, `${url} built`);
  const match = html.match(/<meta name="robots" content="([^"]*)"/);
  assert.ok(match, `${url} carries a robots meta`);
  return match[1];
}

/** A URL of the given family in this build, or a failure naming the family. */
function urlLike(pattern, label) {
  const found = [...pages.keys()].find((url) => pattern.test(url));
  assert.ok(found, `the fixture builds a ${label} page`);
  return found;
}

test('#564: posts, authored pages and collection items are indexed AND in the sitemap', () => {
  const post = urlLike(/^\/blog\/[a-z-]+$/, 'blog post');
  const item = urlLike(/^\/updates\/[^/]+$/, 'collection item');

  for (const url of ['/', '/pricing', post, item]) {
    assert.equal(robots(url), 'index', `${url} is indexed`);
    assert.ok(inSitemap(url), `${url} is in the sitemap`);
  }
});

test('#564: CATEGORY pages are indexed — the tag/category split is the whole ruling', () => {
  const category = urlLike(/^\/blog\/categories\/[^/]+$/, 'blog category');

  assert.equal(robots(category), 'index', 'a curated category term is indexable content');
  assert.equal(robots('/blog/categories'), 'index', 'and so is the categories hub');
  assert.ok(inSitemap('/blog/categories'), 'the hub is in the sitemap');

  // The category TERM pages are still absent from sitemap.xml, and this pins
  // WHY so the residual cannot be mistaken for the filter: they are paginated
  // framework defaults, and #200 Lane B requires every paginated default to
  // carry a literal `eleventyExcludeFromCollections: true` (the render gate's
  // computed value is invisible to pagination expansion), so they never enter
  // `collections.allByUrl` at all. `/blog` and `/blog/page/N` ride the same
  // exclusion. Reversing it is a Lane B decision, not a sitemap-filter one.
  assert.ok(!inSitemap(category), 'the residual #564 reported — see the comment above');
});

test('#564: tag pages are noindex AND out of the sitemap', () => {
  const tag = urlLike(/^\/blog\/tags\/[^/]+$/, 'blog tag');

  for (const url of [tag, '/blog/tags']) {
    assert.equal(robots(url), 'noindex', `${url} is noindex`);
    assert.ok(!inSitemap(url), `${url} is out of the sitemap`);
  }
});

test('#564: a paginated listing page past the first is noindex AND out of the sitemap', () => {
  const paged = urlLike(/^\/blog\/page\/\d+$/, 'blog pagination');

  assert.equal(robots(paged), 'noindex', `${paged} is noindex — page 1 is the canonical listing`);
  assert.ok(!inSitemap(paged), `${paged} is out of the sitemap`);
  assert.equal(robots('/blog'), 'index', 'page 1 is the canonical listing and stays indexable');
});

test('#564: auth, account, checkout and 404 are noindex AND out of the sitemap', () => {
  for (const url of ['/signin', '/signup', '/account', '/dashboard/account', '/payment/checkout', '/404']) {
    assert.equal(robots(url), 'noindex', `${url} is noindex`);
    assert.ok(!inSitemap(url), `${url} is out of the sitemap`);
  }
});

test('#564: the framework dev surfaces under /test say noindex too', () => {
  // A production build emits none of them (#554); a DEV build must not tell a
  // crawler something the sitemap already contradicts.
  const dev = [...pages.keys()].find((url) => /^\/test\//.test(url) && /<meta name="robots"/.test(pages.get(url)));
  assert.ok(dev, 'the fixture builds a dev surface on the full page chrome');

  assert.equal(robots(dev), 'noindex', `${dev} is noindex`);
  assert.ok(!inSitemap(dev), `${dev} is out of the sitemap`);
});

test('#564: a site-wide `meta.index: false` empties the sitemap — one decision, both signals', async () => {
  const staging = await buildWith({ ...miniData, meta: { ...miniData.meta, index: false } }, {}, 'index-posture-off');

  assert.equal(
    (staging.get('/sitemap.xml').match(/<loc>/g) || []).length,
    0,
    'the config switch drops every page from the sitemap, not just the robots tag',
  );
  assert.ok(staging.get('/').includes('<meta name="robots" content="noindex"'), 'and the home page says so');
});
