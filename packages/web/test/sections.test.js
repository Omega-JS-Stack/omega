/**
 * The section/component library machinery (plans/omega-sections-spec.md):
 * dual-form {% section %}/{% component %} tags, layer resolution, defaults ←
 * data ← args merge, call-site liquification, schema warnings, and the
 * context-free render — plus build-level pins for the frontmatter bridge
 * (hero-demo pages) and the body-call authoring lane.
 */
const assert = require('node:assert');
const path = require('node:path');
const { test } = require('node:test');
const { Liquid } = require('liquidjs');

const { registerSectionTags, collectSectionAssets, parseInlineArgs } = require('../src/sections.js');
const { buildWith: sharedBuildWith, miniData } = require('./lib/build.js');

const buildWith = (siteData, overrides) => sharedBuildWith(siteData, overrides, 'sections-test');

const FIXTURES = path.join(__dirname, 'fixtures', 'sections');
const THEME = path.join(FIXTURES, 'theme');
const CONSUMER = path.join(FIXTURES, 'consumer');

/** Fresh engine over the fixture layers with a captured warn sink. */
function makeEngine(baseDirs = [THEME]) {
  const warnings = [];
  const engine = new Liquid();
  registerSectionTags(engine, { baseDirs, warn: (message) => warnings.push(message) });
  return { engine, warnings };
}

const SITE = { site: { brand: { name: 'ACME' } } };

// ─── parseInlineArgs ─────────────────────────────────────────────────────────

test('parseInlineArgs: quote-aware pairs — commas inside quoted values never split', () => {
  assert.deepEqual(parseInlineArgs(', headline: "a, b", n: 3, ref: resolved.hero'), [
    { key: 'headline', expr: '"a, b"' },
    { key: 'n', expr: '3' },
    { key: 'ref', expr: 'resolved.hero' },
  ]);
  assert.deepEqual(parseInlineArgs(''), []);
  assert.throws(() => parseInlineArgs(', not a pair'), /expected key: value/);
  assert.throws(() => parseInlineArgs(', empty:'), /has no value/);
});

// ─── defaults + call-site liquification ──────────────────────────────────────

test('no args → json5 defaults render, liquified against the CALLER scope', async () => {
  const { engine, warnings } = makeEngine();
  const html = await engine.parseAndRender('{% section "marketing/hero" %}', SITE);
  assert.ok(html.includes('<h1>Default ACME</h1>'), 'default headline liquified with site.brand.name');
  assert.ok(html.includes('<span>default-tag</span>'), 'plain default untouched');
  assert.deepEqual(warnings, []);
});

test('inline args: literal + variable ref override defaults, unset keys keep defaults', async () => {
  const { engine } = makeEngine();
  const html = await engine.parseAndRender(
    '{% section "marketing/hero", headline: page.h %}',
    { ...SITE, page: { h: 'From Page' } },
  );
  assert.ok(html.includes('<h1>From Page</h1>'));
  assert.ok(html.includes('<span>default-tag</span>'));
});

// ─── block YAML form ─────────────────────────────────────────────────────────

test('block form: YAML body with arrays; liquid output tokens in values render at call scope', async () => {
  const { engine, warnings } = makeEngine();
  const html = await engine.parseAndRender(
    '{% section "marketing/hero" %}\nheadline: "Why {{ site.brand.name }}"\nitems:\n  - label: one\n  - label: two\n{% endsection %}AFTER',
    SITE,
  );
  assert.ok(html.includes('<h1>Why ACME</h1>'), 'output token inside YAML value liquified');
  assert.ok(html.includes('<li>one</li>') && html.includes('<li>two</li>'), 'array items rendered');
  assert.ok(html.endsWith('AFTER'), 'content after endsection unaffected');
  assert.deepEqual(warnings, []);
});

test('inline args AND a YAML body on one call is an error', async () => {
  const { engine } = makeEngine();
  await assert.rejects(
    engine.parseAndRender('{% section "marketing/hero", tag: "x" %}\nheadline: y\n{% endsection %}', SITE),
    /not both/,
  );
});

// ─── the data bridge ─────────────────────────────────────────────────────────

test('merge order: defaults ← data ← named args', async () => {
  const { engine } = makeEngine();
  const html = await engine.parseAndRender(
    '{% section "marketing/hero", data: d, tag: "explicit" %}',
    { ...SITE, d: { headline: 'DataH', tag: 'DataTag' } },
  );
  assert.ok(html.includes('<h1>DataH</h1>'), 'data beats defaults');
  assert.ok(html.includes('<span>explicit</span>'), 'named args beat data');
});

