/**
 * The auto-generated showcase + schema docs (cp219, spec §9) — builds the
 * mini fixture and pins the /test/sections surface: the index over
 * sectionLibrary.groups, per-entry pages (pagination + expression-named
 * tags), the docs display (raw tokens, escaped — never liquified), live demo
 * variants riding the data bridge, theme-honest resolution (overrides and
 * fallthroughs chip their owning layer), and the production gate that keeps
 * §7 PurgeCSS self-trimming meaningful.
 */
const assert = require('node:assert');
const { test } = require('node:test');

const { buildWith: sharedBuildWith, miniData } = require('./lib/build.js');

const buildWith = (siteData, overrides) => sharedBuildWith(siteData, overrides, 'showcase-test');
const nfData = { ...miniData, theme: { id: 'newsflash' } };

const showcaseUrls = (pages) => [...pages.keys()].filter((url) => url.startsWith('/test/sections')).sort();

test('cp219: the classy showcase — index + one page per resolved entry, docs from the schemas', async () => {
  const pages = await buildWith(miniData);

  // 12 classy entries + the index. A new section folder appears with zero
  // authoring — this count is the "new section → appears automatically" pin.
  assert.equal(showcaseUrls(pages).length, 18, 'index + 17 entry pages');

  const index = pages.get('/test/sections');
  assert.ok(index.includes('Section library'), 'index masthead');
  assert.ok(index.includes('/test/sections/section/marketing/hero'), 'entry cards link the per-entry pages');
  assert.ok(index.includes('/test/sections/component/heading/masthead'), 'components grouped alongside');

  const hero = pages.get('/test/sections/section/marketing/hero');
  assert.ok(hero.includes('<title>marketing/hero · Section library</title>'), 'pagination alias reaches the title through resolved.*');
  assert.ok(hero.includes('<code>rotating</code>'), 'args table renders schema rows');
  assert.ok(hero.includes('&#123;&#123; site.brand.name }}'), 'defaults display shows RAW tokens (escaped, never liquified)');
  assert.ok(!/Introducing \{\{/.test(hero), 'no unescaped liquid in the docs display');

  // Live demos: three hero variants render the real section
  assert.equal((hero.match(/class="classy-hero(?:"| )/g) || []).length, 3, 'all three demo variants render live');

  // Shared bands demo their generic copy; two faq instances coexist by dom_id
  const faq = pages.get('/test/sections/section/marketing/faq');
  assert.ok(faq.includes('demoFaqDuoAccordion') && faq.includes('demoFaqCenterAccordion'), 'variant dom_ids namespace the accordions');
  const sectionHead = pages.get('/test/sections/component/heading/section-head');
  assert.ok(sectionHead.includes('border rounded p-4 classy-section-head'), 'stage_class supplies the natural shell');

  // The dev-only surface stays out of the meta files
  assert.ok(!(pages.get('/sitemap.xml') || '').includes('/test/sections'), 'sitemap clean');
  assert.ok(!(pages.get('/pages.json') || '').includes('/test/sections'), 'pages.json clean');
});

test('cp219: the newsflash showcase — overrides and fallthroughs chip their owning layer', async () => {
  const pages = await buildWith(nfData);

  // 12 shared ids + 6 nf-only entries + the index
  assert.equal(showcaseUrls(pages).length, 24, 'index + 23 entry pages under newsflash');

  const cta = pages.get('/test/sections/section/marketing/cta');
  assert.ok(cta.includes('>newsflash<'), 'override entry chips its owning layer');
  assert.ok(cta.includes('cta-panel') && !cta.includes('classy-cta'), 'the demo renders the OVERRIDE (what a composing page gets)');
  assert.ok(cta.includes('data-icon="headset"'), 'icon keys render in the nf demo (the override\'s distinguishing feature)');

  const hero = pages.get('/test/sections/section/marketing/hero');
  assert.ok(hero.includes('>classy<'), 'fallthrough entry chips the base layer — the doctrine made visible');
  assert.ok(hero.includes('classy-hero'), 'fallthrough demo renders the classy base');

  const newsletter = pages.get('/test/sections/section/marketing/newsletter-cta');
  assert.ok(newsletter.includes('inherits js'), 'declared §7 inherit lane surfaces as a docs chip');
  assert.equal((newsletter.match(/data-omega-section="marketing\/newsletter-cta"/g) || []).length, 2, 'slab + rail variants both render §7 roots');
  assert.ok(newsletter.includes('id="demo-signup"'), 'rail anchor knob rides the demo');

  const byline = pages.get('/test/sections/component/news/byline');
  assert.ok(byline.includes('No demo data'), 'lookup-driven entries document args only');
});

test('cp219: production builds omit the showcase entirely (the §7 self-trim guarantee)', async () => {
  const pages = await buildWith(miniData, { environment: 'production' });
  assert.equal(showcaseUrls(pages).length, 0, 'no /test/sections pages in production output');
});
