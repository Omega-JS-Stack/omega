/**
 * payment-providers.test.js: the ONE capability descriptor per payment provider.
 *
 * The backend's decisions (the zero-charge guard, the refund refusal, the
 * intent route's gate) and the checkout page's buttons read these rows, so the
 * owner's rulings are pinned here as literal values: a row that drifts fails
 * this file rather than quietly moving both surfaces at once.
 */

const test = require('node:test');
const assert = require('node:assert');
const { PAYMENT_PROVIDERS, paymentProvider, clientConfig } = require('../src/index.js');

const CAPABILITY_KEYS = ['id', 'name', 'acceptsZeroCharge', 'refundable', 'couponsHostedByProvider', 'subscriptions', 'oneTime', 'trials'];

test('every descriptor carries exactly the capability keys, keyed by its own id', () => {
  for (const [id, descriptor] of Object.entries(PAYMENT_PROVIDERS)) {
    assert.deepStrictEqual(Object.keys(descriptor), CAPABILITY_KEYS, `${id} carries the one descriptor shape`);
    assert.strictEqual(descriptor.id, id, `${id} is keyed by its own id`);
    assert.strictEqual(typeof descriptor.name, 'string');
    CAPABILITY_KEYS.slice(2).forEach((key) => assert.strictEqual(typeof descriptor[key], 'boolean', `${id}.${key} is a boolean`));
  }
});

test('the rulings, row by row', () => {
  const row = (id) => {
    const { name, ...capabilities } = PAYMENT_PROVIDERS[id];
    return capabilities;
  };

  // Hosted coupons, and a 100% code is the provider's own $0 checkout
  assert.deepStrictEqual(row('stripe'), { id: 'stripe', acceptsZeroCharge: true, refundable: true, couponsHostedByProvider: true, subscriptions: true, oneTime: true, trials: true });
  assert.deepStrictEqual(row('chargebee'), { id: 'chargebee', acceptsZeroCharge: true, refundable: true, couponsHostedByProvider: true, subscriptions: true, oneTime: true, trials: true });
  // A computed price, and no API here takes a zero one
  assert.deepStrictEqual(row('paypal'), { id: 'paypal', acceptsZeroCharge: false, refundable: true, couponsHostedByProvider: false, subscriptions: true, oneTime: true, trials: true });
  // One hosted charge: no refund API, nothing recurring
  assert.deepStrictEqual(row('coinbase'), { id: 'coinbase', acceptsZeroCharge: false, refundable: false, couponsHostedByProvider: false, subscriptions: false, oneTime: true, trials: false });
  // The fixture provider does everything, so no test is ever limited by it
  assert.deepStrictEqual(row('test'), { id: 'test', acceptsZeroCharge: true, refundable: true, couponsHostedByProvider: true, subscriptions: true, oneTime: true, trials: true });
  assert.deepStrictEqual(Object.keys(PAYMENT_PROVIDERS).sort(), ['chargebee', 'coinbase', 'paypal', 'stripe', 'test']);
});

test('the display names are the words a refusal speaks', () => {
  assert.strictEqual(PAYMENT_PROVIDERS.paypal.name, 'PayPal');
  assert.strictEqual(PAYMENT_PROVIDERS.coinbase.name, 'Coinbase Commerce');
});

test('paymentProvider() answers a known id, and null for anything else', () => {
  assert.strictEqual(paymentProvider('paypal'), PAYMENT_PROVIDERS.paypal);
  assert.strictEqual(paymentProvider('unknown-provider'), null);
  // A request names the provider, so an inherited property is never a provider
  assert.strictEqual(paymentProvider('constructor'), null);
  assert.strictEqual(paymentProvider('__proto__'), null);
  assert.strictEqual(paymentProvider(undefined), null);
});

test('the table is frozen: no caller can edit a capability at runtime', () => {
  assert.ok(Object.isFrozen(PAYMENT_PROVIDERS));
  assert.ok(Object.isFrozen(PAYMENT_PROVIDERS.coinbase));
});

test('the browser bake carries the SAME table as payment.capabilities', () => {
  const client = clientConfig({ payment: { providers: { paypal: { clientId: 'x' } }, products: [] } });

  assert.deepStrictEqual(client.payment.capabilities, JSON.parse(JSON.stringify(PAYMENT_PROVIDERS)));
});

test('a config with no payment section bakes no capability table', () => {
  assert.strictEqual(clientConfig({ brand: { id: 'acme' } }).payment, undefined);
});