test('data: undefined (no consumer overrides) is a clean defaults render', async () => {
  const { engine, warnings } = makeEngine();
  const html = await engine.parseAndRender('{% section "marketing/hero", data: resolved.hero %}', SITE);
  assert.ok(html.includes('<h1>Default ACME</h1>'));
  assert.deepEqual(warnings, []);
});

test('named arg evaluating undefined keeps the default (the bare-array bridge: items: resolved.stats)', async () => {
  const { engine, warnings } = makeEngine();
  const html = await engine.parseAndRender('{% section "marketing/hero", headline: resolved.missing %}', SITE);
  assert.ok(html.includes('<h1>Default ACME</h1>'), 'undefined named arg fell through to the default');
  assert.deepEqual(warnings, []);
});

// ─── schema warnings ─────────────────────────────────────────────────────────

test('unknown arg warns with did-you-mean; type mismatch warns; neither throws', async () => {
  const { engine, warnings } = makeEngine();
  const html = await engine.parseAndRender(
    '{% section "marketing/hero", headlin: "typo", items: "not-an-array" %}',
    SITE,
  );
  assert.ok(html.includes('data-sec="theme-hero"'), 'render still succeeds');
  assert.ok(warnings.some((w) => w.includes('unknown arg "headlin"') && w.includes('did you mean "headline"')), warnings.join(' | '));
  assert.ok(warnings.some((w) => w.includes('"items" should be array')), warnings.join(' | '));
});

// ─── resolution ──────────────────────────────────────────────────────────────

test('layer precedence: consumer _sections beats the theme; theme serves when consumer absent', async () => {
  const layered = makeEngine([CONSUMER, THEME]);
  const consumerHtml = await layered.engine.parseAndRender('{% section "marketing/hero", headline: "H" %}', SITE);
  assert.ok(consumerHtml.includes('data-sec="consumer-hero"'), 'consumer layer wins');

  const themeOnly = makeEngine([THEME]);
  const themeHtml = await themeOnly.engine.parseAndRender('{% section "marketing/hero" %}', SITE);
  assert.ok(themeHtml.includes('data-sec="theme-hero"'));

  // single-segment ids work; the consumer layer has no "plain" → falls through
  const plain = await layered.engine.parseAndRender('{% section "plain" %}', {});
  assert.ok(plain.includes('data-sec="plain"'));
});

test('unknown section throws naming the id; traversal-shaped ids rejected', async () => {
  const { engine } = makeEngine();
  await assert.rejects(engine.parseAndRender('{% section "missing/thing" %}', {}), /missing\/thing/);
  await assert.rejects(engine.parseAndRender('{% section "../evil" %}', {}), /kebab-case/);
});

// ─── components ──────────────────────────────────────────────────────────────

test('{% component %} rides the same machinery from _components', async () => {
  const { engine } = makeEngine();
  assert.equal(await engine.parseAndRender('{% component "frame/box" %}', {}), '<div data-comp="box">boxed</div>\n');
  assert.equal(await engine.parseAndRender('{% component "frame/box", label: "custom" %}', {}), '<div data-comp="box">custom</div>\n');
});

// ─── context-free render ─────────────────────────────────────────────────────

test('sections are context-free: caller scope never leaks into the markup', async () => {
  const { engine } = makeEngine();
  const html = await engine.parseAndRender('{% section "marketing/hero" %}', { ...SITE, secret: 'LEAK' });
  assert.ok(html.includes('<b></b>'), `bare {{ secret }} in section markup rendered empty, got: ${html}`);
});

// ─── §7 asset collection ─────────────────────────────────────────────────────

test('collectSectionAssets: first root wins the WHOLE entry; deterministic order; absent assets are null', () => {
  const entries = collectSectionAssets([CONSUMER, THEME]);
  const byKey = new Map(entries.map((entry) => [`${entry.kind}:${entry.id}`, entry]));

  // consumer hero wins outright — its scss/js, never the theme's
  const hero = byKey.get('section:marketing/hero');
  assert.ok(hero.scss.includes(`${path.sep}consumer${path.sep}`), 'consumer scss won');
  assert.ok(hero.js.includes(`${path.sep}consumer${path.sep}`), 'consumer js won');

  // markup-only entries appear with null assets (they still resolve as tags)
  const plain = byKey.get('section:plain');
  assert.equal(plain.scss, null);
  assert.equal(plain.js, null);
  assert.ok(byKey.has('component:frame/box'), 'components collect through the same walk');

  // deterministic kind+id order (sheet/bundle stability)
  const keys = entries.map((entry) => `${entry.kind}:${entry.id}`);
  assert.deepEqual(keys, [...keys].sort(), 'sorted output');
});

