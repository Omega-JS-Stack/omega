/**
 * Test: routes/admin/users/list
 * GET /admin/users/list — the paginated user directory with the Firebase
 * Auth join (providers, disabled, verification, last sign-in) that client
 * SDKs cannot read. Powers the admin users table + the list_users MCP tool.
 *
 * Run: npx omega test routes/admin/users-list
 */

const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');
module.exports = defineCases({
  description: 'routes/admin/users/list',
  type: 'group',

  tests: [
    {
      name: 'lists-users-with-auth-join',
      async run({ http, expect }) {
        const response = await http.as('admin').get('omega/admin/users/list', { limit: 5 });

        expect(response, 'Route responds').toBeSuccess();
        expect(Array.isArray(response.data.users), 'users is an array').toBeTruthy();
        expect(response.data.users.length > 0, 'seeded personas appear').toBeTruthy();
        expect(response.data.users.length <= 5, 'limit respected').toBeTruthy();

        const row = response.data.users[0];
        expect(typeof row.uid === 'string' && row.uid.length, 'row carries uid').toBeTruthy();
        expect('email' in row && 'plan' in row && 'roles' in row, 'row carries directory fields').toBeTruthy();
        expect(row.auth === null || typeof row.auth.disabled === 'boolean', 'auth join carries disabled flag').toBeTruthy();
        expect(row.auth === null || Array.isArray(row.auth.providers), 'auth join carries providers').toBeTruthy();
      },
    },

    {
      name: 'search-filters-by-email-prefix',
      async run({ http, expect }) {
        const response = await http.as('admin').get('omega/admin/users/list', { search: '_test.admin' });

        expect(response, 'Route responds').toBeSuccess();
        expect(Array.isArray(response.data.users), 'users is an array').toBeTruthy();
        expect(response.data.users.length >= 1, 'prefix search finds the admin persona').toBeTruthy();
        expect(response.data.users.every((u) => String(u.email || '').startsWith('_test.admin')), 'every hit matches the prefix').toBeTruthy();
      },
    },

    {
      name: 'cursor-pagination-advances',
      async run({ http, expect }) {
        const page1 = await http.as('admin').get('omega/admin/users/list', { limit: 2 });

        expect(page1, 'page 1 responds').toBeSuccess();
        expect(page1.data.users.length === 2, 'page 1 is full').toBeTruthy();
        expect(typeof page1.data.nextCursor === 'string' && page1.data.nextCursor.length, 'full page carries nextCursor').toBeTruthy();

        const page2 = await http.as('admin').get('omega/admin/users/list', { limit: 2, startAfter: page1.data.nextCursor });

        expect(page2, 'page 2 responds').toBeSuccess();
        expect(page2.data.users.length > 0, 'page 2 has rows').toBeTruthy();

        const page1Uids = new Set(page1.data.users.map((u) => u.uid));
        expect(page2.data.users.every((u) => !page1Uids.has(u.uid)), 'page 2 never repeats page 1').toBeTruthy();
      },
    },
  ],
});
