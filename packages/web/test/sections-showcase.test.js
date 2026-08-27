/**
 * The auto-generated showcase + schema docs (cp219, spec §9) — builds the
 * mini fixture and pins the /test/sections surface: the index over
 * sectionLibrary.groups, per-entry pages (pagination + expression-named
 * tags), the docs display (raw tokens, escaped — never liquified), the
 * per-variant EMBEDDED FRAME pages the entry pages iframe in (#463: one page
 * per demo variant, riding the data bridge), theme-honest resolution
 * (overrides and fallthroughs chip their owning layer), and the production
 * gate that keeps §7 PurgeCSS self-trimming meaningful.
 */
const assert = require('node:assert');
const { test } = require('node:test');

const { buildWith: sharedBuildWith, miniData } = require('./lib/build.js');

const buildWith = (siteData, overrides) => sharedBuildWith(siteData, overrides, 'showcase-test');
const nfData = { ...miniData, theme: { id: 'newsflash' } };

// BOTH gallery url spaces (#602): the showcase is two mirrored libraries now,
// and every count below is the whole surface.
const showcaseUrls = (pages) => [...pages.keys()]
  .filter((url) => url.startsWith('/test/sections') || url.startsWith('/test/components'))
  .sort();
const entryUrls = (pages) => showcaseUrls(pages).filter((url) => !url.includes('/frames/'));
const frameUrls = (pages) => showcaseUrls(pages).filter((url) => url.includes('/frames/'));

// The page-baked client config, as the browser reads it: both overlays gate on
// it (`consent` → main.js's conditional walk, `inbound.chat…` → the client's
// chatsy init), so this IS what decides whether either one mounts.
const configOf = (html) => new Function(`return ${html.match(/var Configuration = (\{[\s\S]*?\n {2}\});/)[1]};`)();