// ─── build-level pins (the real classy hero through the real engine) ─────────

test('frontmatter bridge: hero-demo page keeps its own keys AND the section defaults (deep merge end-to-end)', async () => {
  const pages = await buildWith(miniData);
  const demo = pages.get('/test/components/hero-demo-input');
  assert.ok(demo, 'hero-demo-input built');
  assert.ok(demo.includes('Create your logo in'), 'page frontmatter headline survived the bridge');
  assert.ok(demo.includes('Introducing MiniCo'), 'unset badge fell through to the json5 default, brand-liquified');
  assert.ok(demo.includes('npx omega setup'), 'unset command fell through to the json5 default');
});

test('wave 2: the index composition renders every extracted band from its defaults', async () => {
  const pages = await buildWith(miniData);
  // The hero-demo pages ride the full classy index layout (the mini homepage
  // is its own custom page) — every band except their hero.* overrides
  // renders from section defaults.
  const page = pages.get('/test/components/hero-demo-input');
  assert.ok(page, 'index-composition page built');
  assert.ok(page.includes('Trusted by teams at'), 'trusted-by default headline');
  assert.ok(page.includes('Everything you need.'), 'bento default headline');
  assert.ok(page.includes(`tok-v">'MiniCo'</span>`), 'bento config_demo.name liquified with the brand');
  assert.ok(page.includes('50,000+'), 'stats defaults rode the items named-arg bridge (resolved.stats undefined)');
  assert.ok(page.includes('Sarah Johnson'), 'testimonials page copy rode the data bridge from layout frontmatter');
  assert.ok(page.includes('Ready to build something people remember?'), 'cta default headline');
  assert.ok(!page.includes('dashboard-pane'), 'product-demo stays suppressed (enabled: false default)');
});

test('wave 3: the shared cta union renders page-owned variants (accent em, nudged + plain secondaries)', async () => {
  const pages = await buildWith(miniData);
  const download = pages.get('/download');
  assert.ok(download, 'download page built');
  assert.ok(download.includes('<em>install?</em>'), 'headline_accent renders as the em form');
  assert.ok(download.includes('btn-outline-adaptive btn-lg omega-hover-nudge'), 'secondary_button.nudge: true adds the arrow form');
  const alternatives = pages.get('/alternatives');
  assert.ok(alternatives, 'alternatives page built');
  assert.ok(alternatives.includes('Ready to make the switch?'), 'alternatives cta copy rode its own data bridge');
  assert.ok(alternatives.includes('btn-outline-adaptive btn-lg"'), 'non-nudged secondary stays plain');
});

test('wave 4: the newsletter band renders through the section (form-manager dialect intact)', async () => {
  const pages = await buildWith(miniData);
  const blog = pages.get('/blog');
  assert.ok(blog, 'blog index built');
  assert.ok(blog.includes('Never miss a post'), 'newsletter copy rode the data bridge');
  assert.ok(blog.includes('id="newsletter-form"') && blog.includes('data-form-state="initializing"'), 'the JS contract markup survives extraction');
  assert.ok(blog.includes('data-omega-section="marketing/newsletter-cta"'), 'the §7 presence-init attribute rides the band');
});

test('cp209: blog posts compose the SHARED newsletter band — the dead /email-subscription form is gone', async () => {
  const pages = await buildWith(miniData);
  const post = pages.get('/blog/first-post');
  assert.ok(post, 'post built');
  assert.ok(!post.includes('email-subscription'), 'the dead action-form dialect died');
  assert.ok(post.includes('Stay in the loop'), 'post-owned copy rode the data bridge');
  assert.ok(post.includes('data-form-state="initializing"'), 'posts now speak the form-manager dialect');
  assert.ok(post.includes('data-omega-section="marketing/newsletter-cta"'), 'presence init reaches post pages');
});

test('wave 5: the faq union — duo + center variants, converged ids, dom_id knob', async () => {
  const pages = await buildWith(miniData);
  const download = pages.get('/download');
  assert.ok(download, 'download page built');
  assert.ok(download.includes('id="faqAccordion"'), 'per-page accordion ids converged to the default namespace');
  assert.ok(!download.includes('downloadFaqAccordion'), 'the old page-prefixed id died');
  assert.ok(download.includes('Is MiniCo free to download?'), 'faq items rode the data bridge, brand-liquified');
  const alt = pages.get('/alternatives/acme-growth');
  assert.ok(alt, 'alternative page built');
  assert.ok(alt.includes('classy-section-head--center'), 'variant: "center" renders the stacked shell');
  assert.ok(alt.includes('How long does a MiniCo migration take?'), 'call-site liquification replaced the explicit uj_liquify');
  assert.ok(alt.includes('<em>switching</em>'), 'accent em renders in the center head');
  // The multi-instance knob rides the body-call lane on the demo page.
  const demo = pages.get('/sections-demo');
  assert.ok(demo, 'sections-demo built');
  assert.ok(demo.includes('id="demoFaqAccordion"') && demo.includes('data-bs-target="#demoFaq1"')
    && demo.includes('data-bs-parent="#demoFaqAccordion"'), 'dom_id namespaces every Bootstrap collapse hook');
});

