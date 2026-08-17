/**
 * #294 — the generated blog tag/category pages carry PER-TERM meta. They set
 * only pagination + permalink before, so all 300+ of a real blog's taxonomy
 * pages shipped the site's default title and description (duplicate-content
 * by the hundred). UJM's blog-taxonomy generator emitted
 * "<Term> - Blog Tags - <Brand>" plus a per-term description, and title-cased
 * the term it displayed.
 */
const assert = require('node:assert');
const { test } = require('node:test');
const { buildWith, miniData } = require('./lib/build.js');

let built;

/** Build the mini fixture once for this file. @returns {Promise<Map<string,string>>} */
function pages() {
  built = built || buildWith(miniData, {}, 'blog-taxonomy-meta');
  return built;
}

/**
 * The head values a page shipped.
 * @param {string} html
 * @returns {{ title: string, description: string }}
 */
function head(html) {
  return {
    title: (html.match(/<title>([^<]*)<\/title>/) || [])[1],
    description: (html.match(/<meta name="description" content="([^"]*)"/) || [])[1],
  };
}

test('a tag page titles and describes its own term', async () => {
  const html = (await pages()).get('/blog/tags/automation');
  const { title, description } = head(html);

  assert.strictEqual(title, 'Automation - Blog Tags - MiniCo');
  assert.strictEqual(description, 'Browse all blog posts tagged with Automation.');
  // The fixture's directory data sets a site-wide meta.title — the symptom
  // shape: every taxonomy page inherited it.
  assert.notStrictEqual(title, 'dir-title-must-lose');
});

test('a category page titles and describes its own term', async () => {
  const html = (await pages()).get('/blog/categories/marketing');
  const { title, description } = head(html);

  assert.strictEqual(title, 'Marketing - Blog Categories - MiniCo');
  assert.strictEqual(description, 'Browse all blog posts in the Marketing category.');
});

test('every generated taxonomy page carries its OWN title', async () => {
  const all = await pages();
  const termPages = [...all.keys()].filter((url) => /^\/blog\/(tags|categories)\/./.test(url));
  const titles = termPages.map((url) => head(all.get(url)).title);

  assert.ok(termPages.length >= 3, `fixture generates term pages: ${termPages.join(', ')}`);
  assert.strictEqual(new Set(titles).size, titles.length, `no two term pages share a title: ${titles.join(' | ')}`);
});

test('the term heading is title-cased', async () => {
  const html = (await pages()).get('/blog/tags/automation');
  const h1 = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1];

  assert.ok(h1, 'the tag page renders an h1');
  assert.strictEqual(h1.trim(), 'Automation');
});
