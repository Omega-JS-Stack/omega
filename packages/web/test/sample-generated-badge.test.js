/**
 * The generated-content tell (#208): sample content renders on the real posts
 * lane and reads exactly like real writing, so it must SAY what it is.
 *  1. the marker: every generated sample document carries `generated: true`,
 *     added by the generator — never by a corpus file, so none can forget
 *  2. the badge: a dev build renders the TEST pill on the post page and on the
 *     blog listing rows (featured lead + grid cards), keyed off the
 *     frontmatter flag alone
 *  3. production: samples never inject there, so neither does the badge — the
 *     reason no environment check is needed in the templates
 *  4. the dates stay RECENT: the rolling anchor keeps a virgin blog looking
 *     alive, never months stale
 *  5. the SHAPE (#322): a chip-sized pill above the row's title, never a
 *     full-width row of its own
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const { buildSite, BARE } = require('./lib/build.js');
const { SAMPLE_SETS, generateSampleSet, resolveAnchor } = require('../src/sample-content.js');
const { PATHS } = require('../src/paths.js');

const bareData = JSON.parse(fs.readFileSync(path.join(BARE, 'site-data.json'), 'utf8'));

const DAY_MS = 24 * 60 * 60 * 1000;
const BADGE = 'omega-generated-badge';
const SHEET = path.join(__dirname, '..', 'core', 'css', 'core', '_generated-badge.scss');

/**
 * The post page's ARTICLE header — the block holding the `<h1>`, not the site
 * nav chrome (which is also a `<header>`, and comes first). A post page renders
 * related-post ROWS at the bottom carrying their own badges, so asserting "the
 * badge is somewhere in this HTML" passes even with the headline badge deleted
 * (it did); scoping to the article header is what gives the assertion teeth.
 * @param {string} html - a rendered post page
 * @returns {string}
 */
function postHeader(html) {
  for (let open = html.indexOf('<header'); open !== -1; open = html.indexOf('<header', open + 1)) {
    const close = html.indexOf('</header>', open);
    if (close === -1) break;
    const block = html.slice(open, close);
    if (block.includes('<h1')) return block;
  }
  throw new assert.AssertionError({ message: 'the post page renders no <header> carrying the headline' });
}

/**
 * The first listing ROW unit whose markup carries the badge — the block the
 * #322 placement claim is about (the badge above the row's title), scoped so
 * "somewhere on the page" cannot pass for it.
 * @param {string} html - a rendered listing page
 * @param {RegExp} open - matches the row unit's opening tag (global)
 * @param {string} end - the row unit's closing tag
 * @returns {string}
 */
function badgedRow(html, open, end) {
  for (const match of html.matchAll(open)) {
    const close = html.indexOf(end, match.index);
    if (close === -1) break;
    const block = html.slice(match.index, close);
    if (block.includes(BADGE)) return block;
  }
  throw new assert.AssertionError({ message: `no ${open} row carries the badge` });
}

/**
 * Every badge the page rendered must compose the shared chip: sizing has ONE
 * home (core/css/components), so a site that writes the badge class alone
 * would render an unsized pill.
 * @param {string} html - a rendered page
 * @param {string} label - what page this is, for the failure message
 */
function assertChipComposed(html, label) {
  const found = [...html.matchAll(new RegExp(`class="([^"]*\\b${BADGE}\\b[^"]*)"`, 'g'))];
  assert.ok(found.length, `${label} renders at least one badge`);
  for (const [, classes] of found) {
    assert.ok(classes.split(/\s+/).includes('omega-chip'), `${label}: the badge composes the chip ("${classes}")`);
  }
}

test('every generated sample document carries the generated marker', () => {
  const anchorMs = resolveAnchor('2026-07-18');

  for (const set of SAMPLE_SETS) {
    const files = generateSampleSet(PATHS.defaults, set, anchorMs);
    assert.ok(files.length, `${set.collectionDir} generates documents`);

    for (const file of files) {
      const frontmatter = file.content.slice(0, file.content.indexOf('\n---', 4));
      assert.match(frontmatter, /^generated: true$/m, `${set.collectionDir}/${file.name} is marked generated`);
    }
  }
});

test('the marker rides the generator, not the corpus files', () => {
  // A corpus file carrying it by hand would be a marker the NEXT authored
  // sample forgets. Nothing under defaults/sample-* declares it.
  for (const set of SAMPLE_SETS) {
    const dir = path.join(PATHS.defaults, set.samplesDir);
    for (const name of fs.readdirSync(dir).filter((file) => file.endsWith('.md'))) {
      const source = fs.readFileSync(path.join(dir, name), 'utf8');
      assert.doesNotMatch(source, /^generated:/m, `defaults/${set.samplesDir}/${name} does not hand-declare the marker`);
    }
  }
});

