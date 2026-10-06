/**
 * Test: the redirect route's click destination (pure logic)
 *
 * buildClickDestination is the redirect route's whole URL story: a vert's
 * STORED link, tagged with the vert UTM set through the ONE tagger both lanes
 * share (@omega.js/client's `modules/vert-document.js`). Pure function —
 * called directly per the no-mock doctrine's only exception.
 *
 * Run: npx omega test backend:routes/verts/click-destination
 */
const { buildClickDestination } = require('../../../dist/omega/routes/verts/utils.js');
const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');

module.exports = defineCases({
  description: 'Verts click destination (UTM tagging)',
  type: 'group',
  tests: [
    {
      name: 'tags-the-stored-link-with-the-vert-utm-set',
      async run({ expect }) {
        const destination = new URL(await buildClickDestination({
          id: 'vert-a',
          link: 'https://shop.example/product',
        }, 'site.example', 'site-brand'));

        expect(destination.origin + destination.pathname, 'Destination should be the stored link').toBe('https://shop.example/product');
        expect(destination.searchParams.get('utm_source'), 'utm_source should be the host brand id').toBe('site-brand');
        expect(destination.searchParams.get('utm_medium'), 'utm_medium should be omega-vert').toBe('omega-vert');
        expect(destination.searchParams.get('utm_campaign'), 'utm_campaign should be the vert id').toBe('vert-a');
      },
    },

    {
      name: 'falls-back-to-the-parent-host-without-a-brand-id',
      async run({ expect }) {
        const destination = new URL(await buildClickDestination({
          id: 'vert-a',
          link: 'https://shop.example/product',
        }, 'site.example'));

        expect(destination.searchParams.get('utm_source'), 'utm_source should fall back to the parent host').toBe('site.example');
        expect(destination.searchParams.get('utm_campaign'), 'utm_campaign should still be the vert id').toBe('vert-a');
      },
    },

    {
      name: 'preserves-advertiser-params-and-never-double-appends',
      async run({ expect }) {
        const destination = new URL(await buildClickDestination({
          id: 'vert-a',
          link: 'https://shop.example/product?ref=house&utm_source=partner&utm_medium=email',
        }, 'site.example', 'site-brand'));

        expect(destination.searchParams.get('ref'), 'Existing query params should survive').toBe('house');
        expect(destination.searchParams.get('utm_source'), 'The advertiser utm_source should win').toBe('partner');
        expect(destination.searchParams.get('utm_medium'), 'The advertiser utm_medium should win').toBe('email');
        expect(destination.searchParams.getAll('utm_source').length, 'utm_source should appear once').toBe(1);
        expect(destination.searchParams.get('utm_campaign'), 'The missing key should still be filled').toBe('vert-a');
      },
    },

    {
      name: 'no-brand-and-no-parent-omits-utm-source',
      async run({ expect }) {
        const destination = new URL(await buildClickDestination({
          id: 'vert-a',
          link: 'https://shop.example/product',
        }, '', ''));

        expect(destination.searchParams.get('utm_source'), 'utm_source should be absent without a brand id or a parent').toBe(null);
        expect(destination.searchParams.get('utm_medium'), 'utm_medium should still be set').toBe('omega-vert');
        expect(destination.searchParams.get('utm_campaign'), 'utm_campaign should still be the vert id').toBe('vert-a');
      },
    },
  ],
});
