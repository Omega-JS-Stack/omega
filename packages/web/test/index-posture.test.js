/**
 * The index posture (#564, found by the optiic blind verify): the robots meta
 * and sitemap.xml must AGREE about every page.
 *
 * The optiic build emitted 255 `<loc>` entries where the legacy UJM sitemap
 * had 745 — 310 tag pages, 120 category pages and 34 `/blog/page/N` were
 * missing from the sitemap while every one of them still shipped
 * `<meta name="robots" content="index">`. The posture settles which way each
 * family goes, and makes the two signals ONE decision: `meta.index: false` is
 * what both read, so a page cannot be noindex and in the sitemap (or the
 * reverse) ever again.
 *
 *   INDEXED   posts, authored pages, collection items, every listing's page 1
 *   NOINDEX   the blog taxonomy (tag AND category terms, both hubs), a
 *             listing's page 2..N, auth, account, checkout, 404, /test
 *
 * Thin-taxonomy EXCLUSION is the posture: a term page is a list of links to
 * pages that are themselves indexed, so it earns nothing and competes with
 * them. The canonical listing (`/blog`, `/digest`) stays indexed and listed.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, before } = require('node:test');

const { buildSite, buildWith, miniData, BARE, MINI, PKG } = require('./lib/build.js');

const bareData = JSON.parse(fs.readFileSync(path.join(BARE, 'site-data.json'), 'utf8'));

let pages;
let sitemap;

before(async () => {
  pages = await buildWith(miniData, { environment: 'development' }, 'index-posture');
  sitemap = pages.get('/sitemap.xml');
  assert.ok(sitemap, 'the sitemap built');
});

/** Is this URL listed in a given sitemap? (the root entry drops the trailing slash) */
const listedIn = (xml, base, url) => xml.includes(`<loc>${base}${url === '/' ? '' : url}</loc>`);

/** Is this URL listed in the mini build's sitemap.xml? */
const inSitemap = (url) => listedIn(sitemap, miniData.url, url);

/** The robots content a built page of a given build ships. */
function robotsIn(built, url) {
  const html = built.get(url);
  assert.ok(html, `${url} built`);
  const match = html.match(/<meta name="robots" content="([^"]*)"/);
  assert.ok(match, `${url} carries a robots meta`);
  return match[1];
}

/** The robots content a page of the mini build ships. */
const robots = (url) => robotsIn(pages, url);

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

test('#564: the whole blog taxonomy — tag AND category terms, and both hubs — is noindex AND out of the sitemap', () => {
  const tag = urlLike(/^\/blog\/tags\/[^/]+$/, 'blog tag');
  const category = urlLike(/^\/blog\/categories\/[^/]+$/, 'blog category');

  for (const url of [tag, '/blog/tags', category, '/blog/categories']) {
    assert.equal(robots(url), 'noindex', `${url} is a thin taxonomy page: noindex`);
    assert.ok(!inSitemap(url), `${url} is out of the sitemap — the same decision`);
  }
});

test('#564: a paginated listing page past the first is noindex AND out of the sitemap', () => {
  const paged = urlLike(/^\/blog\/page\/\d+$/, 'blog pagination');

  assert.equal(robots(paged), 'noindex', `${paged} is noindex — page 1 is the canonical listing`);
  assert.ok(!inSitemap(paged), `${paged} is out of the sitemap`);
  assert.equal(robots('/blog'), 'index', 'page 1 is the canonical listing and stays indexable');
  assert.ok(inSitemap('/blog'), '/blog is the canonical listing and stays listed');
});

