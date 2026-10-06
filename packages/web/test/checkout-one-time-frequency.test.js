/**
 * /payment/checkout — a one-time buy runs on `once`, never on a cadence
 * ([#668](https://github.com/Omega-JS-Stack/omega/issues/668)).
 *
 * The bug this pins, off a LIVE purchase (order 5434-3892-3088, the playground's
 * $49.99 Starter Library): the page resolved `state.frequency` out of the price
 * list for every product, cadence or not — a one-time product has no cadence
 * price, so the fallback picked the default `annually`. That word rode the
 * intent payload into the intent doc and out again on the confirmation URL,
 * where the page polled the account for a plan a one-time purchase never
 * writes and sat on "still processing" until it timed out. The payment itself
 * had completed cleanly: webhook, receipt email and revenue events were all in.
 *
 * Everything below drives the REAL page through the shared harness
 * (test/lib/checkout-boot.js), so the assertion is the payload the intent route
 * would have received.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const expect = require('@omega.js/devkit/test/expect');

const { bootCheckout, SUBSCRIPTION } = require('./lib/checkout-boot.js');

// The playground's real one-time product — the buy this was found on.
const ONE_TIME = { id: 'launch-kit', name: 'Starter Library', type: 'one-time', prices: { once: 49.99 } };

/**
 * The body of the intent POST this checkout sent. The page's warmup ping rides
 * the same route (a bodyless wakeup), so the POST is what names it.
 */
function intentPayload(requests) {
  const intent = requests.find((request) => request.url.includes('payments/intent') && request.options.method === 'POST');
  expect(intent, 'the checkout posted a payment intent').toBeTruthy();

  return intent.options.body;
}

module.exports = defineCases({
  type: 'group',
  description: 'checkout-one-time-frequency',
  tests: [
    {
      name: '#668: a one-time checkout asks the intent route for `once`',
      run: async (ctx) => {
        const { requests, form, pay } = await bootCheckout({
          search: '?product=launch-kit',
          product: ONE_TIME,
        });

        await pay();

        ctx.expect(intentPayload(requests).frequency, 'the intent carries what a one-time buy actually bills on — the wrong word here is what stranded the confirmation page').toBe('once');
        ctx.expect(form.data.frequency, 'and the form the page armed agrees with it').toBe('once');
      },
    },

    {
      name: '#668: a cadence in the URL cannot make a one-time product recurring',
      run: async (ctx) => {
        // The abandoned-cart reminder rebuilds the checkout URL from the cart doc, so
        // a cart written before this fix links back with `frequency=annually` on a
        // one-time product. The product decides, never the param.
        const { requests, pay } = await bootCheckout({
          search: '?product=launch-kit&frequency=annually',
          product: ONE_TIME,
        });

        await pay();

        ctx.expect(intentPayload(requests).frequency, 'a stale cadence param is ignored on a one-time product').toBe('once');
      },
    },

    {
      name: '#668: a subscription still runs on the cadence it was sent',
      run: async (ctx) => {
        const { requests, form, pay, answerEligibility } = await bootCheckout({
          search: '?product=premium&frequency=monthly',
        });

        await answerEligibility(false);
        await pay();

        ctx.expect(intentPayload(requests).frequency, 'the URL param still picks a plan\'s term').toBe('monthly');
        ctx.expect(form.data.frequency, 'and seeds the cadence radios').toBe('monthly');
      },
    },

    {
      name: '#668: a subscription with no usable cadence param still falls back to the longest term',
      run: async (ctx) => {
        // `weekly` is a real frequency the harness product does not sell, and `once`
        // is not a cadence at all — both fall through to the longest term on offer.
        for (const param of ['weekly', 'once', '']) {
          const search = param ? `?product=premium&frequency=${param}` : '?product=premium';
          const { requests, pay, answerEligibility } = await bootCheckout({ search });

          await answerEligibility(false);
          await pay();

          ctx.expect(intentPayload(requests).frequency, `a subscription sent "${param || 'nothing'}" bills on the longest term it sells`).toBe('annually');
        }

        ctx.expect(Object.keys(SUBSCRIPTION.prices), 'the fallback above means annually only while the harness product sells it').toEqual(['monthly', 'annually']);
      },
    },

    {
      name: '#668: the funnel reports what a one-time buy actually costs',
      run: async (ctx) => {
        // `getBasePrice()` read `prices.amount || prices.monthly.amount` and never
        // `prices.once`, so the playground's $49.99 product sent begin_checkout and
        // add_payment_info a value of 0 — two funnel steps priced at nothing under a
        // purchase that reports $49.99.
        const { tracked, settle, pay } = await bootCheckout({
          search: '?product=launch-kit',
          product: ONE_TIME,
        });

        await settle();
        await pay();

        const named = (name) => tracked.find((fire) => fire.name === name);

        for (const name of ['begin_checkout', 'add_payment_info']) {
          const fire = named(name);
          ctx.expect(fire, `${name} fired`).toBeTruthy();
          ctx.expect(fire.params.value, `${name} carries the price the card will be charged`).toBe(49.99);
          ctx.expect(fire.params.items[0].price, `${name}'s item is priced too`).toBe(49.99);
          ctx.expect(fire.params.items[0].item_category, `${name} classifies the item by what it is`).toBe('one-time');
          ctx.expect(fire.params.items[0].item_variant, `${name} names no cadence`).toBe('once');
        }
      },
    },

    {
      name: '#668: a subscription\'s funnel value still follows its cadence',
      run: async (ctx) => {
        const { tracked, settle, answerEligibility } = await bootCheckout({
          search: '?product=premium&frequency=monthly',
        });

        await answerEligibility(false);
        await settle();

        const begin = tracked.find((fire) => fire.name === 'begin_checkout');
        ctx.expect(begin, 'begin_checkout fired').toBeTruthy();
        ctx.expect(begin.params.value, 'the monthly price, from the same catalog read').toBe(10);
        ctx.expect(begin.params.items[0].item_variant, 'and the cadence it is billed on').toBe('monthly');
      },
    },
  ],
});
