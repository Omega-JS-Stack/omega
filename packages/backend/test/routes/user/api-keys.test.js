/**
 * Test: POST /user/api-keys
 * Tests the user regenerate API keys endpoint
 * This is a suite because we need to track state and restore original keys
 */

const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');
module.exports = defineCases({
  description: 'User regenerate API keys',
  type: 'suite',
  timeout: 30000,

  tests: [
    // Test 1: Store original keys
    {
      name: 'store-original-keys',
      async run({ firestore, expect, state, accounts }) {
        // Get the basic account's current keys to restore later
        const userDoc = await firestore.get(`users/${accounts.basic.uid}`);

        expect(userDoc, 'User doc should exist').toBeTruthy();
        expect({ data: userDoc }, 'User should have clientId').toHaveProperty('data.api.clientId');
        expect({ data: userDoc }, 'User should have privateKey').toHaveProperty('data.api.privateKey');

        state.originalClientId = userDoc.api.clientId;
        state.originalPrivateKey = userDoc.api.privateKey;

        expect(state.originalClientId, 'Original clientId should exist').toBeTruthy();
        expect(state.originalPrivateKey, 'Original privateKey should exist').toBeTruthy();
      },
    },

    // Test 2: Regenerate both keys (default)
    {
      name: 'regenerate-both-keys',
      async run({ http, expect, state }) {
        const response = await http.as('basic').post('omega/user/api-keys', {});

        expect(response, 'Regenerate API keys should succeed').toBeSuccess();
        expect(response, 'Response should contain new clientId').toHaveProperty('data.clientId');
        expect(response, 'Response should contain new privateKey').toHaveProperty('data.privateKey');

        // Keys should be different from original
        expect(response.data.clientId, 'New clientId should be different from original').not.toBe(state.originalClientId);
        expect(response.data.privateKey, 'New privateKey should be different from original').not.toBe(state.originalPrivateKey);

        // Store new keys for verification
        state.newClientId = response.data.clientId;
        state.newPrivateKey = response.data.privateKey;
      },
    },

    // Test 3: Verify keys are persisted in Firestore
    {
      name: 'verify-keys-persisted',
      async run({ firestore, expect, state, accounts }) {
        const userDoc = await firestore.get(`users/${accounts.basic.uid}`);

        expect(userDoc.api.clientId, 'Persisted clientId should match returned value').toBe(state.newClientId);
        expect(userDoc.api.privateKey, 'Persisted privateKey should match returned value').toBe(state.newPrivateKey);
      },
    },

    // Test 4: Regenerate only clientId
    // Note: After test 2, the privateKey changed so we need to use the new one
    {
      name: 'regenerate-only-clientId',
      async run({ http, expect, state }) {
        // Use the new privateKey from test 2 since old one is invalid
        const response = await http.withPrivateKey(state.newPrivateKey).post('omega/user/api-keys', {
          keys: ['clientId'],
        });

        expect(response, 'Regenerate clientId only should succeed').toBeSuccess();
        expect(response, 'Response should contain new clientId').toHaveProperty('data.clientId');
        expect(!response.data.privateKey, 'Response should NOT contain privateKey when only clientId requested').toBeTruthy();
        expect(response.data.clientId, 'New clientId should be different from previous').not.toBe(state.newClientId);
      },
    },

    // Test 5: Regenerate only privateKey
    {
      name: 'regenerate-only-privateKey',
      async run({ http, expect, state, accounts, firestore }) {
        // Get current clientId to verify it stays the same
        const beforeDoc = await firestore.get(`users/${accounts.basic.uid}`);
        const currentClientId = beforeDoc.api.clientId;

        // Still use newPrivateKey since test 4 didn't change it
        const response = await http.withPrivateKey(state.newPrivateKey).post('omega/user/api-keys', {
          keys: ['privateKey'],
        });

        expect(response, 'Regenerate privateKey only should succeed').toBeSuccess();
        expect(response, 'Response should contain new privateKey').toHaveProperty('data.privateKey');
        expect(!response.data.clientId, 'Response should NOT contain clientId when only privateKey requested').toBeTruthy();

        // Verify clientId stayed the same
        const afterDoc = await firestore.get(`users/${accounts.basic.uid}`);
        expect(afterDoc.api.clientId, 'clientId should remain unchanged when only privateKey regenerated').toBe(currentClientId);
      },
    },

    // Test 6: Unauthenticated request fails
    {
      name: 'unauthenticated-rejected',
      async run({ http, expect }) {
        const response = await http.as('none').post('omega/user/api-keys', {});

        expect(response, 'Regenerate API keys should fail without authentication').toBeError(401);
      },
    },

    // Test 7: Restore original keys
    {
      name: 'restore-original-keys',
      async run({ firestore, state, accounts }) {
        // Restore original keys so other tests aren't affected
        await firestore.set(`users/${accounts.basic.uid}`, {
          api: {
            clientId: state.originalClientId,
            privateKey: state.originalPrivateKey,
          },
        }, { merge: true });
      },
    },
  ],
});
