/**
 * Test: /omega/ads admin CRUD — create/read/update/delete + auth gating
 *
 * Run: npx omega test backend:routes/ads/crud
 */
module.exports = {
  description: 'Ads admin CRUD',
  type: 'suite',
  tests: [
    {
      name: 'create-requires-auth',
      timeout: 15000,
      async run({ http, assert }) {
        const response = await http.as('none').post('omega/ads', { title: 'Nope', link: 'https://x.example' });

        assert.isError(response, 401, 'Unauthenticated create should 401');
      },
    },

    {
      name: 'create-requires-admin',
      timeout: 15000,
      async run({ http, assert }) {
        const response = await http.as('basic').post('omega/ads', { title: 'Nope', link: 'https://x.example' });

        assert.isError(response, 403, 'Non-admin create should 403');
      },
    },

    {
      name: 'admin-creates-ad-with-defaults',
      timeout: 15000,
      async run({ http, assert, firestore, state }) {
        const response = await http.as('admin').post('omega/ads', {
          title: 'CRUD Test Ad',
          description: 'A test ad.',
          button: 'Go',
          link: 'https://crud-shop.example/item',
          footer: 'Sponsored',
          targeting: { categories: ['testing'] },
        });

        assert.isSuccess(response, 'Create should succeed');
        assert.hasProperty(response, 'data.ad.id', 'Response should contain the ad id');

        state.adId = response.data.ad.id;

        const doc = await firestore.get(`ads/${state.adId}`);

        assert.ok(doc, 'Ad doc should exist in Firestore');
        assert.equal(doc.title, 'CRUD Test Ad', 'Title should persist');
        assert.equal(doc.enabled, true, 'enabled should default to true');
        assert.equal(doc.weight, 1, 'weight should default to 1');
        assert.deepEqual(doc.targeting, { sites: [], categories: ['testing'], keywords: [] }, 'targeting should normalize to the full shape');
        assert.deepEqual(doc.whitelist, [], 'whitelist should default empty');
        assert.deepEqual(doc.blacklist, [], 'blacklist should default empty');
        assert.hasProperty(doc, 'metadata.created.timestamp', 'metadata.created should be set');
        assert.hasProperty(doc, 'metadata.updated.timestamp', 'metadata.updated should be set');
      },
    },

    {
      name: 'create-rejects-missing-title',
      timeout: 15000,
      async run({ http, assert }) {
        const response = await http.as('admin').post('omega/ads', { link: 'https://x.example' });

        assert.isError(response, 400, 'Missing title should 400');
      },
    },

    {
      name: 'create-rejects-invalid-link',
      timeout: 15000,
      async run({ http, assert }) {
        const response = await http.as('admin').post('omega/ads', { title: 'Bad Link', link: 'javascript:alert(1)' });

        assert.isError(response, 400, 'Non-http(s) link should 400');
      },
    },

    {
      name: 'list-requires-admin',
      timeout: 15000,
      async run({ http, assert }) {
        const response = await http.as('basic').get('omega/ads');

        assert.isError(response, 403, 'Non-admin list should 403');
      },
    },

    {
      name: 'admin-lists-and-gets-ads',
      timeout: 15000,
      async run({ http, assert, state }) {
        const list = await http.as('admin').get('omega/ads');

        assert.isSuccess(list, 'List should succeed');
        assert.ok(list.data.ads.some((ad) => ad.id === state.adId), 'List should contain the created ad');

        const single = await http.as('admin').get('omega/ads', { id: state.adId });

        assert.isSuccess(single, 'Get by id should succeed');
        assert.propertyEquals(single, 'data.ad.title', 'CRUD Test Ad', 'Single get should return the ad');
      },
    },

    {
      name: 'get-unknown-id-returns-404',
      timeout: 15000,
      async run({ http, assert }) {
        const response = await http.as('admin').get('omega/ads', { id: 'does-not-exist' });

        assert.isError(response, 404, 'Unknown id should 404');
      },
    },

    {
      name: 'admin-updates-provided-fields-only',
      timeout: 15000,
      async run({ http, assert, firestore, state }) {
        const response = await http.as('admin').put('omega/ads', {
          id: state.adId,
          title: 'Updated Ad',
          weight: 5,
          enabled: false,
        });

        assert.isSuccess(response, 'Update should succeed');

        const doc = await firestore.get(`ads/${state.adId}`);

        assert.equal(doc.title, 'Updated Ad', 'Title should update');
        assert.equal(doc.weight, 5, 'Weight should update');
        assert.equal(doc.enabled, false, 'Enabled should update');
        assert.equal(doc.link, 'https://crud-shop.example/item', 'Untouched fields should persist');
        assert.hasProperty(doc, 'metadata.created.timestamp', 'metadata.created should survive updates');
      },
    },

    {
      name: 'update-requires-admin',
      timeout: 15000,
      async run({ http, assert, state }) {
        const response = await http.as('basic').put('omega/ads', { id: state.adId, title: 'Hijack' });

        assert.isError(response, 403, 'Non-admin update should 403');
      },
    },

    {
      name: 'update-unknown-id-returns-404',
      timeout: 15000,
      async run({ http, assert }) {
        const response = await http.as('admin').put('omega/ads', { id: 'does-not-exist', title: 'Ghost' });

        assert.isError(response, 404, 'Unknown id should 404');
      },
    },

    {
      name: 'delete-requires-admin',
      timeout: 15000,
      async run({ http, assert, state }) {
        const response = await http.as('basic').delete('omega/ads', { id: state.adId });

        assert.isError(response, 403, 'Non-admin delete should 403');
      },
    },

    {
      name: 'admin-deletes-ad',
      timeout: 15000,
      async run({ http, assert, firestore, state }) {
        const response = await http.as('admin').delete('omega/ads', { id: state.adId });

        assert.isSuccess(response, 'Delete should succeed');
        assert.equal(await firestore.exists(`ads/${state.adId}`), false, 'Ad doc should be gone');
      },
    },

    {
      name: 'delete-unknown-id-returns-404',
      timeout: 15000,
      async run({ http, assert }) {
        const response = await http.as('admin').delete('omega/ads', { id: 'does-not-exist' });

        assert.isError(response, 404, 'Unknown id should 404');
      },
    },
  ],
};
