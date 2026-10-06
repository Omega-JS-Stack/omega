/**
 * Test: POST /payments/intent
 * Tests intent creation endpoint validation + end-to-end flow via test provider
 *
 * Validation tests use provider=stripe (fail at SDK step, proving validation logic)
 * Success tests use provider=test (full intent→webhook→trigger pipeline)
 *
 * Product-agnostic: resolves the first paid product from config.payment.products.
 * If the brand has no paid product configured, each test skips — this is a
 * config-gap, not a code failure.
 */

const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');
module.exports = defineCases({
  description: 'Payment intent creation',
  type: 'group',
  timeout: 30000,

  tests: [
    {
      name: 'rejects-unauthenticated',
      auth: 'none',
      async run({ http, expect, config, skip }) {
        const paidProduct = config.payment.products.find(p => p.id !== 'basic' && p.prices);
        if (!paidProduct) {
          skip('No paid product configured in this brand');
        }

        const response = await http.as('none').post('omega/payments/intent', {
          provider: 'stripe',
          productId: paidProduct.id,
          frequency: 'monthly',
        });

        expect(response, 'Should reject unauthenticated request').toBeError(401);
      },
    },

    {
      name: 'rejects-missing-provider',
      async run({ http, expect, config, skip }) {
        const paidProduct = config.payment.products.find(p => p.id !== 'basic' && p.prices);
        if (!paidProduct) {
          skip('No paid product configured in this brand');
        }

        const response = await http.as('basic').post('omega/payments/intent', {
          productId: paidProduct.id,
          frequency: 'monthly',
        });

        expect(response, 'Should reject missing provider').toBeError(400);
      },
    },

    {
      name: 'rejects-missing-product-id',
      async run({ http, expect }) {
        const response = await http.as('basic').post('omega/payments/intent', {
          provider: 'stripe',
          frequency: 'monthly',
        });

        expect(response, 'Should reject missing productId').toBeError(400);
      },
    },

    {
      name: 'rejects-missing-frequency-for-subscription',
      async run({ http, expect, config, skip }) {
        const paidProduct = config.payment.products.find(p => p.id !== 'basic' && p.type === 'subscription' && p.prices);
        if (!paidProduct) {
          skip('No paid subscription product configured in this brand');
        }

        const response = await http.as('basic').post('omega/payments/intent', {
          provider: 'stripe',
          productId: paidProduct.id,
        });

        expect(response, 'Should reject missing frequency for subscription product').toBeError(400);
      },
    },

    {
      name: 'rejects-active-paid-user',
      auth: 'premium-active',
      async run({ http, expect, config, skip }) {
        const paidProduct = config.payment.products.find(p => p.id !== 'basic' && p.prices);
        if (!paidProduct) {
          skip('No paid product configured in this brand');
        }

        const response = await http.as('premium-active').post('omega/payments/intent', {
          provider: 'stripe',
          productId: paidProduct.id,
          frequency: 'monthly',
        });

        expect(response, 'Should reject user with active subscription').toBeError(400);
      },
    },

    {
      name: 'rejects-suspended-user',
      auth: 'premium-suspended',
      async run({ http, expect, config, skip }) {
        const paidProduct = config.payment.products.find(p => p.id !== 'basic' && p.prices);
        if (!paidProduct) {
          skip('No paid product configured in this brand');
        }

        const response = await http.as('premium-suspended').post('omega/payments/intent', {
          provider: 'stripe',
          productId: paidProduct.id,
          frequency: 'monthly',
        });

        expect(response, 'Should reject user with suspended subscription').toBeError(400);
      },
    },

    {
      name: 'rejects-cancelling-user',
      auth: 'premium-cancelling',
      async run({ http, expect, config, skip }) {
        const paidProduct = config.payment.products.find(p => p.id !== 'basic' && p.prices);
        if (!paidProduct) {
          skip('No paid product configured in this brand');
        }

        const response = await http.as('premium-cancelling').post('omega/payments/intent', {
          provider: 'stripe',
          productId: paidProduct.id,
          frequency: 'monthly',
        });

        expect(response, 'Should reject user with cancelling subscription').toBeError(400);
      },
    },

    {
      name: 'allows-cancelled-user',
      auth: 'premium-expired',
      async run({ http, expect, config, skip }) {
        const paidProduct = config.payment.products.find(p => p.id !== 'basic' && p.prices);
        if (!paidProduct) {
          skip('No paid product configured in this brand');
        }

        const response = await http.as('premium-expired').post('omega/payments/intent', {
          provider: 'test',
          productId: paidProduct.id,
          frequency: 'monthly',
        });

        expect(response, 'Should allow user with fully cancelled subscription').toBeSuccess();
      },
    },

    {
      name: 'rejects-invalid-product',
      async run({ http, expect }) {
        const response = await http.as('basic').post('omega/payments/intent', {
          provider: 'stripe',
          productId: 'nonexistent-product',
          frequency: 'monthly',
        });

        expect(response, 'Should reject invalid product').toBeError(400);
      },
    },

    {
      name: 'rejects-unknown-simulate-value',
      async run({ http, expect, config, skip }) {
        const paidProduct = config.payment.products.find(p => p.id !== 'basic' && p.prices);
        if (!paidProduct) {
          skip('No paid product configured in this brand');
        }

        const response = await http.as('basic').post('omega/payments/intent', {
          provider: 'test',
          productId: paidProduct.id,
          frequency: 'monthly',
          simulate: 'explode',
        });

        expect(response, 'simulate should be allow-listed').toBeError(400);
      },
    },

    {
      name: 'rejects-unknown-provider',
      async run({ http, expect, config, skip }) {
        const paidProduct = config.payment.products.find(p => p.id !== 'basic' && p.prices);
        if (!paidProduct) {
          skip('No paid product configured in this brand');
        }

        const response = await http.as('basic').post('omega/payments/intent', {
          provider: 'unknown-provider',
          productId: paidProduct.id,
          frequency: 'monthly',
        });

        expect(response, 'Should reject unknown provider').toBeError(400);
      },
    },

    {
      name: 'rejects-a-product-type-the-provider-does-not-sell',
      async run({ http, expect, config, skip }) {
        // The provider gate reads the registry: Coinbase Commerce's row sells
        // no subscription, so the route refuses before any provider module runs
        const plan = config.payment.products.find(p => p.id !== 'basic' && (p.type || 'subscription') === 'subscription' && p.prices);
        if (!plan) {
          skip('No paid subscription configured in this brand');
        }

        const response = await http.as('basic').post('omega/payments/intent', {
          provider: 'coinbase',
          productId: plan.id,
          frequency: 'monthly',
        });

        expect(response, 'Should refuse a subscription on a provider that sells none').toBeError(400);
        expect(`${response.error}`, 'The refusal names the provider and the product type').toMatch(/Coinbase Commerce cannot sell a subscription/);
      },
    },

    {
      name: 'rejects-invalid-discount-code',
      async run({ http, expect, config, skip }) {
        const paidProduct = config.payment.products.find(p => p.id !== 'basic' && p.prices);
        if (!paidProduct) {
          skip('No paid product configured in this brand');
        }

        const response = await http.as('basic').post('omega/payments/intent', {
          provider: 'stripe',
          productId: paidProduct.id,
          frequency: 'monthly',
          discount: 'FAKECODE',
        });

        expect(response, 'Should reject invalid discount code').toBeError(400);
      },
    },

    {
      name: 'saves-discount-to-intent-doc',
      async run({ http, expect, config, firestore, skip }) {
        const paidProduct = config.payment.products.find(p => p.id !== 'basic' && p.prices);
        if (!paidProduct) {
          skip('No paid product configured in this brand');
        }
        const frequency = Object.keys(paidProduct.prices)[0];

        const response = await http.as('intent-discount-validation').post('omega/payments/intent', {
          provider: 'test',
          productId: paidProduct.id,
          frequency,
          discount: 'FLASH20',
        });

        expect(response, 'Should succeed with valid discount').toBeSuccess();

        // Verify discount was resolved and saved to intent doc
        const intentDoc = await firestore.get(`payments-intents/${response.data.orderId}`);
        expect(intentDoc.discount, 'Discount should be saved on intent').toBeTruthy();
        expect(intentDoc.discount.code, 'Discount code should match').toBe('FLASH20');
        expect(intentDoc.discount.percent, 'Discount percent should be 20').toBe(20);
        expect(intentDoc.discount.duration, 'Discount duration should be once').toBe('once');
      },
    },

    {
      // The checkout context the client sends rides through UNTOUCHED: the
      // first/last touch model of [#384](https://github.com/Omega-JS-Stack/omega/issues/384)
      // and the tracking-consent snapshot beside it are stored verbatim on the intent,
      // then folded onto the order by the payments-webhooks on-write. The one piece
      // the client CANNOT send is captured here: the requester's IP and user agent,
      // which is what Meta and TikTok match a server conversion on
      // ([#385](https://github.com/Omega-JS-Stack/omega/issues/385)) — the completing
      // webhook arrives from the provider, so this is the only moment we hear from
      // the customer's own browser.
      name: 'saves-attribution-tracking-consent-and-supplemental-to-intent-doc',
      async run({ http, expect, config, firestore, waitFor, skip }) {
        const paidProduct = config.payment.products.find(p => p.id !== 'basic' && p.prices);
        if (!paidProduct) {
          skip('No paid product configured in this brand');
        }
        const frequency = Object.keys(paidProduct.prices)[0];

        const attribution = {
          first: {
            tags: { utm_source: 'newsletter', utm_medium: 'email' },
            referrer: 'https://news.ycombinator.com/',
            url: 'https://brand.test/',
            page: '/',
            timestamp: '2025-06-01T00:00:00.000Z',
          },
          last: {
            tags: { utm_source: 'meta', utm_campaign: 'launch' },
            clickIds: { fbclid: 'FB1', gclid: 'G1' },
            referrer: 'https://facebook.com/',
            url: 'https://brand.test/pricing?utm_source=meta',
            page: '/pricing',
            timestamp: '2025-08-01T00:00:00.000Z',
          },
          affiliate: { code: 'IAN7', timestamp: '2025-08-01T00:00:00.000Z', url: 'https://brand.test/', page: '/' },
          // The platform cookies the checkout reads off document.cookie at send
          // time (#385) — just another key on a passthrough field, so proving the
          // whole object survives proves these do.
          cookies: { fbc: 'fb.1.1754006400000.FB1', fbp: 'fb.1.1754006400000.987654321', ttp: 'TTP1' },
        };
        // The snapshot the web consent module writes under storage.trackingConsent.
        const trackingConsent = {
          analytics: true,
          marketing: false,
          region: 'opt-in',
          timestamp: '2026-08-01T00:00:00.000Z',
          version: 1,
        };

        const response = await http.as('journey-payments-intent-attribution').post('omega/payments/intent', {
          provider: 'test',
          productId: paidProduct.id,
          frequency,
          attribution,
          trackingConsent,
          supplemental: { referral: 'friend' },
        });

        expect(response, 'Should succeed with attribution, trackingConsent and supplemental').toBeSuccess();

        const intentDoc = await firestore.get(`payments-intents/${response.data.orderId}`);
        expect(intentDoc.attribution, 'Attribution should be stored verbatim on the intent').toEqual(attribution);
        expect(intentDoc.trackingConsent, 'Tracking consent should be stored verbatim on the intent').toEqual(trackingConsent);
        expect(intentDoc.supplemental.referral, 'Supplemental should be saved').toBe('friend');
        expect(typeof intentDoc.request, 'The requester context should be captured on the intent').toBe('object');
        expect(Object.hasOwn(intentDoc.request, 'ip'), 'The client IP slot is always written — null when no header carries one').toBe(true);
        expect(Object.hasOwn(intentDoc.request, 'userAgent'), 'The user agent slot is always written').toBe(true);

        // The auto-webhook folds the intent's checkout context onto the order.
        await waitFor(async () => {
          const orderDoc = await firestore.get(`payments-orders/${response.data.orderId}`);
          return !!orderDoc;
        }, 15000, 500);

        const orderDoc = await firestore.get(`payments-orders/${response.data.orderId}`);
        expect(orderDoc.attribution, 'The order fold copies attribution unchanged').toEqual(attribution);
        expect(orderDoc.trackingConsent, 'The order fold copies trackingConsent unchanged').toEqual(trackingConsent);
        expect(orderDoc.request, 'The order fold copies the captured request context — the conversion match data reads it from the order').toEqual(intentDoc.request);
      },
    },

    {
      name: 'succeeds-with-test-provider',
      async run({ http, expect, config, firestore, accounts, waitFor, skip }) {
        const uid = accounts['journey-payments-intent'].uid;
        const paidProduct = config.payment.products.find(p => p.id !== 'basic' && p.prices);
        if (!paidProduct) {
          skip('No paid product configured in this brand');
        }

        const response = await http.as('journey-payments-intent').post('omega/payments/intent', {
          provider: 'test',
          productId: paidProduct.id,
          frequency: 'monthly',
        });

        expect(response, 'Should succeed with test provider').toBeSuccess();
        expect(response.data.id, 'Should return intent ID').toBeTruthy();
        expect(response.data.orderId, 'Should return orderId').toBeTruthy();
        expect(response.data.orderId, 'orderId should be XXXX-XXXX-XXXX format').toMatch(/^\d{4}-\d{4}-\d{4}$/);
        expect(response.data.url, 'Should return URL').toBeTruthy();

        // Verify intent doc was saved (keyed by orderId)
        const intentDoc = await firestore.get(`payments-intents/${response.data.orderId}`);
        expect(intentDoc, 'Intent doc should exist').toBeTruthy();
        expect(intentDoc.intentId, 'Intent ID should match response').toBe(response.data.id);
        expect(intentDoc.provider, 'Provider should be test').toBe('test');
        expect(intentDoc.productId, 'Product should match').toBe(paidProduct.id);

        // Wait for auto-webhook to process and activate the subscription
        await waitFor(async () => {
          const userDoc = await firestore.get(`users/${uid}`);
          return userDoc?.subscription?.product?.id === paidProduct.id;
        }, 15000, 500).catch(() => {});
      },
    },

    {
      name: 'downgrades-trial-for-user-with-history',
      async run({ http, expect, config, accounts, firestore, waitFor, skip }) {
        const uid = accounts['journey-payments-intent-trial'].uid;
        const paidProduct = config.payment.products.find(p => p.id !== 'basic' && p.prices);
        if (!paidProduct) {
          skip('No paid product configured in this brand');
        }
        const orderDocPath = `payments-orders/_test-order-history-${uid}`;

        // Create fake subscription history so user is ineligible for trial
        await firestore.set(orderDocPath, { owner: uid, type: 'subscription', provider: 'test', status: 'cancelled' });

        try {
          const response = await http.as('journey-payments-intent-trial').post('omega/payments/intent', {
            provider: 'test',
            productId: paidProduct.id,
            frequency: 'monthly',
            trial: true,
          });

          // Should succeed (not reject with 400) — trial silently downgraded
          expect(response, 'Should not reject — trial silently downgraded').toBeSuccess();

          // Verify intent saved with trial=false (keyed by orderId)
          const intentDoc = await firestore.get(`payments-intents/${response.data.orderId}`);
          expect(intentDoc.trial, 'Trial should be false (downgraded)').toBe(false);

          // Wait for auto-webhook to activate the subscription
          await waitFor(async () => {
            const userDoc = await firestore.get(`users/${uid}`);
            return userDoc?.subscription?.product?.id === paidProduct.id;
          }, 15000, 500).catch(() => {});
        } finally {
          await firestore.delete(orderDocPath);
        }
      },
    },
  ],
});
