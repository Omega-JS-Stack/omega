/**
 * Checkout client pricing — calculatePrices() is the order summary's money
 * math (subtotal/discount/trial/total/recurring). Pure module, unit-tested
 * directly. Pins the one-time `prices.once` resolution (cp177 catch: the
 * schema's one-time key is `once` — launch-kit/credits shapes — but the
 * module only read the legacy `amount`/`monthly` keys, so every one-time
 * checkout rendered a $0.00 summary).
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const { validateConfig } = require('@omega.js/config');
const { calculatePrices } = require('../core/js/pages/payment/checkout/modules/pricing.js');

module.exports = defineCases({
  type: 'group',
  description: 'checkout-pricing',
  tests: [
    {
      name: 'one-time product: prices.once drives subtotal and total',
      run: (ctx) => {
        const prices = calculatePrices({
          product: { id: 'launch-kit', type: 'one-time', prices: { once: 49.99 } },
          frequency: 'annually', // URL default — must be ignored for one-time
          discountPercent: 0,
          trialEligible: false,
        });

        ctx.expect(prices.subtotal, 'subtotal comes from prices.once').toBe(49.99);
        ctx.expect(prices.total, 'total due today matches').toBe(49.99);
        ctx.expect(prices.trialDiscountAmount, 'one-time products never trial').toBe(0);
      },
    },

    {
      name: '#849: a one-time price is `once` alone, on the page and in the validator',
      run: (ctx) => {
        // The page reads `once` only, the key every backend reader takes, and a config
        // spelling the price any other way fails validation instead of pricing a page
        // the purchase then refuses.
        const legacy = { id: 'credits', type: 'one-time', prices: { amount: 9.99 } };

        for (const prices of [{ amount: 9.99 }, { monthly: 9.99 }]) {
          const priced = calculatePrices({ product: { ...legacy, prices }, frequency: 'monthly', discountPercent: 0, trialEligible: false });
          ctx.expect(priced.subtotal, `the page prices no ${Object.keys(prices)[0]} key, the same as the backend`).toBe(0);

          const { errors } = validateConfig({ brand: { id: 'acme', name: 'Acme' }, targets: { web: { type: 'web' } }, payment: { products: [{ ...legacy, prices }] } });
          ctx.expect(errors.some((error) => error.includes('once: 9.99')), `the validator refuses it, naming once: ${errors.join(' | ')}`).toBeTruthy();
        }
      },
    },

    {
      name: 'subscription: frequency price + free trial zeroes today, recurring stays',
      run: (ctx) => {
        const product = { id: 'premium', type: 'subscription', trial: { days: 14 }, prices: { monthly: 9.99, annually: 99.99 } };

        const annual = calculatePrices({ product, frequency: 'annually', discountPercent: 0, trialEligible: true });
        ctx.expect(annual.subtotal, 'annual price selected by frequency').toBe(99.99);
        ctx.expect(annual.total, 'trial makes today free').toBe(0);
        ctx.expect(annual.trialDiscountAmount, 'trial credit equals the price').toBe(99.99);
        ctx.expect(annual.recurring, 'recurring unaffected by the trial').toBe(99.99);

        const monthly = calculatePrices({ product, frequency: 'monthly', discountPercent: 0, trialEligible: false });
        ctx.expect(monthly.total, 'no trial: today = the cycle price').toBe(9.99);
      },
    },

    {
      name: 'discount percent: a once code comes off today only, the renewal stays list price',
      run: (ctx) => {
        // #254: the receipt used to reduce BOTH lines, promising a discounted renewal
        // the backend never honors — every configured code is `duration: 'once'`, the
        // Stripe coupon is a once coupon, and the terms line already says "first
        // payment only". Due-today carries the discount; recurring is list price.
        const product = { id: 'premium', type: 'subscription', prices: { monthly: 10 } };
        const prices = calculatePrices({ product, frequency: 'monthly', discountPercent: 20, discountDuration: 'once', trialEligible: false });

        ctx.expect(prices.discountAmount, '20% of $10').toBe(2);
        ctx.expect(prices.total, 'total due today carries the discount').toBe(8);
        ctx.expect(prices.recurring, 'the renewal is list price — a once code does not ride').toBe(10);
      },
    },

    {
      name: 'discount amount: a once code comes off today only, exactly as a percent does',
      run: (ctx) => {
        // The server issues flat codes too — `{ amount: 10 }` with no percent key.
        // The amount shape mirrored the percent shape's math deliberately, so it
        // inherited this bug and is fixed with it (#254).
        const product = { id: 'premium', type: 'subscription', prices: { monthly: 25 } };
        const prices = calculatePrices({ product, frequency: 'monthly', discountAmount: 10, discountDuration: 'once', trialEligible: false });

        ctx.expect(prices.discountAmount, 'the code\'s face value comes off').toBe(10);
        ctx.expect(prices.total, 'total due today carries the discount').toBe(15);
        ctx.expect(prices.recurring, 'the renewal is list price — exactly as the percent shape').toBe(25);
      },
    },

    {
      name: 'an absent duration is read as `once` — the receipt never promises an unhonored renewal',
      run: (ctx) => {
        // A code that reaches the page without a duration gets the conservative read
        // in BOTH shapes: discount today, list price at renewal.
        const product = { id: 'premium', type: 'subscription', prices: { monthly: 10 } };

        const percent = calculatePrices({ product, frequency: 'monthly', discountPercent: 20, trialEligible: false });
        ctx.expect(percent.total, 'today still carries it').toBe(8);
        ctx.expect(percent.recurring, 'the renewal stays list price').toBe(10);

        const amount = calculatePrices({ product, frequency: 'monthly', discountAmount: 4, trialEligible: false });
        ctx.expect(amount.total, 'today still carries it').toBe(6);
        ctx.expect(amount.recurring, 'the renewal stays list price').toBe(10);
      },
    },

    {
      name: 'a recurring-duration code does ride every cycle — duration is read, not assumed',
      run: (ctx) => {
        // Proves the rule is the code's own `duration`, not a hardcoded "never".
        const product = { id: 'premium', type: 'subscription', prices: { monthly: 10 } };

        const forever = calculatePrices({ product, frequency: 'monthly', discountPercent: 20, discountDuration: 'forever', trialEligible: false });
        ctx.expect(forever.total, 'today carries it').toBe(8);
        ctx.expect(forever.recurring, 'and so does the renewal').toBe(8);

        const repeating = calculatePrices({ product, frequency: 'monthly', discountAmount: 4, discountDuration: 'repeating', trialEligible: false });
        ctx.expect(repeating.recurring, 'a repeating code rides the renewal too').toBe(6);
      },
    },

    {
      name: 'a discount never becomes a credit: it is capped at the price',
      run: (ctx) => {
        // $10 off a $4.99 product is free, never negative four cents owed back.
        const product = { id: 'credits', type: 'one-time', prices: { once: 4.99 } };
        const prices = calculatePrices({ product, frequency: 'monthly', discountAmount: 10, trialEligible: false });

        ctx.expect(prices.discountAmount, 'the discount stops at the subtotal').toBe(4.99);
        ctx.expect(prices.total, 'the floor is free, not a negative total').toBe(0);
      },
    },
  ],
});
