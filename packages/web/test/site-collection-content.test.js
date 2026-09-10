/**
 * `site.<collection>` docs carry the document's REAL body (#711).
 *
 * The engine flattened collection documents twice: `jekyllDoc` (lazy
 * non-enumerable `content`, feeding `paginator.posts` — #598) and a second,
 * content-less literal at the `site.<name>` push. Every layout that reads a
 * post's body off `site.posts` therefore counted an empty string: the
 * newsflash homepage prints the readtime of its cover story and of every
 * story tile from `featured.content` / `post.content`, and printed
 * "1 min read" for all of them while the post's own page printed the truth.
 *
 * Two things are proven here, and the second is the reason the first is
 * allowed to exist:
 *  1. a `site.posts` loop reads the post's rendered body at RENDER time
 *  2. the premature-templateContent hazard `jekyllDoc`'s docstring names is
 *     NOT triggered by publishing that getter on the site arrays — the site
 *     object is captured into the data cascade at data-init, so a getter that
 *     read eagerly (or enumerably) would throw Eleventy's premature-use error
 *     on every `resolved` walk. A green build of a fixture whose pages loop
 *     `site.posts` IS that proof.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test, before, after } = require('node:test');

const { buildSite, miniData, MINI, PKG } = require('./lib/build.js');

// Inside the package, not os.tmpdir: Eleventy matches its ignores against
// CWD-relative paths, and a `../../var/folders/…` fixture makes the
// `**/_layouts/**` ignore miss the mini theme's layouts (engine.js).
const CONSUMER = path.join(PKG, '.omega', 'site-collection-content-src');

// A body long enough that its readtime cannot be the tag's own "no content"
// answer: omega_readtime is 269 wpm with a floor of 1, so ~1,200 words is a
// several-minute post no matter how the paragraphs tokenize.
const LONG_BODY = Array.from({ length: 120 }, (_, i) => (
  `Section ${i} alpha bravo charlie delta echo foxtrot golf hotel india juliet.`
)).join('\n\n');

const nfData = { ...miniData, theme: { id: 'newsflash' } };

let pages;

before(async () => {
  fs.rmSync(CONSUMER, { recursive: true, force: true });
  fs.cpSync(MINI, CONSUMER, { recursive: true });

  // The newest post, so it lands in the homepage's cover-story slot.
  fs.mkdirSync(path.join(CONSUMER, '_posts', '2025'), { recursive: true });
  fs.writeFileSync(path.join(CONSUMER, '_posts', '2025', '2025-06-01-the-long-read.md'), [
    '---',
    'layout: blueprint/blog/post',
    'post:',
    '  title: "The long read"',
    '  description: "A post nobody finishes in a minute"',
    '  author: jane doe',
    '  id: 1000042',
    '  tags: ["automation"]',
    '  categories: ["Growth"]',
    '---',
    '',
    LONG_BODY,
    '',
  ].join('\n'));

  // The direct probe: a page that iterates site.posts and reads each doc's
  // body at render time, exactly like a migrating UJM consumer's loop.
  fs.writeFileSync(path.join(CONSUMER, 'pages', 'site-posts-probe.html'), [
    '---',
    'layout: frontend/core/base',
    'permalink: /site-posts-probe',
    '---',
    '{%- for post in site.posts -%}',
    '<span data-post="{{ post.url }}" data-len="{{ post.content | size }}" data-rt="{% omega_readtime post.content %}"></span>',
    '{%- endfor -%}',
    '',
  ].join('\n'));

  pages = await buildSite(CONSUMER, nfData, {}, 'site-collection-content');
});

after(() => {
  fs.rmSync(CONSUMER, { recursive: true, force: true });
});

/** Every probed post: url → { len, rt }. */
function probed() {
  const html = pages.get('/site-posts-probe');
  assert.ok(html, 'the probe page built');
  const found = {};
  for (const m of html.matchAll(/<span data-post="([^"]*)" data-len="(\d+)" data-rt="(\d+)"><\/span>/g)) {
    found[m[1]] = { len: Number(m[2]), rt: Number(m[3]) };
  }
  return found;
}

test('#711: a site.posts loop reads each post\'s rendered body at render time', () => {
  const docs = probed();
  const urls = Object.keys(docs);

  assert.ok(urls.length >= 18, `the fixture's posts all reach site.posts (got ${urls.length})`);
  const empty = urls.filter((url) => docs[url].len === 0);
  assert.deepStrictEqual(empty, [], 'no site.posts doc carries an empty body');

  // The rendered body, not the raw source: the markdown ran.
  const long = docs['/blog/the-long-read'];
  assert.ok(long, `the long post is in site.posts: ${urls.join(', ')}`);
  assert.ok(long.len > 1000, `the long post's body is real (${long.len} chars)`);
});

test('#711: the newsflash homepage cover story prints the post\'s OWN readtime, not "1 min read"', () => {
  // The four homepage slots (cover story, top stories, the desk feed, more
  // stories) all capture `{% omega_readtime post.content %}` off site.posts.
  const home = pages.get('/about'); // the fixture page that rides the index layout
  assert.ok(home, 'the homepage layout rendered');

  const post = pages.get('/blog/the-long-read');
  assert.ok(post, 'the post page built');
  const truth = Number((post.match(/<span class="badge bg-primary">(\d+) min read<\/span>/) || [])[1]);
  assert.ok(truth > 1, `the post's own page counts a multi-minute read (got ${truth})`);

  const cover = home.match(/newsflash-hero__art[\s\S]*?<h2 class="h4 mb-1">The long read<\/h2>[\s\S]*?· (\d+) min read/);
  assert.ok(cover, 'the cover story slot renders the long post with a byline');
  assert.strictEqual(Number(cover[1]), truth, 'the card and the post agree — one body, one count');
});

test('#711: every posts-driven tile on the homepage counts a real body', () => {
  const home = pages.get('/about');
  const tiles = [...home.matchAll(/· (\d+) min read/g)].map((m) => Number(m[1]));

  assert.ok(tiles.length >= 4, `the homepage renders its posts-driven bands (${tiles.length} bylines)`);
  // The mini posts are genuinely one-minute reads; the long one is not, so a
  // homepage where every byline says 1 is the content-less flattener.
  assert.ok(tiles.some((rt) => rt > 1), `not every byline is the no-content answer: ${tiles.join(', ')}`);
});
