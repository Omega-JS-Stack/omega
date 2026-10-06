/**
 * Test: /omega/verts admin CRUD — create/read/update/delete + auth gating
 *
 * Run: npx omega test backend:routes/verts/crud
 */

const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');
module.exports = defineCases({
  description: 'Verts admin CRUD',
  type: 'suite',
  tests: [
    {
      name: 'create-requires-auth',
      timeout: 15000,
      async run({ http, expect }) {
        const response = await http.as('none').post('omega/verts', { title: 'Nope', link: 'https://x.example' });

        expect(response, 'Unauthenticated create should 401').toBeError(401);
      },
    },

    {
      name: 'create-requires-admin',
      timeout: 15000,
      async run({ http, expect }) {
        const response = await http.as('basic').post('omega/verts', { title: 'Nope', link: 'https://x.example' });

        expect(response, 'Non-admin create should 403').toBeError(403);
      },
    },

    {
      name: 'admin-creates-vert-with-defaults',
      timeout: 15000,
      async run({ http, expect, firestore, state }) {
        const response = await http.as('admin').post('omega/verts', {
          title: 'CRUD Test Vert',
          description: 'A test vert.',
          button: 'Go',
          link: 'https://crud-shop.example/item',
          footer: 'Sponsored',
          targeting: { categories: ['testing'] },
        });

        expect(response, 'Create should succeed').toBeSuccess();
        expect(response, 'Response should contain the vert id').toHaveProperty('data.vert.id');

        state.vertId = response.data.vert.id;

        const doc = await firestore.get(`verts/${state.vertId}`);

        expect(doc, 'Vert doc should exist in Firestore').toBeTruthy();
        expect(doc.title, 'Title should persist').toBe('CRUD Test Vert');
        expect(doc.enabled, 'enabled should default to true').toBe(true);
        expect(doc.weight, 'weight should default to 1').toBe(1);
        expect(doc.targeting, 'targeting should normalize to the full shape').toEqual({ sites: [], categories: ['testing'], keywords: [] });
        expect(doc.whitelist, 'whitelist should default empty').toEqual([]);
        expect(doc.blacklist, 'blacklist should default empty').toEqual([]);
        expect(doc, 'metadata.created should be set').toHaveProperty('metadata.created.timestamp');
        expect(doc, 'metadata.updated should be set').toHaveProperty('metadata.updated.timestamp');
      },
    },

    {
      name: 'create-rejects-missing-title',
      timeout: 15000,
      async run({ http, expect }) {
        const response = await http.as('admin').post('omega/verts', { link: 'https://x.example' });

        expect(response, 'Missing title should 400').toBeError(400);
      },
    },

    {
      name: 'create-rejects-invalid-link',
      timeout: 15000,
      async run({ http, expect }) {
        const response = await http.as('admin').post('omega/verts', { title: 'Bad Link', link: 'javascript:alert(1)' });

        expect(response, 'Non-http(s) link should 400').toBeError(400);
      },
    },

    {
      name: 'list-requires-admin',
      timeout: 15000,
      async run({ http, expect }) {
        const response = await http.as('basic').get('omega/verts');

        expect(response, 'Non-admin list should 403').toBeError(403);
      },
    },

    {
      name: 'admin-lists-and-gets-verts',
      timeout: 15000,
      async run({ http, expect, state }) {
        const list = await http.as('admin').get('omega/verts');

        expect(list, 'List should succeed').toBeSuccess();
        expect(list.data.verts.some((vert) => vert.id === state.vertId), 'List should contain the created vert').toBeTruthy();

        const single = await http.as('admin').get('omega/verts', { id: state.vertId });

        expect(single, 'Get by id should succeed').toBeSuccess();
        expect(single, 'Single get should return the vert').toHaveProperty('data.vert.title', 'CRUD Test Vert');
      },
    },

    {
      name: 'get-unknown-id-returns-404',
      timeout: 15000,
      async run({ http, expect }) {
        const response = await http.as('admin').get('omega/verts', { id: 'does-not-exist' });

        expect(response, 'Unknown id should 404').toBeError(404);
      },
    },

    {
      name: 'admin-updates-provided-fields-only',
      timeout: 15000,
      async run({ http, expect, firestore, state }) {
        const response = await http.as('admin').put('omega/verts', {
          id: state.vertId,
          title: 'Updated Vert',
          weight: 5,
          enabled: false,
        });

        expect(response, 'Update should succeed').toBeSuccess();

        const doc = await firestore.get(`verts/${state.vertId}`);

        expect(doc.title, 'Title should update').toBe('Updated Vert');
        expect(doc.weight, 'Weight should update').toBe(5);
        expect(doc.enabled, 'Enabled should update').toBe(false);
        expect(doc.link, 'Untouched fields should persist').toBe('https://crud-shop.example/item');
        expect(doc, 'metadata.created should survive updates').toHaveProperty('metadata.created.timestamp');
      },
    },

    {
      name: 'update-requires-admin',
      timeout: 15000,
      async run({ http, expect, state }) {
        const response = await http.as('basic').put('omega/verts', { id: state.vertId, title: 'Hijack' });

        expect(response, 'Non-admin update should 403').toBeError(403);
      },
    },

    {
      name: 'update-unknown-id-returns-404',
      timeout: 15000,
      async run({ http, expect }) {
        const response = await http.as('admin').put('omega/verts', { id: 'does-not-exist', title: 'Ghost' });

        expect(response, 'Unknown id should 404').toBeError(404);
      },
    },

    {
      name: 'delete-requires-admin',
      timeout: 15000,
      async run({ http, expect, state }) {
        const response = await http.as('basic').delete('omega/verts', { id: state.vertId });

        expect(response, 'Non-admin delete should 403').toBeError(403);
      },
    },

    {
      name: 'admin-deletes-vert',
      timeout: 15000,
      async run({ http, expect, firestore, state }) {
        const response = await http.as('admin').delete('omega/verts', { id: state.vertId });

        expect(response, 'Delete should succeed').toBeSuccess();
        expect(await firestore.exists(`verts/${state.vertId}`), 'Vert doc should be gone').toBe(false);
      },
    },

    {
      name: 'delete-unknown-id-returns-404',
      timeout: 15000,
      async run({ http, expect }) {
        const response = await http.as('admin').delete('omega/verts', { id: 'does-not-exist' });

        expect(response, 'Unknown id should 404').toBeError(404);
      },
    },
  ],
});