test('#564: a CONSUMER listing leaves the sitemap by the FLAG, and a URL that merely reads /page/ does not', async () => {
  // The framework's own paginated pages are ALSO out of `collections.allByUrl`
  // (#200 Lane B: a paginated default must carry a literal
  // `eleventyExcludeFromCollections`), so they cannot prove WHICH rule drops
  // them. A consumer's listing carries no such key: every one of its pages is
  // in the sitemap walk, so page 2 leaving is the `meta.index` flag and
  // nothing else. The second page proves the other direction — the robots tag
  // no longer keeps a URL list, so a page whose path simply contains `/page/`
  // is indexed and listed like any other.
  // Inside the package, not os.tmpdir: Eleventy matches its ignores against
  // CWD-relative paths, and a `../../var/folders/…` fixture makes the
  // `**/_layouts/**` ignore miss the mini theme's layouts (engine.js:455).
  const consumerDir = path.join(PKG, '.omega', 'index-posture-consumer-src');
  fs.rmSync(consumerDir, { recursive: true, force: true });
  fs.cpSync(MINI, consumerDir, { recursive: true });
  fs.writeFileSync(path.join(consumerDir, 'pages', 'digest.html'), [
    '---',
    'layout: blueprint/blog/index',
    'permalink: "/digest{% if pagination.pageNumber > 0 %}/page/{{ pagination.pageNumber | plus: 1 }}{% endif %}.html"',
    'pagination:',
    '  data: collections.posts',
    '  size: 1',
    '---',
    '',
  ].join('\n'));
  fs.mkdirSync(path.join(consumerDir, 'pages', 'handbook', 'page'), { recursive: true });
  fs.writeFileSync(path.join(consumerDir, 'pages', 'handbook', 'page', 'anatomy.html'), [
    '---',
    'layout: blueprint/index',
    'permalink: /handbook/page/anatomy',
    'meta:',
    '  title: "Page Anatomy - {{ resolved.config.brand.name }}"',
    '---',
    '',
  ].join('\n'));

  try {
    const built = await buildSite(consumerDir, miniData, { environment: 'development' }, 'index-posture-consumer');
    const xml = built.get('/sitemap.xml');
    const listed = (url) => listedIn(xml, miniData.url, url);

    assert.ok(built.get('/digest/page/2'), `the consumer listing paginates: ${[...built.keys()].filter((url) => url.startsWith('/digest')).join(', ')}`);
    assert.equal(robotsIn(built, '/digest'), 'index', 'page 1 of a consumer listing is the canonical one');
    assert.ok(listed('/digest'), 'and it is in the sitemap');

    assert.equal(robotsIn(built, '/digest/page/2'), 'noindex', 'page 2 is a duplicate of page 1');
    assert.ok(!listed('/digest/page/2'), 'and the SAME flag drops it from the sitemap walk it is inside of');

    assert.equal(robotsIn(built, '/handbook/page/anatomy'), 'index', 'a page is not a listing because its url reads /page/');
    assert.ok(listed('/handbook/page/anatomy'), 'and it is listed like any other page');
  } finally {
    fs.rmSync(consumerDir, { recursive: true, force: true });
  }
});

test('#564: auth, account, checkout and 404 are noindex AND out of the sitemap', () => {
  for (const url of ['/signin', '/signup', '/account', '/dashboard/account', '/payment/checkout', '/404']) {
    assert.equal(robots(url), 'noindex', `${url} is noindex`);
    assert.ok(!inSitemap(url), `${url} is out of the sitemap`);
  }
});

test('#468: a default page the framework keeps OUT of the sitemap says noindex too', () => {
  // The sitemap-orphan check (#468) reads a page's opt-out off the BUILD, and
  // since #564 there is only ONE opt-out to read: a page dropped from the
  // sitemap while still saying `index` cannot happen any more, because the
  // sitemap follows the very flag the robots tag prints.
  const url = '/portal/email-preferences';

  assert.equal(robots(url), 'noindex', `${url} is noindex`);
  assert.ok(!inSitemap(url), `${url} is out of the sitemap`);
});

