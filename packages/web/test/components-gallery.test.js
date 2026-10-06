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
 * Ian's spec addendum (2026-08-26) finished the mirror by HARMONIZING the two
 * spellings: a section entry is `/test/sections/<id>` exactly as a component
 * entry is `/test/components/<id>`, so neither library carries a kind segment
 * the other lacks. The `/test/sections/section/…` spelling goes with it — a
 * dev-only surface, so no redirects.
 *
 * ONE generator serves both kinds: `defaults/showcase/entry.html` and
 * `defaults/showcase/frame.html` paginate the whole library and take their
 * permalink from the entry's own kind-aware url.
 *
 * The gallery rides `defaults/showcase/`, so production emits none of it; the
 * styleguide rides `defaults/pages/` and keeps the dev-page rules it always
 * had (noindex, sitemap-excluded, consumer-suppressible).
 */
const defineCases = require('@omega.js/devkit/test/define-cases');

const { buildWith: sharedBuildWith, miniData } = require('./lib/build.js');

const buildWith = (siteData, overrides) => sharedBuildWith(siteData, overrides, 'components-gallery-test');

module.exports = defineCases({
  type: 'group',
  description: 'components-gallery',
  tests: [
    {
      name: '#602: /test/components is the component INDEX — one row per entry, linking its own page',
      run: async (ctx) => {
        const pages = await buildWith(miniData);
        const index = pages.get('/test/components');

        ctx.expect(index, 'the index page builds').toBeTruthy();

        // The shell: #540's fixed model, so the head clears the site masthead
        ctx.expect(index, 'the same top-level section shell the section gallery uses').toMatch(/<main[^>]*>\s*<section[^>]*data-omega-showcase-shell/);
        ctx.expect(index.includes('aria-label="Component library"'), 'the rail is its own nav landmark').toBeTruthy();

        // A listing, not a stack: the frames live on the entry pages now
        ctx.expect(!index.includes('<iframe'), 'the index embeds nothing — that is what the entry pages are for').toBeTruthy();
        ctx.expect(index.includes('href="/test/components/heading/masthead"'), 'each component links its own page').toBeTruthy();
        ctx.expect(index.includes('href="/test/components/pricing/features"'), 'including the ones a section composes, not a page').toBeTruthy();

        // Components only, both here and in the section gallery
        ctx.expect(!index.includes('/test/sections/marketing/hero'), 'no section entries on the component index').toBeTruthy();
        ctx.expect(index.includes('/test/sections'), 'the section library is one click away').toBeTruthy();

        // Dev-only surface, like the rest of the gallery
        ctx.expect(!(pages.get('/sitemap.xml') || '').includes('/test/components'), 'sitemap clean').toBeTruthy();
        ctx.expect(!(pages.get('/pages.json') || '').includes('/test/components'), 'pages.json clean').toBeTruthy();
      },
    },

    {
      name: '#602: /test/components/<id> is the entry page, with its frames beside it',
      run: async (ctx) => {
        const pages = await buildWith(miniData);
        const entry = pages.get('/test/components/heading/masthead');

        ctx.expect(entry, 'each component has its own page').toBeTruthy();
        ctx.expect(entry, 'the same shell a section entry wears').toMatch(/<main[^>]*>\s*<section[^>]*data-omega-showcase-shell/);
        ctx.expect(entry.includes('aria-label="Component library"'), 'the rail is the COMPONENT library on a component page').toBeTruthy();
        ctx.expect(entry.includes('href="/test/components/pricing/features"'), 'the rail links its siblings — no trip back to the index').toBeTruthy();
        ctx.expect(!entry.includes('href="/test/sections/marketing/hero"'), 'and never a section: the rail is its own kind').toBeTruthy();

        // The frames are this entry's own, under its own url space
        ctx.expect(entry.includes('src="/test/components/heading/masthead/frames/eyebrow-accent-sub"'), 'each iframe points at its own frame page').toBeTruthy();
        ctx.expect(entry.includes('loading="lazy"') && entry.includes('data-omega-showcase-frame'), 'lazy, and autosized by the same hook').toBeTruthy();
        ctx.expect(entry.includes('id="variant-eyebrow-accent-sub"'), 'the rail anchor lands on the variant, the entry-page prefix').toBeTruthy();

        const frame = pages.get('/test/components/heading/masthead/frames/eyebrow-accent-sub');
        ctx.expect(frame, 'the frame page builds in the component url space').toBeTruthy();
        ctx.expect(!frame.includes('data-omega-showcase-shell'), 'a frame is the entry alone — no gallery chrome').toBeTruthy();

        // The schema IS the docs here too
        const features = pages.get('/test/components/pricing/features');
        ctx.expect(features.includes('<code>features</code>'), 'the args table renders from the entry\'s own json5').toBeTruthy();
        ctx.expect(features.includes('&quot;definition&quot;: &quot;API requests per month.&quot;'), 'and its variant options show as a copyable block').toBeTruthy();
      },
    },

    {
      name: '#602: the two galleries are the SAME url shape — <index>/<id>, frames beside it, no kind segment anywhere',
      run: async (ctx) => {
        const pages = await buildWith(miniData);

        // THE route table. Every showcase url a build writes, by which library owns
        // it — the one place both spaces are pinned side by side, so a change to
        // either shape has to be spelled out here first.
        const routes = [...pages.keys()].filter((url) => url.startsWith('/test/sections') || url.startsWith('/test/components'));
        const shapeOf = (base) => ({
          index: routes.filter((url) => url === base),
          entries: routes.filter((url) => url.startsWith(`${base}/`) && !url.includes('/frames/')),
          frames: routes.filter((url) => url.startsWith(`${base}/`) && url.includes('/frames/')),
        });
        const sections = shapeOf('/test/sections');
        const components = shapeOf('/test/components');

        for (const [label, shape] of [['section', sections], ['component', components]]) {
          ctx.expect(shape.index.length, `${label}: exactly one index page`).toBe(1);
          ctx.expect(shape.entries.length > 0 && shape.frames.length > 0, `${label}: entry pages, and frames beside them`).toBeTruthy();
          // <base>/<category>/<name> and <base>/<category>/<name>/frames/<slug> —
          // the SAME segment count on both sides, which is what "mirrored" means.
          const depth = (url) => url.split('/').length;
          ctx.expect([...new Set(shape.entries.map(depth))], `${label}: an entry is <index>/<category>/<name>, nothing deeper`).toEqual([depth(shape.index[0]) + 2]);
          ctx.expect([...new Set(shape.frames.map(depth))], `${label}: a frame is <entry>/frames/<slug>`).toEqual([depth(shape.index[0]) + 4]);
        }
        ctx.expect(sections.entries.length + components.entries.length, 'every showcase url belongs to one of the two libraries').toBe(routes.length - sections.frames.length - components.frames.length - 2);

        // The retired spellings — the kind segment is gone from BOTH sides now
        // (Ian's 2026-08-26 addendum harmonized sections onto the component shape).
        for (const retired of ['/test/sections/component/', '/test/sections/section/']) {
          ctx.expect(routes.filter((url) => url.startsWith(retired)), `no page is generated under the retired ${retired} url space`).toEqual([]);
        }

        const index = pages.get('/test/sections');
        ctx.expect(index.includes('href="/test/sections/marketing/hero"'), 'sections link their own pages, at the harmonized url').toBeTruthy();
        ctx.expect(!index.includes('/test/components/heading/masthead'), 'a component entry is not listed on the section index').toBeTruthy();
        ctx.expect(index.includes('/test/components'), 'the component library is one click away').toBeTruthy();

        const hero = pages.get('/test/sections/marketing/hero');
        ctx.expect(hero, 'a section entry page sits directly under its index, like a component one').toBeTruthy();
        ctx.expect(hero.includes('src="/test/sections/marketing/hero/frames/email-capture"'), 'and its frames hang off it').toBeTruthy();
        ctx.expect(!hero.includes('/test/components/heading/masthead'), 'a section rail carries no components either').toBeTruthy();
      },
    },

    {
      name: '#549: the styleguide moved to /test/styleguide, whole',
      run: async (ctx) => {
        const pages = await buildWith(miniData);
        const styleguide = pages.get('/test/styleguide');
        const gallery = pages.get('/test/components');

        ctx.expect(styleguide, 'the styleguide builds at its own url').toBeTruthy();
        ctx.expect(styleguide.includes('<title>Styleguide</title>'), 'and says what it is').toBeTruthy();
        ctx.expect(styleguide.includes('--omega-ground'), 'the token sheet came with it').toBeTruthy();
        ctx.expect(styleguide.includes('id="typography"') && styleguide.includes('id="motion"'), 'so did every section of it').toBeTruthy();
        ctx.expect(styleguide.includes('<meta name="robots" content="noindex"/>'), 'still noindex, like every /test page').toBeTruthy();
        ctx.expect(!(pages.get('/sitemap.xml') || '').includes('/test/styleguide'), 'still sitemap-excluded').toBeTruthy();

        // The name is not shared: the gallery is not the styleguide wearing a rail
        ctx.expect(!gallery.includes('id="typography"'), '/test/components is no longer the styleguide').toBeTruthy();
      },
    },

    {
      name: '#549: production ships neither the component gallery nor the styleguide (#554)',
      run: async (ctx) => {
        const pages = await buildWith(miniData, { environment: 'production' });

        ctx.expect(!pages.get('/test/components'), 'the gallery rides the dev-only showcase lane').toBeTruthy();
        ctx.expect([...pages.keys()].filter((url) => url.startsWith('/test/components')), 'entry pages and frames with it').toEqual([]);
        // #554 moved the styleguide with it: /test/* is development-only, whole.
        ctx.expect(!pages.get('/test/styleguide'), 'and the styleguide is a dev surface too now').toBeTruthy();
      },
    },
  ],
});