test('cp219: the classy showcase — index + one page per resolved entry, docs from the schemas', async () => {
  const pages = await buildWith(miniData);

  // Classy entries + the index. A new section folder appears with zero
  // authoring — this count is the "new section → appears automatically" pin
  // (+2 declared adds: verts/unit cp246, data/org-chart #72; +3 more:
  // marketing/prose #515, marketing/pricing-cards #493, pricing/features #539).
  assert.equal(entryUrls(pages).length, 24, 'two indexes (#602) + 22 entry pages');
  // …and one embedded-frame page per demo variant (#463), on the same lane.
  assert.equal(frameUrls(pages).length, 47, 'one frame page per demo variant of the resolved library');

  const index = pages.get('/test/sections');
  assert.ok(index.includes('Section library'), 'index masthead');
  assert.ok(index.includes('/test/sections/section/marketing/hero'), 'entry cards link the per-entry pages');
  assert.ok(!index.includes('/test/components/heading/masthead'), 'components have their own library now (#602) — this one lists sections');

  const hero = pages.get('/test/sections/section/marketing/hero');
  assert.ok(hero.includes('<title>marketing/hero · Section library</title>'), 'pagination alias reaches the title through resolved.*');
  assert.ok(hero.includes('<code>rotating</code>'), 'args table renders schema rows');
  assert.ok(hero.includes('&#123;&#123; resolved.config.brand.name }}'), 'defaults display shows RAW tokens (escaped, never liquified)');
  assert.ok(!/Introducing \{\{/.test(hero), 'no unescaped liquid in the docs display');

  // #463: the entry page EMBEDS its variants — the section itself renders in
  // the frame, never inline beside the docs.
  assert.ok(!hero.includes('class="omega-hero'), 'no inline section render on the entry page');
  assert.equal((hero.match(/<iframe/g) || []).length, 11, 'one lazy iframe per demo variant');
  assert.ok(hero.includes('src="/test/sections/section/marketing/hero/frames/email-capture"'), 'each iframe points at its own frame page');
  assert.ok(hero.includes('loading="lazy"') && hero.includes('title="Email capture"'), 'lazy, and titled by the variant label');
  assert.ok(hero.includes('&quot;subtext&quot;: &quot;No credit card required&quot;'), 'the variant\'s authored args show as a copyable block');

  // The frames themselves: the real section, chrome-less, in its own document
  const frame = pages.get('/test/sections/section/marketing/hero/frames/email-capture');
  assert.ok(frame.includes('<title>Email capture · marketing/hero · Section library</title>'), 'the variant alias reaches the title through resolved.*');
  assert.ok(frame.includes('class="omega-hero'), 'the section renders live in its frame');
  assert.ok(frame.includes('/assets/css/main-TEST.css') && frame.includes('/assets/js/main-TEST.js'), 'with the theme\'s real asset bundles');
  assert.ok(!frame.includes('<header') && !frame.includes('<footer'), 'and no site chrome — the gallery page owns that');

  // Shared bands demo their generic copy; two faq instances coexist by dom_id
  const faqDuo = pages.get('/test/sections/section/marketing/faq/frames/duo-layout');
  const faqCentered = pages.get('/test/sections/section/marketing/faq/frames/centered');
  assert.ok(faqDuo.includes('demoFaqDuoAccordion') && faqCentered.includes('demoFaqCenterAccordion'), 'variant dom_ids namespace the accordions');
  const sectionHead = pages.get('/test/components/heading/section-head/frames/full-cluster');
  assert.ok(sectionHead.includes('border rounded p-4 omega-section-head'), 'stage_class supplies the natural shell');

  // The dev-only surface stays out of the meta files
  assert.ok(!(pages.get('/sitemap.xml') || '').includes('/test/sections'), 'sitemap clean');
  assert.ok(!(pages.get('/pages.json') || '').includes('/test/sections'), 'pages.json clean');
});

/**
 * #540 — Ian's QA veto (2026-08-24), settled at the PM QA pass. Both gallery
 * pages are sidebar + content; the entry page shows EVERY variant STACKED,
 * one frame each, and the rail's variant links are plain anchor jumps to
 * those frames (his pick: stacked scans faster than a tab). The two other
 * fixes from the same screenshot: the gallery chrome no longer collides with
 * the site masthead (the shell is a top-level <section>, so it takes the
 * theme's own nav clearance), and the "← Section library" link reaches the
 * gallery index. Layout only — the embedded-frame model, the autosizing and
 * the frame URLs are #463's, untouched.
 */
test('#540: an entry page is a navigation rail plus every variant, stacked', async () => {
  const pages = await buildWith(miniData);
  const hero = pages.get('/test/sections/section/marketing/hero');

  // The rail: the whole library, this entry marked, its variants under it
  assert.ok(hero.includes('aria-label="Section library"'), 'the rail is a nav landmark');
  assert.ok(hero.includes('/test/sections/section/marketing/faq'), 'a sibling entry is one click away — no trip back to the index');
  assert.ok(hero.includes('aria-current="page"'), 'the entry being shown is marked in the rail');

  // The rail's variant links are ANCHOR JUMPS — no tab machinery, no reload
  assert.ok(hero.includes('href="#variant-email-capture"'), 'each demo variant is a rail anchor');
  assert.ok(!hero.includes('data-omega-showcase-nav'), 'the tab/selection hook is gone — the rail is plain anchors now');

  // The pane: every panel present and visible, each holding its frame + options
  assert.equal((hero.match(/data-omega-showcase-variant="/g) || []).length, 11, 'one panel per variant, all of them');
  assert.ok(!/<section [^>]*data-omega-showcase-variant[^>]*hidden/.test(hero), 'nothing starts hidden — the whole stack renders');
  assert.ok(hero.includes('id="variant-email-capture"'), 'the rail anchor lands on its own panel');
  assert.ok(hero.includes('&quot;subtext&quot;: &quot;No credit card required&quot;'), 'the variant\'s options ride with it');
  assert.ok(hero.indexOf('aria-label="Section library"') < hero.indexOf('id="variant-default"'), 'rail first, content after — left and right of one row');
  assert.ok(!hero.includes('card h-100'), 'and nothing is a stacked card any more');

  // The args table is on the right too, under the frames
  assert.ok(hero.indexOf('id="variant-default"') < hero.indexOf('<code>rotating</code>'), 'the args reference sits under the frames in the same pane');

  // #463's plumbing, untouched
  assert.equal((hero.match(/<iframe/g) || []).length, 11, 'one lazy iframe per demo variant, as built');
  assert.ok(hero.includes('src="/test/sections/section/marketing/hero/frames/email-capture"'), 'the frame urls are unchanged');
  assert.ok(hero.includes('data-omega-showcase-frame'), 'the autosizing hook rides through');
});

test('#540: the gallery chrome clears the site masthead, and the back link reaches the index', async () => {
  const pages = await buildWith(miniData);
  const hero = pages.get('/test/sections/section/marketing/hero');
  const index = pages.get('/test/sections');

  // The masthead collision (Ian's screenshot): the shell is the page's FIRST
  // top-level <section>, which is the element every theme's nav clearance
  // targets — a bare <div> took none and slid under the fixed nav.
  for (const [label, page] of [['entry', hero], ['index', index]]) {
    assert.match(page, /<main[^>]*>\s*<section[^>]*data-omega-showcase-shell/, `${label}: the shell opens main as a section, so it takes the theme's nav clearance`);
  }

  // The dead back link: it points at the index, and the index is a page that
  // this very build produced.
  assert.match(hero, /<a href="\/test\/sections"[^>]*>&larr; Section library<\/a>/, 'the back link addresses the gallery index');
  assert.ok(index, 'and that URL is a page this build wrote');

  // The index itself: same rail, still no cards, nothing current
  assert.ok(index.includes('aria-label="Section library"'), 'the index carries the same rail');
  assert.ok(!index.includes('card h-100'), 'the stacked entry cards are gone');
  assert.ok(index.includes('/test/sections/section/marketing/hero'), 'every entry is still one click away');
  assert.ok(!index.includes('aria-current="page"'), 'no entry is current on the index itself');
});

/**
 * #555 — the frames carry no OVERLAY chrome either. The gallery stacks a frame
 * per variant, and each one used to boot the full client overlay: the cookie
 * banner and the chatsy widget, multiplied by every variant on the page. The
 * frame page turns both off the same way it already turns off nav and footer —
 * in its own frontmatter, so the config the frame bakes never switches them on.
 * ONE home covers both galleries: the frame page is the same generator for
 * both kinds (#602), so a component frame bakes the same switches.
 */
test('#555: a variant frame boots without the consent banner or the chat widget', async () => {
  // A brand with both overlays ON — the only state where the bug is visible.
  const overlayData = {
    ...miniData,
    client: { consent: { enabled: true } },
    inbound: { chat: { providers: { chatsy: { enabled: true, agentId: 'agent-mini', settings: {} } } } },
  };
  const pages = await buildWith(overlayData);

  const frame = configOf(pages.get('/test/sections/section/marketing/hero/frames/default'));
  assert.equal(frame.consent.enabled, false, 'the frame bakes the consent gate off, so main.js never loads the banner');
  assert.equal(frame.inbound.chat.providers.chatsy.enabled, false, 'and the chat widget off, so the client never mounts chatsy');

  // Every variant frame, not just the one — and the component gallery's frames
  // are these same documents, so both galleries are covered by one fix.
  for (const url of frameUrls(pages)) {
    const config = configOf(pages.get(url));
    assert.ok(!config.consent.enabled && !config.inbound.chat.providers.chatsy.enabled, `${url}: no overlay chrome in any frame`);
  }
  assert.ok(pages.get('/test/components/heading/masthead').includes('src="/test/components/heading/masthead/frames/eyebrow-accent-sub"'), 'the component gallery\'s entry pages carry frames of their own, on the same lane');

  // …and a NORMAL render is untouched: both overlays still ship, hints included.
  const home = pages.get('/');
  assert.equal(configOf(home).consent.enabled, true, 'a real page still ships the consent banner');
  assert.equal(configOf(home).inbound.chat.providers.chatsy.enabled, true, 'and still mounts the chat widget');
  assert.ok(home.includes('chatsy.ai') && !pages.get('/test/sections/section/marketing/hero/frames/default').includes('chatsy.ai'), 'the chat preconnect hints ride the page, not the frame');

  // The gallery PAGE around the frames is a page like any other.
  assert.equal(configOf(pages.get('/test/sections/section/marketing/hero')).consent.enabled, true, 'the gallery page itself is not a frame');
});

test('cp219: the newsflash showcase — overrides and fallthroughs chip their owning layer', async () => {
  const pages = await buildWith(nfData);

  // Shared ids + nf-only entries + the index (+2 declared adds: verts/unit
  // cp246, data/org-chart #72; +3 more: marketing/prose #515,
  // marketing/pricing-cards #493, pricing/features #539)
  assert.equal(entryUrls(pages).length, 30, 'two indexes (#602) + 28 entry pages under newsflash');
  assert.equal(frameUrls(pages).length, 53, 'one frame page per demo variant of the newsflash-resolved library');

  // marketing/cta fork deleted (#177 phase 2): the entry chips the base
  // layer and demos base markup, exactly what a composing page gets.
  const cta = pages.get('/test/sections/section/marketing/cta');
  assert.ok(cta.includes('>base<'), 'fallthrough entry chips the base layer');
  const ctaDemo = pages.get('/test/sections/section/marketing/cta/frames/full-band');
  assert.ok(ctaDemo.includes('omega-cta') && !ctaDemo.includes('cta-panel'), 'the demo renders the base band (what a composing page gets)');

  const hero = pages.get('/test/sections/section/marketing/hero');
  assert.ok(hero.includes('>base<'), 'fallthrough entry chips the base layer — the doctrine made visible');
  assert.ok(pages.get('/test/sections/section/marketing/hero/frames/default').includes('omega-hero'), 'fallthrough demo renders the classy base');

  const newsletter = pages.get('/test/sections/section/marketing/newsletter-cta');
  assert.ok(newsletter.includes('inherits js'), 'declared §7 inherit lane surfaces as a docs chip');
  const slab = pages.get('/test/sections/section/marketing/newsletter-cta/frames/slab-band');
  const rail = pages.get('/test/sections/section/marketing/newsletter-cta/frames/rail-card');
  assert.equal(((slab + rail).match(/data-omega-section="marketing\/newsletter-cta"/g) || []).length, 2, 'slab + rail variants both render §7 roots');
  assert.ok(rail.includes('id="demo-signup"'), 'rail anchor knob rides the demo');

  const byline = pages.get('/test/components/news/byline');
  assert.ok(byline.includes('No demo data'), 'lookup-driven entries document args only');
});

test('cp219: production builds omit the showcase entirely (the §7 self-trim guarantee)', async () => {
  const pages = await buildWith(miniData, { environment: 'production' });
  assert.equal(showcaseUrls(pages).length, 0, 'no gallery pages in production output, in either url space');
  assert.equal(frameUrls(pages).length, 0, 'the per-variant frame pages ride the same dev-only injection (#463)');
});
