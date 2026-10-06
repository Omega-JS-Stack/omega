/**
 * Test: the payment provider registry, one capability descriptor per provider.
 *
 * `libraries/payment/providers/index.js` is what every backend decision about
 * a provider reads: the zero-charge guard, the refund refusal, the intent
 * route's gate. So its rows and the provider files must be one set, and each
 * refusal must be exactly the rows that say "cannot", never a list of names.
 *
 * Plain node: the folders on disk, the registry and the two pure refusals.
 *
 * Run: npx omega test backend:helpers/payment/provider-registry
 */
const path = require('path');
const jetpack = require('fs-jetpack');
const registry = require('../../../dist/omega/libraries/payment/providers/index.js');
const discountCodes = require('../../../dist/omega/libraries/payment/discount-codes.js');
const { oneTimeRefundRefusal } = require('../../../dist/omega/libraries/payment/refund-policy.js');
const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');

const OMEGA_DIR = path.join(__dirname, '../../../dist/omega');

// Every route that acts on a SUBSCRIPTION has no module for a provider that sells none
const EVERY_PROVIDER_DIRS = ['libraries/payment/providers', 'routes/payments/intent/providers', 'routes/payments/webhook/providers', 'routes/payments/refund/providers'];
const SUBSCRIPTION_DIRS = ['cancel', 'plan', 'portal', 'uncancel', 'winback'].map((route) => `routes/payments/${route}/providers`);

/** The provider ids a folder holds modules for, sorted */
function providerFiles(dir) {
  return jetpack.list(path.join(OMEGA_DIR, dir))
    .filter((file) => file.endsWith('.js') && file !== 'index.js')
    .map((file) => file.slice(0, -3))
    .sort();
}

/** The descriptor ids a predicate picks, sorted */
function ids(predicate) {
  return Object.values(registry.PAYMENT_PROVIDERS).filter(predicate).map((descriptor) => descriptor.id).sort();
}

/** A completed one-time order on one provider, the shape the webhook pipeline writes */
function completedOrder(provider) {
  const nowUNIX = Math.floor(Date.now() / 1000);

  return {
    type: 'one-time',
    provider,
    resourceId: '_test-resource',
    unified: { status: 'completed', payment: { provider } },
    requests: { refund: null },
    metadata: { created: { timestampUNIX: nowUNIX } },
  };
}

module.exports = defineCases({
  description: 'The payment provider registry',
  type: 'group',

  tests: [
    {
      name: 'every-provider-file-has-a-descriptor-and-every-descriptor-a-file',
      async run({ expect }) {
        for (const dir of EVERY_PROVIDER_DIRS) {
          expect(providerFiles(dir), `${dir} holds one module per descriptor`).toEqual(ids(() => true));
        }
      },
    },

    {
      name: 'the-subscription-routes-hold-exactly-the-providers-that-sell-subscriptions',
      async run({ expect }) {
        for (const dir of SUBSCRIPTION_DIRS) {
          expect(providerFiles(dir), `${dir} matches the subscriptions capability`).toEqual(ids((descriptor) => descriptor.subscriptions));
        }
      },
    },

    {
      name: 'the-zero-charge-refusal-set-equals-the-descriptors',
      async run({ expect }) {
        const code = discountCodes.validate('WELCOME10OFF');
        const refused = [];

        for (const id of ids(() => true)) {
          try {
            expect(discountCodes.chargeableAmount(9.99, code, { provider: id }), `${id} takes the $0 charge`).toBe(0);
          } catch (e) {
            if (e.code !== 400) throw e;
            expect(e.message, `${id}'s refusal names it`).toMatch(new RegExp(`nothing for ${registry.PAYMENT_PROVIDERS[id].name} to charge`));
            refused.push(id);
          }
        }

        expect(refused).toEqual(ids((descriptor) => !descriptor.acceptsZeroCharge));
      },
    },

    {
      name: 'the-refund-refusal-set-equals-the-descriptors',
      async run({ expect }) {
        const refused = ids(() => true).filter((id) => oneTimeRefundRefusal(completedOrder(id))?.reason === 'provider-cannot-refund');

        expect(refused).toEqual(ids((descriptor) => !descriptor.refundable));
      },
    },

    {
      name: 'an-unknown-id-has-no-descriptor',
      async run({ expect }) {
        expect(registry.paymentProvider('unknown-provider')).toBe(null);
        expect(registry.paymentProvider('constructor'), 'an inherited name is never a provider').toBe(null);
        expect(registry.paymentProvider('paypal')).toBe(registry.PAYMENT_PROVIDERS.paypal);
      },
    },

    {
      name: 'the-zero-charge-guard-refuses-an-id-the-registry-does-not-know',
      async run({ expect }) {
        // A caller passing a display name or a typo is a bug, never a provider
        // that silently accepts $0
        let thrown = null;

        try {
          discountCodes.chargeableAmount(9.99, null, { provider: 'PayPal' });
        } catch (e) {
          thrown = e;
        }

        expect(thrown?.message || '', 'an unknown id throws, naming it').toMatch(/No payment provider "PayPal"/);
      },
    },
  ],
});
