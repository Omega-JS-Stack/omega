/**
 * Test: /omega/verts admin CRUD — create/read/update/delete + auth gating
 *
 * Run: npx omega test backend:routes/verts/crud
 */
module.exports = {
  description: 'Verts admin CRUD',
  type: 'suite',
  tests: [
    {
      name: 'create-requires-auth',
      timeout: 15000,
      async run({ http, assert }) {
        const response = await http.as('none').post('omega/verts', { title: 'Nope', link: 'https://x.example' });

        assert.isError(response, 401, 'Unauthenticated create should 401');
      },
    },

    {
      name: 'create-requires-admin',
      timeout: 15000,
      async run({ http, assert }) {
        const response = await http.as('basic').post('omega/verts', { title: 'Nope', link: 'https://x.example' });

        assert.isError(response, 403, 'Non-admin create should 403');
      },
    },

    {
      name: 'admin-creates-vert-with-defaults',
      timeout: 15000,
      async run({ http, assert, firestore, state }) {
        const response = await http.as('admin').post('omega/verts', {
          title: 'CRUD Test Vert',
          description: 'A test vert.',
          button: 'Go',
          link: 'https://crud-shop.example/item',
          footer: 'Sponsored',
          targeting: { categories: ['testing'] },
        });

        assert.isSuccess(response, 'Create should succeed');
        assert.hasProperty(response, 'data.vert.id', 'Response should contain the vert id');

        state.vertId = response.data.vert.id;

        const doc = await firestore.get(`verts/${state.vertId}`);

        assert.ok(doc, 'Vert doc should exist in Firestore');
        assert.equal(doc.title, 'CRUD Test Vert', 'Title should persist');
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
        const response = await http.as('admin').post('omega/verts', { link: 'https://x.example' });

        assert.isError(response, 400, 'Missing title should 400');
      },
    },

    {
      name: 'create-rejects-invalid-link',
      timeout: 15000,
      async run({ http, assert }) {
        const response = await http.as('admin').post('omega/verts', { title: 'Bad Link', link: 'javascript:alert(1)' });

        assert.isError(response, 400, 'Non-http(s) link should 400');
      },
    },

    {
      name: 'list-requires-admin',
      timeout: 15000,
      async run({ http, assert }) {
        const response = await http.as('basic').get('omega/verts');

        assert.isError(response, 403, 'Non-admin list should 403');
      },
    },

    {
      name: 'admin-lists-and-gets-verts',
      timeout: 15000,
      async run({ http, assert, state }) {
        const list = await http.as('admin').get('omega/verts');

        assert.isSuccess(list, 'List should succeed');
        assert.ok(list.data.verts.some((vert) => vert.id === state.vertId), 'List should contain the created vert');

        const single = await http.as('admin').get('omega/verts', { id: state.vertId });

        assert.isSuccess(single, 'Get by id should succeed');
        assert.propertyEquals(single, 'data.vert.title', 'CRUD Test Vert', 'Single get should return the vert');
      },
    },

    {
      name: 'get-unknown-id-returns-404',
      timeout: 15000,
      async run({ http, assert }) {
        const response = await http.as('admin').get('omega/verts', { id: 'does-not-exist' });

        assert.isError(response, 404, 'Unknown id should 404');
      },
    },

    {
      name: 'admin-updates-provided-fields-only',
      timeout: 15000,
      async run({ http, assert, firestore, state }) {
        const response = await http.as('admin').put('omega/verts', {
          id: state.vertId,
          title: 'Updated Vert',
          weight: 5,
          enabled: false,
        });

        assert.isSuccess(response, 'Update should succeed');

        const doc = await firestore.get(`verts/${state.vertId}`);

        assert.equal(doc.title, 'Updated Vert', 'Title should update');
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
        const response = await http.as('basic').put('omega/verts', { id: state.vertId, title: 'Hijack' });

        assert.isError(response, 403, 'Non-admin update should 403');
      },
    },

    {
      name: 'update-unknown-id-returns-404',
      timeout: 15000,
      async run({ http, assert }) {
        const response = await http.as('admin').put('omega/verts', { id: 'does-not-exist', title: 'Ghost' });

        assert.isError(response, 404, 'Unknown id should 404');
      },
    },

    {
      name: 'delete-requires-admin',
      timeout: 15000,
      async run({ http, assert, state }) {
        const response = await http.as('basic').delete('omega/verts', { id: state.vertId });

        assert.isError(response, 403, 'Non-admin delete should 403');
      },
    },

    {
      name: 'admin-deletes-vert',
      timeout: 15000,
      async run({ http, assert, firestore, state }) {
        const response = await http.as('admin').delete('omega/verts', { id: state.vertId });

        assert.isSuccess(response, 'Delete should succeed');
        assert.equal(await firestore.exists(`verts/${state.vertId}`), false, 'Vert doc should be gone');
      },
    },

    {
      name: 'delete-unknown-id-returns-404',
      timeout: 15000,
      async run({ http, assert }) {
        const response = await http.as('admin').delete('omega/verts', { id: 'does-not-exist' });

        assert.isError(response, 404, 'Unknown id should 404');
      },
    },
  ],
};
