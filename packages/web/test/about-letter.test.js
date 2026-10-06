/**
 * #456 — the about page's letter band. Two consumer holes, one file each:
 * the layout rendered the band unconditionally (only the gallery had a gate),
 * and the section hardcoded a demo ops feed, so every brand's /about claimed
 * "v2.4 shipped to production" with no way out. The band now takes the
 * gallery's `letter: false` gate, and the feed rides args whose defaults are
 * the placeholder copy (the photo-band idiom). Pinned over real builds: the
 * packaged default page for the untouched rendering, a consumer sidecar
 * (#269, the page-level data lane) for both overrides.
 *
 * #520 closed the third hole: emptying the feed still framed it — an empty
 * fragment box and a chip holding a bare dot. The aside now GATES on having
 * something to say (feed items, or the aside photo), and a letter with
 * neither runs full width with no aside markup at all.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');

const { buildSite, buildWith, miniData, BARE } = require('./lib/build.js');

const bareData = JSON.parse(fs.readFileSync(path.join(BARE, 'site-data.json'), 'utf8'));

/** A consumer /about riding the blueprint, with its band data in the sidecar. */
function makeConsumer(sidecar) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-about-letter-'));
  const consumerDir = path.join(tmp, 'src');
  fs.mkdirSync(path.join(consumerDir, 'pages'), { recursive: true });
  fs.writeFileSync(
    path.join(consumerDir, 'pages', 'about.md'),
    ['---', 'layout: blueprint/about', 'permalink: /about', '---', ''].join('\n'),
  );
  fs.writeFileSync(
    path.join(consumerDir, 'pages', 'about.11tydata.json'),
    `${JSON.stringify(sidecar, null, 2)}\n`,
  );
  return { tmp, consumerDir };
}

