/**
 * validate-prices.test.js: a one-time price has ONE key, `once`. Any other
 * spelling is a validation error naming `once`, so a brand can never price a
 * page the purchase then refuses.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');

const { validateConfig, SUBSCRIPTION_CADENCES } = require('../src/index.js');

const VALID = { brand: { id: 'sandbox-brand', name: 'Sandbox Brand' } };

module.exports = defineCases({
  type: 'group',
  description: 'validate-prices',
  tests: [
    {
      name: 'a one-time price spelled `amount` is refused, naming `once` (#849)',
      run: (ctx) => {
        const { errors } = validateConfig({
          ...VALID,
          payment: { products: [{ id: 'credits', type: 'one-time', prices: { amount: 9.99 } }] },
        });

        ctx.expect(errors.length, errors.join(' | ')).toBe(1);
        ctx.expect(errors[0].includes('credits'), errors[0]).toBeTruthy();
        ctx.expect(errors[0].includes('"amount"'), errors[0]).toBeTruthy();
        ctx.expect(errors[0].includes('once: 9.99'), errors[0]).toBeTruthy();
      },
    },

    {
      name: 'a one-time price spelled `monthly` is refused too, naming `once` (#849)',
      run: (ctx) => {
        const { errors } = validateConfig({
          ...VALID,
          payment: { products: [{ id: 'credits', type: 'one-time', prices: { monthly: 9.99 } }] },
        });

        ctx.expect(errors.length, errors.join(' | ')).toBe(1);
        ctx.expect(errors[0].includes('"monthly"'), errors[0]).toBeTruthy();
        ctx.expect(errors[0].includes('once: 9.99'), errors[0]).toBeTruthy();
      },
    },

    {
      name: 'every cadence key on a one-time product is refused, naming `once` (#849)',
      run: (ctx) => {
        for (const cadence of SUBSCRIPTION_CADENCES) {
          const { errors } = validateConfig({
            ...VALID,
            payment: { products: [{ id: 'credits', type: 'one-time', prices: { [cadence]: 9.99 } }] },
          });

          ctx.expect(errors.length, `${cadence}: ${errors.join(' | ')}`).toBe(1);
          ctx.expect(errors[0].includes(`"${cadence}"`) && errors[0].includes('once: 9.99'), errors[0]).toBeTruthy();
        }
      },
    },

    {
      name: 'the cadence keys are the one list the checkout and Chargebee price by',
      run: (ctx) => {
        ctx.expect(SUBSCRIPTION_CADENCES).toEqual(['daily', 'weekly', 'monthly', 'annually']);
      },
    },

    {
      name: '`amount` is no cadence either, so a subscription carrying it is refused (#849)',
      run: (ctx) => {
        const { errors } = validateConfig({
          ...VALID,
          payment: { products: [{ id: 'premium', type: 'subscription', prices: { monthly: 9.99, amount: 9.99 } }] },
        });

        ctx.expect(errors.length, errors.join(' | ')).toBe(1);
        ctx.expect(errors[0].includes('"amount"'), errors[0]).toBeTruthy();
      },
    },

    {
      name: '`once` on a subscription is refused, naming the cadence keys (#849)',
      run: (ctx) => {
        // A plan bills on a cadence; a stray `once` beside it is a price nothing reads
        for (const product of [
          { id: 'premium', type: 'subscription', prices: { monthly: 9.99, once: 9.99 } },
          { id: 'untyped', prices: { once: 9.99 } },
        ]) {
          const { errors } = validateConfig({ ...VALID, payment: { products: [product] } });

          ctx.expect(errors.length, errors.join(' | ')).toBe(1);
          ctx.expect(errors[0].includes(product.id), errors[0]).toBeTruthy();
          ctx.expect(errors[0].includes('"once"'), errors[0]).toBeTruthy();
          ctx.expect(errors[0].includes('daily, weekly, monthly, annually'), errors[0]).toBeTruthy();
        }
      },
    },

    {
      name: '`once` on a one-time product and `monthly` on a plan both pass',
      run: (ctx) => {
        const { errors } = validateConfig({
          ...VALID,
          payment: {
            products: [
              { id: 'credits', type: 'one-time', prices: { once: 9.99 } },
              { id: 'premium', type: 'subscription', prices: { monthly: 9.99 } },
            ],
          },
        });

        ctx.expect(errors).toEqual([]);
      },
    },
  ],
});
