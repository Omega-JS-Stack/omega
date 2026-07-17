/**
 * Checkout client pricing — calculatePrices() is the order summary's money
 * math (subtotal/discount/trial/total/recurring). Pure module, unit-tested
 * directly. Pins the one-time `prices.once` resolution (cp177 catch: the
 * schema's one-time key is `once` — launch-kit/credits shapes — but the
 * module only read the legacy `amount`/`monthly` keys, so every one-time
 * checkout rendered a $0.00 summary).
 */
const assert = require('node:assert');
const { test } = require('node:test');
const { calculatePrices } = require('../core/js/pages/payment/checkout/modules/pricing.js');

test('one-time product: prices.once drives subtotal and total', () => {
  const prices = calculatePrices({
    product: { id: 'launch-kit', type: 'one-time', prices: { once: 49.99 } },
    frequency: 'annually', // URL default — must be ignored for one-time
    discountPercent: 0,
    trialEligible: false,
  });

  assert.strictEqual(prices.subtotal, 49.99, 'subtotal comes from prices.once');
  assert.strictEqual(prices.total, 49.99, 'total due today matches');
  assert.strictEqual(prices.trialDiscountAmount, 0, 'one-time products never trial');
});

test('one-time product: legacy amount key still resolves', () => {
  const prices = calculatePrices({
    product: { id: 'credits', type: 'one-time', prices: { amount: 9.99 } },
    frequency: 'monthly',
    discountPercent: 0,
    trialEligible: false,
  });

  assert.strictEqual(prices.subtotal, 9.99, 'legacy { amount } shape keeps working');
});

test('subscription: frequency price + free trial zeroes today, recurring stays', () => {
  const product = { id: 'premium', type: 'subscription', trial: { days: 14 }, prices: { monthly: 9.99, annually: 99.99 } };

  const annual = calculatePrices({ product, frequency: 'annually', discountPercent: 0, trialEligible: true });
  assert.strictEqual(annual.subtotal, 99.99, 'annual price selected by frequency');
  assert.strictEqual(annual.total, 0, 'trial makes today free');
  assert.strictEqual(annual.trialDiscountAmount, 99.99, 'trial credit equals the price');
  assert.strictEqual(annual.recurring, 99.99, 'recurring unaffected by the trial');

  const monthly = calculatePrices({ product, frequency: 'monthly', discountPercent: 0, trialEligible: false });
  assert.strictEqual(monthly.total, 9.99, 'no trial: today = the cycle price');
});

test('discount percent reduces total and recurring', () => {
  const product = { id: 'premium', type: 'subscription', prices: { monthly: 10 } };
  const prices = calculatePrices({ product, frequency: 'monthly', discountPercent: 20, trialEligible: false });

  assert.strictEqual(prices.discountAmount, 2, '20% of $10');
  assert.strictEqual(prices.total, 8, 'total after discount');
  assert.strictEqual(prices.recurring, 8, 'recurring carries the discount');
});
