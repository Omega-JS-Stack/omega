/**
 * Test: GET /omega/verts/redirect — fail-closed click redirect
 *
 * Uses native fetch with redirect: 'manual' to assert the 302 Location.
 *
 * Run: npx omega test backend:routes/verts/redirect
 */

const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');
module.exports = defineCases({
  description: 'Verts redirect route (fail-closed)',
  type: 'suite',
  tests: [
    {
      name: 'redirects-to-stored-link-with-utm',
      timeout: 30000,
      async run({ expect, firestore, config }) {
        await firestore.set('verts/redirect-a', {
          id: 'redirect-a',
          enabled: true,
          title: 'Redirect Vert',
          link: 'https://shop.example/product?ref=house',
          weight: 1,
        });

        const response = await fetch(`${config.apiUrl}/omega/verts/redirect?id=redirect-a&parent=site.example&brand=site-brand`, { redirect: 'manual' });

        expect(response.status, 'Redirect should 302').toBe(302);

        const location = new URL(response.headers.get('location'));

        expect(location.origin + location.pathname, 'Location should be the STORED link').toBe('https://shop.example/product');
        expect(location.searchParams.get('ref'), 'Existing query params should survive').toBe('house');
        expect(location.searchParams.get('utm_source'), 'utm_source should be the host brand id').toBe('site-brand');
        expect(location.searchParams.get('utm_medium'), 'utm_medium should be omega-vert').toBe('omega-vert');
        expect(location.searchParams.get('utm_campaign'), 'utm_campaign should be the vert id').toBe('redirect-a');
      },
    },

    {
      name: 'no-brand-falls-back-to-the-parent-host',
      timeout: 30000,
      async run({ expect, config }) {
        const response = await fetch(`${config.apiUrl}/omega/verts/redirect?id=redirect-a&parent=site.example`, { redirect: 'manual' });

        expect(response.status, 'Redirect should 302').toBe(302);

        const location = new URL(response.headers.get('location'));

        expect(location.searchParams.get('utm_source'), 'utm_source should fall back to the parent host').toBe('site.example');
      },
    },

    {
      name: 'no-brand-and-no-parent-omits-utm-source',
      timeout: 30000,
      async run({ expect, config }) {
        const response = await fetch(`${config.apiUrl}/omega/verts/redirect?id=redirect-a`, { redirect: 'manual' });

        expect(response.status, 'Redirect should 302').toBe(302);

        const location = new URL(response.headers.get('location'));

        expect(location.searchParams.get('utm_source'), 'utm_source should be absent without a brand id or a parent').toBe(null);
        expect(location.searchParams.get('utm_medium'), 'utm_medium should still be omega-vert').toBe('omega-vert');
      },
    },

    {
      name: 'unknown-id-returns-404',
      timeout: 30000,
      async run({ expect, config }) {
        const response = await fetch(`${config.apiUrl}/omega/verts/redirect?id=does-not-exist`, { redirect: 'manual' });

        expect(response.status, 'Unknown vert id should 404').toBe(404);
      },
    },

    {
      name: 'missing-id-returns-400',
      timeout: 30000,
      async run({ expect, config }) {
        const response = await fetch(`${config.apiUrl}/omega/verts/redirect`, { redirect: 'manual' });

        expect(response.status, 'Missing id should fail schema validation with 400').toBe(400);
      },
    },

    {
      name: 'caller-supplied-url-is-ignored',
      timeout: 30000,
      async run({ expect, config }) {
        // A url param must NEVER influence the destination — fail closed
        const response = await fetch(`${config.apiUrl}/omega/verts/redirect?id=redirect-a&url=${encodeURIComponent('https://evil.example/phish')}`, { redirect: 'manual' });

        expect(response.status, 'Redirect should 302').toBe(302);

        const location = new URL(response.headers.get('location'));

        expect(location.hostname, 'Location must be the stored link host, never the caller URL').toBe('shop.example');
        expect(!response.headers.get('location').includes('evil.example'), 'Caller-supplied URL must be ignored').toBeTruthy();
      },
    },

    {
      name: 'vert-with-invalid-link-fails-closed',
      timeout: 30000,
      async run({ expect, firestore, config }) {
        await firestore.set('verts/redirect-bad-link', {
          id: 'redirect-bad-link',
          enabled: true,
          title: 'Bad Link',
          link: 'javascript:alert(1)',
          weight: 1,
        });

        const response = await fetch(`${config.apiUrl}/omega/verts/redirect?id=redirect-bad-link`, { redirect: 'manual' });

        expect(response.status, 'A non-http(s) stored link should fail closed with 404').toBe(404);
      },
    },

    {
      name: 'disabled-vert-still-redirects-to-its-own-link',
      timeout: 30000,
      async run({ expect, firestore, config }) {
        // Clicks on a just-disabled vert must still resolve — it is still only
        // ITS stored link
        await firestore.set('verts/redirect-disabled', {
          id: 'redirect-disabled',
          enabled: false,
          title: 'Disabled Vert',
          link: 'https://disabled-shop.example/item',
          weight: 1,
        });

        const response = await fetch(`${config.apiUrl}/omega/verts/redirect?id=redirect-disabled`, { redirect: 'manual' });

        expect(response.status, 'Disabled vert should still redirect (stored link only)').toBe(302);

        const location = new URL(response.headers.get('location'));

        expect(location.hostname, 'Location should be the disabled vert\'s stored link').toBe('disabled-shop.example');
      },
    },
  ],
});
