/**
 * Test: GET /omega/ads/redirect — fail-closed click redirect
 *
 * Uses native fetch with redirect: 'manual' to assert the 302 Location.
 *
 * Run: npx omega test backend:routes/ads/redirect
 */
const BASE_URL = 'http://localhost:5002';

module.exports = {
  description: 'Ads redirect route (fail-closed)',
  type: 'suite',
  tests: [
    {
      name: 'redirects-to-stored-link-with-utm',
      timeout: 30000,
      async run({ assert, firestore }) {
        await firestore.set('ads/redirect-a', {
          id: 'redirect-a',
          enabled: true,
          title: 'Redirect Ad',
          link: 'https://shop.example/product?ref=house',
          weight: 1,
        });

        const response = await fetch(`${BASE_URL}/omega/ads/redirect?id=redirect-a&parent=site.example`, { redirect: 'manual' });

        assert.equal(response.status, 302, 'Redirect should 302');

        const location = new URL(response.headers.get('location'));

        assert.equal(location.origin + location.pathname, 'https://shop.example/product', 'Location should be the STORED link');
        assert.equal(location.searchParams.get('ref'), 'house', 'Existing query params should survive');
        assert.equal(location.searchParams.get('utm_source'), 'site.example', 'utm_source should be the parent host');
        assert.equal(location.searchParams.get('utm_medium'), 'ad', 'utm_medium should be ad');
        assert.equal(location.searchParams.get('utm_campaign'), 'redirect-a', 'utm_campaign should be the ad id');
      },
    },

    {
      name: 'no-parent-omits-utm-source',
      timeout: 30000,
      async run({ assert }) {
        const response = await fetch(`${BASE_URL}/omega/ads/redirect?id=redirect-a`, { redirect: 'manual' });

        assert.equal(response.status, 302, 'Redirect should 302');

        const location = new URL(response.headers.get('location'));

        assert.equal(location.searchParams.get('utm_source'), null, 'utm_source should be absent without a parent');
        assert.equal(location.searchParams.get('utm_medium'), 'ad', 'utm_medium should still be ad');
      },
    },

    {
      name: 'unknown-id-returns-404',
      timeout: 30000,
      async run({ assert }) {
        const response = await fetch(`${BASE_URL}/omega/ads/redirect?id=does-not-exist`, { redirect: 'manual' });

        assert.equal(response.status, 404, 'Unknown ad id should 404');
      },
    },

    {
      name: 'missing-id-returns-400',
      timeout: 30000,
      async run({ assert }) {
        const response = await fetch(`${BASE_URL}/omega/ads/redirect`, { redirect: 'manual' });

        assert.equal(response.status, 400, 'Missing id should fail schema validation with 400');
      },
    },

    {
      name: 'caller-supplied-url-is-ignored',
      timeout: 30000,
      async run({ assert }) {
        // A url param must NEVER influence the destination — fail closed
        const response = await fetch(`${BASE_URL}/omega/ads/redirect?id=redirect-a&url=${encodeURIComponent('https://evil.example/phish')}`, { redirect: 'manual' });

        assert.equal(response.status, 302, 'Redirect should 302');

        const location = new URL(response.headers.get('location'));

        assert.equal(location.hostname, 'shop.example', 'Location must be the stored link host, never the caller URL');
        assert.ok(!response.headers.get('location').includes('evil.example'), 'Caller-supplied URL must be ignored');
      },
    },

    {
      name: 'ad-with-invalid-link-fails-closed',
      timeout: 30000,
      async run({ assert, firestore }) {
        await firestore.set('ads/redirect-bad-link', {
          id: 'redirect-bad-link',
          enabled: true,
          title: 'Bad Link',
          link: 'javascript:alert(1)',
          weight: 1,
        });

        const response = await fetch(`${BASE_URL}/omega/ads/redirect?id=redirect-bad-link`, { redirect: 'manual' });

        assert.equal(response.status, 404, 'A non-http(s) stored link should fail closed with 404');
      },
    },

    {
      name: 'disabled-ad-still-redirects-to-its-own-link',
      timeout: 30000,
      async run({ assert, firestore }) {
        // Clicks on a just-disabled ad must still resolve — it is still only
        // ITS stored link
        await firestore.set('ads/redirect-disabled', {
          id: 'redirect-disabled',
          enabled: false,
          title: 'Disabled Ad',
          link: 'https://disabled-shop.example/item',
          weight: 1,
        });

        const response = await fetch(`${BASE_URL}/omega/ads/redirect?id=redirect-disabled`, { redirect: 'manual' });

        assert.equal(response.status, 302, 'Disabled ad should still redirect (stored link only)');

        const location = new URL(response.headers.get('location'));

        assert.equal(location.hostname, 'disabled-shop.example', 'Location should be the disabled ad\'s stored link');
      },
    },
  ],
};
