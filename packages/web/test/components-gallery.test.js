/**
 * The component gallery (#549, reshaped by #602) — and the /test page split
 * that made room for it.
 *
 * #549 moved the living styleguide off `/test/components` (it had taken the
 * name before components existed as a concept) and put the component library
 * there. #602 is Ian's correction to the SHAPE that landed: one page embedding
 * frames that lived under the SECTION url space read like a second view of
 * `/test/sections`, not a library of its own. So the component gallery MIRRORS
 * the section gallery — an index, one page per entry, frames beside it — in
 * its OWN url space, and `/test/sections/component/…` is gone.
 *
 * ONE generator serves both kinds: `defaults/showcase/entry.html` and
 * `defaults/showcase/frame.html` paginate the whole library and take their
 * permalink from the entry's own kind-aware url.
 *
 * The gallery rides `defaults/showcase/`, so production emits none of it; the
 * styleguide rides `defaults/pages/` and keeps the dev-page rules it always
 * had (noindex, sitemap-excluded, consumer-suppressible).
 */
const assert = require('node:assert');
const { test } = require('node:test');

const { buildWith: sharedBuildWith, miniData } = require('./lib/build.js');

const buildWith = (siteData, overrides) => sharedBuildWith(siteData, overrides, 'components-gallery-test');

test('#602: /test/components is the component INDEX — one row per entry, linking its own page', async () => {
  const pages = await buildWith(miniData);
  const index = pages.get('/test/components');

  assert.ok(index, 'the index page builds');

  // The shell: #540's fixed model, so the head clears the site masthead
  assert.match(index, /<main[^>]*>\s*<section[^>]*data-omega-showcase-shell/, 'the same top-level section shell the section gallery uses');
  assert.ok(index.includes('aria-label="Component library"'), 'the rail is its own nav landmark');

  // A listing, not a stack: the frames live on the entry pages now
  assert.ok(!index.includes('<iframe'), 'the index embeds nothing — that is what the entry pages are for');
  assert.ok(index.includes('href="/test/components/heading/masthead"'), 'each component links its own page');
  assert.ok(index.includes('href="/test/components/pricing/features"'), 'including the ones a section composes, not a page');

  // Components only, both here and in the section gallery
  assert.ok(!index.includes('/test/sections/section/marketing/hero'), 'no section entries on the component index');
  assert.ok(index.includes('/test/sections'), 'the section library is one click away');

  // Dev-only surface, like the rest of the gallery
  assert.ok(!(pages.get('/sitemap.xml') || '').includes('/test/components'), 'sitemap clean');
  assert.ok(!(pages.get('/pages.json') || '').includes('/test/components'), 'pages.json clean');
});

test('#602: /test/components/<id> is the entry page, with its frames beside it', async () => {
  const pages = await buildWith(miniData);
  const entry = pages.get('/test/components/heading/masthead');

  assert.ok(entry, 'each component has its own page');
  assert.match(entry, /<main[^>]*>\s*<section[^>]*data-omega-showcase-shell/, 'the same shell a section entry wears');
  assert.ok(entry.includes('aria-label="Component library"'), 'the rail is the COMPONENT library on a component page');
  assert.ok(entry.includes('href="/test/components/pricing/features"'), 'the rail links its siblings — no trip back to the index');
  assert.ok(!entry.includes('href="/test/sections/section/marketing/hero"'), 'and never a section: the rail is its own kind');

  // The frames are this entry's own, under its own url space
  assert.ok(entry.includes('src="/test/components/heading/masthead/frames/eyebrow-accent-sub"'), 'each iframe points at its own frame page');
  assert.ok(entry.includes('loading="lazy"') && entry.includes('data-omega-showcase-frame'), 'lazy, and autosized by the same hook');
  assert.ok(entry.includes('id="variant-eyebrow-accent-sub"'), 'the rail anchor lands on the variant, the entry-page prefix');

  const frame = pages.get('/test/components/heading/masthead/frames/eyebrow-accent-sub');
  assert.ok(frame, 'the frame page builds in the component url space');
  assert.ok(!frame.includes('data-omega-showcase-shell'), 'a frame is the entry alone — no gallery chrome');

  // The schema IS the docs here too
  const features = pages.get('/test/components/pricing/features');
  assert.ok(features.includes('<code>features</code>'), 'the args table renders from the entry\'s own json5');
  assert.ok(features.includes('&quot;definition&quot;: &quot;API requests per month.&quot;'), 'and its variant options show as a copyable block');
});

test('#602: the /test/sections/component/… url space is gone; the section gallery lists sections only', async () => {
  const pages = await buildWith(miniData);

  const strays = [...pages.keys()].filter((url) => url.startsWith('/test/sections/component'));
  assert.deepEqual(strays, [], 'no page is generated under the retired component url space');

  const index = pages.get('/test/sections');
  assert.ok(index.includes('/test/sections/section/marketing/hero'), 'sections still link their own pages');
  assert.ok(!index.includes('/test/components/heading/masthead'), 'a component entry is not listed on the section index');
  assert.ok(index.includes('/test/components'), 'the component library is one click away');

  const hero = pages.get('/test/sections/section/marketing/hero');
  assert.ok(hero, 'section entry pages are where they always were');
  assert.ok(hero.includes('src="/test/sections/section/marketing/hero/frames/email-capture"'), 'and so are their frames');
  assert.ok(!hero.includes('/test/components/heading/masthead'), 'a section rail carries no components either');
});

test('#549: the styleguide moved to /test/styleguide, whole', async () => {
  const pages = await buildWith(miniData);
  const styleguide = pages.get('/test/styleguide');
  const gallery = pages.get('/test/components');

  assert.ok(styleguide, 'the styleguide builds at its own url');
  assert.ok(styleguide.includes('<title>Styleguide</title>'), 'and says what it is');
  assert.ok(styleguide.includes('--omega-ground'), 'the token sheet came with it');
  assert.ok(styleguide.includes('id="typography"') && styleguide.includes('id="motion"'), 'so did every section of it');
  assert.ok(styleguide.includes('<meta name="robots" content="noindex"/>'), 'still noindex, like every /test page');
  assert.ok(!(pages.get('/sitemap.xml') || '').includes('/test/styleguide'), 'still sitemap-excluded');

  // The name is not shared: the gallery is not the styleguide wearing a rail
  assert.ok(!gallery.includes('id="typography"'), '/test/components is no longer the styleguide');
});

test('#549: production ships neither the component gallery nor the styleguide (#554)', async () => {
  const pages = await buildWith(miniData, { environment: 'production' });

  assert.ok(!pages.get('/test/components'), 'the gallery rides the dev-only showcase lane');
  assert.deepEqual([...pages.keys()].filter((url) => url.startsWith('/test/components')), [], 'entry pages and frames with it');
  // #554 moved the styleguide with it: /test/* is development-only, whole.
  assert.ok(!pages.get('/test/styleguide'), 'and the styleguide is a dev surface too now');
});
