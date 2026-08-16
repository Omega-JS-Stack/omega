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

test('discount percent: a once code comes off today only, the renewal stays list price', () => {
  // #254: the receipt used to reduce BOTH lines, promising a discounted renewal
  // the backend never honors — every configured code is `duration: 'once'`, the
  // Stripe coupon is a once coupon, and the terms line already says "first
  // payment only". Due-today carries the discount; recurring is list price.
  const product = { id: 'premium', type: 'subscription', prices: { monthly: 10 } };
  const prices = calculatePrices({ product, frequency: 'monthly', discountPercent: 20, discountDuration: 'once', trialEligible: false });

  assert.strictEqual(prices.discountAmount, 2, '20% of $10');
  assert.strictEqual(prices.total, 8, 'total due today carries the discount');
  assert.strictEqual(prices.recurring, 10, 'the renewal is list price — a once code does not ride');
});

test('discount amount: a once code comes off today only, exactly as a percent does', () => {
  // The server issues flat codes too — `{ amount: 10 }` with no percent key.
  // The amount shape mirrored the percent shape's math deliberately, so it
  // inherited this bug and is fixed with it (#254).
  const product = { id: 'premium', type: 'subscription', prices: { monthly: 25 } };
  const prices = calculatePrices({ product, frequency: 'monthly', discountAmount: 10, discountDuration: 'once', trialEligible: false });

  assert.strictEqual(prices.discountAmount, 10, 'the code\'s face value comes off');
  assert.strictEqual(prices.total, 15, 'total due today carries the discount');
  assert.strictEqual(prices.recurring, 25, 'the renewal is list price — exactly as the percent shape');
});

test('an absent duration is read as `once` — the receipt never promises an unhonored renewal', () => {
  // A code that reaches the page without a duration gets the conservative read
  // in BOTH shapes: discount today, list price at renewal.
  const product = { id: 'premium', type: 'subscription', prices: { monthly: 10 } };

  const percent = calculatePrices({ product, frequency: 'monthly', discountPercent: 20, trialEligible: false });
  assert.strictEqual(percent.total, 8, 'today still carries it');
  assert.strictEqual(percent.recurring, 10, 'the renewal stays list price');

  const amount = calculatePrices({ product, frequency: 'monthly', discountAmount: 4, trialEligible: false });
  assert.strictEqual(amount.total, 6, 'today still carries it');
  assert.strictEqual(amount.recurring, 10, 'the renewal stays list price');
});

test('a recurring-duration code does ride every cycle — duration is read, not assumed', () => {
  // Proves the rule is the code's own `duration`, not a hardcoded "never".
  const product = { id: 'premium', type: 'subscription', prices: { monthly: 10 } };

  const forever = calculatePrices({ product, frequency: 'monthly', discountPercent: 20, discountDuration: 'forever', trialEligible: false });
  assert.strictEqual(forever.total, 8, 'today carries it');
  assert.strictEqual(forever.recurring, 8, 'and so does the renewal');

  const repeating = calculatePrices({ product, frequency: 'monthly', discountAmount: 4, discountDuration: 'repeating', trialEligible: false });
  assert.strictEqual(repeating.recurring, 6, 'a repeating code rides the renewal too');
});

test('a discount never becomes a credit: it is capped at the price', () => {
  // $10 off a $4.99 product is free, never negative four cents owed back.
  const product = { id: 'credits', type: 'one-time', prices: { once: 4.99 } };
  const prices = calculatePrices({ product, frequency: 'monthly', discountAmount: 10, trialEligible: false });

  assert.strictEqual(prices.discountAmount, 4.99, 'the discount stops at the subtotal');
  assert.strictEqual(prices.total, 0, 'the floor is free, not a negative total');
});
