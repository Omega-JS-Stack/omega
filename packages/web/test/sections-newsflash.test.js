/**
 * Newsflash section-library lane (cp213+, reshaped by #177 phase 2): builds
 * the mini fixture with the newsflash theme active and pins the skin+forks
 * model: the KEPT identity forks (rundown/desks sections, the rule-head +
 * lede + story-card + byline components, the newsletter-cta fork with its
 * rail variant) wear newsflash-* BEM classes, while the commodity surfaces
 * (marketing/stats, marketing/cta, the taxonomy/about/team/pricing layouts)
 * fall through to BASE markup (omega-* classes) restyled by scss alone.
 */
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');

const { collectSectionAssets } = require('../src/sections.js');
const { buildWith: sharedBuildWith, miniData } = require('./lib/build.js');

const nfData = { ...miniData, theme: { id: 'newsflash' } };
const buildWith = (siteData, overrides) => sharedBuildWith(siteData, overrides, 'sections-nf-test');

module.exports = defineCases({
  type: 'group',
  description: 'sections-newsflash',
  tests: [
    {
      name: 'cp213/#177: newsflash index bands: kept forks in nf vocabulary, stats falls through to base',
      run: async (ctx) => {
        const pages = await buildWith(nfData);
        const home = pages.get('/about'); // the fixture page that rides the index layout

        // marketing/stats fork is DELETED: the BASE band serves, and the
        // data-omega-countup contract newsflash had dropped returns with it.
        ctx.expect(home.includes('omega-stats'), 'base stats markup serves the shared id').toBeTruthy();
        ctx.expect(home.includes('data-omega-countup'), 'the count-up contract returns').toBeTruthy();
        ctx.expect(home.includes('2M+'), 'items bridged from resolved.stats').toBeTruthy();
        ctx.expect(!home.includes('stat-num'), 'no trace of the deleted fork vocabulary').toBeTruthy();

        // marketing/rundown (kept fork): rule head + lede + numbered feed, BEM
        ctx.expect(home.includes('Original reporting'), 'rundown items over the data bridge').toBeTruthy();
        ctx.expect(home.includes('newsflash-feed__num'), 'numbered feed cluster').toBeTruthy();
        ctx.expect(home.includes('newsflash-accent">morning'), 'lede accent span').toBeTruthy();

        // marketing/desks (kept fork): icon cards linked to category pages
        ctx.expect(home.includes('Read the desk'), 'desk card affordance').toBeTruthy();
        ctx.expect(home.includes('newsflash-desks__icon'), 'desk icon chip wears the BEM class').toBeTruthy();
        ctx.expect(home.includes('/blog/categories/tech'), 'desk href to its category page').toBeTruthy();
      },
    },

    {
      name: 'cp215: news/story-card + news/byline — the posts-driven tile family (component-in-component)',
      run: async (ctx) => {
        const pages = await buildWith(nfData);

        // Blog index grid: tiles render through the component (byline nested inside)
        const blog = pages.get('/blog');
        ctx.expect(blog.includes('newsflash-story-card'), 'tile markup present (BEM)').toBeTruthy();
        ctx.expect(blog.includes('newsflash-byline'), 'byline block class through the nested component').toBeTruthy();
        ctx.expect(blog.includes('Mini story 17'), 'enriched posts in the grid').toBeTruthy();
        ctx.expect(blog.includes('Dec 15, 2023'), 'pre-formatted date arg').toBeTruthy();
        ctx.expect(blog.includes('min read'), 'captured readtime through the byline').toBeTruthy();
        ctx.expect(!blog.includes('>Undefined<'), 'kicker default-guard: no "Undefined" from title-casing a missing category').toBeTruthy();

        // Category pages fall through to the BASE taxonomy layout (#177 phase 2):
        // base post-cards, no newsflash fork vocabulary.
        const growth = pages.get('/blog/categories/growth');
        ctx.expect(growth.includes('omega-post-card'), 'base post-card include serves the category grid').toBeTruthy();
        ctx.expect(!growth.includes('newsflash-story-card'), 'no fork tile on the fallthrough page').toBeTruthy();

        // Index bands: top stories + more-to-chew-on tiles via the same component
        const home = pages.get('/about'); // rides the index layout
        ctx.expect(home.includes('Mini story 16'), 'top-stories tile (slot 3)').toBeTruthy();
        ctx.expect(home.includes('Mini story 03'), 'more-to-chew-on tile (slot 17)').toBeTruthy();
      },
    },

    {
      name: 'cp216/#177: rule-head/lede on the kept forks; about and team fall through to base',
      run: async (ctx) => {
        const pages = await buildWith(nfData);

        // The link slot renders live: index top-stories and blog/post related both
        // pass link args through the rule-head component (BEM classes).
        const home = pages.get('/about'); // rides the index layout
        ctx.expect(/Top stories<\/h2>[\s\S]{0,200}View all/.test(home), 'top-stories head links View all through the component').toBeTruthy();
        ctx.expect(home.includes('newsflash-rule-head__rule'), 'rule element wears the BEM class').toBeTruthy();
        const post = pages.get('/blog/first-post');
        ctx.expect(post.includes('View all'), 'related-posts head link').toBeTruthy();
        ctx.expect(post.includes('newsflash-rule-head'), 'post band heads render through the component').toBeTruthy();

        // The lede component serves the kept index bands (accent span, BEM)
        ctx.expect(home.includes('newsflash-lede'), 'lede block class on the kept bands').toBeTruthy();

        // about and team/member forks are DELETED: the base compositions serve,
        // with no newsflash fork vocabulary anywhere on them. (/about in the mini
        // fixture rides blueprint/index; /about-blueprint is the real about page.)
        const about = pages.get('/about-blueprint');
        ctx.expect(about.includes('omega-display'), 'about renders the base masthead cluster').toBeTruthy();
        ctx.expect(!about.includes('newsflash-rule-head'), 'no fork heads on the fallthrough page').toBeTruthy();
        const member = pages.get('/team/avery-quinn');
        ctx.expect(member.includes('omega-person'), 'member renders the base portrait split').toBeTruthy();
        ctx.expect(!member.includes('newsflash-rule-head'), 'no fork heads on the fallthrough page').toBeTruthy();
      },
    },

    {
      name: 'cp217: the newsletter slab renders through the nf override — BOTH dead forms fixed',
      run: async (ctx) => {
        const pages = await buildWith(nfData);

        // Post pages: the plain action="/email-subscription" form posted to a page
        // that doesn't exist (the cp209 bug, still live here) — the managed
        // form-manager dialect rides instead, inside the narrow centered column.
        const post = pages.get('/blog/first-post');
        ctx.expect(!post.includes('email-subscription'), 'the dead action-form dialect died').toBeTruthy();
        ctx.expect(post.includes('data-omega-section="marketing/newsletter-cta"'), 'presence-init root reaches nf posts').toBeTruthy();
        ctx.expect(post.includes('data-form-state="initializing"'), 'posts speak the form-manager dialect').toBeTruthy();
        ctx.expect(!post.includes('newsletter-success-alert') && !post.includes('newsletter-error-alert'), 'the static alert slots are culled (cp227) — FormManager presents success/error as toasts, the baked divs were never toggled').toBeTruthy();
        ctx.expect(post.includes('<div class="row justify-content-center"><div class="col-xl-8 col-lg-8 col-md-12 col-12">'), 'narrow knob wraps the card in the centered column').toBeTruthy();

        // Blog index: the inline slab had the managed markup but NO presence-init
        // root, so nothing ever bound it (frozen at "initializing", no-op submit).
        // Composing the section is what turns the binding on.
        const blog = pages.get('/blog');
        ctx.expect(blog.includes('data-omega-section="marketing/newsletter-cta"'), 'index slab is now §7-bound').toBeTruthy();
        ctx.expect(blog.includes('Never miss a'), 'index copy rode the bridge').toBeTruthy();
        ctx.expect(!blog.includes('<div class="row justify-content-center"><div class="col-xl-8'), 'index stays full-width (narrow off)').toBeTruthy();
      },
    },

    {
      name: 'cp217: §7 inherit over the real tree — the nf override keeps the base FormManager js in the bundle',
      run: (ctx) => {
        const themes = path.join(__dirname, '..', 'themes');
        const entries = collectSectionAssets([path.join(themes, 'newsflash'), path.join(themes, 'base')]);
        const entry = entries.find((item) => item.kind === 'section' && item.id === 'marketing/newsletter-cta');
        ctx.expect(entry, 'entry collected').toBeTruthy();
        ctx.expect(entry.js && entry.js.includes(`${path.sep}base${path.sep}`), `js inherited from the base layer, got: ${entry.js}`).toBeTruthy();
        ctx.expect(entry.scss, 'no scss on either layer — nothing invented').toBe(null);
      },
    },

    {
      name: '#177: the cta fork is deleted; marketing/cta falls through to base everywhere',
      run: async (ctx) => {
        const pages = await buildWith(nfData);

        // /download (always a fallthrough layout) now gets the BASE cta band too;
        // scss restyles omega-cta as the dark big-read slab. The fork's icon
        // rendering goes with it (base markup ignores icon keys, accepted).
        const download = pages.get('/download');
        ctx.expect(download.includes('omega-cta'), 'base cta markup serves the shared id').toBeTruthy();
        ctx.expect(!download.includes('cta-panel'), 'no trace of the deleted fork vocabulary').toBeTruthy();
      },
    },

    {
      name: 'cp218: the doctrine half that stays — body-called hero deliberately falls through to base',
      run: async (ctx) => {
        const pages = await buildWith(nfData);

        // nf composes no hero in its own vocabulary (the lede/splash family serves
        // that role), so {% section "marketing/hero" %} resolves consumer → nf →
        // base and the base serves. Fork only what the theme's design vocabulary
        // actually has.
        const demo = pages.get('/sections-demo');
        ctx.expect(demo.includes('omega-hero'), 'body-called hero falls through to the base').toBeTruthy();
        ctx.expect(!demo.includes('newsflash-hero'), 'nf hero vocabulary absent — no nf hero section exists').toBeTruthy();
      },
    },

    {
      name: 'cp218/#177: the rail signup card: the kept newsletter-cta fork\'s rail variant',
      run: async (ctx) => {
        const pages = await buildWith(nfData);
        const home = pages.get('/about'); // the fixture page that rides the index layout

        // The old inline card posted to action="/email-subscription" — a page that
        // doesn't exist. The rail variant of the nf newsletter-cta override rides
        // instead: managed dialect, §7-bound through its own root, no section/
        // container wrapper (it composes inside the aside rail).
        ctx.expect(!home.includes('email-subscription'), 'the dead action-form dialect died on the index rail').toBeTruthy();
        ctx.expect(home.includes('data-omega-section="marketing/newsletter-cta"'), 'rail card is a §7-bound instance of the shared section').toBeTruthy();
        ctx.expect(home.includes('data-form-state="initializing"'), 'rail speaks the form-manager dialect').toBeTruthy();
        ctx.expect(home.includes('button-text'), 'button text swaps through the managed span').toBeTruthy();
        ctx.expect(home.includes('id="signup"'), 'anchor knob keeps the hero deep link').toBeTruthy();
        ctx.expect(home.includes('Free forever. Unsubscribe anytime.'), 'disclaimer rides the bridge').toBeTruthy();

        // The index cta band composes the same BASE section the fallthrough pages
        // get (the fork is deleted; scss owns the big-read look).
        ctx.expect(home.includes('omega-cta'), 'base cta band through the section').toBeTruthy();
        ctx.expect(home.includes('omega-ink-panel'), 'the band rides the ink panel scss restyles').toBeTruthy();
      },
    },
  ],
});