test('a development build badges the sample post page and every listing row', async () => {
  const pages = await buildSite(BARE, bareData, { environment: 'development' }, 'generated-badge-dev');

  // The post page
  const post = pages.get('/blog/welcome-to-the-blog');
  assert.ok(post, 'the sample post renders');
  assert.match(postHeader(post), new RegExp(`class="[^"]*${BADGE}[^"]*">TEST<`), 'the post headline wears the badge, and the pill reads TEST');

  // The listing: the featured lead AND the grid cards are separate markup, so
  // both are pinned — the featured slot is the one row that does not go
  // through post-card.html.
  const blogUrl = [...pages.keys()].find((url) => url === '/blog/' || url === '/blog');
  const blog = pages.get(blogUrl);
  const badges = blog.split(BADGE).length - 1;
  assert.ok(badges >= 2, `every listing row is badged (found ${badges})`);

  // A taxonomy page renders through the same shared card.
  const categoryUrl = [...pages.keys()].find((url) => url.startsWith('/blog/categories/') && url !== '/blog/categories');
  assert.ok(pages.get(categoryUrl).includes(BADGE), 'category listing rows are badged too');

  // The badge is styled off the status tokens, never a raw hex.
  const sheet = fs.readFileSync(path.join(__dirname, '..', 'core', 'css', 'core', '_generated-badge.scss'), 'utf8');
  assert.match(sheet, /var\(--omega-warn\)/, 'the pill reads from the warn token');
  // Declarations only — a `#208` issue reference in a comment is not a color.
  const declarations = sheet.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(declarations, /#[0-9a-fA-F]{3,8}\b/, 'no raw hex in the badge declarations — status tokens only');
});

test('#322: the badge is a chip-sized pill ABOVE the row title, never a full-width row', async () => {
  // Ian's QA: on a playground blog card the pill spanned the whole card under
  // the title. `.omega-post-card__body` is a flex COLUMN, so a badge dropped in
  // as a plain item stretches across the cross axis and eats a row — and it sat
  // under the title besides. The fix is structural, so it is pinned twice:
  // the sheet may never let a flex parent stretch it, and the row markup puts
  // it above the title.
  const sheet = fs.readFileSync(SHEET, 'utf8');
  const rule = sheet.match(/\.omega-generated-badge \{[^}]*\}/);
  assert.ok(rule, 'the badge rule still lives in core');
  assert.match(rule[0], /align-self: flex-start/, 'a flex column can never stretch the pill into a row');
  assert.doesNotMatch(rule[0], /font-size:|padding:|border-radius:/, 'sizing is the chip\'s — never a second copy that drifts');

  const pages = await buildSite(BARE, bareData, { environment: 'development' }, 'generated-badge-shape');

  // The shared card (blog grid, category and tag pages all render it).
  const categoryUrl = [...pages.keys()].find((url) => url.startsWith('/blog/categories/') && url !== '/blog/categories');
  const card = badgedRow(pages.get(categoryUrl), /<article class="omega-post-card"/g, '</article>');
  assert.ok(card.indexOf(BADGE) < card.indexOf('omega-post-card__title'), 'the card wears the pill ABOVE its title');
  assertChipComposed(card, 'the post card');

  // The featured lead is its own markup and gets the same treatment.
  const blogUrl = [...pages.keys()].find((url) => url === '/blog/' || url === '/blog');
  const blog = pages.get(blogUrl);
  const featured = badgedRow(blog, /<article class="omega-featured-post/g, '</article>');
  assert.ok(featured.indexOf(BADGE) < featured.indexOf('omega-featured-post__title'), 'the featured lead wears it above its title too');
  assertChipComposed(blog, 'the blog listing');
});

test('the newsflash fork renders the badge too — post page, lead splash, story rows', async () => {
  // The theme that forks blog/index.html + blog/post.html and renders rows
  // through its own story-card component: a real render, not just the static
  // sweep below, because this is the fork that shipped unbadged.
  const pages = await buildSite(BARE, { ...bareData, theme: { id: 'newsflash' } }, {
    environment: 'development',
    activeTheme: 'newsflash',
  }, 'generated-badge-newsflash');

  const post = pages.get('/blog/welcome-to-the-blog');
  assert.ok(post, 'the sample post renders under newsflash');
  assert.match(postHeader(post), new RegExp(`class="[^"]*${BADGE}[^"]*">TEST<`), 'the newsflash post headline wears the badge');

  const blogUrl = [...pages.keys()].find((url) => url === '/blog/' || url === '/blog');
  const blog = pages.get(blogUrl);
  const badges = blog.split(BADGE).length - 1;
  assert.ok(badges >= 2, `the lead splash and the story rows are badged (found ${badges})`);

  // #322: the same chip shape and above-the-title placement as the base rows —
  // this theme's story tile is a separate component, so it is pinned separately.
  assertChipComposed(blog, 'the newsflash listing');
  const story = badgedRow(blog, /<a href="[^"]*" class="newsflash-story-card"/g, '</a>');
  assert.ok(story.indexOf(BADGE) < story.indexOf('<h3'), 'the newsflash story row wears the pill above its headline');
});

test('every packaged theme that forks the blog markup carries the badge conditional', () => {
  // Core owns the badge's STYLE; the MARKUP is per-theme, so a skin that forks
  // blog/index.html, blog/post.html or the row unit can drop the warning
  // silently. This static sweep is what actually stops that — a future
  // packaged skin fails here the moment it ships unbadged templates.
  const themesDir = path.join(__dirname, '..', 'themes');
  const swept = [];

  for (const theme of fs.readdirSync(themesDir).filter((name) => !name.startsWith('_'))) {
    const forked = [
      path.join(themesDir, theme, '_layouts', 'frontend', 'pages', 'blog', 'post.html'),
      path.join(themesDir, theme, '_layouts', 'frontend', 'pages', 'blog', 'index.html'),
      // The row unit, whatever this theme calls it (base: a post-card
      // include; newsflash: a story-card component).
      ...['_includes', '_components'].flatMap((dir) => {
        const root = path.join(themesDir, theme, dir);
        if (!fs.existsSync(root)) return [];
        return fs.readdirSync(root, { recursive: true, withFileTypes: true })
          .filter((entry) => entry.isFile() && /(post|story)-card/.test(path.join(entry.parentPath, entry.name)) && entry.name.endsWith('.html'))
          .map((entry) => path.join(entry.parentPath, entry.name));
      }),
    ].filter((file) => fs.existsSync(file));

    for (const file of forked) {
      const relative = path.relative(themesDir, file);
      assert.match(fs.readFileSync(file, 'utf8'), /generated/, `themes/${relative} renders no generated-content badge — a forked blog template must carry it`);
      swept.push(relative);
    }
  }

  // The sweep must never silently pass on nothing found.
  assert.ok(swept.some((file) => file.startsWith('base/')), 'the base theme is swept');
  assert.ok(swept.some((file) => file.startsWith('newsflash/')), 'the newsflash theme is swept');
  assert.ok(swept.length >= 5, `every forked blog template is swept (${swept.length}: ${swept.join(', ')})`);
});

test('a production build ships neither the samples nor the badge', async () => {
  const pages = await buildSite(BARE, bareData, { environment: 'production' }, 'generated-badge-prod');

  assert.strictEqual(pages.get('/blog/welcome-to-the-blog'), undefined, 'samples never inject into production');

  for (const [url, html] of pages) {
    assert.ok(!html.includes(BADGE), `${url} carries no generated badge`);
  }
});

test('the rolling anchor keeps the corpus recent, never stale or future-dated', () => {
  // The anchor defaults to TODAY (the harness pins it via OMEGA_SAMPLE_ANCHOR
  // so fixture builds stay stable — cleared here to read the real default).
  const pinned = process.env.OMEGA_SAMPLE_ANCHOR;
  delete process.env.OMEGA_SAMPLE_ANCHOR;
  try {
    const now = new Date();
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    assert.strictEqual(resolveAnchor(), today, 'no anchor, no env pin → today');

    const postsSet = SAMPLE_SETS.find((set) => set.collectionDir === '_posts');
    const days = generateSampleSet(PATHS.defaults, postsSet, resolveAnchor())
      .map((file) => Date.parse(`${file.name.slice(0, 10)}T00:00:00Z`))
      .sort((a, b) => a - b);

    const newest = days[days.length - 1];
    const oldest = days[0];
    assert.ok(newest <= today, 'nothing is dated in the future');
    assert.ok((today - newest) / DAY_MS <= 14, `the newest sample is recent (${(today - newest) / DAY_MS} days old)`);
    assert.ok((today - oldest) / DAY_MS <= 240, 'even the oldest sample is within the last months, not years');
  } finally {
    if (pinned !== undefined) process.env.OMEGA_SAMPLE_ANCHOR = pinned;
  }
});
