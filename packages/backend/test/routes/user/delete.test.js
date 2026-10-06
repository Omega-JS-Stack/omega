/**
 * Test: DELETE /user
 * User deletion flow tests
 * Tests:
 * - Users with active subscriptions cannot delete themselves
 * - Users cannot delete other users
 * - Users can delete themselves after subscription is removed
 * - Admins can delete any user
 */

const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');
module.exports = defineCases({
  description: 'User deletion flow',
  type: 'suite',

  tests: [
    // --- Self-deletion tests ---
    {
      name: 'verify-delete-user-exists',
      async run({ firestore, expect, state, accounts }) {
        // Get the delete test account uid
        state.deleteUid = accounts.delete.uid;

        // Verify the user doc exists
        const userDoc = await firestore.get(`users/${state.deleteUid}`);

        expect(userDoc, 'Delete user doc should exist before deletion').toBeTruthy();
        expect(userDoc?.auth?.uid === state.deleteUid, 'User doc should have correct uid').toBeTruthy();
      },
    },

    {
      name: 'delete-blocked-with-subscription',
      async run({ http, expect }) {
        // Auth as the delete user and try to delete themselves
        // Should be blocked due to active subscription
        const deleteResponse = await http.as('delete').delete('omega/user', {});

        expect(deleteResponse, 'Deletion should be blocked with active subscription').toBeError(400);
        expect(deleteResponse.error?.includes('paid subscription'), `Error should mention paid subscription: ${deleteResponse.error}`).toBeTruthy();
      },
    },

    // NOTE: The DELETE /user API ignores the payload uid parameter for non-admin users.
    // It always uses the authenticated user's uid from resolveUser().
    // This means non-admins cannot delete other users by design - the uid param is simply ignored.
    // A test for "delete other user blocked" would be misleading since it would actually
    // try to delete the authenticated user (basic), not the target user.
    // If we want to explicitly block this, the API should be updated to check payload.uid
    // against user.auth.uid and return a 403 if they don't match.

    {
      name: 'remove-subscription-from-delete-user',
      async run({ firestore, state }) {
        // Remove the subscription (set to null to overwrite)
        await firestore.set(`users/${state.deleteUid}`, { subscription: null }, { merge: true });
      },
    },

    {
      name: 'delete-user-succeeds',
      async run({ http, expect }) {
        // Auth as the delete user and delete themselves
        const deleteResponse = await http.as('delete').delete('omega/user', {});

        expect(deleteResponse, `DELETE /user should succeed: ${JSON.stringify(deleteResponse, null, 2)}`).toBeSuccess();
      },
    },

    {
      name: 'verify-firestore-doc-deleted',
      async run({ firestore, expect, state, waitFor }) {
        // on-delete handler deletes Firestore doc when Auth user is deleted
        // Wait for the deletion to complete
        const docDeleted = await waitFor(async () => {
          const userDoc = await firestore.get(`users/${state.deleteUid}`);
          return !userDoc;
        }, 10000, 500);

        expect(docDeleted, 'Firestore doc should be deleted after Auth user deletion').toBeTruthy();
      },
    },

    // --- Admin deletion tests ---
    {
      name: 'verify-admin-delete-target-exists',
      async run({ firestore, expect, state, accounts }) {
        // Get the delete-by-admin test account uid
        state.adminDeleteUid = accounts['delete-by-admin'].uid;

        // Verify the user doc exists
        const userDoc = await firestore.get(`users/${state.adminDeleteUid}`);

        expect(userDoc, 'Admin delete target user doc should exist').toBeTruthy();
        expect(userDoc?.auth?.uid === state.adminDeleteUid, 'User doc should have correct uid').toBeTruthy();
      },
    },

    {
      name: 'admin-can-delete-other-user',
      async run({ http, expect, state }) {
        // Auth as admin (using admin key) and delete another user
        const deleteResponse = await http.as('admin').delete('omega/user', {
          uid: state.adminDeleteUid,
        });

        expect(deleteResponse, `Admin should be able to delete another user: ${JSON.stringify(deleteResponse, null, 2)}`).toBeSuccess();
      },
    },

    {
      name: 'verify-admin-deleted-user-firestore-deleted',
      async run({ firestore, expect, state, waitFor }) {
        // on-delete handler deletes Firestore doc when Auth user is deleted
        // Wait for the deletion to complete
        const docDeleted = await waitFor(async () => {
          const userDoc = await firestore.get(`users/${state.adminDeleteUid}`);
          return !userDoc;
        }, 10000, 500);

        expect(docDeleted, 'Firestore doc should be deleted after admin deletion').toBeTruthy();
      },
    },

    // --- Auth rejection test (at end per convention) ---
    {
      name: 'unauthenticated-rejected',
      async run({ http, expect }) {
        const deleteResponse = await http.as('none').delete('omega/user', {});

        expect(deleteResponse, 'Delete should fail without authentication').toBeError(401);
      },
    },
  ],
});
