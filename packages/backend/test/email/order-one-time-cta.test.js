/**
 * Test: a one-time receipt's button lands where that purchase actually is
 * ([#672](https://github.com/Omega-JS-Stack/omega/issues/672)).
 *
 * The order template's CTA is keyed on the EVENT, so every confirmation and
 * every refund notice pointed at `/dashboard/account` — a page whose sections
 * are all subscription surfaces. A one-time purchase writes nothing to any of
 * them, so the receipt told the customer to go and look at a page that could
 * not show them what they had just bought. It now points at the orders list,
 * which can.
 *
 * Plain-node unit test (no emulator, no network): build() is a pure string.
 */
const assert = require('node:assert');
const order = require('../../dist/manager/libraries/email/generators/lib/templates/order.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

const BRAND = { name: 'Test Brand', url: 'https://test.dev' };

/**
 * Render the order template for one event and purchase type
 *
 * @param {string} event - The order event ('confirmation', 'refunded', …)
 * @param {string} type - 'one-time' | 'subscription'
 * @returns {string} The rendered markup
 */
function build(event, type) {
  return order.build({
    data: {
      brand: BRAND,
      email: { subject: 'Your order' },
      content: {
        event: event,
        id: '1234-5678-9012',
        type: type,
        unified: { product: { id: 'credits-100', name: '100 Credits' }, payment: { price: 9.99, provider: 'stripe' } },
        _computed: { date: 'Aug 31, 2026', totalToday: '9.99' },
      },
    },
    theme: {},
    templateName: 'order',
  });
}

module.exports = defineCases({
  description: 'Order email: a one-time receipt points at the orders list',
  type: 'group',

  tests: [
    {
      name: 'a-one-time-confirmation-links-to-the-orders-list',
      async run() {
        assert.ok(build('confirmation', 'one-time').includes('https://test.dev/dashboard/account#orders'), 'the receipt CTA should open the orders list');
      },
    },

    {
      name: 'a-one-time-refund-notice-links-to-the-orders-list',
      async run() {
        assert.ok(build('refunded', 'one-time').includes('https://test.dev/dashboard/account#orders'), 'the refund CTA should open the orders list too');
      },
    },

    {
      name: 'a-one-time-payment-failure-neither-claims-a-subscription-nor-sends-them-to-billing',
      async run() {
        const html = build('payment-failed', 'one-time');

        assert.ok(!/subscription/i.test(html), `a one-time buyer has no subscription to be told about: ${html}`);
        assert.ok(!html.includes('/dashboard/account#billing'), 'and no billing section to update a payment method in');
        assert.ok(html.includes('View your order'), 'the CTA offers the one thing they do have — the order');
        assert.ok(html.includes('https://test.dev/dashboard/account#orders'), 'and it opens the orders list, where that order is');
      },
    },

    {
      name: 'a-subscription-payment-failure-is-unchanged',
      async run() {
        const html = build('payment-failed', 'subscription');

        assert.ok(html.includes('not cancelled'), 'a subscriber is still told their subscription survives the decline');
        assert.ok(html.includes('Update payment method'), 'and still asked to fix the payment method');
        assert.ok(html.includes('https://test.dev/dashboard/account#billing'), 'in the billing section they actually have');
      },
    },

    {
      name: 'a-subscription-confirmation-still-lands-on-the-account-page',
      async run() {
        const html = build('confirmation', 'subscription');

        assert.ok(html.includes('https://test.dev/dashboard/account'), 'the subscription CTA is unchanged');
        assert.ok(!html.includes('/dashboard/account#orders'), 'and it does not send a subscriber to the orders list');
      },
    },
  ],
});
