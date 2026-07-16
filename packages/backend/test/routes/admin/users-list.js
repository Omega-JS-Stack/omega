/**
 * Test: routes/admin/users/list
 * GET /admin/users/list — the paginated user directory with the Firebase
 * Auth join (providers, disabled, verification, last sign-in) that client
 * SDKs cannot read. Powers the admin users table + the list_users MCP tool.
 *
 * Run: npx omega test routes/admin/users-list
 */
module.exports = {
  description: 'routes/admin/users/list',
  type: 'group',

  tests: [
    {
      name: 'lists-users-with-auth-join',
      async run({ http, assert }) {
        const response = await http.as('admin').get('backend-manager/admin/users/list', { limit: 5 });

        assert.isSuccess(response, 'Route responds');
        assert.ok(Array.isArray(response.data.users), 'users is an array');
        assert.ok(response.data.users.length > 0, 'seeded personas appear');
        assert.ok(response.data.users.length <= 5, 'limit respected');

        const row = response.data.users[0];
        assert.ok(typeof row.uid === 'string' && row.uid.length, 'row carries uid');
        assert.ok('email' in row && 'plan' in row && 'roles' in row, 'row carries directory fields');
        assert.ok(row.auth === null || typeof row.auth.disabled === 'boolean', 'auth join carries disabled flag');
        assert.ok(row.auth === null || Array.isArray(row.auth.providers), 'auth join carries providers');
      },
    },

    {
      name: 'search-filters-by-email-prefix',
      async run({ http, assert }) {
        const response = await http.as('admin').get('backend-manager/admin/users/list', { search: '_test.admin' });

        assert.isSuccess(response, 'Route responds');
        assert.ok(Array.isArray(response.data.users), 'users is an array');
        assert.ok(response.data.users.length >= 1, 'prefix search finds the admin persona');
        assert.ok(
          response.data.users.every((u) => String(u.email || '').startsWith('_test.admin')),
          'every hit matches the prefix'
        );
      },
    },

    {
      name: 'cursor-pagination-advances',
      async run({ http, assert }) {
        const page1 = await http.as('admin').get('backend-manager/admin/users/list', { limit: 2 });

        assert.isSuccess(page1, 'page 1 responds');
        assert.ok(page1.data.users.length === 2, 'page 1 is full');
        assert.ok(typeof page1.data.nextCursor === 'string' && page1.data.nextCursor.length, 'full page carries nextCursor');

        const page2 = await http.as('admin').get('backend-manager/admin/users/list', { limit: 2, startAfter: page1.data.nextCursor });

        assert.isSuccess(page2, 'page 2 responds');
        assert.ok(page2.data.users.length > 0, 'page 2 has rows');

        const page1Uids = new Set(page1.data.users.map((u) => u.uid));
        assert.ok(
          page2.data.users.every((u) => !page1Uids.has(u.uid)),
          'page 2 never repeats page 1'
        );
      },
    },
  ],
};
