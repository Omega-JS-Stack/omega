/**
 * payment-providers.test.js: the ONE capability descriptor per payment provider.
 *
 * The backend's decisions (the zero-charge guard, the refund refusal, the
 * intent route's gate) and the checkout page's buttons read these rows, so the
 * owner's rulings are pinned here as literal values: a row that drifts fails
 * this file rather than quietly moving both surfaces at once.
 */

const defineCases = require('@omega.js/devkit/test/define-cases');
const { PAYMENT_PROVIDERS, paymentProvider, clientConfig } = require('../src/index.js');

const CAPABILITY_KEYS = ['id', 'name', 'acceptsZeroCharge', 'refundable', 'couponsHostedByProvider', 'subscriptions', 'oneTime', 'trials'];

module.exports = defineCases({
  type: 'group',
  description: 'payment-providers',
  tests: [
    {
      name: 'every descriptor carries exactly the capability keys, keyed by its own id',
      run: (ctx) => {
        for (const [id, descriptor] of Object.entries(PAYMENT_PROVIDERS)) {
          ctx.expect(Object.keys(descriptor), `${id} carries the one descriptor shape`).toEqual(CAPABILITY_KEYS);
          ctx.expect(descriptor.id, `${id} is keyed by its own id`).toBe(id);
          ctx.expect(typeof descriptor.name).toBe('string');
          CAPABILITY_KEYS.slice(2).forEach((key) => ctx.expect(typeof descriptor[key], `${id}.${key} is a boolean`).toBe('boolean'));
        }
      },
    },

    {
      name: 'the rulings, row by row',
      run: (ctx) => {
        const row = (id) => {
          const { name, ...capabilities } = PAYMENT_PROVIDERS[id];
          return capabilities;
        };

        // Hosted coupons, and a 100% code is the provider's own $0 checkout
        ctx.expect(row('stripe')).toEqual({ id: 'stripe', acceptsZeroCharge: true, refundable: true, couponsHostedByProvider: true, subscriptions: true, oneTime: true, trials: true });
        ctx.expect(row('chargebee')).toEqual({ id: 'chargebee', acceptsZeroCharge: true, refundable: true, couponsHostedByProvider: true, subscriptions: true, oneTime: true, trials: true });
        // A computed price, and no API here takes a zero one
        ctx.expect(row('paypal')).toEqual({ id: 'paypal', acceptsZeroCharge: false, refundable: true, couponsHostedByProvider: false, subscriptions: true, oneTime: true, trials: true });
        // One hosted charge: no refund API, nothing recurring
        ctx.expect(row('coinbase')).toEqual({ id: 'coinbase', acceptsZeroCharge: false, refundable: false, couponsHostedByProvider: false, subscriptions: false, oneTime: true, trials: false });
        // The fixture provider does everything, so no test is ever limited by it
        ctx.expect(row('test')).toEqual({ id: 'test', acceptsZeroCharge: true, refundable: true, couponsHostedByProvider: true, subscriptions: true, oneTime: true, trials: true });
        ctx.expect(Object.keys(PAYMENT_PROVIDERS).sort()).toEqual(['chargebee', 'coinbase', 'paypal', 'stripe', 'test']);
      },
    },

    {
      name: 'the display names are the words a refusal speaks',
      run: (ctx) => {
        ctx.expect(PAYMENT_PROVIDERS.paypal.name).toBe('PayPal');
        ctx.expect(PAYMENT_PROVIDERS.coinbase.name).toBe('Coinbase Commerce');
      },
    },

    {
      name: 'paymentProvider() answers a known id, and null for anything else',
      run: (ctx) => {
        ctx.expect(paymentProvider('paypal')).toBe(PAYMENT_PROVIDERS.paypal);
        ctx.expect(paymentProvider('unknown-provider')).toBe(null);
        // A request names the provider, so an inherited property is never a provider
        ctx.expect(paymentProvider('constructor')).toBe(null);
        ctx.expect(paymentProvider('__proto__')).toBe(null);
        ctx.expect(paymentProvider(undefined)).toBe(null);
      },
    },

    {
      name: 'the table is frozen: no caller can edit a capability at runtime',
      run: (ctx) => {
        ctx.expect(Object.isFrozen(PAYMENT_PROVIDERS)).toBeTruthy();
        ctx.expect(Object.isFrozen(PAYMENT_PROVIDERS.coinbase)).toBeTruthy();
      },
    },

    {
      name: 'the browser bake carries the SAME table as payment.capabilities',
      run: (ctx) => {
        const client = clientConfig({ payment: { providers: { paypal: { clientId: 'x' } }, products: [] } });

        ctx.expect(client.payment.capabilities).toEqual(JSON.parse(JSON.stringify(PAYMENT_PROVIDERS)));
      },
    },

    {
      name: 'a config with no payment section bakes no capability table',
      run: (ctx) => {
        ctx.expect(clientConfig({ brand: { id: 'acme' } }).payment).toBe(undefined);
      },
    },
  ],
});
