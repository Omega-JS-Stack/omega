/**
 * Test: POST /test/usage
 * Tests the usage tracking API through `consume`
 * ([#647](https://github.com/Omega-JS-Stack/omega/issues/647)) — one call
 * checks, counts and writes, and the response reports what is LEFT of both
 * counters rather than the raw fields.
 * This is a suite because we need to track state and verify the counting
 */

const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');
module.exports = defineCases({
  description: 'Usage tracking API',
  type: 'suite',
  timeout: 30000,

  tests: [
    // Test 1: Store initial usage state
    {
      name: 'store-initial-usage',
      async run({ firestore, assert, state, accounts }) {
        // Get the basic account's current usage to track changes
        const userDoc = await firestore.get(`users/${accounts.basic.uid}`);

        state.initialUsage = userDoc?.usage || {};

        // Store initial values for the requests feature (may not exist yet)
        state.initialMonthly = state.initialUsage?.requests?.monthly || 0;
        state.initialDaily = state.initialUsage?.requests?.daily || 0;

        assert.ok(true, 'Initial usage state captured');
      },
    },

    // Test 2: Consume usage with default values
    {
      name: 'consume-default',
      async run({ http, assert, state }) {
        const response = await http.as('basic').post('backend-manager/test/usage', {});

        assert.isSuccess(response, 'Usage consume should succeed');
        assert.hasProperty(response, 'data.feature', 'Response should contain the feature name');
        assert.hasProperty(response, 'data.amount', 'Response should contain amount');
        assert.hasProperty(response, 'data.before', 'Response should contain before values');
        assert.hasProperty(response, 'data.after', 'Response should contain after values');

        // Verify defaults
        assert.equal(response.data.feature, 'requests', 'Feature should be requests');
        assert.equal(response.data.amount, 1, 'Default amount should be 1');

        // Verify the month counter moved
        assert.equal(
          response.data.after.used,
          response.data.before.used + 1,
          'The month counter should move by 1'
        );

        // Verify the day counter moved
        assert.equal(
          response.data.after.day.used,
          response.data.before.day.used + 1,
          'The day counter should move by 1'
        );

        // Store for next test
        state.afterFirstConsume = response.data.after;
      },
    },

    // Test 3: Verify usage persisted to Firestore
    {
      name: 'verify-usage-persisted',
      async run({ firestore, assert, state, accounts }) {
        const userDoc = await firestore.get(`users/${accounts.basic.uid}`);

        assert.ok(userDoc?.usage, 'User should have usage object');
        assert.ok(userDoc?.usage?.requests, 'User should have requests usage');

        assert.equal(
          userDoc.usage.requests.monthly,
          state.afterFirstConsume.used,
          'Persisted monthly should match API response'
        );
        assert.equal(
          userDoc.usage.requests.daily,
          state.afterFirstConsume.day.used,
          'Persisted daily should match API response'
        );
        assert.ok(userDoc.usage.requests.total > 0, 'Total should be counted too');

        // Verify last timestamp exists
        assert.ok(userDoc.usage.requests.last, 'Should have last object');
        assert.ok(userDoc.usage.requests.last.timestamp, 'Should have last.timestamp');
        assert.ok(userDoc.usage.requests.last.timestampUNIX, 'Should have last.timestampUNIX');
      },
    },

    // Test 4: Consume a custom amount
    {
      name: 'consume-custom-amount',
      async run({ http, assert, state }) {
        const response = await http.as('basic').post('backend-manager/test/usage', {
          amount: 5,
        });

        assert.isSuccess(response, 'Custom amount consume should succeed');
        assert.equal(response.data.amount, 5, 'Amount should be 5');

        // Verify both counters moved by 5
        assert.equal(
          response.data.after.used,
          response.data.before.used + 5,
          'The month counter should move by 5'
        );
        assert.equal(
          response.data.after.day.used,
          response.data.before.day.used + 5,
          'The day counter should move by 5'
        );

        state.afterCustomAmount = response.data.after;
      },
    },

    // Test 5: Verify custom amount persisted
    {
      name: 'verify-custom-amount-persisted',
      async run({ firestore, assert, state, accounts }) {
        const userDoc = await firestore.get(`users/${accounts.basic.uid}`);

        assert.ok(userDoc?.usage?.requests, 'User should have requests usage');

        assert.equal(
          userDoc.usage.requests.monthly,
          state.afterCustomAmount.used,
          'Requests monthly should be persisted'
        );
        assert.equal(
          userDoc.usage.requests.daily,
          state.afterCustomAmount.day.used,
          'Requests daily should be persisted'
        );
      },
    },

    // Test 6: Multiple consumes accumulate
    {
      name: 'multiple-consumes-accumulate',
      async run({ http, assert, state }) {
        // First consume
        const response1 = await http.as('basic').post('backend-manager/test/usage', {});

        assert.isSuccess(response1, 'First consume should succeed');

        // Second consume
        const response2 = await http.as('basic').post('backend-manager/test/usage', {});

        assert.isSuccess(response2, 'Second consume should succeed');

        // Third consume with a custom amount
        const response3 = await http.as('basic').post('backend-manager/test/usage', {
          amount: 3,
        });

        assert.isSuccess(response3, 'Third consume should succeed');

        // Verify accumulation: should be initial + 1 (test 2) + 5 (test 4) + 1 + 1 + 3 = initial + 11
        const expectedMonthly = state.initialMonthly + 11;
        const expectedDaily = state.initialDaily + 11;

        assert.equal(
          response3.data.after.used,
          expectedMonthly,
          `The month counter should accumulate to ${expectedMonthly}`
        );
        assert.equal(
          response3.data.after.day.used,
          expectedDaily,
          `The day counter should accumulate to ${expectedDaily}`
        );
      },
    },

    // Test 7: Unauthenticated usage tracks by IP in usage collection
    {
      name: 'unauthenticated-usage-by-ip',
      async run({ http, assert, state }) {
        // Unauthenticated requests use IP as key (no proxy headers in emulator, so falls back to 'unknown')
        state.unauthKey = 'unknown';

        const response = await http.as('none').post('backend-manager/test/usage', {});

        assert.isSuccess(response, 'Unauthenticated usage consume should succeed');
        assert.equal(response.data.authenticated, false, 'Should report as unauthenticated');
        assert.equal(response.data.key, state.unauthKey, 'Key should be unknown');

        // Verify both counters moved
        assert.equal(response.data.after.used, response.data.before.used + 1, 'The month counter should move by 1');
        assert.equal(response.data.after.day.used, response.data.before.day.used + 1, 'The day counter should move by 1');

        state.unauthMonthly = response.data.after.used;
      },
    },

    // Test 8: Verify unauthenticated usage persisted to usage collection
    {
      name: 'verify-unauthenticated-usage-persisted',
      async run({ firestore, assert, state }) {
        const usageDoc = await firestore.get(`usage/${state.unauthKey}`);

        assert.ok(usageDoc, 'Usage doc should exist in usage collection');
        assert.ok(usageDoc?.requests, 'Usage doc should have the requests feature');
        assert.equal(usageDoc.requests.monthly, state.unauthMonthly, 'Persisted monthly should match');
      },
    },

    // Test 9: Cron resets daily counters for authenticated users
    {
      name: 'cron-resets-daily-counters',
      // omega_cronDaily runs all daily jobs serially; reset-usage is at the end of
      // the alphabetical sequence. In EXTENDED mode the real-API jobs ahead of
      // it can take ~50s combined — override the suite's 30s default.
      timeout: 75000,
      async run({ assert, firestore, state, accounts, waitFor, pubsub }) {
        // Verify daily counter is > 0 before cron
        const beforeDoc = await firestore.get(`users/${accounts.basic.uid}`);
        assert.ok(beforeDoc?.usage?.requests?.daily > 0, 'Daily counter should be > 0 before cron');

        // Store monthly and total before cron (should NOT be reset by daily cron)
        state.monthlyBeforeCron = beforeDoc.usage.requests.monthly;
        state.totalBeforeCron = beforeDoc.usage.requests.total;

        // Trigger cron via PubSub
        await pubsub.trigger('omega_cronDaily');

        // Wait for cron to reset daily counter.
        // omega_cronDaily executes every registered daily job sequentially. In EXTENDED
        // mode the real-API jobs (expire-paypal-cancellations,
        // blog-auto-publisher, etc.) can take 40-50s combined before reset-usage
        // (alphabetical tail) gets its turn. 70s gives that the headroom it needs;
        // the per-test `timeout` below matches.
        try {
          await waitFor(
            async () => {
              const doc = await firestore.get(`users/${accounts.basic.uid}`);
              return doc?.usage?.requests?.daily === 0;
            },
            70000,
            500
          );
          assert.ok(true, 'Daily counter was reset to 0 by cron');
        } catch (error) {
          assert.fail('Daily counter should be reset to 0 within 70s');
        }
      },
    },

    // Test 10: Cron preserves monthly and total counters (non-1st of month)
    {
      name: 'cron-preserves-monthly-and-total',
      async run({ assert, firestore, state, accounts }) {
        const afterDoc = await firestore.get(`users/${accounts.basic.uid}`);

        // The daily cron resets monthly counters on the 1st BY DESIGN
        // (reset-usage.js), and the functions process may sit in a different
        // timezone than this test process, so on a month boundary in either
        // calendar a reset-to-zero is the correct outcome too
        const boundary = new Date().getDate() === 1 || new Date().getUTCDate() === 1;
        const monthlyOk = afterDoc.usage.requests.monthly === state.monthlyBeforeCron
          || (boundary && afterDoc.usage.requests.monthly === 0);
        assert.equal(
          monthlyOk,
          true,
          'Monthly counter should be preserved after daily cron (or reset when the run crosses the 1st)'
        );
        assert.equal(
          afterDoc.usage.requests.total,
          state.totalBeforeCron,
          'Total counter should be preserved after daily cron'
        );
      },
    },

    // Test 11: Cron deletes unauthenticated usage collection
    {
      name: 'cron-deletes-unauthenticated-usage',
      async run({ assert, firestore, state, waitFor }) {
        // The cron was already triggered in test 9, so the usage collection should be deleted
        try {
          await waitFor(
            async () => {
              const doc = await firestore.get(`usage/${state.unauthKey}`);
              return !doc;
            },
            10000,
            500
          );
          assert.ok(true, 'Usage collection doc was deleted by cron');
        } catch (error) {
          assert.fail('Usage collection doc should be deleted within 10s');
        }
      },
    },

    // Test 12: Daily counter accumulates after cron reset
    {
      name: 'daily-counter-accumulates-after-reset',
      async run({ http, assert }) {
        // After cron reset the day counter to 0, new consumes start from 0
        const response = await http.as('basic').post('backend-manager/test/usage', {
          amount: 3,
        });

        assert.isSuccess(response, 'Consume after cron reset should succeed');
        assert.equal(response.data.before.day.used, 0, 'The day counter should be 0 after cron reset');
        assert.equal(response.data.after.day.used, 3, 'The day counter should be 3 after consuming');

        // Monthly should have continued accumulating (not reset)
        assert.equal(
          response.data.after.used,
          response.data.before.used + 3,
          'The month counter should continue accumulating'
        );
      },
    },

    // Test 13: A negative amount clamps to 0 instead of DECREMENTING the
    // counter — the route keys usage off the caller's uid OR their IP, so
    // without the clamp an unauthenticated caller could zero their own bucket
    // (#238). Last in the suite: it must not move the counters the
    // accumulation tests above assert on.
    {
      name: 'negative-amount-clamps-to-zero',
      async run({ http, assert }) {
        const response = await http.as('basic').post('backend-manager/test/usage', {
          amount: -5,
        });

        assert.isSuccess(response, 'A negative amount should be accepted and clamped, not rejected');
        assert.equal(response.data.amount, 0, 'Amount should clamp to 0');

        assert.equal(
          response.data.after.used,
          response.data.before.used,
          'The month counter must not go down'
        );
        assert.equal(
          response.data.after.day.used,
          response.data.before.day.used,
          'The day counter must not go down'
        );
      },
    },

    // Test 14: The same clamp for an UNAUTHENTICATED caller, whose usage doc is
    // keyed by IP — the exact bucket the unclamped amount let anyone reset.
    {
      name: 'negative-amount-clamps-for-unauthenticated-callers',
      async run({ http, assert }) {
        const response = await http.as('none').post('backend-manager/test/usage', {
          amount: -5,
        });

        assert.isSuccess(response, 'Unauthenticated consume should succeed');
        assert.equal(response.data.authenticated, false, 'Should report as unauthenticated');
        assert.equal(response.data.amount, 0, 'Amount should clamp to 0');
        assert.equal(
          response.data.after.used,
          response.data.before.used,
          'The month counter must not go down'
        );
      },
    },
  ],
});
