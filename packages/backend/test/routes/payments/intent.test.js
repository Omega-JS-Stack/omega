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
module.exports = {
  description: 'Payment intent creation',
  type: 'group',
  timeout: 30000,

  tests: [
    {
      name: 'rejects-unauthenticated',
      auth: 'none',
      async run({ http, assert, config, skip }) {
        const paidProduct = config.payment.products.find(p => p.id !== 'basic' && p.prices);
        if (!paidProduct) {
          skip('No paid product configured in this brand');
        }

        const response = await http.as('none').post('backend-manager/payments/intent', {
          provider: 'stripe',
          productId: paidProduct.id,
          frequency: 'monthly',
        });

        assert.isError(response, 401, 'Should reject unauthenticated request');
      },
    },

    {
      name: 'rejects-missing-provider',
      async run({ http, assert, config, skip }) {
        const paidProduct = config.payment.products.find(p => p.id !== 'basic' && p.prices);
        if (!paidProduct) {
          skip('No paid product configured in this brand');
        }

        const response = await http.as('basic').post('backend-manager/payments/intent', {
          productId: paidProduct.id,
          frequency: 'monthly',
        });

        assert.isError(response, 400, 'Should reject missing provider');
      },
    },

    {
      name: 'rejects-missing-product-id',
      async run({ http, assert }) {
        const response = await http.as('basic').post('backend-manager/payments/intent', {
          provider: 'stripe',
          frequency: 'monthly',
        });

        assert.isError(response, 400, 'Should reject missing productId');
      },
    },

    {
      name: 'rejects-missing-frequency-for-subscription',
      async run({ http, assert, config, skip }) {
        const paidProduct = config.payment.products.find(p => p.id !== 'basic' && p.type === 'subscription' && p.prices);
        if (!paidProduct) {
          skip('No paid subscription product configured in this brand');
        }

        const response = await http.as('basic').post('backend-manager/payments/intent', {
          provider: 'stripe',
          productId: paidProduct.id,
        });

        assert.isError(response, 400, 'Should reject missing frequency for subscription product');
      },
    },

    {
      name: 'rejects-active-paid-user',
      auth: 'premium-active',
      async run({ http, assert, config, skip }) {
        const paidProduct = config.payment.products.find(p => p.id !== 'basic' && p.prices);
        if (!paidProduct) {
          skip('No paid product configured in this brand');
        }

        const response = await http.as('premium-active').post('backend-manager/payments/intent', {
          provider: 'stripe',
          productId: paidProduct.id,
          frequency: 'monthly',
        });

        assert.isError(response, 400, 'Should reject user with active subscription');
      },
    },

    {
      name: 'rejects-suspended-user',
      auth: 'premium-suspended',
      async run({ http, assert, config, skip }) {
        const paidProduct = config.payment.products.find(p => p.id !== 'basic' && p.prices);
        if (!paidProduct) {
          skip('No paid product configured in this brand');
        }

        const response = await http.as('premium-suspended').post('backend-manager/payments/intent', {
          provider: 'stripe',
          productId: paidProduct.id,
          frequency: 'monthly',
        });

        assert.isError(response, 400, 'Should reject user with suspended subscription');
      },
    },

    {
      name: 'rejects-cancelling-user',
      auth: 'premium-cancelling',
      async run({ http, assert, config, skip }) {
        const paidProduct = config.payment.products.find(p => p.id !== 'basic' && p.prices);
        if (!paidProduct) {
          skip('No paid product configured in this brand');
        }

        const response = await http.as('premium-cancelling').post('backend-manager/payments/intent', {
          provider: 'stripe',
          productId: paidProduct.id,
          frequency: 'monthly',
        });

        assert.isError(response, 400, 'Should reject user with cancelling subscription');
      },
    },

    {
      name: 'allows-cancelled-user',
      auth: 'premium-expired',
      async run({ http, assert, config, skip }) {
        const paidProduct = config.payment.products.find(p => p.id !== 'basic' && p.prices);
        if (!paidProduct) {
          skip('No paid product configured in this brand');
        }

        const response = await http.as('premium-expired').post('backend-manager/payments/intent', {
          provider: 'test',
          productId: paidProduct.id,
          frequency: 'monthly',
        });

        assert.isSuccess(response, 'Should allow user with fully cancelled subscription');
      },
    },

    {
      name: 'rejects-invalid-product',
      async run({ http, assert }) {
        const response = await http.as('basic').post('backend-manager/payments/intent', {
          provider: 'stripe',
          productId: 'nonexistent-product',
          frequency: 'monthly',
        });

        assert.isError(response, 400, 'Should reject invalid product');
      },
    },

    {
      name: 'rejects-unknown-simulate-value',
      async run({ http, assert, config, skip }) {
        const paidProduct = config.payment.products.find(p => p.id !== 'basic' && p.prices);
        if (!paidProduct) {
          skip('No paid product configured in this brand');
        }

        const response = await http.as('basic').post('backend-manager/payments/intent', {
          provider: 'test',
          productId: paidProduct.id,
          frequency: 'monthly',
          simulate: 'explode',
        });

        assert.isError(response, 400, 'simulate should be allow-listed');
      },
    },

    {
      name: 'rejects-unknown-provider',
      async run({ http, assert, config, skip }) {
        const paidProduct = config.payment.products.find(p => p.id !== 'basic' && p.prices);
        if (!paidProduct) {
          skip('No paid product configured in this brand');
        }

        const response = await http.as('basic').post('backend-manager/payments/intent', {
          provider: 'unknown-provider',
          productId: paidProduct.id,
          frequency: 'monthly',
        });

        assert.isError(response, 400, 'Should reject unknown provider');
      },
    },

    {
      name: 'rejects-invalid-discount-code',
      async run({ http, assert, config, skip }) {
        const paidProduct = config.payment.products.find(p => p.id !== 'basic' && p.prices);
        if (!paidProduct) {
          skip('No paid product configured in this brand');
        }

        const response = await http.as('basic').post('backend-manager/payments/intent', {
          provider: 'stripe',
          productId: paidProduct.id,
          frequency: 'monthly',
          discount: 'FAKECODE',
        });

        assert.isError(response, 400, 'Should reject invalid discount code');
      },
    },

    {
      name: 'saves-discount-to-intent-doc',
      async run({ http, assert, config, firestore, skip }) {
        const paidProduct = config.payment.products.find(p => p.id !== 'basic' && p.prices);
        if (!paidProduct) {
          skip('No paid product configured in this brand');
        }
        const frequency = Object.keys(paidProduct.prices)[0];

        const response = await http.as('intent-discount-validation').post('backend-manager/payments/intent', {
          provider: 'test',
          productId: paidProduct.id,
          frequency,
          discount: 'FLASH20',
        });

        assert.isSuccess(response, 'Should succeed with valid discount');

        // Verify discount was resolved and saved to intent doc
        const intentDoc = await firestore.get(`payments-intents/${response.data.orderId}`);
        assert.ok(intentDoc.discount, 'Discount should be saved on intent');
        assert.equal(intentDoc.discount.code, 'FLASH20', 'Discount code should match');
        assert.equal(intentDoc.discount.percent, 20, 'Discount percent should be 20');
        assert.equal(intentDoc.discount.duration, 'once', 'Discount duration should be once');
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
      async run({ http, assert, config, firestore, waitFor, skip }) {
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

        const response = await http.as('journey-payments-intent-attribution').post('backend-manager/payments/intent', {
          provider: 'test',
          productId: paidProduct.id,
          frequency,
          attribution,
          trackingConsent,
          supplemental: { referral: 'friend' },
        });

        assert.isSuccess(response, 'Should succeed with attribution, trackingConsent and supplemental');

        const intentDoc = await firestore.get(`payments-intents/${response.data.orderId}`);
        assert.deepEqual(intentDoc.attribution, attribution, 'Attribution should be stored verbatim on the intent');
        assert.deepEqual(intentDoc.trackingConsent, trackingConsent, 'Tracking consent should be stored verbatim on the intent');
        assert.equal(intentDoc.supplemental.referral, 'friend', 'Supplemental should be saved');
        assert.equal(typeof intentDoc.request, 'object', 'The requester context should be captured on the intent');
        assert.equal(Object.hasOwn(intentDoc.request, 'ip'), true, 'The client IP slot is always written — null when no header carries one');
        assert.equal(Object.hasOwn(intentDoc.request, 'userAgent'), true, 'The user agent slot is always written');

        // The auto-webhook folds the intent's checkout context onto the order.
        await waitFor(async () => {
          const orderDoc = await firestore.get(`payments-orders/${response.data.orderId}`);
          return !!orderDoc;
        }, 15000, 500);

        const orderDoc = await firestore.get(`payments-orders/${response.data.orderId}`);
        assert.deepEqual(orderDoc.attribution, attribution, 'The order fold copies attribution unchanged');
        assert.deepEqual(orderDoc.trackingConsent, trackingConsent, 'The order fold copies trackingConsent unchanged');
        assert.deepEqual(orderDoc.request, intentDoc.request, 'The order fold copies the captured request context — the conversion match data reads it from the order');
      },
    },

    {
      name: 'succeeds-with-test-provider',
      async run({ http, assert, config, firestore, accounts, waitFor, skip }) {
        const uid = accounts['journey-payments-intent'].uid;
        const paidProduct = config.payment.products.find(p => p.id !== 'basic' && p.prices);
        if (!paidProduct) {
          skip('No paid product configured in this brand');
        }

        const response = await http.as('journey-payments-intent').post('backend-manager/payments/intent', {
          provider: 'test',
          productId: paidProduct.id,
          frequency: 'monthly',
        });

        assert.isSuccess(response, 'Should succeed with test provider');
        assert.ok(response.data.id, 'Should return intent ID');
        assert.ok(response.data.orderId, 'Should return orderId');
        assert.match(response.data.orderId, /^\d{4}-\d{4}-\d{4}$/, 'orderId should be XXXX-XXXX-XXXX format');
        assert.ok(response.data.url, 'Should return URL');

        // Verify intent doc was saved (keyed by orderId)
        const intentDoc = await firestore.get(`payments-intents/${response.data.orderId}`);
        assert.ok(intentDoc, 'Intent doc should exist');
        assert.equal(intentDoc.intentId, response.data.id, 'Intent ID should match response');
        assert.equal(intentDoc.provider, 'test', 'Provider should be test');
        assert.equal(intentDoc.productId, paidProduct.id, 'Product should match');

        // Wait for auto-webhook to process and activate the subscription
        await waitFor(async () => {
          const userDoc = await firestore.get(`users/${uid}`);
          return userDoc?.subscription?.product?.id === paidProduct.id;
        }, 15000, 500).catch(() => {});
      },
    },

    {
      name: 'downgrades-trial-for-user-with-history',
      async run({ http, assert, config, accounts, firestore, waitFor, skip }) {
        const uid = accounts['journey-payments-intent-trial'].uid;
        const paidProduct = config.payment.products.find(p => p.id !== 'basic' && p.prices);
        if (!paidProduct) {
          skip('No paid product configured in this brand');
        }
        const orderDocPath = `payments-orders/_test-order-history-${uid}`;

        // Create fake subscription history so user is ineligible for trial
        await firestore.set(orderDocPath, { owner: uid, type: 'subscription', provider: 'test', status: 'cancelled' });

        try {
          const response = await http.as('journey-payments-intent-trial').post('backend-manager/payments/intent', {
            provider: 'test',
            productId: paidProduct.id,
            frequency: 'monthly',
            trial: true,
          });

          // Should succeed (not reject with 400) — trial silently downgraded
          assert.isSuccess(response, 'Should not reject — trial silently downgraded');

          // Verify intent saved with trial=false (keyed by orderId)
          const intentDoc = await firestore.get(`payments-intents/${response.data.orderId}`);
          assert.equal(intentDoc.trial, false, 'Trial should be false (downgraded)');

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
};
