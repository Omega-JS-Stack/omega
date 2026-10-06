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
const fs = require('node:fs');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');

const { buildWith: sharedBuildWith, miniData, PKG } = require('./lib/build.js');

// Namespace this file's Eleventy output dirs (test files run concurrently)
const buildWith = (siteData, overrides) => sharedBuildWith(siteData, overrides, 'verts-test');

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

module.exports = defineCases({
  type: 'group',
  description: 'verts-config',
  tests: [
    // ─── Source guards ───────────────────────────────────────────────────────────

    {
      name: 'blog [slug].js rides the modern verts lane — config-gated, module-delegated',
      run: (ctx) => {
        const slug = fs.readFileSync(path.join(PKG, 'core', 'js', 'pages', 'blog', '[slug].js'), 'utf8');

        ctx.expect(!slug.includes('itwcreativeworks'), 'no ITW ad-server hostname baked in').toBeTruthy();
        ctx.expect(!slug.includes('vert.bundle'), 'no legacy vert bundle reference').toBeTruthy();
        ctx.expect(slug.includes('omega.config?.advertising'), 'advertising key presence gates insertion').toBeTruthy();
        ctx.expect(slug.includes('data-omega-vert'), 'inserted hosts speak the modern vocabulary').toBeTruthy();
        ctx.expect(slug.includes('omega.verts.mount'), 'delegates the lifecycle to the shared client verts module').toBeTruthy();
        ctx.expect(slug.includes('[data-omega-verts="false"]'), 'the per-post opt-out stops the mid-article lane too').toBeTruthy();
      },
    },

    {
      name: 'the verts test page carries a per-slot reload that tears the unit down first',
      run: (ctx) => {
        const page = fs.readFileSync(path.join(PKG, 'core', 'js', 'pages', 'test', 'libraries', 'verts', 'index.js'), 'utf8');

        ctx.expect(page.includes('.omega-vert-unit'), 'every demo slot gets the control').toBeTruthy();
        ctx.expect(page.includes('unit.destroy()'), 'the live unit is destroyed, not just orphaned').toBeTruthy();
        ctx.expect(page.includes('__omegaVertMounted = false'), 'the mount latch clears so the element re-mounts').toBeTruthy();
        ctx.expect(page.includes('omega.verts.mount'), 're-init runs through the public verts API').toBeTruthy();
      },
    },

    {
      name: 'packaged content speaks advertising.providers.* only',
      run: (ctx) => {
        const files = [
          ['core/_includes/core/head.html', 'advertising.providers.adsense.client'],
        ];

        for (const [relative, marker] of files) {
          const contents = fs.readFileSync(path.join(PKG, relative), 'utf8');
          ctx.expect(contents.includes(marker), `${relative} reads the providers path`).toBeTruthy();
          ctx.expect(!/advertising\.google-adsense|advertising\?\.\['google-adsense'\]/.test(contents), `${relative} has no pre-providers spelling`).toBeTruthy();
          // #23/#35: the vendor prefix and the kebab slot keys are gone for good
          ctx.expect(!contents.includes('google-adsense'), `${relative} has no vendor-prefixed provider id`).toBeTruthy();
          ctx.expect(!/(display|in-article|in-feed|multiplex)-slot/.test(contents), `${relative} has no kebab-case slot key`).toBeTruthy();
        }
      },
    },

    {
      name: 'configured advertising: the verts/unit section renders its host — values stay in config',
      run: async (ctx) => {
        const pages = await buildWith({ ...miniData, advertising: ADVERTISING });
        const html = pages.get('/vert');

        ctx.expect(html.includes('data-omega-vert="in-article"'), 'section host renders with the type').toBeTruthy();
        // The id/slot reach the page ONLY through the OMEGA_BUILD_JSON snapshot
        // (the channel the client verts module reads) — never as legacy unit markup
        ctx.expect(!html.includes('data-ad-client'), 'no legacy data-ad-* unit markup').toBeTruthy();
        ctx.expect(!html.includes('vert.bundle'), 'no legacy vert bundle script').toBeTruthy();
      },
    },

    {
      name: 'no advertising config: a HAND-AUTHORED unit still renders — the author asked for it',
      run: async (ctx) => {
        const pages = await buildWith(miniData);
        const html = pages.get('/vert');

        ctx.expect(html.includes('id="vert-page"'), 'page itself renders').toBeTruthy();
        ctx.expect(html.includes('data-omega-vert="in-article"'), 'the host still renders (the module no-fills without config)').toBeTruthy();
        ctx.expect(!html.includes('data-ad-client'), 'no legacy ad unit markup').toBeTruthy();
      },
    },

    // ─── Placement (#44 item 24) ────────────────────────────────────────────────
    //
    // AUTO placements — the ones a page never asked for (blog posts, the blog
    // feed, the dashboard rail) — are gated by the `advertising` key: no config,
    // no markup at all. A post opts out for itself with `verts: false`, which also
    // travels to the mid-article JS insertion lane through data-omega-verts.

    {
      name: 'blog post: the in-article unit lands only when advertising is configured',
      run: async (ctx) => {
        const on = await buildWith({ ...miniData, advertising: ADVERTISING }, {}, 'verts-post-on');
        const post = on.get('/blog/first-post');

        ctx.expect(post.includes('data-omega-vert="in-article"'), 'configured brand gets the in-article unit').toBeTruthy();
        ctx.expect(!post.includes('data-omega-verts="false"'), 'the article is not marked opted-out').toBeTruthy();

        const off = await buildWith(miniData, {}, 'verts-post-off');
        const bare = off.get('/blog/first-post');

        ctx.expect(bare.includes('blog-post-content'), 'the post itself still renders').toBeTruthy();
        ctx.expect(!bare.includes('data-omega-vert='), 'unconfigured brand emits zero vert markup').toBeTruthy();
        ctx.expect(bare.includes('data-omega-verts="false"'), 'the article tells the JS lane to stay out too').toBeTruthy();
      },
    },

    {
      name: 'blog post: `verts: false` frontmatter opts one post out of both lanes',
      run: async (ctx) => {
        const pages = await buildWith({ ...miniData, advertising: ADVERTISING }, {}, 'verts-post-optout');
        const post = pages.get('/blog/second-post');

        ctx.expect(post.includes('blog-post-content'), 'the opted-out post renders').toBeTruthy();
        ctx.expect(!post.includes('data-omega-vert='), 'no template unit').toBeTruthy();
        ctx.expect(post.includes('data-omega-verts="false"'), 'the JS insertion lane is told to skip this article').toBeTruthy();
      },
    },

    {
      name: 'blog feed: the in-feed unit is gated by the same key',
      run: async (ctx) => {
        const on = await buildWith({ ...miniData, advertising: ADVERTISING }, {}, 'verts-feed-on');
        ctx.expect(on.get('/blog').includes('data-omega-vert="in-feed"'), 'configured brand gets the feed unit').toBeTruthy();

        const off = await buildWith(miniData, {}, 'verts-feed-off');
        ctx.expect(!off.get('/blog').includes('data-omega-vert='), 'unconfigured brand emits none').toBeTruthy();
      },
    },

    {
      name: 'dashboard rail: the sidebar vert slot rides the app shell, config-gated',
      run: async (ctx) => {
        const on = await buildWith({ ...miniData, advertising: ADVERTISING }, {}, 'verts-rail-on');
        const app = on.get('/app');

        ctx.expect(app.includes('omega-side__ad'), 'the rail slot renders on the user app surface').toBeTruthy();
        ctx.expect(app.includes('data-omega-vert="in-article"'), 'the slot carries a unit').toBeTruthy();
        ctx.expect(app.includes('data-omega-vert-size="rectangle"'), 'sized for the rail').toBeTruthy();
        ctx.expect(app.includes('Remove with'), 'the upsell rides along for non-paying users').toBeTruthy();

        // Staff never see verts: the admin sidebar data carries no bottom slot
        ctx.expect(!on.get('/admin').includes('omega-side__ad'), 'admin rail carries no vert slot').toBeTruthy();

        const off = await buildWith(miniData, {}, 'verts-rail-off');
        ctx.expect(!off.get('/app').includes('omega-side__ad'), 'no advertising config, no slot chrome').toBeTruthy();
        ctx.expect(!off.get('/app').includes('data-omega-vert='), 'and no unit').toBeTruthy();
      },
    },

    {
      name: 'newsflash mirrors the placement contract on its own post layout',
      run: async (ctx) => {
        const nfData = { ...miniData, theme: { id: 'newsflash' } };

        const on = await buildWith({ ...nfData, advertising: ADVERTISING }, {}, 'verts-nf-on');
        ctx.expect(on.get('/blog/first-post').includes('data-omega-vert="in-article"'), 'nf post carries the unit when configured').toBeTruthy();
        ctx.expect(!on.get('/blog/second-post').includes('data-omega-vert='), 'nf honors the per-post opt-out').toBeTruthy();

        const off = await buildWith(nfData, {}, 'verts-nf-off');
        ctx.expect(!off.get('/blog/first-post').includes('data-omega-vert='), 'nf post emits nothing without config').toBeTruthy();
      },
    },

    // ─── The visual-QA page (#44 item 25) ───────────────────────────────────────

    {
      name: '/test/libraries/verts shows every format and size preset, config state labeled',
      run: async (ctx) => {
        const pages = await buildWith({ ...miniData, advertising: ADVERTISING }, {}, 'verts-testpage');
        const html = pages.get('/test/libraries/verts');

        for (const type of ['display', 'in-article', 'in-feed', 'multiplex', 'house']) {
          ctx.expect(html.includes(`data-omega-vert="${type}"`), `${type} unit on the page`).toBeTruthy();
        }
        for (const size of ['leaderboard', 'banner', 'rectangle', 'large-rectangle', 'skyscraper', '320']) {
          ctx.expect(html.includes(`data-omega-vert-size="${size}"`), `${size} preset on the page`).toBeTruthy();
        }

        // The tag that produced each slot is printed beside it (raw, never rendered)
        ctx.expect(html.includes('&#123;% section "verts/unit", type: "display" %&#125;'), 'labels show the literal tag (entity-escaped so it never re-renders)').toBeTruthy();
        ctx.expect(html.includes('ca-pub-TEST123'), 'the config state is spelled out for QA').toBeTruthy();

        // The narrow sidebar rail: a skyscraper slot in a real 264px column (the app
        // shell sidebar width), where the card stacks instead of running as a media row
        ctx.expect(html.includes('width: 264px'), 'the rail demo is a real narrow column').toBeTruthy();
        ctx.expect(html.includes('Narrow rail'), 'the rail demo is labeled like the other examples').toBeTruthy();

        // Dev-only: the /test tree stays out of the index
        ctx.expect(html.includes('noindex'), 'noindex like the rest of /test').toBeTruthy();

        const off = await buildWith(miniData, {}, 'verts-testpage-off');
        const bare = off.get('/test/libraries/verts');
        ctx.expect(bare.includes('data-omega-vert="display"'), 'hand-authored units still render unconfigured (the terminal promo lane is the point)').toBeTruthy();
        ctx.expect(bare.includes('no <code>advertising</code> key'), 'the page says so').toBeTruthy();
      },
    },
  ],
});
