/**
 * Test: POST /payments/dispute-alert
 * Tests the dispute alert endpoint validates requests and saves to Firestore
 */

const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');
module.exports = defineCases({
  description: 'Dispute alert endpoint',
  type: 'group',
  timeout: 30000,

  tests: [
    {
      name: 'rejects-missing-key',
      auth: 'none',
      async run({ http, expect }) {
        const response = await http.as('none').post('omega/payments/dispute-alert', {});

        expect(response, 'Should reject missing key').toBeError(401);
      },
    },

    {
      name: 'rejects-invalid-key',
      auth: 'none',
      async run({ http, expect }) {
        const response = await http.as('none').post('omega/payments/dispute-alert?key=wrong-key', {});

        expect(response, 'Should reject invalid key').toBeError(401);
      },
    },

    {
      name: 'rejects-unknown-provider',
      auth: 'none',
      async run({ http, expect }) {
        const response = await http.as('none').post(`omega/payments/dispute-alert?provider=unknown&key=${process.env.OMEGA_WEBHOOK_KEY}`, {
          id: '_test-dispute-unknown-provider',
          card: '4242',
          amount: 9.99,
          transactionDate: '2026-01-15',
        });

        expect(response, 'Should reject unknown alert provider').toBeError(400);
      },
    },

    {
      name: 'rejects-missing-id',
      auth: 'none',
      async run({ http, expect }) {
        const response = await http.as('none').post(`omega/payments/dispute-alert?key=${process.env.OMEGA_WEBHOOK_KEY}`, {
          card: '4242',
          amount: 9.99,
          transactionDate: '2026-01-15',
        });

        expect(response, 'Should reject missing id').toBeError(400);
      },
    },

    {
      name: 'rejects-missing-card',
      auth: 'none',
      async run({ http, expect }) {
        const response = await http.as('none').post(`omega/payments/dispute-alert?key=${process.env.OMEGA_WEBHOOK_KEY}`, {
          id: '_test-dispute-no-card',
          amount: 9.99,
          transactionDate: '2026-01-15',
        });

        expect(response, 'Should reject missing card').toBeError(400);
      },
    },

    {
      name: 'rejects-missing-amount',
      auth: 'none',
      async run({ http, expect }) {
        const response = await http.as('none').post(`omega/payments/dispute-alert?key=${process.env.OMEGA_WEBHOOK_KEY}`, {
          id: '_test-dispute-no-amount',
          card: '4242',
          transactionDate: '2026-01-15',
        });

        expect(response, 'Should reject missing amount').toBeError(400);
      },
    },

    {
      name: 'rejects-missing-transaction-date',
      auth: 'none',
      async run({ http, expect }) {
        const response = await http.as('none').post(`omega/payments/dispute-alert?key=${process.env.OMEGA_WEBHOOK_KEY}`, {
          id: '_test-dispute-no-date',
          card: '4242',
          amount: 9.99,
        });

        expect(response, 'Should reject missing transactionDate').toBeError(400);
      },
    },

    {
      name: 'accepts-valid-chargeblast-alert',
      auth: 'none',
      async run({ http, expect, firestore }) {
        const alertId = '_test-dispute-valid';

        const response = await http.as('none').post(`omega/payments/dispute-alert?key=${process.env.OMEGA_WEBHOOK_KEY}`, {
          id: alertId,
          card: '4242424242424242',
          cardBrand: 'Visa',
          amount: 29.99,
          transactionDate: '2026-03-07 14:30:00',
          // Chargeblast's own field name on the wire (#428 leftover) — the
          // route normalizes it onto `alert.provider`
          processor: 'stripe',
          alertType: 'FRAUD',
          customerEmail: 'test@example.com',
          externalOrder: 'ch_test123',
          metadata: 'pi_test456',
          externalUrl: 'https://dashboard.stripe.com/charges/ch_test123',
          reasonCode: 'WIP',
          subprovider: 'Ethoca',
          isRefunded: false,
        });

        expect(response, 'Should accept valid Chargeblast alert').toBeSuccess();
        expect(response.data.received, 'Should confirm receipt').toBe(true);

        // Verify doc was saved to Firestore
        const doc = await firestore.get(`payments-disputes/${alertId}`);
        expect(doc, 'Dispute doc should exist in Firestore').toBeTruthy();
        expect(doc.provider, 'Provider should be chargeblast').toBe('chargeblast');
        expect(doc.status === 'pending' || doc.status === 'processing', 'Status should be pending or processing').toBeTruthy();

        // Verify core normalized alert data
        expect(doc.alert.card.last4, 'Should extract last4 from full card number').toBe('4242');
        expect(doc.alert.card.brand, 'Should lowercase card brand').toBe('visa');
        expect(doc.alert.amount, 'Amount should be preserved').toBe(29.99);
        expect(doc.alert.transactionDate, 'Should extract date without time').toBe('2026-03-07');
        expect(doc.alert.provider, 'Provider should be stripe').toBe('stripe');

        // Verify new normalized fields
        expect(doc.alert.alertType, 'Alert type should be preserved').toBe('FRAUD');
        expect(doc.alert.customerEmail, 'Customer email should be preserved').toBe('test@example.com');
        expect(doc.alert.chargeId, 'Charge ID should be extracted from externalOrder').toBe('ch_test123');
        expect(doc.alert.paymentIntentId, 'Payment intent ID should be extracted from metadata').toBe('pi_test456');
        expect(doc.alert.stripeUrl, 'Stripe URL should be preserved').toBe('https://dashboard.stripe.com/charges/ch_test123');
        expect(doc.alert.reasonCode, 'Reason code should be preserved').toBe('WIP');
        expect(doc.alert.subprovider, 'Subprovider should be preserved').toBe('Ethoca');
        expect(doc.alert.isRefunded, 'isRefunded should be preserved').toBe(false);

        // Verify raw payload is preserved
        expect(doc.raw, 'Raw payload should be preserved').toBeTruthy();
        expect(doc.raw.id, 'Raw id should match').toBe(alertId);
      },
    },

    {
      name: 'accepts-alert-with-alertId-field',
      auth: 'none',
      async run({ http, expect, firestore }) {
        const alertId = '_test-dispute-alertid-field';

        // Chargeblast alert.created events use alertId instead of id
        const response = await http.as('none').post(`omega/payments/dispute-alert?key=${process.env.OMEGA_WEBHOOK_KEY}`, {
          alertId: alertId,
          card: '546616******5805',
          cardBrand: 'Mastercard',
          amount: 8,
          transactionDate: '2026-03-19 00:00:00.000000Z',
        });

        expect(response, 'Should accept alert using alertId field').toBeSuccess();

        const doc = await firestore.get(`payments-disputes/${alertId}`);
        expect(doc, 'Dispute doc should exist in Firestore').toBeTruthy();
        expect(doc.id, 'Doc ID should match alertId').toBe(alertId);
        expect(doc.alert.id, 'Alert id should be set from alertId').toBe(alertId);
        expect(doc.alert.card.last4, 'Should extract last4 from masked card').toBe('5805');
      },
    },

    {
      name: 'accepts-alert-without-optional-fields',
      auth: 'none',
      async run({ http, expect, firestore }) {
        const alertId = '_test-dispute-minimal';

        // Send minimal alert (alert.created shape — no externalOrder, metadata, etc.)
        const response = await http.as('none').post(`omega/payments/dispute-alert?key=${process.env.OMEGA_WEBHOOK_KEY}`, {
          id: alertId,
          card: '9124',
          amount: 10,
          transactionDate: '2026-03-21 00:01:02',
        });

        expect(response, 'Should accept minimal alert').toBeSuccess();

        const doc = await firestore.get(`payments-disputes/${alertId}`);
        expect(doc.alert.card.last4, 'Should use card as last4').toBe('9124');
        expect(doc.alert.provider, 'Provider should default to stripe').toBe('stripe');
        expect(doc.alert.chargeId, 'Charge ID should be null when not provided').toBe(null);
        expect(doc.alert.paymentIntentId, 'Payment intent should be null when not provided').toBe(null);
        expect(doc.alert.customerEmail, 'Customer email should be null when not provided').toBe(null);
        expect(doc.alert.alertType, 'Alert type should be null when not provided').toBe(null);
        expect(doc.alert.stripeUrl, 'Stripe URL should be null when not provided').toBe(null);
        expect(doc.alert.reasonCode, 'Reason code should be null when not provided').toBe(null);
        expect(doc.alert.subprovider, 'Subprovider should be null when not provided').toBe(null);
        expect(doc.alert.isRefunded, 'isRefunded should default to false').toBe(false);
      },
    },

    {
      name: 'accepts-alert-with-last4-only',
      auth: 'none',
      async run({ http, expect, firestore }) {
        const alertId = '_test-dispute-last4';

        const response = await http.as('none').post(`omega/payments/dispute-alert?key=${process.env.OMEGA_WEBHOOK_KEY}`, {
          id: alertId,
          card: '1234',
          amount: 9.99,
          transactionDate: '2026-01-15',
        });

        expect(response, 'Should accept alert with card last4 only').toBeSuccess();

        const doc = await firestore.get(`payments-disputes/${alertId}`);
        expect(doc.alert.card.last4, 'Should use card value as last4 when already 4 digits').toBe('1234');
        expect(doc.alert.provider, 'Provider should default to stripe').toBe('stripe');
      },
    },

    {
      name: 'deduplicates-dispute-alerts',
      auth: 'none',
      async run({ http, expect, firestore }) {
        const alertId = '_test-dispute-duplicate';

        // Pre-seed an in-flight dispute directly. We seed (rather than POST a first alert)
        // because the route fires an async on-write trigger that, for synthetic test data
        // with no matching charge, can transition the doc to 'failed' — at which point the
        // dedup contract intentionally treats it as RETRYABLE, not a duplicate. Racing a
        // live POST against that trigger made this test flaky. Seeding 'processing' (a
        // non-failed, in-flight state) deterministically exercises the dedup path.
        await firestore.set(`payments-disputes/${alertId}`, {
          id: alertId,
          status: 'processing',
        });

        // A subsequent identical alert must be reported as a duplicate (not reprocessed).
        const response = await http.as('none').post(`omega/payments/dispute-alert?key=${process.env.OMEGA_WEBHOOK_KEY}`, {
          id: alertId,
          card: '4242',
          amount: 29.99,
          transactionDate: '2026-03-07',
        });

        expect(response, 'Duplicate should still return 200').toBeSuccess();
        expect(response.data.duplicate, 'Should indicate duplicate').toBe(true);
      },
    },

    {
      name: 'retries-failed-alerts',
      auth: 'none',
      async run({ http, expect, firestore }) {
        const alertId = '_test-dispute-retry';

        // Pre-seed a failed dispute
        await firestore.set(`payments-disputes/${alertId}`, {
          id: alertId,
          status: 'failed',
          error: 'Previous error',
        });

        // Send alert with same ID — should retry since previous status was 'failed'
        const response = await http.as('none').post(`omega/payments/dispute-alert?key=${process.env.OMEGA_WEBHOOK_KEY}`, {
          id: alertId,
          card: '4242',
          amount: 29.99,
          transactionDate: '2026-03-07',
        });

        expect(response.status, 'Should accept retry of failed alert with 200').toBe(200);
        expect(!response.data.duplicate, 'Should not indicate duplicate for failed retry').toBeTruthy();

        // The on-write trigger may already have moved `status` on, so only the retry's rewrite is asserted
        const doc = await firestore.get(`payments-disputes/${alertId}`);
        expect(doc.alert.card.last4, 'The retry should save the posted card').toBe('4242');
        expect(doc.alert.amount, 'The retry should save the posted amount').toBe(29.99);
        expect(doc.error, 'The retry should replace the seeded error').not.toBe('Previous error');
      },
    },

    {
      name: 'defaults-provider-to-chargeblast',
      auth: 'none',
      async run({ http, expect, firestore }) {
        const alertId = '_test-dispute-default-provider';

        // Send without provider query param
        const response = await http.as('none').post(`omega/payments/dispute-alert?key=${process.env.OMEGA_WEBHOOK_KEY}`, {
          id: alertId,
          card: '4242',
          amount: 9.99,
          transactionDate: '2026-01-15',
        });

        expect(response, 'Should accept without explicit provider param').toBeSuccess();

        const doc = await firestore.get(`payments-disputes/${alertId}`);
        expect(doc.provider, 'Provider should default to chargeblast').toBe('chargeblast');
      },
    },
  ],
});
