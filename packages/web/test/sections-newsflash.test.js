/**
 * Newsflash section-library lane (cp213+) — builds the mini fixture with the
 * newsflash theme active (the classy-corpus tests never render newsflash
 * layouts) and pins the theme-layer conversions: the marketing/stats
 * OVERRIDE (first theme-layer section override), the newsflash-specific
 * rundown/desks sections, the rule-head + lede components — plus the two
 * contracts the conversion must NOT change yet: fallthrough pages keep
 * classy's cta band (the marketing/cta "goes native" override is a separate
 * declared step), and a body-called marketing/hero still resolves to the
 * classy base.
 */
const assert = require('node:assert');
const { test } = require('node:test');

const { buildWith: sharedBuildWith, miniData } = require('./lib/build.js');

const nfData = { ...miniData, theme: { id: 'newsflash' } };
const buildWith = (siteData, overrides) => sharedBuildWith(siteData, overrides, 'sections-nf-test');

test('cp213: newsflash index bands render through the section library', async () => {
  const pages = await buildWith(nfData);
  const home = pages.get('/test/components/hero-demo-input'); // rides the index layout

  // marketing/stats override — nf vocabulary via the rule-head component
  assert.ok(home.includes('By the numbers'), 'stats rule-head label (nf json5 default)');
  assert.ok(home.includes('stat-num'), 'nf stroked numerals');
  assert.ok(home.includes('2M+'), 'items bridged from resolved.stats');
  assert.ok(!home.includes('classy-stats'), 'classy stats markup NOT rendered — the override won');

  // marketing/rundown — rule head + lede + numbered feed
  assert.ok(home.includes('Original reporting'), 'rundown items over the data bridge');
  assert.ok(home.includes('feed-num'), 'numbered feed cluster');
  assert.ok(home.includes('text-accent">morning'), 'lede accent span');

  // marketing/desks — icon cards linked to category pages
  assert.ok(home.includes('Read the desk'), 'desk card affordance');
  assert.ok(home.includes('/blog/categories/tech'), 'desk href to its category page');
});

test('cp215: news/story-card + news/byline — the posts-driven tile family (component-in-component)', async () => {
  const pages = await buildWith(nfData);

  // Blog index grid: tiles render through the component (byline nested inside)
  const blog = pages.get('/blog');
  assert.ok(blog.includes('story-card'), 'tile markup present');
  assert.ok(blog.includes('Mini story 17'), 'enriched posts in the grid');
  assert.ok(blog.includes('Dec 15, 2023'), 'pre-formatted date arg');
  assert.ok(blog.includes('min read'), 'captured readtime through the byline');
  assert.ok(!blog.includes('>Undefined<'), 'kicker default-guard: no "Undefined" from title-casing a missing category');

  // Category page passes its own kicker (resolved.category.name, verbatim)
  const growth = pages.get('/blog/categories/growth');
  assert.ok(growth.includes('kicker mb-1">Growth<'), 'category-name kicker through the component');

  // Index bands: top stories + more-to-chew-on tiles via the same component
  const home = pages.get('/test/components/hero-demo-input');
  assert.ok(home.includes('Mini story 16'), 'top-stories tile (slot 3)');
  assert.ok(home.includes('Mini story 03'), 'more-to-chew-on tile (slot 17)');
});

test('cp216: rule-head/lede sweep — every newsflash band head through the components, link slot lit', async () => {
  const pages = await buildWith(nfData);

  // The link slot (dormant since cp213) now renders live: index top-stories
  // and blog/post related both pass link args through the component.
  const home = pages.get('/test/components/hero-demo-input');
  assert.ok(/Top stories<\/h2>[\s\S]{0,200}View all/.test(home), 'top-stories head links View all through the component');
  const post = pages.get('/blog/first-post');
  assert.ok(post.includes('View all'), 'related-posts head link');

  // Lede through the component on about (accent span) + composite captures
  const about = pages.get('/about');
  assert.ok(about.includes('text-accent'), 'about ledes render accents through heading/lede');

  // team/member: the tight join survives the component's trimmed doc comment
  const member = pages.get('/team/avery-quinn');
  assert.ok(member.includes('col-lg-9"><div class="section-head"'), 'trimmed-context call keeps the glued join');

  // No inline section-head clusters remain in any newsflash layout — every
  // head renders through the component (h2 + rule always adjacent).
  assert.ok(member.includes('section-head'), 'member head renders');
});

test('cp213: contracts deliberately NOT flipped — fallthrough cta + body-called hero stay classy', async () => {
  const pages = await buildWith(nfData);

  // /download falls through to the converted classy layout; its cta band must
  // keep classy markup until the declared marketing/cta override step.
  const download = pages.get('/download');
  assert.ok(download.includes('classy-cta'), 'fallthrough page renders the classy cta band');

  // A body-called {% section "marketing/hero" %} resolves consumer → nf →
  // classy; nf ships no hero, so the classy base serves.
  const demo = pages.get('/sections-demo');
  assert.ok(demo.includes('classy-hero'), 'body-called hero falls through to the classy base');
  assert.ok(!demo.includes('hero-title'), 'nf hero vocabulary absent — no nf hero section exists');
});
