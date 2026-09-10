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
const { buildClickDestination } = require('../../../dist/manager/routes/verts/utils.js');
const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');

module.exports = defineCases({
  description: 'Verts click destination (UTM tagging)',
  type: 'group',
  tests: [
    {
      name: 'tags-the-stored-link-with-the-vert-utm-set',
      async run({ assert }) {
        const destination = new URL(await buildClickDestination({
          id: 'vert-a',
          link: 'https://shop.example/product',
        }, 'site.example', 'site-brand'));

        assert.equal(destination.origin + destination.pathname, 'https://shop.example/product', 'Destination should be the stored link');
        assert.equal(destination.searchParams.get('utm_source'), 'site-brand', 'utm_source should be the host brand id');
        assert.equal(destination.searchParams.get('utm_medium'), 'omega-vert', 'utm_medium should be omega-vert');
        assert.equal(destination.searchParams.get('utm_campaign'), 'vert-a', 'utm_campaign should be the vert id');
      },
    },

    {
      name: 'falls-back-to-the-parent-host-without-a-brand-id',
      async run({ assert }) {
        const destination = new URL(await buildClickDestination({
          id: 'vert-a',
          link: 'https://shop.example/product',
        }, 'site.example'));

        assert.equal(destination.searchParams.get('utm_source'), 'site.example', 'utm_source should fall back to the parent host');
        assert.equal(destination.searchParams.get('utm_campaign'), 'vert-a', 'utm_campaign should still be the vert id');
      },
    },

    {
      name: 'preserves-advertiser-params-and-never-double-appends',
      async run({ assert }) {
        const destination = new URL(await buildClickDestination({
          id: 'vert-a',
          link: 'https://shop.example/product?ref=house&utm_source=partner&utm_medium=email',
        }, 'site.example', 'site-brand'));

        assert.equal(destination.searchParams.get('ref'), 'house', 'Existing query params should survive');
        assert.equal(destination.searchParams.get('utm_source'), 'partner', 'The advertiser utm_source should win');
        assert.equal(destination.searchParams.get('utm_medium'), 'email', 'The advertiser utm_medium should win');
        assert.equal(destination.searchParams.getAll('utm_source').length, 1, 'utm_source should appear once');
        assert.equal(destination.searchParams.get('utm_campaign'), 'vert-a', 'The missing key should still be filled');
      },
    },

    {
      name: 'no-brand-and-no-parent-omits-utm-source',
      async run({ assert }) {
        const destination = new URL(await buildClickDestination({
          id: 'vert-a',
          link: 'https://shop.example/product',
        }, '', ''));

        assert.equal(destination.searchParams.get('utm_source'), null, 'utm_source should be absent without a brand id or a parent');
        assert.equal(destination.searchParams.get('utm_medium'), 'omega-vert', 'utm_medium should still be set');
        assert.equal(destination.searchParams.get('utm_campaign'), 'vert-a', 'utm_campaign should still be the vert id');
      },
    },
  ],
});
