/**
 * The section/component library machinery (docs/web/omega-sections-spec.md):
 * dual-form {% section %}/{% component %} tags, layer resolution, defaults ←
 * data ← args merge, call-site liquification, schema warnings, and the
 * context-free render — plus build-level pins for the data bridge (the
 * showcase gallery's per-variant frame pages) and the body-call authoring lane.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');
const { Liquid } = require('liquidjs');

const { registerSectionTags, collectSectionAssets, buildSectionLibrary, parseInlineArgs } = require('../src/sections.js');
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

// Config reads live under `resolved.config` (#607) — the caller scope a
// section's defaults liquify against.
const SITE = { resolved: { config: { brand: { name: 'ACME' } } } };

// ─── cp219: buildSectionLibrary (the showcase/docs data source) ──────────────

const THEMES = path.join(__dirname, '..', 'themes');

module.exports = defineCases({
  type: 'group',
  description: 'sections',
  tests: [
    // ─── parseInlineArgs ─────────────────────────────────────────────────────────

    {
      name: 'parseInlineArgs: quote-aware pairs — commas inside quoted values never split',
      run: (ctx) => {
        ctx.expect(parseInlineArgs(', headline: "a, b", n: 3, ref: resolved.hero')).toEqual([
          { key: 'headline', expr: '"a, b"' },
          { key: 'n', expr: '3' },
          { key: 'ref', expr: 'resolved.hero' },
        ]);
        ctx.expect(parseInlineArgs('')).toEqual([]);
        ctx.expect(() => parseInlineArgs(', not a pair')).toThrow(/expected key: value/);
        ctx.expect(() => parseInlineArgs(', empty:')).toThrow(/has no value/);
      },
    },

    // ─── defaults + call-site liquification ──────────────────────────────────────

    {
      name: 'no args → json5 defaults render, liquified against the CALLER scope',
      run: async (ctx) => {
        const { engine, warnings } = makeEngine();
        const html = await engine.parseAndRender('{% section "marketing/hero" %}', SITE);
        ctx.expect(html.includes('<h1>Default ACME</h1>'), 'default headline liquified with resolved.config.brand.name').toBeTruthy();
        ctx.expect(html.includes('<span>default-tag</span>'), 'plain default untouched').toBeTruthy();
        ctx.expect(warnings).toEqual([]);
      },
    },

    {
      name: 'inline args: literal + variable ref override defaults, unset keys keep defaults',
      run: async (ctx) => {
        const { engine } = makeEngine();
        const html = await engine.parseAndRender(
          '{% section "marketing/hero", headline: page.h %}',
          { ...SITE, page: { h: 'From Page' } },
        );
        ctx.expect(html.includes('<h1>From Page</h1>')).toBeTruthy();
        ctx.expect(html.includes('<span>default-tag</span>')).toBeTruthy();
      },
    },

    // ─── block YAML form ─────────────────────────────────────────────────────────

    {
      name: 'block form: YAML body with arrays; liquid output tokens in values render at call scope',
      run: async (ctx) => {
        const { engine, warnings } = makeEngine();
        const html = await engine.parseAndRender(
          '{% section "marketing/hero" %}\nheadline: "Why {{ resolved.config.brand.name }}"\nitems:\n  - label: one\n  - label: two\n{% endsection %}AFTER',
          SITE,
        );
        ctx.expect(html.includes('<h1>Why ACME</h1>'), 'output token inside YAML value liquified').toBeTruthy();
        ctx.expect(html.includes('<li>one</li>') && html.includes('<li>two</li>'), 'array items rendered').toBeTruthy();
        ctx.expect(html.endsWith('AFTER'), 'content after endsection unaffected').toBeTruthy();
        ctx.expect(warnings).toEqual([]);
      },
    },

    {
      name: 'inline args AND a YAML body on one call is an error',
      run: async (ctx) => {
        const { engine } = makeEngine();
        await ctx.expect(engine.parseAndRender('{% section "marketing/hero", tag: "x" %}\nheadline: y\n{% endsection %}', SITE)).rejects.toThrow(/not both/);
      },
    },

    // ─── the data bridge ─────────────────────────────────────────────────────────

    {
      name: 'merge order: defaults ← data ← named args',
      run: async (ctx) => {
        const { engine } = makeEngine();
        const html = await engine.parseAndRender(
          '{% section "marketing/hero", data: d, tag: "explicit" %}',
          { ...SITE, d: { headline: 'DataH', tag: 'DataTag' } },
        );
        ctx.expect(html.includes('<h1>DataH</h1>'), 'data beats defaults').toBeTruthy();
        ctx.expect(html.includes('<span>explicit</span>'), 'named args beat data').toBeTruthy();
      },
    },

    {
      name: 'data: undefined (no consumer overrides) is a clean defaults render',
      run: async (ctx) => {
        const { engine, warnings } = makeEngine();
        const html = await engine.parseAndRender('{% section "marketing/hero", data: resolved.hero %}', SITE);
        ctx.expect(html.includes('<h1>Default ACME</h1>')).toBeTruthy();
        ctx.expect(warnings).toEqual([]);
      },
    },

    {
      name: 'named arg evaluating undefined keeps the default (the bare-array bridge: items: resolved.stats)',
      run: async (ctx) => {
        const { engine, warnings } = makeEngine();
        const html = await engine.parseAndRender('{% section "marketing/hero", headline: resolved.missing %}', SITE);
        ctx.expect(html.includes('<h1>Default ACME</h1>'), 'undefined named arg fell through to the default').toBeTruthy();
        ctx.expect(warnings).toEqual([]);
      },
    },

    // ─── schema warnings ─────────────────────────────────────────────────────────

    {
      name: 'unknown arg warns with did-you-mean; type mismatch warns; neither throws',
      run: async (ctx) => {
        const { engine, warnings } = makeEngine();
        const html = await engine.parseAndRender(
          '{% section "marketing/hero", headlin: "typo", items: "not-an-array" %}',
          SITE,
        );
        ctx.expect(html.includes('data-sec="theme-hero"'), 'render still succeeds').toBeTruthy();
        ctx.expect(warnings.some((w) => w.includes('unknown arg "headlin"') && w.includes('did you mean "headline"')), warnings.join(' | ')).toBeTruthy();
        ctx.expect(warnings.some((w) => w.includes('"items" should be array')), warnings.join(' | ')).toBeTruthy();
      },
    },

    // ─── resolution ──────────────────────────────────────────────────────────────

    {
      name: 'layer precedence: consumer _sections beats the theme; theme serves when consumer absent',
      run: async (ctx) => {
        const layered = makeEngine([CONSUMER, THEME]);
        const consumerHtml = await layered.engine.parseAndRender('{% section "marketing/hero", headline: "H" %}', SITE);
        ctx.expect(consumerHtml.includes('data-sec="consumer-hero"'), 'consumer layer wins').toBeTruthy();

        const themeOnly = makeEngine([THEME]);
        const themeHtml = await themeOnly.engine.parseAndRender('{% section "marketing/hero" %}', SITE);
        ctx.expect(themeHtml.includes('data-sec="theme-hero"')).toBeTruthy();

        // single-segment ids work; the consumer layer has no "plain" → falls through
        const plain = await layered.engine.parseAndRender('{% section "plain" %}', {});
        ctx.expect(plain.includes('data-sec="plain"')).toBeTruthy();
      },
    },

    {
      name: 'unknown section throws naming the id; traversal-shaped ids rejected',
      run: async (ctx) => {
        const { engine } = makeEngine();
        await ctx.expect(engine.parseAndRender('{% section "missing/thing" %}', {})).rejects.toThrow(/missing\/thing/);
        await ctx.expect(engine.parseAndRender('{% section "../evil" %}', {})).rejects.toThrow(/kebab-case/);
      },
    },

    // ─── components ──────────────────────────────────────────────────────────────

    {
      name: '{% component %} rides the same machinery from _components',
      run: async (ctx) => {
        const { engine } = makeEngine();
        ctx.expect(await engine.parseAndRender('{% component "frame/box" %}', {})).toBe('<div data-comp="box">boxed</div>\n');
        ctx.expect(await engine.parseAndRender('{% component "frame/box", label: "custom" %}', {})).toBe('<div data-comp="box">custom</div>\n');
      },
    },

    // ─── context-free render ─────────────────────────────────────────────────────

    {
      name: 'sections are context-free: caller scope never leaks into the markup',
      run: async (ctx) => {
        const { engine } = makeEngine();
        const html = await engine.parseAndRender('{% section "marketing/hero" %}', { ...SITE, secret: 'LEAK' });
        ctx.expect(html.includes('<b></b>'), `bare {{ secret }} in section markup rendered empty, got: ${html}`).toBeTruthy();
      },
    },

    // ─── §7 asset collection ─────────────────────────────────────────────────────

    {
      name: 'collectSectionAssets: first root wins the WHOLE entry; deterministic order; absent assets are null',
      run: (ctx) => {
        const entries = collectSectionAssets([CONSUMER, THEME]);
        const byKey = new Map(entries.map((entry) => [`${entry.kind}:${entry.id}`, entry]));

        // consumer hero wins outright — its scss/js, never the theme's
        const hero = byKey.get('section:marketing/hero');
        ctx.expect(hero.scss.includes(`${path.sep}consumer${path.sep}`), 'consumer scss won').toBeTruthy();
        ctx.expect(hero.js.includes(`${path.sep}consumer${path.sep}`), 'consumer js won').toBeTruthy();

        // markup-only entries appear with null assets (they still resolve as tags)
        const plain = byKey.get('section:plain');
        ctx.expect(plain.scss).toBe(null);
        ctx.expect(plain.js).toBe(null);
        ctx.expect(byKey.has('component:frame/box'), 'components collect through the same walk').toBeTruthy();

        // deterministic kind+id order (sheet/bundle stability)
        const keys = entries.map((entry) => `${entry.kind}:${entry.id}`);
        ctx.expect(keys, 'sorted output').toEqual([...keys].sort());
      },
    },

    {
      name: '§7 inherit: a declared lane fills from the layer below while undeclared lanes stay the winner\'s',
      run: (ctx) => {
        const entries = collectSectionAssets([CONSUMER, THEME]);
        const demo = entries.find((entry) => entry.kind === 'section' && entry.id === 'marketing/inherit-demo');
        ctx.expect(demo.scss.includes(`${path.sep}consumer${path.sep}`), 'own scss stays the override folder\'s').toBeTruthy();
        ctx.expect(demo.js.includes(`${path.sep}theme${path.sep}`), 'declared js lane inherited from the layer below').toBeTruthy();
      },
    },

    {
      name: '§7 inherit: contradictions and malformed declarations throw; unfulfilled warns and stays null; the chain skips layers lacking the file',
      run: (ctx) => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-inherit-'));
        const make = (layer, id, files) => {
          const dir = path.join(root, layer, '_sections', id);
          fs.mkdirSync(dir, { recursive: true });
          for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
          return path.join(root, layer);
        };
        try {
          // own file + inherit of the same lane = contradictory manifest
          const a = make('contra', 'x/y', { 'section.html': '<i></i>', 'section.js': 'export default () => {};', 'section.json5': "{ inherit: ['js'] }" });
          ctx.expect(() => collectSectionAssets([a])).toThrow(/ships its own section\.js/);

          // malformed declarations
          const b = make('bad-string', 'x/y', { 'section.html': '<i></i>', 'section.json5': "{ inherit: 'js' }" });
          ctx.expect(() => collectSectionAssets([b])).toThrow(/inherit must be an array/);
          const c = make('bad-lane', 'x/y', { 'section.html': '<i></i>', 'section.json5': "{ inherit: ['html'] }" });
          ctx.expect(() => collectSectionAssets([c])).toThrow(/inherit must be an array drawn from/);

          // declared but nothing below owns the file → warn, stays null
          const d = make('orphan', 'x/y', { 'section.html': '<i></i>', 'section.json5': "{ inherit: ['js'] }" });
          const warnings = [];
          const orphaned = collectSectionAssets([d], { warn: (message) => warnings.push(message) });
          ctx.expect(orphaned.find((entry) => entry.id === 'x/y').js, 'nothing inherited').toBe(null);
          ctx.expect(warnings.some((w) => w.includes('x/y') && w.includes('nothing inherited')), warnings.join(' | ')).toBeTruthy();

          // chain continuation: the middle layer owns the html but not the js —
          // the fill comes from the layer below it
          const top = make('chain-top', 'x/y', { 'section.html': '<i></i>', 'section.json5': "{ inherit: ['js'] }" });
          const mid = make('chain-mid', 'x/y', { 'section.html': '<i></i>' });
          const bottom = make('chain-bottom', 'x/y', { 'section.html': '<i></i>', 'section.js': 'export default () => {};' });
          const chained = collectSectionAssets([top, mid, bottom]);
          ctx.expect(chained.find((entry) => entry.id === 'x/y').js.includes('chain-bottom'), 'chain continued past the js-less layer').toBeTruthy();
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },

    // ─── build-level pins (the real classy hero through the real engine) ─────────

    {
      name: 'data bridge: a showcase frame keeps the variant\'s own keys AND the section defaults (deep merge end-to-end)',
      run: async (ctx) => {
        const pages = await buildWith(miniData);
        const demo = pages.get('/test/sections/marketing/hero/frames/input-capture');
        ctx.expect(demo, 'the Input capture variant frame built').toBeTruthy();
        ctx.expect(demo.includes('Create your logo in'), 'the variant\'s headline survived the bridge').toBeTruthy();
        ctx.expect(demo.includes('Introducing MiniCo'), 'unset badge fell through to the json5 default, brand-liquified').toBeTruthy();
        ctx.expect(!demo.includes('btn-cmd'), 'unset command renders NO command button (pass B: a framework command is never a theme default)').toBeTruthy();
      },
    },

    {
      name: 'wave 2: the index composition renders every extracted band from its defaults',
      run: async (ctx) => {
        const pages = await buildWith(miniData);
        // The fixture's /about rides the full classy index layout (the mini
        // homepage is its own custom page) — every band renders from its section
        // defaults.
        const page = pages.get('/about');
        ctx.expect(page, 'index-composition page built').toBeTruthy();
        ctx.expect(page.includes('Trusted by teams at'), 'trusted-by default headline').toBeTruthy();
        ctx.expect(page.includes('Everything you need.'), 'bento default headline').toBeTruthy();
        ctx.expect(page.includes(`tok-v">'MiniCo'</span>`), 'bento config_demo.name liquified with the brand').toBeTruthy();
        ctx.expect(page.includes('50,000+'), 'stats defaults rode the items named-arg bridge (resolved.stats undefined)').toBeTruthy();
        ctx.expect(page.includes('Sarah Johnson'), 'testimonials page copy rode the data bridge from layout frontmatter').toBeTruthy();
        ctx.expect(page.includes('Ready to build something people remember?'), 'cta default headline').toBeTruthy();
        ctx.expect(!page.includes('dashboard-pane'), 'product-demo stays suppressed (enabled: false default)').toBeTruthy();
      },
    },

    {
      name: 'wave 3: the shared cta union renders page-owned variants (accent em, nudged + plain secondaries)',
      run: async (ctx) => {
        const pages = await buildWith(miniData);
        const download = pages.get('/download');
        ctx.expect(download, 'download page built').toBeTruthy();
        ctx.expect(download.includes('<em>install?</em>'), 'headline_accent renders as the em form').toBeTruthy();
        ctx.expect(download.includes('btn-outline-adaptive btn-lg omega-hover-nudge'), 'secondary_button.nudge: true adds the arrow form').toBeTruthy();
        const alternatives = pages.get('/alternatives');
        ctx.expect(alternatives, 'alternatives page built').toBeTruthy();
        ctx.expect(alternatives.includes('Ready to make the switch?'), 'alternatives cta copy rode its own data bridge').toBeTruthy();
        ctx.expect(alternatives.includes('btn-outline-adaptive btn-lg"'), 'non-nudged secondary stays plain').toBeTruthy();
      },
    },

    {
      name: 'wave 4: the newsletter band renders through the section (form-manager dialect intact)',
      run: async (ctx) => {
        const pages = await buildWith(miniData);
        const blog = pages.get('/blog');
        ctx.expect(blog, 'blog index built').toBeTruthy();
        ctx.expect(blog.includes('Never miss a post'), 'newsletter copy rode the data bridge').toBeTruthy();
        ctx.expect(blog.includes('id="newsletter-form"') && blog.includes('data-form-state="initializing"'), 'the JS contract markup survives extraction').toBeTruthy();
        ctx.expect(blog.includes('data-omega-section="marketing/newsletter-cta"'), 'the §7 presence-init attribute rides the band').toBeTruthy();
        ctx.expect(!blog.includes('newsletter-success-alert') && !blog.includes('newsletter-error-alert'), 'the static alert slots are culled (cp227) — FormManager presents success/error as toasts, the baked divs were never toggled').toBeTruthy();
      },
    },

    {
      name: 'cp209: blog posts compose the SHARED newsletter band — the dead /email-subscription form is gone',
      run: async (ctx) => {
        const pages = await buildWith(miniData);
        const post = pages.get('/blog/first-post');
        ctx.expect(post, 'post built').toBeTruthy();
        ctx.expect(!post.includes('email-subscription'), 'the dead action-form dialect died').toBeTruthy();
        ctx.expect(post.includes('Stay in the loop'), 'post-owned copy rode the data bridge').toBeTruthy();
        ctx.expect(post.includes('data-form-state="initializing"'), 'posts now speak the form-manager dialect').toBeTruthy();
        ctx.expect(post.includes('data-omega-section="marketing/newsletter-cta"'), 'presence init reaches post pages').toBeTruthy();
      },
    },

    {
      name: 'wave 5: the faq union — duo + center variants, converged ids, dom_id knob',
      run: async (ctx) => {
        const pages = await buildWith(miniData);
        const download = pages.get('/download');
        ctx.expect(download, 'download page built').toBeTruthy();
        ctx.expect(download.includes('id="faqAccordion"'), 'per-page accordion ids converged to the default namespace').toBeTruthy();
        ctx.expect(!download.includes('downloadFaqAccordion'), 'the old page-prefixed id died').toBeTruthy();
        ctx.expect(download.includes('Is MiniCo free to download?'), 'faq items rode the data bridge, brand-liquified').toBeTruthy();
        const alt = pages.get('/alternatives/acme-growth');
        ctx.expect(alt, 'alternative page built').toBeTruthy();
        ctx.expect(alt.includes('omega-section-head--center'), 'variant: "center" renders the stacked shell').toBeTruthy();
        ctx.expect(alt.includes('How long does a MiniCo migration take?'), 'call-site liquification replaced the explicit omega_liquify').toBeTruthy();
        ctx.expect(alt.includes('<em>switching</em>'), 'accent em renders in the center head').toBeTruthy();
        // The multi-instance knob rides the body-call lane on the demo page.
        const demo = pages.get('/sections-demo');
        ctx.expect(demo, 'sections-demo built').toBeTruthy();
        ctx.expect(demo.includes('id="demoFaqAccordion"') && demo.includes('data-bs-target="#demoFaq1"')
          && demo.includes('data-bs-parent="#demoFaqAccordion"'), 'dom_id namespaces every Bootstrap collapse hook').toBeTruthy();
      },
    },

    {
      name: 'wave 6: heading/masthead — the first REAL component serves the interior-page heads',
      run: async (ctx) => {
        const pages = await buildWith(miniData);
        const pricing = pages.get('/pricing');
        ctx.expect(pricing, 'pricing built').toBeTruthy();
        ctx.expect(pricing.includes('<em>for the right price</em>'), 'pricing copy moved from inline | default: to frontmatter intact').toBeTruthy();
        ctx.expect(pricing.includes('>Pricing</span>'), 'literal eyebrow arg renders the micro label').toBeTruthy();
        ctx.expect(pricing.includes('omega-hero__sub mx-auto'), 'sub_class knob carries the centered variant').toBeTruthy();
        const about = pages.get('/about-blueprint');
        ctx.expect(about, 'about blueprint page built').toBeTruthy();
        ctx.expect(about.includes('>About MiniCo</span>'), 'eyebrow | default: fallback fires when superheadline is unset').toBeTruthy();
        const blog = pages.get('/blog');
        ctx.expect(blog.includes('omega-display--page mb-0'), 'h1_class knob appends to the display classes').toBeTruthy();
        ctx.expect(blog.includes('omega-hero-split__sub mt-3 mb-0'), 'blog sub_class variant rides through').toBeTruthy();
        const terms = pages.get('/terms');
        ctx.expect(terms.includes('>Legal</span>') && terms.includes('omega-legal__sub omega-quiet'), 'legal head converges with its own knobs').toBeTruthy();
        const alt = pages.get('/alternatives/acme-growth');
        ctx.expect(alt.includes('<em>Acme Growth</em>'), 'component args liquify at call site (the dropped omega_liquify)').toBeTruthy();
      },
    },

    {
      name: 'wave 7: heading/section-head — nested composition (sections call it) + layout heads',
      run: async (ctx) => {
        const pages = await buildWith(miniData);
        const demo = pages.get('/sections-demo');
        ctx.expect(demo, 'sections-demo built').toBeTruthy();
        ctx.expect(demo.includes('What makes MiniCo different'), 'showcase head renders through the NESTED component').toBeTruthy();
        ctx.expect(demo.includes('>Showcase</span>'), 'nested superheadline string arg renders').toBeTruthy();
        const indexComposition = pages.get('/about');
        ctx.expect(indexComposition.includes('Everything you need.'), 'bento head (plain-string superheadline) survives').toBeTruthy();
        const alt = pages.get('/alternatives/acme-growth');
        ctx.expect(alt.includes('<em>compare</em>'), 'alternative comparison accent liquifies without the dropped omega_liquify').toBeTruthy();
        const post = pages.get('/blog/first-post');
        ctx.expect(post.includes('Related <em>posts</em>'), 'related-posts head: em-in-string headline through the guarded h2').toBeTruthy();
        // The pricing one-time/comparison bands are catalog-gated and the mini
        // corpus has no payment config — build once WITH a catalog so the inline
        // | default: filter-arg call lines actually render. The comparison band
        // also needs rows, so the products name VALUES against a top-level
        // `features` catalog (#647): no catalog, no matrix, no head.
        const paid = await buildWith({
          ...miniData,
          features: {
            alpha: { name: 'Alpha', usage: {} },
            beta: { name: 'Beta' },
            gamma: { name: 'Gamma' },
          },
          payment: { products: [
            { id: 'starter', name: 'Starter', prices: { monthly: 9, annually: 90 }, features: { alpha: 100, beta: true } },
            { id: 'growth', name: 'Growth', prices: { monthly: 29, annually: 290 }, features: { alpha: -1, beta: true, gamma: true } },
            { id: 'kit', name: 'Launch Kit', type: 'one-time', prices: { once: 49 }, features: { alpha: 100 } },
          ] },
        });
        const pricing = paid.get('/pricing');
        ctx.expect(pricing, 'pricing built with a catalog').toBeTruthy();
        ctx.expect(pricing.includes('One-time') && pricing.includes('<em>purchases</em>'), 'one-time head renders from inline | default: args').toBeTruthy();
        ctx.expect(pricing.includes('Compare all') && pricing.includes('<em>plans</em>'), 'comparison head renders from inline | default: args').toBeTruthy();
      },
    },

    {
      name: 'body-call lane: a consumer page composes the section with YAML args',
      run: async (ctx) => {
        const pages = await buildWith(miniData);
        const demo = pages.get('/sections-demo');
        ctx.expect(demo, 'sections-demo built').toBeTruthy();
        ctx.expect(demo.includes('Composed from'), 'body-call headline rendered').toBeTruthy();
        ctx.expect(demo.includes('a body call'), 'body-call rotating item rendered').toBeTruthy();
        ctx.expect(!demo.includes('omega-mock'), 'frame.enabled: false suppressed the product frame').toBeTruthy();
        ctx.expect(!demo.includes('btn-cmd'), 'unset command renders no command button (pass B)').toBeTruthy();
      },
    },

    // ─── cp219: expression names (the showcase's lane) ───────────────────────────

    {
      name: 'cp219: expression name resolves like the quoted form, inline args intact',
      run: async (ctx) => {
        const { engine, warnings } = makeEngine();
        const html = await engine.parseAndRender(
          '{% section page.which, headline: page.h %}',
          { ...SITE, page: { which: 'marketing/hero', h: 'By Expression' } },
        );
        ctx.expect(html.includes('<h1>By Expression</h1>'), 'expression-named section renders with inline args').toBeTruthy();
        ctx.expect(html.includes('<span>default-tag</span>'), 'defaults still merge under').toBeTruthy();
        ctx.expect(warnings).toEqual([]);
      },
    },

    {
      name: 'cp219: expression name must resolve to an id string',
      run: async (ctx) => {
        const { engine } = makeEngine();
        await ctx.expect((() => engine.parseAndRender('{% section page.missing %}', SITE))()).rejects.toThrow(/must resolve to an entry id string/);
        await ctx.expect((() => engine.parseAndRender('{% section page.n %}', { page: { n: 42 } }))()).rejects.toThrow(/must resolve to an entry id string/);
      },
    },

    {
      name: 'cp219: buildSectionLibrary — resolved entries over the real base chain',
      run: (ctx) => {
        const { entries, groups } = buildSectionLibrary({ baseDirs: [path.join(THEMES, 'base')] });
        ctx.expect(entries.length, `base chain: 18 sections + 4 components (verts/unit added cp246, data/org-chart #72, marketing/prose #515 + marketing/pricing-cards #493, pricing/features #539), got ${entries.length}`).toBe(22);
        ctx.expect(entries.every((entry) => entry.source === 'base'), 'every entry owned by the base layer').toBeTruthy();

        const hero = entries.find((entry) => entry.id === 'marketing/hero' && entry.kind === 'section');
        ctx.expect(hero.argsTable.some((row) => row.name === 'rotating' && row.type === 'array'), 'args rows normalized').toBeTruthy();
        ctx.expect(hero.demo.length, 'hero demo variants ride through (the folded-in hero-demo pages, #463, the breadcrumb trail #513, the custom-animation slot #441)').toBe(11);
        ctx.expect(!hero.defaultsJson.includes('{{'), 'defaultsJson is liquid-inert (escaped braces)').toBeTruthy();
        ctx.expect(hero.defaultsJson.includes('&#123;&#123; resolved.config.brand.name }}'), 'raw tokens display in escaped form').toBeTruthy();

        // Groups: sections before components, categories clustered (about sorts first)
        ctx.expect(groups[0].kind).toBe('section');
        ctx.expect(groups[0].category).toBe('about');
        ctx.expect(groups.some((group) => group.kind === 'component' && group.category === 'heading')).toBeTruthy();
      },
    },

    {
      name: '#463: buildSectionLibrary — a flattened variants list, one item per entry x demo variant',
      run: (ctx) => {
        const { entries, variants } = buildSectionLibrary({ baseDirs: [path.join(THEMES, 'base')] });

        const demoCount = entries.reduce((total, entry) => total + entry.demo.length, 0);
        ctx.expect(variants.length, 'every demo variant of every entry, flattened — the frame pages\' pagination data').toBe(demoCount);

        const heroVariants = variants.filter((variant) => variant.id === 'marketing/hero');
        ctx.expect(heroVariants.map((variant) => variant.slug), 'slugs are kebab-cased labels, in authored order').toEqual(['default', 'email-capture', 'no-frame-second-button', 'input-capture', 'form', 'video', 'side-placement', 'custom-animation', 'custom-slot', 'breadcrumb', 'stat-cards']);
        ctx.expect(heroVariants.every((variant) => variant.kind === 'section' && variant.source === 'base'), 'each item carries the entry coordinates its own page needs').toBeTruthy();

        const video = heroVariants.find((variant) => variant.slug === 'video');
        ctx.expect(video.label, 'the label rides through for the page title').toBe('Video');
        ctx.expect(video.args.demo.type, 'args stay RAW — they liquify at the tag\'s call site').toBe('video');

        // The entry's own copy carries the same slug (the iframe src on the entry
        // page) plus the escaped args display block.
        const hero = entries.find((entry) => entry.id === 'marketing/hero');
        ctx.expect(hero.demo.map((variant) => variant.slug), 'entry.demo and variants agree on the slug — one URL, both sides').toEqual(heroVariants.map((variant) => variant.slug));
        ctx.expect(hero.demo[0].argsJson, 'a variant with no args shows no args block').toBe('');
        ctx.expect(hero.demo[1].argsJson.includes('&quot;subtext&quot;'), 'authored args pretty-print as display copy').toBeTruthy();
        ctx.expect(!hero.demo[1].argsJson.includes('{'), 'and are liquid-inert, like every other display string').toBeTruthy();
      },
    },

    {
      name: '#463: buildSectionLibrary — colliding variant labels get numbered slugs, never a shared URL',
      run: (ctx) => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-lib-slug-'));
        const entryDir = path.join(dir, '_sections', 'demo', 'dupes');
        fs.mkdirSync(entryDir, { recursive: true });
        fs.writeFileSync(path.join(entryDir, 'section.html'), '<div></div>');
        fs.writeFileSync(path.join(entryDir, 'section.json5'),
          '{ demo: [{ label: "Side by side" }, { label: "side BY side" }, { label: "Side / by / side" }, { label: "Other" }] }');

        const { variants } = buildSectionLibrary({ baseDirs: [dir], warn: () => {} });
        ctx.expect(variants.map((variant) => variant.slug), 'the first claim keeps the bare slug; the rest are numbered in authored order').toEqual(['side-by-side', 'side-by-side-2', 'side-by-side-3', 'other']);
        fs.rmSync(dir, { recursive: true, force: true });
      },
    },

    {
      name: 'cp219: buildSectionLibrary — the newsflash chain resolves overrides and fallthroughs honestly',
      run: (ctx) => {
        const { entries } = buildSectionLibrary({ baseDirs: [path.join(THEMES, 'newsflash'), path.join(THEMES, 'base')] });
        ctx.expect(entries.length, `nf chain: 22 shared ids + 6 nf-only, got ${entries.length}`).toBe(28);

        const cta = entries.find((entry) => entry.id === 'marketing/cta');
        ctx.expect(cta.source, 'the deleted fork falls through: the base owns the entry (#177 phase 2)').toBe('base');
        const hero = entries.find((entry) => entry.id === 'marketing/hero');
        ctx.expect(hero.source, 'fallthrough ids show the base layer (the doctrine, visible)').toBe('base');
        const newsletter = entries.find((entry) => entry.id === 'marketing/newsletter-cta');
        ctx.expect(newsletter.source, 'the kept fork wins its entry').toBe('newsflash');
        ctx.expect(newsletter.inherit, 'declared inherit lanes surface for the docs chip').toEqual(['js']);
        const byline = entries.find((entry) => entry.id === 'news/byline');
        ctx.expect(byline.demo.length, 'lookup-driven components stay demo-less by design').toBe(0);
      },
    },

    {
      name: 'cp219: buildSectionLibrary — malformed demo warns and drops, never throws',
      run: (ctx) => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-lib-'));
        const entryDir = path.join(dir, '_sections', 'demo', 'bad');
        fs.mkdirSync(entryDir, { recursive: true });
        fs.writeFileSync(path.join(entryDir, 'section.html'), '<div></div>');
        fs.writeFileSync(path.join(entryDir, 'section.json5'), '{ demo: { not: "an array" } }');
        const entryDir2 = path.join(dir, '_sections', 'demo', 'unlabeled');
        fs.mkdirSync(entryDir2, { recursive: true });
        fs.writeFileSync(path.join(entryDir2, 'section.html'), '<div></div>');
        fs.writeFileSync(path.join(entryDir2, 'section.json5'), '{ demo: [{ args: {} }, { label: "ok" }] }');

        const warnings = [];
        const { entries } = buildSectionLibrary({ baseDirs: [dir], warn: (message) => warnings.push(message) });
        ctx.expect(entries.find((entry) => entry.id === 'demo/bad').demo.length, 'non-array demo ignored').toBe(0);
        ctx.expect(entries.find((entry) => entry.id === 'demo/unlabeled').demo.map((v) => v.label), 'unlabeled variant dropped, labeled kept').toEqual(['ok']);
        ctx.expect(warnings.some((message) => message.includes('demo must be an array')), 'non-array warned').toBeTruthy();
        ctx.expect(warnings.some((message) => message.includes('without a label')), 'unlabeled warned').toBeTruthy();
        fs.rmSync(dir, { recursive: true, force: true });
      },
    },
  ],
});
