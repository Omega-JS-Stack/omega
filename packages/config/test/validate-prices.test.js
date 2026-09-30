/**
 * validate-prices.test.js: a one-time price has ONE key, `once`. Any other
 * spelling is a validation error naming `once`, so a brand can never price a
 * page the purchase then refuses.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { validateConfig, SUBSCRIPTION_CADENCES } = require('../src/index.js');

const VALID = { brand: { id: 'sandbox-brand', name: 'Sandbox Brand' } };

test('a one-time price spelled `amount` is refused, naming `once` (#849)', () => {
  const { errors } = validateConfig({
    ...VALID,
    payment: { products: [{ id: 'credits', type: 'one-time', prices: { amount: 9.99 } }] },
  });

  assert.equal(errors.length, 1, errors.join(' | '));
  assert.ok(errors[0].includes('credits'), errors[0]);
  assert.ok(errors[0].includes('"amount"'), errors[0]);
  assert.ok(errors[0].includes('once: 9.99'), errors[0]);
});

test('a one-time price spelled `monthly` is refused too, naming `once` (#849)', () => {
  const { errors } = validateConfig({
    ...VALID,
    payment: { products: [{ id: 'credits', type: 'one-time', prices: { monthly: 9.99 } }] },
  });

  assert.equal(errors.length, 1, errors.join(' | '));
  assert.ok(errors[0].includes('"monthly"'), errors[0]);
  assert.ok(errors[0].includes('once: 9.99'), errors[0]);
});

test('every cadence key on a one-time product is refused, naming `once` (#849)', () => {
  for (const cadence of SUBSCRIPTION_CADENCES) {
    const { errors } = validateConfig({
      ...VALID,
      payment: { products: [{ id: 'credits', type: 'one-time', prices: { [cadence]: 9.99 } }] },
    });

    assert.equal(errors.length, 1, `${cadence}: ${errors.join(' | ')}`);
    assert.ok(errors[0].includes(`"${cadence}"`) && errors[0].includes('once: 9.99'), errors[0]);
  }
});

test('the cadence keys are the one list the checkout and Chargebee price by', () => {
  assert.deepStrictEqual(SUBSCRIPTION_CADENCES, ['daily', 'weekly', 'monthly', 'annually']);
});

test('`amount` is no cadence either, so a subscription carrying it is refused (#849)', () => {
  const { errors } = validateConfig({
    ...VALID,
    payment: { products: [{ id: 'premium', type: 'subscription', prices: { monthly: 9.99, amount: 9.99 } }] },
  });

  assert.equal(errors.length, 1, errors.join(' | '));
  assert.ok(errors[0].includes('"amount"'), errors[0]);
});

test('`once` on a subscription is refused, naming the cadence keys (#849)', () => {
  // A plan bills on a cadence; a stray `once` beside it is a price nothing reads
  for (const product of [
    { id: 'premium', type: 'subscription', prices: { monthly: 9.99, once: 9.99 } },
    { id: 'untyped', prices: { once: 9.99 } },
  ]) {
    const { errors } = validateConfig({ ...VALID, payment: { products: [product] } });

    assert.equal(errors.length, 1, errors.join(' | '));
    assert.ok(errors[0].includes(product.id), errors[0]);
    assert.ok(errors[0].includes('"once"'), errors[0]);
    assert.ok(errors[0].includes('daily, weekly, monthly, annually'), errors[0]);
  }
});

test('`once` on a one-time product and `monthly` on a plan both pass', () => {
  const { errors } = validateConfig({
    ...VALID,
    payment: {
      products: [
        { id: 'credits', type: 'one-time', prices: { once: 9.99 } },
        { id: 'premium', type: 'subscription', prices: { monthly: 9.99 } },
      ],
    },
  });

  assert.deepStrictEqual(errors, []);
});
