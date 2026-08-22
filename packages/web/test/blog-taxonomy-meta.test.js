/**
 * #294 — the generated blog tag/category pages carry PER-TERM meta. They set
 * only pagination + permalink before, so all 300+ of a real blog's taxonomy
 * pages shipped the site's default title and description (duplicate-content
 * by the hundred). UJM's blog-taxonomy generator emitted
 * "<Term> - Blog Tags - <Brand>" plus a per-term description, and title-cased
 * the term it displayed.
 *
 * The same pages' heading order (#313): the masthead h1 is followed by the post
 * cards' h3s, so the grid needs its own h2 in between. The newsflash fork of
 * the blog index carries its own order (#318), pinned here on a real render.
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

test('a hyphenated term reads as WORDS on its page — title, h1, description (#457)', async () => {
  // The fixture's `growth-hacks` tag stands in for clockii's
  // `time-tracking-tools`: legacy UJM titleized the term (hyphens are word
  // breaks), OMEGA kept the corpus spelling and sentence-cased it, and every
  // migrating brand's taxonomy SEO titles drifted. The URL never moves.
  const all = await pages();
  const html = all.get('/blog/tags/growth-hacks');
  const { title, description } = head(html);

  assert.ok(html, `the tag page still lives at its slug: ${[...all.keys()].filter((url) => url.startsWith('/blog/tags')).join(', ')}`);
  assert.strictEqual(title, 'Growth Hacks - Blog Tags - MiniCo');
  assert.strictEqual(description, 'Browse all blog posts tagged with Growth Hacks.');
  assert.match(html, /<h1[^>]*>\s*Growth Hacks\s*</, 'the masthead h1 reads the same words');
});

test('every generated taxonomy page carries its OWN title', async () => {
  const all = await pages();
  const termPages = [...all.keys()].filter((url) => /^\/blog\/(tags|categories)\/./.test(url));
  const titles = termPages.map((url) => head(all.get(url)).title);

  assert.ok(termPages.length >= 3, `fixture generates term pages: ${termPages.join(', ')}`);
  assert.strictEqual(new Set(titles).size, titles.length, `no two term pages share a title: ${titles.join(' | ')}`);
});

/**
 * The heading levels a page shipped, in document order.
 * @param {string} html
 * @returns {Array<number>}
 */
function headingLevels(html) {
  return [...html.matchAll(/<h([1-6])\b/g)].map((match) => Number(match[1]));
}

test('a term page never skips from its h1 to the post cards\' h3 (#313)', async () => {
  const all = await pages();

  for (const url of ['/blog/tags/automation', '/blog/categories/marketing']) {
    const levels = headingLevels(all.get(url));

    assert.strictEqual(levels[0], 1, `${url} opens with its own h1`);
    assert.strictEqual(levels[1], 2, `${url} skips h1 → h${levels[1]}: the post cards' h3s need a parent level`);
  }

  // The cards are the SAME include the blog index renders, so the index's own
  // order (h1 masthead → the featured post's h2 → the card h3s) must not move.
  assert.deepStrictEqual(headingLevels(all.get('/blog')).slice(0, 3), [1, 2, 3], 'the blog index order is untouched');
});

test('a paginated blog index page never skips from its h1 to the card h3s (#315)', async () => {
  const all = await pages();
  const second = all.get('/blog/page/2');

  assert.ok(second, 'the mini corpus paginates past page 1');

  // Page 2 renders no featured post, so the grid's own h2 is the only thing
  // that can sit between the masthead h1 and the cards' h3s.
  const levels = headingLevels(second).slice(0, 9);
  assert.strictEqual(levels[0], 1, 'page 2 opens with the masthead h1');
  assert.strictEqual(levels[1], 2, `page 2 skips h1 → h${levels[1]}: the post cards' h3s need a parent level`);
  assert.deepStrictEqual(levels, [1, 2, 3, 3, 3, 3, 3, 3, 2], 'h1 → grid h2 → six card h3s → the newsletter band');

  // Page 1 leads with the featured post, which IS its h2 — it gains nothing.
  assert.deepStrictEqual(
    headingLevels(all.get('/blog')).slice(0, 8), [1, 2, 3, 3, 3, 3, 3, 2],
    'page 1 keeps exactly one h2 above its cards: the featured post',
  );
});

test('the newsflash blog index never skips a heading level, on any page (#318)', async () => {
  // Newsflash FORKS blog/index.html and renders a lead-story splash on every
  // page, so it never enters the no-featured state #315 gated on: its own
  // order needs its own pin. The lead headline is an `<h3 class="h1">` —
  // h1-sized by class, h3 by level — which reads like an h1 → h3 skip in the
  // template; the level above it lives in the `heading/rule-head` component,
  // so only a RENDER can say whether the outline actually steps.
  const all = await buildWith({ ...miniData, theme: { id: 'newsflash' } }, { activeTheme: 'newsflash' }, 'blog-taxonomy-meta-newsflash');

  for (const url of ['/blog', '/blog/page/2']) {
    const levels = headingLevels(all.get(url));

    assert.strictEqual(levels[0], 1, `${url} opens with the masthead h1`);
    assert.deepStrictEqual(
      levels.slice(0, 4), [1, 2, 3, 2],
      `${url}: h1 masthead → the "Lead story" band h2 → the lead headline h3 → the "More stories" band h2`,
    );

    // Every later heading too: a band that loses its head, anywhere down the
    // page, is the same defect one section lower.
    levels.forEach((level, index) => {
      if (index === 0) return;
      assert.ok(level <= levels[index - 1] + 1, `${url} skips h${levels[index - 1]} → h${level} at heading ${index + 1}: ${levels.join(',')}`);
    });
  }
});

test('the term heading is title-cased', async () => {
  const html = (await pages()).get('/blog/tags/automation');
  const h1 = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1];

  assert.ok(h1, 'the tag page renders an h1');
  assert.strictEqual(h1.trim(), 'Automation');
});
