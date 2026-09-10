/**
 * Test: Firestore Security Rules - Notification Documents
 * Tests that security rules correctly protect notification data
 *
 * Contract (the doc id IS the push token — a high-entropy capability):
 * - get: anyone who knows the token (existence check before create; device re-check)
 * - list: DENIED for non-admins — tokens can never be harvested by query
 * - create: token field must equal the doc id; owner must be null (anonymous
 *   subscribe) or the caller's own uid — never someone else's
 * - update: token must equal the doc id AND stay immutable; owner may only
 *   become null or the caller's own uid
 * - delete: admin only
 *
 * @see templates/firestore.framework.rules (compiled into dist/firestore.rules)
 */

const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');
module.exports = defineCases({
  description: 'Firestore security rules for notification documents',
  type: 'group',
  timeout: 30000,

  tests: [
    // Test 1: Anonymous can create a notification (owner null)
    {
      name: 'anonymous-can-create-notification',
      auth: 'none',

      async run({ rules }) {
        const db = rules.asAnonymous();
        const token = 'test-token-create-anon';

        await rules.expectSuccess(
          db.doc(`notifications/${token}`).set({
            token: token,
            owner: null,
            metadata: { created: { timestamp: new Date().toISOString(), timestampUNIX: Math.floor(Date.now() / 1000) } },
          })
        );
      },
    },

    // Test 2: Authenticated user can create a notification they own
    {
      name: 'user-can-create-notification',
      auth: 'none',

      async run({ rules, accounts }) {
        const uid = accounts.basic.uid;
        const db = rules.asAccount('basic');
        const token = 'test-token-create-user';

        await rules.expectSuccess(
          db.doc(`notifications/${token}`).set({
            token: token,
            owner: uid,
            metadata: { created: { timestamp: new Date().toISOString(), timestampUNIX: Math.floor(Date.now() / 1000) } },
          })
        );
      },
    },

    // Test 3: Cannot create a notification owned by someone ELSE
    {
      name: 'user-cannot-create-notification-for-other-user',
      auth: 'none',

      async run({ rules, accounts }) {
        const otherUid = accounts.admin.uid;
        const db = rules.asAccount('basic');
        const token = 'test-token-create-foreign-owner';

        await rules.expectFailure(
          db.doc(`notifications/${token}`).set({
            token: token,
            owner: otherUid,
          })
        );
      },
    },

    // Test 4: Cannot create with a token field that doesn't match the doc id
    {
      name: 'cannot-create-with-mismatched-token-field',
      auth: 'none',

      async run({ rules }) {
        const db = rules.asAnonymous();

        await rules.expectFailure(
          db.doc('notifications/test-token-mismatch').set({
            token: 'some-other-token',
            owner: null,
          })
        );
      },
    },

    // Test 4b: Cannot create OMITTING the owner field (the contract requires it explicitly)
    {
      name: 'cannot-create-omitting-owner-field',
      auth: 'none',

      async run({ rules }) {
        const db = rules.asAnonymous();
        const token = 'test-token-omit-owner';

        await rules.expectFailure(
          db.doc(`notifications/${token}`).set({
            token: token,
          })
        );
      },
    },

    // Test 4c: Cannot create OMITTING the token field
    {
      name: 'cannot-create-omitting-token-field',
      auth: 'none',

      async run({ rules }) {
        const db = rules.asAnonymous();

        await rules.expectFailure(
          db.doc('notifications/test-token-omit-token').set({
            owner: null,
          })
        );
      },
    },

    // Test 5: User can read their own notification (by owner)
    {
      name: 'user-can-read-own-notification',
      auth: 'none',

      async run({ rules, accounts }) {
        const uid = accounts.basic.uid;
        const db = rules.asAccount('basic');
        const token = 'test-token-read-own';

        const adminDb = rules.asAccount('admin');
        await rules.expectSuccess(
          adminDb.doc(`notifications/${token}`).set({
            token: token,
            owner: uid,
            metadata: { created: { timestamp: new Date().toISOString(), timestampUNIX: Math.floor(Date.now() / 1000) } },
          })
        );

        await rules.expectSuccess(
          db.doc(`notifications/${token}`).get()
        );
      },
    },

    // Test 6: Point-read by token is allowed (capability: knowing the token)
    {
      name: 'user-can-read-notification-by-token',
      auth: 'none',

      async run({ rules, accounts }) {
        const otherUid = accounts.admin.uid;
        const db = rules.asAccount('basic');
        const token = 'test-token-read-token';

        const adminDb = rules.asAccount('admin');
        await rules.expectSuccess(
          adminDb.doc(`notifications/${token}`).set({
            token: token,
            owner: otherUid,
            metadata: { created: { timestamp: new Date().toISOString(), timestampUNIX: Math.floor(Date.now() / 1000) } },
          })
        );

        await rules.expectSuccess(
          db.doc(`notifications/${token}`).get()
        );
      },
    },

    // Test 7: Anonymous can read non-existent notification (availability check)
    {
      name: 'anonymous-can-read-nonexistent-notification',
      auth: 'none',

      async run({ rules }) {
        const db = rules.asAnonymous();
        const token = 'nonexistent-token-12345';

        await rules.expectSuccess(
          db.doc(`notifications/${token}`).get()
        );
      },
    },

    // Test 8: LIST is denied — tokens can never be harvested by query
    {
      name: 'user-cannot-list-notifications',
      auth: 'none',

      async run({ rules, accounts }) {
        const adminDb = rules.asAccount('admin');
        const token = 'test-token-list-harvest';

        await rules.expectSuccess(
          adminDb.doc(`notifications/${token}`).set({
            token: token,
            owner: accounts.basic.uid,
          })
        );

        await rules.expectFailure(
          rules.asAccount('basic').collection('notifications').get()
        );
        await rules.expectFailure(
          rules.asAnonymous().collection('notifications').get()
        );
      },
    },

    // Test 9: Signed-in user can take over a token they possess (sign-in on device)
    {
      name: 'user-can-take-over-notification-by-token',
      auth: 'none',

      async run({ rules, accounts }) {
        const uid = accounts.basic.uid;
        const db = rules.asAccount('basic');
        const token = 'test-token-take-over';

        const adminDb = rules.asAccount('admin');
        await rules.expectSuccess(
          adminDb.doc(`notifications/${token}`).set({
            token: token,
            owner: accounts.admin.uid,
            metadata: { created: { timestamp: new Date().toISOString(), timestampUNIX: Math.floor(Date.now() / 1000) } },
          })
        );

        // The client's sign-in flow: same device, owner flips to the caller
        await rules.expectSuccess(
          db.doc(`notifications/${token}`).update({
            owner: uid,
            'metadata.updated': { timestamp: new Date().toISOString(), timestampUNIX: Math.floor(Date.now() / 1000) },
          })
        );
      },
    },

    // Test 10: Update keeping a FOREIGN owner is denied (owner must become null or self)
    {
      name: 'user-cannot-update-keeping-foreign-owner',
      auth: 'none',

      async run({ rules, accounts }) {
        const db = rules.asAccount('basic');
        const token = 'test-token-foreign-owner-update';

        const adminDb = rules.asAccount('admin');
        await rules.expectSuccess(
          adminDb.doc(`notifications/${token}`).set({
            token: token,
            owner: accounts.admin.uid,
            metadata: { created: { timestamp: new Date().toISOString(), timestampUNIX: Math.floor(Date.now() / 1000) } },
          })
        );

        // Owner stays the admin's uid — not null, not the caller → denied
        await rules.expectFailure(
          db.doc(`notifications/${token}`).update({
            'metadata.updated': { timestamp: new Date().toISOString(), timestampUNIX: Math.floor(Date.now() / 1000) },
          })
        );
      },
    },

    // Test 11: Owner can update their notification (owner field kept as self)
    {
      name: 'owner-can-update-notification',
      auth: 'none',

      async run({ rules, accounts }) {
        const uid = accounts.basic.uid;
        const db = rules.asAccount('basic');
        const token = 'test-token-update-owner';

        const adminDb = rules.asAccount('admin');
        await rules.expectSuccess(
          adminDb.doc(`notifications/${token}`).set({
            token: token,
            owner: uid,
            metadata: { created: { timestamp: new Date().toISOString(), timestampUNIX: Math.floor(Date.now() / 1000) } },
          })
        );

        await rules.expectSuccess(
          db.doc(`notifications/${token}`).update({
            preferences: { sound: true },
          })
        );
      },
    },

    // Test 12: Anonymous can release a token to null (sign-out on device)
    {
      name: 'anonymous-can-release-notification-owner',
      auth: 'none',

      async run({ rules, accounts }) {
        const db = rules.asAnonymous();
        const token = 'test-token-anon-release';

        const adminDb = rules.asAccount('admin');
        await rules.expectSuccess(
          adminDb.doc(`notifications/${token}`).set({
            token: token,
            owner: accounts.basic.uid,
            metadata: { created: { timestamp: new Date().toISOString(), timestampUNIX: Math.floor(Date.now() / 1000) } },
          })
        );

        await rules.expectSuccess(
          db.doc(`notifications/${token}`).update({
            owner: null,
            'metadata.updated': { timestamp: new Date().toISOString(), timestampUNIX: Math.floor(Date.now() / 1000) },
          })
        );
      },
    },

    // Test 13: Anonymous update keeping a foreign owner is denied
    {
      name: 'anonymous-cannot-update-keeping-foreign-owner',
      auth: 'none',

      async run({ rules, accounts }) {
        const uid = accounts.basic.uid;
        const db = rules.asAnonymous();
        const token = 'test-token-anon-update';

        const adminDb = rules.asAccount('admin');
        await rules.expectSuccess(
          adminDb.doc(`notifications/${token}`).set({
            token: token,
            owner: uid,
            metadata: { created: { timestamp: new Date().toISOString(), timestampUNIX: Math.floor(Date.now() / 1000) } },
          })
        );

        await rules.expectFailure(
          db.doc(`notifications/${token}`).update({
            hacked: true,
          })
        );
      },
    },

    // Test 14: Token field is immutable on update
    {
      name: 'cannot-change-token-field-on-update',
      auth: 'none',

      async run({ rules, accounts }) {
        const uid = accounts.basic.uid;
        const db = rules.asAccount('basic');
        const token = 'test-token-immutable';

        const adminDb = rules.asAccount('admin');
        await rules.expectSuccess(
          adminDb.doc(`notifications/${token}`).set({
            token: token,
            owner: uid,
          })
        );

        await rules.expectFailure(
          db.doc(`notifications/${token}`).update({
            token: 'rewritten-token',
            owner: uid,
          })
        );
      },
    },

    // Test 14b: A MALFORMED doc (stored token ≠ doc id) is client-read-only
    // ([#288](https://github.com/Omega-JS-Stack/omega/issues/288)). The
    // framework's own create rule cannot produce one, but legacy-era docs
    // exist, and the managed block used to let their owner keep updating them
    // — legacy BEM denied it. Only an admin write can seed one here.
    {
      name: 'cannot-update-a-malformed-notification',
      auth: 'none',

      async run({ rules, accounts }) {
        const uid = accounts.basic.uid;
        const db = rules.asAccount('basic');
        const adminDb = rules.asAccount('admin');
        const malformed = 'test-token-malformed-doc';
        const wellFormed = 'test-token-well-formed-doc';

        // Legacy-era shape: the stored token never matched the doc id
        await rules.expectSuccess(
          adminDb.doc(`notifications/${malformed}`).set({
            token: 'a-token-that-is-not-the-doc-id',
            owner: uid,
          })
        );

        // Every OTHER clause holds — token unchanged, owner is the caller — so
        // this update is denied by the doc-id guard alone
        await rules.expectFailure(
          db.doc(`notifications/${malformed}`).update({
            preferences: { sound: true },
          })
        );

        // …and the same update on a well-formed doc still passes
        await rules.expectSuccess(
          adminDb.doc(`notifications/${wellFormed}`).set({
            token: wellFormed,
            owner: uid,
          })
        );
        await rules.expectSuccess(
          db.doc(`notifications/${wellFormed}`).update({
            preferences: { sound: true },
          })
        );
      },
    },

    // Test 15: Admin can create notification
    {
      name: 'admin-can-create-notification',
      auth: 'none',

      async run({ rules, accounts }) {
        const adminDb = rules.asAccount('admin');
        const token = 'test-token-admin-create';

        await rules.expectSuccess(
          adminDb.doc(`notifications/${token}`).set({
            token: token,
            owner: accounts.basic.uid,
            metadata: { created: { timestamp: new Date().toISOString(), timestampUNIX: Math.floor(Date.now() / 1000) } },
          })
        );
      },
    },

    // Test 16: Admin can read any notification (and list)
    {
      name: 'admin-can-read-any-notification',
      auth: 'none',

      async run({ rules, accounts }) {
        const basicUid = accounts.basic.uid;
        const adminDb = rules.asAccount('admin');
        const token = 'test-token-admin-read';

        await rules.expectSuccess(
          adminDb.doc(`notifications/${token}`).set({
            token: token,
            owner: basicUid,
            metadata: { created: { timestamp: new Date().toISOString(), timestampUNIX: Math.floor(Date.now() / 1000) } },
          })
        );

        await rules.expectSuccess(
          adminDb.doc(`notifications/${token}`).get()
        );
        await rules.expectSuccess(
          adminDb.collection('notifications').get()
        );
      },
    },

    // Test 17: Admin can update any notification
    {
      name: 'admin-can-update-notification',
      auth: 'none',

      async run({ rules, accounts }) {
        const adminDb = rules.asAccount('admin');
        const token = 'test-token-admin-update';

        await rules.expectSuccess(
          adminDb.doc(`notifications/${token}`).set({
            token: token,
            owner: accounts.basic.uid,
            metadata: { created: { timestamp: new Date().toISOString(), timestampUNIX: Math.floor(Date.now() / 1000) } },
          })
        );

        await rules.expectSuccess(
          adminDb.doc(`notifications/${token}`).update({
            'metadata.updated': { timestamp: new Date().toISOString(), timestampUNIX: Math.floor(Date.now() / 1000) },
            adminModified: true,
          })
        );
      },
    },

    // Test 18: Admin can delete notification
    {
      name: 'admin-can-delete-notification',
      auth: 'none',

      async run({ rules, accounts }) {
        const adminDb = rules.asAccount('admin');
        const token = 'test-token-admin-delete';

        await rules.expectSuccess(
          adminDb.doc(`notifications/${token}`).set({
            token: token,
            owner: 'someone',
            metadata: { created: { timestamp: new Date().toISOString(), timestampUNIX: Math.floor(Date.now() / 1000) } },
          })
        );

        await rules.expectSuccess(
          adminDb.doc(`notifications/${token}`).delete()
        );
      },
    },

    // Test 19: Regular user cannot delete notification
    {
      name: 'user-cannot-delete-notification',
      auth: 'none',

      async run({ rules, accounts }) {
        const uid = accounts.basic.uid;
        const db = rules.asAccount('basic');
        const adminDb = rules.asAccount('admin');
        const token = 'test-token-user-delete';

        await rules.expectSuccess(
          adminDb.doc(`notifications/${token}`).set({
            token: token,
            owner: uid,
            metadata: { created: { timestamp: new Date().toISOString(), timestampUNIX: Math.floor(Date.now() / 1000) } },
          })
        );

        await rules.expectFailure(
          db.doc(`notifications/${token}`).delete()
        );
      },
    },

    // Test 20: Anonymous cannot delete notification
    {
      name: 'anonymous-cannot-delete-notification',
      auth: 'none',

      async run({ rules, accounts }) {
        const db = rules.asAnonymous();
        const adminDb = rules.asAccount('admin');
        const token = 'test-token-anon-delete';

        await rules.expectSuccess(
          adminDb.doc(`notifications/${token}`).set({
            token: token,
            owner: 'someone',
            metadata: { created: { timestamp: new Date().toISOString(), timestampUNIX: Math.floor(Date.now() / 1000) } },
          })
        );

        await rules.expectFailure(
          db.doc(`notifications/${token}`).delete()
        );
      },
    },
  ],
});