test('wave 6: heading/masthead — the first REAL component serves the interior-page heads', async () => {
  const pages = await buildWith(miniData);
  const pricing = pages.get('/pricing');
  assert.ok(pricing, 'pricing built');
  assert.ok(pricing.includes('<em>for the right price</em>'), 'pricing copy moved from inline | default: to frontmatter intact');
  assert.ok(pricing.includes('>Pricing</span>'), 'literal eyebrow arg renders the micro label');
  assert.ok(pricing.includes('classy-hero__sub mx-auto'), 'sub_class knob carries the centered variant');
  const about = pages.get('/about-blueprint');
  assert.ok(about, 'about blueprint page built');
  assert.ok(about.includes('>About MiniCo</span>'), 'eyebrow | default: fallback fires when superheadline is unset');
  const blog = pages.get('/blog');
  assert.ok(blog.includes('classy-display--page mb-0'), 'h1_class knob appends to the display classes');
  assert.ok(blog.includes('classy-hero-split__sub mt-3 mb-0'), 'blog sub_class variant rides through');
  const terms = pages.get('/terms');
  assert.ok(terms.includes('>Legal</span>') && terms.includes('classy-legal__sub classy-quiet'), 'legal head converges with its own knobs');
  const alt = pages.get('/alternatives/acme-growth');
  assert.ok(alt.includes('<em>Acme Growth</em>'), 'component args liquify at call site (the dropped uj_liquify)');
});

test('wave 7: heading/section-head — nested composition (sections call it) + layout heads', async () => {
  const pages = await buildWith(miniData);
  const demo = pages.get('/sections-demo');
  assert.ok(demo, 'sections-demo built');
  assert.ok(demo.includes('What makes MiniCo different'), 'showcase head renders through the NESTED component');
  assert.ok(demo.includes('>Showcase</span>'), 'nested superheadline string arg renders');
  const hero = pages.get('/test/components/hero-demo-input');
  assert.ok(hero.includes('Everything you need.'), 'bento head (plain-string superheadline) survives');
  const alt = pages.get('/alternatives/acme-growth');
  assert.ok(alt.includes('<em>compare</em>'), 'alternative comparison accent liquifies without the dropped uj_liquify');
  const post = pages.get('/blog/first-post');
  assert.ok(post.includes('Related <em>posts</em>'), 'related-posts head: em-in-string headline through the guarded h2');
  // The pricing one-time/comparison bands are catalog-gated and the mini
  // corpus has no payment config — build once WITH a catalog so the inline
  // | default: filter-arg call lines actually render.
  const paid = await buildWith({
    ...miniData,
    payment: { products: [
      { id: 'starter', name: 'Starter', prices: { monthly: 9, annually: 90 }, features: ['Alpha', 'Beta'] },
      { id: 'growth', name: 'Growth', prices: { monthly: 29, annually: 290 }, features: ['Alpha', 'Beta', 'Gamma'] },
      { id: 'kit', name: 'Launch Kit', type: 'one-time', prices: { once: 49 }, features: ['Alpha'] },
    ] },
  });
  const pricing = paid.get('/pricing');
  assert.ok(pricing, 'pricing built with a catalog');
  assert.ok(pricing.includes('One-time') && pricing.includes('<em>purchases</em>'), 'one-time head renders from inline | default: args');
  assert.ok(pricing.includes('Compare all') && pricing.includes('<em>plans</em>'), 'comparison head renders from inline | default: args');
});

test('body-call lane: a consumer page composes the section with YAML args', async () => {
  const pages = await buildWith(miniData);
  const demo = pages.get('/sections-demo');
  assert.ok(demo, 'sections-demo built');
  assert.ok(demo.includes('Composed from'), 'body-call headline rendered');
  assert.ok(demo.includes('a body call'), 'body-call rotating item rendered');
  assert.ok(!demo.includes('classy-mock'), 'frame.enabled: false suppressed the product frame');
  assert.ok(demo.includes('npx omega setup'), 'unset command still rides the defaults');
});