test('#564: the framework dev surfaces under /test say noindex too', () => {
  // A production build emits none of them (#554); a DEV build must not tell a
  // crawler something the sitemap already contradicts.
  const dev = [...pages.keys()].find((url) => /^\/test\//.test(url) && /<meta name="robots"/.test(pages.get(url)));
  assert.ok(dev, 'the fixture builds a dev surface on the full page chrome');

  assert.equal(robots(dev), 'noindex', `${dev} is noindex`);
  assert.ok(!inSitemap(dev), `${dev} is out of the sitemap`);
});

/**
 * Build the bare fixture with extra site data, in its own scratch consumer dir
 * so a caller may edit a page first.
 * @param {object} extra - site-data keys merged over the bare fixture's
 * @param {string} name - the caller's output namespace
 * @param {function} [edit] - (consumerDir) => void, run before the build
 * @returns {Promise<Map<string, string>>}
 */
async function buildBare(extra, name, edit) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `omega-${name}-`));
  const consumerDir = path.join(tmp, 'src');
  fs.cpSync(BARE, consumerDir, { recursive: true });
  if (edit) edit(consumerDir);

  try {
    return await buildSite(consumerDir, { ...bareData, ...extra }, {}, name);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** Every URL of a build that ships a robots meta at all. */
const robotsPages = (built) => [...built.keys()].filter((url) => /<meta name="robots"/.test(built.get(url)));

// #607 (Ian 2026-08-26) deleted the config `meta` section, so the site-wide
// switch this test used to flip in omega.json5 is gone with it — meta lives in
// page frontmatter and its page-level data lane alone. The property under test
// is unchanged: whatever sets `meta.index: false` moves BOTH signals together.
test('#564: a page\'s own `meta.index: false` drops it from the sitemap AND says noindex', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-index-posture-'));
  const consumerDir = path.join(tmp, 'src');
  fs.cpSync(BARE, consumerDir, { recursive: true });
  const home = path.join(consumerDir, 'pages', 'index.html');
  fs.writeFileSync(home, fs.readFileSync(home, 'utf8').replace('permalink: /', 'permalink: /\nmeta:\n  index: false'));

  try {
    const staging = await buildSite(consumerDir, bareData, {}, 'index-posture-off');
    assert.ok(staging.get('/').includes('<meta name="robots" content="noindex"'), 'the page says noindex');
    assert.ok(
      !staging.get('/sitemap.xml').includes(`<loc>${bareData.url}</loc>`),
      'and the same decision drops it from the sitemap, not just the robots tag',
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── #564: the site-wide default is `targets.web.meta.index` ─────────────────
// One name at both levels (Ian 2026-09-09, docs/shared/rulings.md): the site
// default is spelled exactly the way a page spells its override, so the two can
// never drift apart. #725 shipped it as `seo.index`, a second name for one
// decision; that key is retired with a pointer. The site value is a SEED under
// the very same `meta.index` machinery, and every signal (robots meta,
// sitemap.xml, llms.txt, pages.json) still reads the one resolved flag.
//
// A target's keys land at the top level of the resolved config, so the site
// data a build receives carries `targets.web.meta.index` as `meta.index`.
test('#564: `targets.web.meta.index: false` noindexes the whole site and empties the machine files', async () => {
  const off = await buildBare({ meta: { index: false } }, 'index-posture-site-off');

  const shipped = robotsPages(off);
  assert.ok(shipped.length > 5, `the bare fixture builds the packaged default pages (${shipped.length})`);
  const indexed = shipped.filter((url) => robotsIn(off, url) === 'index');
  assert.deepStrictEqual(indexed, [], 'not one page is left telling a crawler to index it');

  assert.ok(!off.get('/sitemap.xml').includes('<loc>'), 'the sitemap lists nothing');
  assert.ok(!off.get('/llms.txt').includes(`](${bareData.url}`), 'llms.txt links nothing');
  assert.deepStrictEqual(JSON.parse(off.get('/pages.json')), [], 'the search index is empty');
});

test('#564: a page\'s own `meta.index: true` wins over a site-wide `targets.web.meta.index: false`', async () => {
  // ONE name, and the specific level wins BOTH directions (`meta.index: false`
  // under a site-wide true is the test above): the site value is only the seed
  // the page's own meta walk merges over.
  const off = await buildBare({ meta: { index: false } }, 'index-posture-site-page-on', (consumerDir) => {
    const home = path.join(consumerDir, 'pages', 'index.html');
    fs.writeFileSync(home, fs.readFileSync(home, 'utf8').replace('permalink: /', 'permalink: /\nmeta:\n  index: true'));
  });

  assert.equal(robotsIn(off, '/'), 'index', 'the page the brand exempted is indexed');
  assert.ok(listedIn(off.get('/sitemap.xml'), bareData.url, '/'), 'and the same decision lists it in the sitemap');
  assert.equal(robotsIn(off, '/404'), 'noindex', 'the rest of the site is still off');
});

test('#564: absence is today\'s behavior — the switch changes nothing until it is the literal false', async () => {
  // Consequential-feature doctrine (#527): turning a whole site off search is
  // irreversible-shaped, so only the literal `false` does it.
  const on = await buildBare({ meta: { index: true } }, 'index-posture-site-on');
  const absent = await buildBare({}, 'index-posture-site-absent');

  for (const [label, built] of [['meta.index: true', on], ['no meta block', absent]]) {
    assert.equal(robotsIn(built, '/'), 'index', `${label}: the homepage is indexed`);
    assert.ok(listedIn(built.get('/sitemap.xml'), bareData.url, '/'), `${label}: and listed`);
    assert.equal(robotsIn(built, '/404'), 'noindex', `${label}: and the per-page posture is untouched`);
  }
});

// ── #564: the automatic exclusions are the ENGINE's, not each template's ────
// Every machine file used to carry its own copy of the same rule list (drafts,
// the /test segment, /admin/, redirect stubs, a listing's pages 2..N) while the
// robots tag carried none of it, so a draft, or a redirect stub, told a
// crawler "index" while the sitemap that would have led it there left it out.
// The engine resolves ONE value per page and every output reads that.
test('#564: a draft and a redirect stub say noindex, the same flag that drops them from the machine files', async () => {
  const consumerDir = path.join(PKG, '.omega', 'index-posture-auto-src');
  fs.rmSync(consumerDir, { recursive: true, force: true });
  fs.cpSync(MINI, consumerDir, { recursive: true });
  fs.writeFileSync(path.join(consumerDir, '_posts', '2024', '2024-04-01-draft-post.md'), [
    '---',
    'layout: blueprint/blog/post',
    'draft: true',
    'post:',
    '  title: "Draft post"',
    '  description: "Written, not published"',
    '  author: jane doe',
    '  id: 1000098',
    '---',
    '',
    'Quebec romeo sierra tango uniform victor.',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(consumerDir, 'pages', 'moved.md'), [
    '---',
    'layout: modules/utilities/redirect',
    'permalink: /moved',
    'redirect:',
    '  url: "/about"',
    '---',
    '',
  ].join('\n'));

  try {
    const built = await buildSite(consumerDir, miniData, {}, 'index-posture-auto');
    const xml = built.get('/sitemap.xml');
    const json = JSON.parse(built.get('/pages.json'));
    const llms = built.get('/llms.txt');

    for (const url of ['/blog/draft-post', '/moved']) {
      assert.equal(robotsIn(built, url), 'noindex', `${url} tells the crawler not to index it`);
      assert.ok(!listedIn(xml, miniData.url, url), `${url} is out of the sitemap`);
      assert.ok(!json.some((entry) => entry.url === `${miniData.url}${url}`), `${url} is out of pages.json`);
      assert.ok(!llms.includes(`(${miniData.url}${url})`), `${url} is out of llms.txt`);
    }

    assert.equal(robotsIn(built, '/blog/first-post'), 'index', 'a published post is untouched');
    assert.ok(listedIn(xml, miniData.url, '/blog/first-post'), 'and still listed');
  } finally {
    fs.rmSync(consumerDir, { recursive: true, force: true });
  }
});
