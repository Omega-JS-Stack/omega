/**
 * Test: Firestore Security Rules - Verts Documents
 * The verts collection (house vert inventory) is client-inaccessible — all access
 * goes through the /omega/verts/* routes. No explicit rules entry exists for it;
 * it rides the framework's default lock (admin-only catch-all), mirroring the
 * other route-owned built-in collections (e.g. marketing-campaigns).
 *
 * Rules being tested:
 * - Anonymous cannot read/write verts docs
 * - Authenticated non-admin cannot read/write verts docs
 * - Admin can read/write verts docs (default catch-all)
 *
 * @see templates/firestore.framework.rules (compiled into dist/firestore.rules)
 */

const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');
module.exports = defineCases({
  description: 'Firestore security rules for verts documents',
  type: 'group',
  timeout: 30000,

  tests: [
    {
      name: 'setup-vert-doc',
      auth: 'none',

      async run({ rules }) {
        const adminDb = rules.asAccount('admin');

        await rules.expectSuccess(
          adminDb.doc('verts/rules-test-vert').set({
            id: 'rules-test-vert',
            enabled: true,
            title: 'Rules Test Vert',
            link: 'https://rules-shop.example/item',
            weight: 1,
          })
        );
      },
    },

    {
      name: 'anonymous-cannot-read-vert',
      auth: 'none',

      async run({ rules }) {
        const db = rules.asAnonymous();

        await rules.expectFailure(db.doc('verts/rules-test-vert').get());
      },
    },

    {
      name: 'anonymous-cannot-write-vert',
      auth: 'none',

      async run({ rules }) {
        const db = rules.asAnonymous();

        await rules.expectFailure(
          db.doc('verts/rules-anon-vert').set({ title: 'Nope' })
        );
      },
    },

    {
      name: 'user-cannot-read-vert',
      auth: 'none',

      async run({ rules }) {
        const db = rules.asAccount('basic');

        await rules.expectFailure(db.doc('verts/rules-test-vert').get());
      },
    },

    {
      name: 'user-cannot-write-vert',
      auth: 'none',

      async run({ rules }) {
        const db = rules.asAccount('basic');

        await rules.expectFailure(
          db.doc('verts/rules-test-vert').update({ title: 'Hijacked' })
        );
      },
    },

    {
      name: 'admin-can-read-vert',
      auth: 'none',

      async run({ rules }) {
        const adminDb = rules.asAccount('admin');

        await rules.expectSuccess(adminDb.doc('verts/rules-test-vert').get());
      },
    },
  ],
});
