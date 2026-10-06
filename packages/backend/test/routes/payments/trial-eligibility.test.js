/**
 * Test: GET /payments/trial-eligibility
 * Tests trial eligibility check based on subscription order history
 */

const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');
module.exports = defineCases({
  description: 'Trial eligibility check',
  type: 'group',
  timeout: 15000,

  tests: [
    {
      name: 'rejects-unauthenticated',
      async run({ http, expect }) {
        const response = await http.as('none').get('omega/payments/trial-eligibility');

        expect(response, 'Should reject unauthenticated request').toBeError(401);
      },
    },

    {
      name: 'eligible-when-no-orders',
      async run({ http, expect }) {
        // Basic user with no subscription history should be eligible
        const response = await http.as('basic').get('omega/payments/trial-eligibility');

        expect(response, 'Should succeed for authenticated user').toBeSuccess();
        expect(response.data.eligible, 'Should be eligible with no order history').toBe(true);
      },
    },

    {
      name: 'ineligible-when-has-subscription-history',
      async run({ http, expect, accounts, firestore }) {
        const uid = accounts['basic'].uid;
        const orderDocPath = `payments-orders/_test-trial-eligibility-${uid}`;

        // Create fake subscription order history
        await firestore.set(orderDocPath, { owner: uid, type: 'subscription', provider: 'test', status: 'cancelled' });

        try {
          const response = await http.as('basic').get('omega/payments/trial-eligibility');

          expect(response, 'Should succeed for authenticated user').toBeSuccess();
          expect(response.data.eligible, 'Should be ineligible with subscription history').toBe(false);
        } finally {
          await firestore.delete(orderDocPath);
        }
      },
    },

    {
      name: 'eligible-when-only-non-subscription-orders',
      async run({ http, expect, accounts, firestore }) {
        const uid = accounts['basic'].uid;
        const orderDocPath = `payments-orders/_test-trial-eligibility-onetime-${uid}`;

        // Create a non-subscription order (one-time purchase)
        await firestore.set(orderDocPath, { owner: uid, type: 'one-time', provider: 'test', status: 'completed' });

        try {
          const response = await http.as('basic').get('omega/payments/trial-eligibility');

          expect(response, 'Should succeed for authenticated user').toBeSuccess();
          expect(response.data.eligible, 'Should be eligible — only non-subscription orders').toBe(true);
        } finally {
          await firestore.delete(orderDocPath);
        }
      },
    },
  ],
});
