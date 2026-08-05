/**
 * C4 cp105 (reshaped at ads step 5) — advertising is role-keyed config,
 * zero ITW hardcodes.
 *
 * Two halves: the packaged sources speak `advertising.providers.*` with no
 * baked-in ITW ad-server values (blog [slug].js gates on config presence and
 * delegates to the shared client verts module), and the engine renders the
 * verts/unit section from CONFIG-FREE markup — client ids and slots never
 * reach the page; the client module reads them at mount.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const { buildWith: sharedBuildWith, miniData, PKG } = require('./lib/build.js');

// Namespace this file's Eleventy output dirs (test files run concurrently)
const buildWith = (siteData, overrides) => sharedBuildWith(siteData, overrides, 'verts-test');

// ─── Source guards ───────────────────────────────────────────────────────────

test('blog [slug].js rides the modern verts lane — config-gated, module-delegated', () => {
  const slug = fs.readFileSync(path.join(PKG, 'core', 'js', 'pages', 'blog', '[slug].js'), 'utf8');

  assert.ok(!slug.includes('itwcreativeworks'), 'no ITW ad-server hostname baked in');
  assert.ok(!slug.includes('vert.bundle'), 'no legacy vert bundle reference');
  assert.ok(slug.includes('omega.config?.advertising'), 'advertising key presence gates insertion');
  assert.ok(slug.includes('data-omega-vert'), 'inserted hosts speak the modern vocabulary');
  assert.ok(slug.includes('omega.verts().mount'), 'delegates the lifecycle to the shared client verts module');
  assert.ok(slug.includes('[data-omega-verts="false"]'), 'the per-post opt-out stops the mid-article lane too');
});

test('the verts test page carries a per-slot reload that tears the unit down first', () => {
  const page = fs.readFileSync(path.join(PKG, 'core', 'js', 'pages', 'test', 'libraries', 'verts', 'index.js'), 'utf8');

  assert.ok(page.includes('.omega-vert-unit'), 'every demo slot gets the control');
  assert.ok(page.includes('unit.destroy()'), 'the live unit is destroyed, not just orphaned');
  assert.ok(page.includes('__omegaVertMounted = false'), 'the mount latch clears so the element re-mounts');
  assert.ok(page.includes('omega.verts().mount'), 're-init runs through the public verts API');
});

test('packaged content speaks advertising.providers.* only', () => {
  const files = [
    ['core/_includes/core/head.html', 'advertising.providers.adsense.client'],
  ];

  for (const [relative, marker] of files) {
    const contents = fs.readFileSync(path.join(PKG, relative), 'utf8');
    assert.ok(contents.includes(marker), `${relative} reads the providers path`);
    assert.ok(!/advertising\.google-adsense|advertising\?\.\['google-adsense'\]/.test(contents), `${relative} has no pre-providers spelling`);
    // #23/#35: the vendor prefix and the kebab slot keys are gone for good
    assert.ok(!contents.includes('google-adsense'), `${relative} has no vendor-prefixed provider id`);
    assert.ok(!/(display|in-article|in-feed|multiplex)-slot/.test(contents), `${relative} has no kebab-case slot key`);
  }
});

// ─── Engine channel ──────────────────────────────────────────────────────────

const ADVERTISING = {
  providers: {
    adsense: {
      client: 'ca-pub-TEST123',
      inArticleSlot: '9990001',
    },
    inhouse: { source: 'self' },
  },
};

test('configured advertising: the verts/unit section renders its host — values stay in config', async () => {
  const pages = await buildWith({ ...miniData, advertising: ADVERTISING });
  const html = pages.get('/vert');

  assert.ok(html.includes('data-omega-vert="in-article"'), 'section host renders with the type');
  // The id/slot reach the page ONLY through the baked window.Configuration
  // (the channel the client verts module reads) — never as legacy unit markup
  assert.ok(!html.includes('data-ad-client'), 'no legacy data-ad-* unit markup');
  assert.ok(!html.includes('vert.bundle'), 'no legacy vert bundle script');
});

test('no advertising config: a HAND-AUTHORED unit still renders — the author asked for it', async () => {
  const pages = await buildWith(miniData);
  const html = pages.get('/vert');

  assert.ok(html.includes('id="vert-page"'), 'page itself renders');
  assert.ok(html.includes('data-omega-vert="in-article"'), 'the host still renders (the module no-fills without config)');
  assert.ok(!html.includes('data-ad-client'), 'no legacy ad unit markup');
});

// ─── Placement (#44 item 24) ────────────────────────────────────────────────
//
// AUTO placements — the ones a page never asked for (blog posts, the blog
// feed, the dashboard rail) — are gated by the `advertising` key: no config,
// no markup at all. A post opts out for itself with `verts: false`, which also
// travels to the mid-article JS insertion lane through data-omega-verts.

test('blog post: the in-article unit lands only when advertising is configured', async () => {
  const on = await buildWith({ ...miniData, advertising: ADVERTISING }, {}, 'verts-post-on');
  const post = on.get('/blog/first-post');

  assert.ok(post.includes('data-omega-vert="in-article"'), 'configured brand gets the in-article unit');
  assert.ok(!post.includes('data-omega-verts="false"'), 'the article is not marked opted-out');

  const off = await buildWith(miniData, {}, 'verts-post-off');
  const bare = off.get('/blog/first-post');

  assert.ok(bare.includes('blog-post-content'), 'the post itself still renders');
  assert.ok(!bare.includes('data-omega-vert='), 'unconfigured brand emits zero vert markup');
  assert.ok(bare.includes('data-omega-verts="false"'), 'the article tells the JS lane to stay out too');
});

test('blog post: `verts: false` frontmatter opts one post out of both lanes', async () => {
  const pages = await buildWith({ ...miniData, advertising: ADVERTISING }, {}, 'verts-post-optout');
  const post = pages.get('/blog/second-post');

  assert.ok(post.includes('blog-post-content'), 'the opted-out post renders');
  assert.ok(!post.includes('data-omega-vert='), 'no template unit');
  assert.ok(post.includes('data-omega-verts="false"'), 'the JS insertion lane is told to skip this article');
});

test('blog feed: the in-feed unit is gated by the same key', async () => {
  const on = await buildWith({ ...miniData, advertising: ADVERTISING }, {}, 'verts-feed-on');
  assert.ok(on.get('/blog').includes('data-omega-vert="in-feed"'), 'configured brand gets the feed unit');

  const off = await buildWith(miniData, {}, 'verts-feed-off');
  assert.ok(!off.get('/blog').includes('data-omega-vert='), 'unconfigured brand emits none');
});

test('dashboard rail: the sidebar vert slot rides the app shell, config-gated', async () => {
  const on = await buildWith({ ...miniData, advertising: ADVERTISING }, {}, 'verts-rail-on');
  const app = on.get('/app');

  assert.ok(app.includes('omega-side__ad'), 'the rail slot renders on the user app surface');
  assert.ok(app.includes('data-omega-vert="in-article"'), 'the slot carries a unit');
  assert.ok(app.includes('data-omega-vert-size="rectangle"'), 'sized for the rail');
  assert.ok(app.includes('Remove with'), 'the upsell rides along for non-paying users');

  // Staff never see verts: the admin sidebar data carries no bottom slot
  assert.ok(!on.get('/admin').includes('omega-side__ad'), 'admin rail carries no vert slot');

  const off = await buildWith(miniData, {}, 'verts-rail-off');
  assert.ok(!off.get('/app').includes('omega-side__ad'), 'no advertising config, no slot chrome');
  assert.ok(!off.get('/app').includes('data-omega-vert='), 'and no unit');
});

test('newsflash mirrors the placement contract on its own post layout', async () => {
  const nfData = { ...miniData, theme: { id: 'newsflash' } };

  const on = await buildWith({ ...nfData, advertising: ADVERTISING }, {}, 'verts-nf-on');
  assert.ok(on.get('/blog/first-post').includes('data-omega-vert="in-article"'), 'nf post carries the unit when configured');
  assert.ok(!on.get('/blog/second-post').includes('data-omega-vert='), 'nf honors the per-post opt-out');

  const off = await buildWith(nfData, {}, 'verts-nf-off');
  assert.ok(!off.get('/blog/first-post').includes('data-omega-vert='), 'nf post emits nothing without config');
});

// ─── The visual-QA page (#44 item 25) ───────────────────────────────────────

test('/test/libraries/verts shows every format and size preset, config state labeled', async () => {
  const pages = await buildWith({ ...miniData, advertising: ADVERTISING }, {}, 'verts-testpage');
  const html = pages.get('/test/libraries/verts');

  for (const type of ['display', 'in-article', 'in-feed', 'multiplex', 'house']) {
    assert.ok(html.includes(`data-omega-vert="${type}"`), `${type} unit on the page`);
  }
  for (const size of ['leaderboard', 'banner', 'rectangle', 'large-rectangle', 'skyscraper', '320']) {
    assert.ok(html.includes(`data-omega-vert-size="${size}"`), `${size} preset on the page`);
  }

  // The tag that produced each slot is printed beside it (raw, never rendered)
  assert.ok(html.includes('&#123;% section "verts/unit", type: "display" %&#125;'), 'labels show the literal tag (entity-escaped so it never re-renders)');
  assert.ok(html.includes('ca-pub-TEST123'), 'the config state is spelled out for QA');

  // The narrow sidebar rail: a skyscraper slot in a real 264px column (the app
  // shell sidebar width), where the card stacks instead of running as a media row
  assert.ok(html.includes('width: 264px'), 'the rail demo is a real narrow column');
  assert.ok(html.includes('Narrow rail'), 'the rail demo is labeled like the other examples');

  // Dev-only: the /test tree stays out of the index
  assert.ok(html.includes('noindex'), 'noindex like the rest of /test');

  const off = await buildWith(miniData, {}, 'verts-testpage-off');
  const bare = off.get('/test/libraries/verts');
  assert.ok(bare.includes('data-omega-vert="display"'), 'hand-authored units still render unconfigured (the terminal promo lane is the point)');
  assert.ok(bare.includes('no <code>advertising</code> key'), 'the page says so');
});
