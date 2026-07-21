/**
 * Test: Firestore Security Rules - Ads Documents
 * The ads collection (house ad inventory) is client-inaccessible — all access
 * goes through the /omega/ads/* routes. No explicit rules entry exists for it;
 * it rides the framework's default lock (admin-only catch-all), mirroring the
 * other route-owned built-in collections (e.g. marketing-campaigns).
 *
 * Rules being tested:
 * - Anonymous cannot read/write ads docs
 * - Authenticated non-admin cannot read/write ads docs
 * - Admin can read/write ads docs (default catch-all)
 *
 * @see templates/firestore.rules
 */
module.exports = {
  description: 'Firestore security rules for ads documents',
  type: 'group',
  timeout: 30000,

  tests: [
    {
      name: 'setup-ad-doc',
      auth: 'none',

      async run({ rules }) {
        const adminDb = rules.asAccount('admin');

        await rules.expectSuccess(
          adminDb.doc('ads/rules-test-ad').set({
            id: 'rules-test-ad',
            enabled: true,
            title: 'Rules Test Ad',
            link: 'https://rules-shop.example/item',
            weight: 1,
          })
        );
      },
    },

    {
      name: 'anonymous-cannot-read-ad',
      auth: 'none',

      async run({ rules }) {
        const db = rules.asAnonymous();

        await rules.expectFailure(db.doc('ads/rules-test-ad').get());
      },
    },

    {
      name: 'anonymous-cannot-write-ad',
      auth: 'none',

      async run({ rules }) {
        const db = rules.asAnonymous();

        await rules.expectFailure(
          db.doc('ads/rules-anon-ad').set({ title: 'Nope' })
        );
      },
    },

    {
      name: 'user-cannot-read-ad',
      auth: 'none',

      async run({ rules }) {
        const db = rules.asAccount('basic');

        await rules.expectFailure(db.doc('ads/rules-test-ad').get());
      },
    },

    {
      name: 'user-cannot-write-ad',
      auth: 'none',

      async run({ rules }) {
        const db = rules.asAccount('basic');

        await rules.expectFailure(
          db.doc('ads/rules-test-ad').update({ title: 'Hijacked' })
        );
      },
    },

    {
      name: 'admin-can-read-ad',
      auth: 'none',

      async run({ rules }) {
        const adminDb = rules.asAccount('admin');

        await rules.expectSuccess(adminDb.doc('ads/rules-test-ad').get());
      },
    },
  ],
};
