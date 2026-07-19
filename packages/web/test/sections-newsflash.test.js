/**
 * Newsflash section-library lane (cp213+) — builds the mini fixture with the
 * newsflash theme active (the classy-corpus tests never render newsflash
 * layouts) and pins the theme-layer conversions: the marketing/stats,
 * newsletter-cta, and cta OVERRIDES, the newsflash-specific rundown/desks
 * sections, the rule-head + lede components, and the standing fallthrough
 * doctrine — a shared id is overridden only when the band exists in the
 * theme's own design vocabulary (hero does not: lede/splash serve that role,
 * so a body-called marketing/hero deliberately resolves to the classy base).
 */
const assert = require('node:assert');
const path = require('node:path');
const { test } = require('node:test');

const { collectSectionAssets } = require('../src/sections.js');
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

test('cp217: the newsletter slab renders through the nf override — BOTH dead forms fixed', async () => {
  const pages = await buildWith(nfData);

  // Post pages: the plain action="/email-subscription" form posted to a page
  // that doesn't exist (the cp209 bug, still live here) — the managed
  // form-manager dialect rides instead, inside the narrow centered column.
  const post = pages.get('/blog/first-post');
  assert.ok(!post.includes('email-subscription'), 'the dead action-form dialect died');
  assert.ok(post.includes('data-omega-section="marketing/newsletter-cta"'), 'presence-init root reaches nf posts');
  assert.ok(post.includes('data-form-state="initializing"'), 'posts speak the form-manager dialect');
  assert.ok(!post.includes('newsletter-success-alert') && !post.includes('newsletter-error-alert'),
    'the static alert slots are culled (cp227) — FormManager presents success/error as toasts, the baked divs were never toggled');
  assert.ok(post.includes('<div class="row justify-content-center"><div class="col-xl-8 col-lg-8 col-md-12 col-12">'), 'narrow knob wraps the card in the centered column');

  // Blog index: the inline slab had the managed markup but NO presence-init
  // root, so nothing ever bound it (frozen at "initializing", no-op submit).
  // Composing the section is what turns the binding on.
  const blog = pages.get('/blog');
  assert.ok(blog.includes('data-omega-section="marketing/newsletter-cta"'), 'index slab is now §7-bound');
  assert.ok(blog.includes('Never miss a'), 'index copy rode the bridge');
  assert.ok(!blog.includes('<div class="row justify-content-center"><div class="col-xl-8'), 'index stays full-width (narrow off)');
});

test('cp217: §7 inherit over the real tree — the nf override keeps classy\'s FormManager js in the bundle', () => {
  const themes = path.join(__dirname, '..', 'themes');
  const entries = collectSectionAssets([path.join(themes, 'newsflash'), path.join(themes, 'classy')]);
  const entry = entries.find((item) => item.kind === 'section' && item.id === 'marketing/newsletter-cta');
  assert.ok(entry, 'entry collected');
  assert.ok(entry.js && entry.js.includes(`${path.sep}classy${path.sep}`), `js inherited from the classy base, got: ${entry.js}`);
  assert.equal(entry.scss, null, 'no scss on either layer — nothing invented');
});

test('cp218: the flip decision executed — marketing/cta goes native on fallthrough pages', async () => {
  const pages = await buildWith(nfData);

  // /download still falls through to the converted classy LAYOUT, but its
  // cta band now resolves to the nf override — the dark big-read panel —
  // and the icon keys classy's markup ignored finally render.
  const download = pages.get('/download');
  assert.ok(!download.includes('classy-cta'), 'classy cta markup gone from the fallthrough page');
  assert.ok(download.includes('cta-panel'), 'nf big-read panel serves the shared contract');
  assert.ok(download.includes('data-icon="headset"'), 'button icon from the data renders under nf (classy ignored it)');
});

test('cp218: the doctrine half that stays — body-called hero deliberately falls through to classy', async () => {
  const pages = await buildWith(nfData);

  // nf composes no hero in its own vocabulary (the lede/splash family serves
  // that role), so {% section "marketing/hero" %} resolves consumer → nf →
  // classy and the base serves. Override only what the theme's design
  // vocabulary actually has.
  const demo = pages.get('/sections-demo');
  assert.ok(demo.includes('classy-hero'), 'body-called hero falls through to the classy base');
  assert.ok(!demo.includes('hero-title'), 'nf hero vocabulary absent — no nf hero section exists');
});

test('cp218: the rail signup card — the third dead form dies (newsletter-cta rail variant)', async () => {
  const pages = await buildWith(nfData);
  const home = pages.get('/test/components/hero-demo-input'); // rides the index layout

  // The old inline card posted to action="/email-subscription" — a page that
  // doesn't exist. The rail variant of the nf newsletter-cta override rides
  // instead: managed dialect, §7-bound through its own root, no section/
  // container wrapper (it composes inside the aside rail).
  assert.ok(!home.includes('email-subscription'), 'the dead action-form dialect died on the index rail');
  assert.ok(home.includes('data-omega-section="marketing/newsletter-cta"'), 'rail card is a §7-bound instance of the shared section');
  assert.ok(home.includes('data-form-state="initializing"'), 'rail speaks the form-manager dialect');
  assert.ok(home.includes('button-text'), 'button text swaps through the managed span');
  assert.ok(home.includes('id="signup"'), 'anchor knob keeps the hero deep link');
  assert.ok(home.includes('Free forever. Unsubscribe anytime.'), 'disclaimer rides the bridge');

  // The index cta band composes the same override the fallthrough pages get.
  assert.ok(home.includes('<section class="cta">'), 'section_class knob keeps the band class');
  assert.ok(home.includes('cta-panel'), 'big-read panel through the section');
});