module.exports = defineCases({
  type: 'group',
  description: 'about-letter',
  tests: [
    {
      name: '#456: letter: false kills the band — the gallery gate, on the letter',
      run: async (ctx) => {
        const { tmp, consumerDir } = makeConsumer({ letter: false });
        try {
          const pages = await buildSite(consumerDir, bareData, { environment: 'development' }, 'about-letter-off');
          const html = pages.get('/about');
          ctx.expect(html, 'the about page built').toBeTruthy();

          ctx.expect(!html.includes('omega-fragment'), 'the ops feed is gone').toBeTruthy();
          ctx.expect(!html.includes('omega-statement'), 'and so are the mission/vision statements').toBeTruthy();
          ctx.expect(!html.includes('All systems go'), 'no status chip survives the opt-out').toBeTruthy();
          // The rest of the composition is untouched — the gate kills one band.
          ctx.expect(html.includes('omega-timeline'), 'the journey still renders').toBeTruthy();
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },

    {
      name: '#456: a brand\'s own feed items and status chip replace the placeholder copy',
      run: async (ctx) => {
        const { tmp, consumerDir } = makeConsumer({
          letter: {
            feed_items: [
              { icon: 'code-branch', text: 'The <strong>2.0</strong> rewrite landed' },
              { icon: 'user-plus', text: 'Priya joined the support desk' },
            ],
            feed_status: 'Shipping daily',
          },
        });
        try {
          const pages = await buildSite(consumerDir, bareData, { environment: 'development' }, 'about-letter-feed');
          const html = pages.get('/about');
          ctx.expect(html, 'the about page built').toBeTruthy();

          ctx.expect(html.includes('The <strong>2.0</strong> rewrite landed'), 'the brand item renders, markup and all').toBeTruthy();
          ctx.expect(html.includes('Priya joined the support desk'), 'every supplied item renders').toBeTruthy();
          ctx.expect(html.includes('Shipping daily'), 'the brand names its own status chip').toBeTruthy();
          ctx.expect((html.match(/omega-fragment__msg"/g) || []).length, 'exactly the supplied items — the demo feed is REPLACED, not appended to').toBe(2);
          ctx.expect(!html.includes('shipped to production'), 'no fabricated release claim survives').toBeTruthy();
          ctx.expect(!html.includes('All systems go'), 'nor the default chip').toBeTruthy();
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },

    {
      name: '#520: an emptied feed renders NO aside at all — no frame, no chip, no label',
      run: async (ctx) => {
        const { tmp, consumerDir } = makeConsumer({ letter: { feed_items: [] } });
        try {
          const pages = await buildSite(consumerDir, bareData, { environment: 'development' }, 'about-letter-nofeed');
          const html = pages.get('/about');
          ctx.expect(html, 'the about page built').toBeTruthy();

          // The letter's own aside — the timeline band further down owns the other
          // `omega-duo__aside omega-section-head` on this page.
          ctx.expect(!html.includes('<div class="omega-duo__aside" data-omega-reveal>'), 'the aside column is gone, not emptied').toBeTruthy();
          ctx.expect(!html.includes('omega-fragment'), 'no empty frame').toBeTruthy();
          ctx.expect(!html.includes('omega-fragment-chip'), 'no chip holding a bare dot').toBeTruthy();
          ctx.expect(!html.includes('Why we exist'), 'and no orphan aside label').toBeTruthy();
          // The letter itself is the whole point of the band — it stays.
          ctx.expect(html.includes('omega-statement'), 'the mission/vision statements still render').toBeTruthy();
          ctx.expect(html.includes('Our mission'), 'with their own labels').toBeTruthy();
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },

    {
      name: '#520: an emptied feed with an aside PHOTO keeps the aside — the picture is content',
      run: async (ctx) => {
        const { tmp, consumerDir } = makeConsumer({
          letter: {
            feed_items: [],
            image: '/assets/images/core/placeholder/photo-3.jpg',
            image_alt: 'Placeholder artwork in soft green tones',
          },
        });
        try {
          const pages = await buildSite(consumerDir, bareData, { environment: 'development' }, 'about-letter-photo-nofeed');
          const html = pages.get('/about');
          ctx.expect(html, 'the about page built').toBeTruthy();

          ctx.expect(html.includes('<div class="omega-duo__aside" data-omega-reveal>'), 'the aside column survives for the photo').toBeTruthy();
          ctx.expect(html.includes('omega-aside-photo'), 'the photo hangs where it always did').toBeTruthy();
          ctx.expect(!html.includes('omega-fragment'), 'while the feed frame stays gone').toBeTruthy();
          ctx.expect(!html.includes('All systems go'), 'chip and all').toBeTruthy();
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },

    {
      name: '#520: the gallery shows the feedless form — the letter, full width',
      run: async (ctx) => {
        const pages = await buildWith(miniData, {}, 'about-letter-frames');
        const frame = pages.get('/test/sections/about/letter/frames/no-feed-the-full-width-letter');
        ctx.expect(frame, 'the feedless variant frame built').toBeTruthy();

        ctx.expect(!frame.includes('omega-duo'), 'no aside column, so no duo grid either').toBeTruthy();
        ctx.expect(!frame.includes('omega-fragment'), 'and nothing left of the feed').toBeTruthy();
        ctx.expect(frame.includes('omega-statement'), 'the statements are the whole band now').toBeTruthy();
      },
    },

    {
      name: '#456: no letter data — the packaged about page renders the placeholder feed, unchanged',
      run: async (ctx) => {
        const pages = await buildSite(BARE, bareData, { environment: 'development' }, 'about-letter-default');
        const html = pages.get('/about');
        ctx.expect(html, 'the packaged about page built').toBeTruthy();

        ctx.expect(html.includes('This week at BareCo'), 'the feed label still liquifies against the brand').toBeTruthy();
        ctx.expect(html.includes('<strong>v2.4</strong> shipped to production'), 'the placeholder feed is byte-identical').toBeTruthy();
        ctx.expect(html.includes('Two new faces on support'), 'item two, unchanged').toBeTruthy();
        ctx.expect(html.includes('"Best tool we\'ve adopted this year"'), 'item three, unchanged').toBeTruthy();
        ctx.expect(html.includes('All systems go'), 'and the status chip').toBeTruthy();
        ctx.expect((html.match(/omega-fragment__msg"/g) || []).length, 'three feed messages, as before').toBe(3);
      },
    },
  ],
});
