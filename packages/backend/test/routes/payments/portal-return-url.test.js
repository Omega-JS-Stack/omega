/**
 * Test: POST /payments/portal — `returnUrl` must be the brand's own
 * ([#212](https://github.com/Omega-JS-Stack/omega/issues/212)).
 *
 * `returnUrl` is client-settable and lands inside the processor's hosted billing
 * page as the "back to the site" link. An arbitrary host there turns the brand's
 * own billing portal into a redirector to anywhere — a phishing hop that wears
 * the brand's checkout. The route now accepts only the brand's own resolved
 * origins and falls back to the brand's account page, with a warning, otherwise.
 *
 * The `test` portal processor answers with the returnUrl it was handed, so the
 * response IS the assertion about what the processor would have received.
 *
 * Run: npx omega test backend:routes/payments/portal-return-url
 */
const { buildUser, callHandler } = require('./_route-harness.js');

const handler = require('../../../src/manager/routes/payments/portal/post.js');

// Where the route sends a caller whose returnUrl it refused.
const DEFAULT_RETURN = (Manager) => new URL('/dashboard/account#billing', Manager.project.websiteUrl).toString();

function subscriber(Manager) {
  return buildUser(Manager, {
    auth: { uid: '_test-portal-return-url', email: '_test.portal-return-url@example.com' },
    roles: {},
    subscription: {
      product: { id: 'premium', name: 'Premium' },
      status: 'active',
      payment: { processor: 'test', resourceId: 'sub_test_portal_return_url' },
    },
  });
}

function openPortal(Manager, returnUrl) {
  return callHandler({
    Manager,
    handler,
    functionName: 'payments-portal',
    user: subscriber(Manager),
    settings: { returnUrl: returnUrl },
  });
}

module.exports = {
  description: 'Payment portal endpoint: returnUrl is same-origin only',
  type: 'group',
  timeout: 15000,

  tests: [
    {
      name: 'an-off-brand-return-url-falls-back',
      auth: 'none',
      async run({ assert, Manager }) {
        const sent = await openPortal(Manager, 'https://evil.example/steal');

        assert.equal(sent.code, 200, `The portal should still open, got ${sent.code}: ${JSON.stringify(sent.body)}`);
        assert.equal(sent.body.url, DEFAULT_RETURN(Manager), 'An off-brand host must never reach the processor');
      },
    },

    {
      name: 'a-look-alike-host-falls-back',
      auth: 'none',
      async run({ assert, Manager }) {
        // The classic near-miss: the brand's origin as a prefix of somebody else's host
        const origin = new URL(Manager.project.websiteUrl).origin;
        const sent = await openPortal(Manager, `${origin}.evil.example/dashboard/account`);

        assert.equal(sent.body.url, DEFAULT_RETURN(Manager), 'A host that merely starts with the brand origin must not pass');
      },
    },

    {
      name: 'an-unparseable-return-url-falls-back',
      auth: 'none',
      async run({ assert, Manager }) {
        const sent = await openPortal(Manager, 'not a url at all');

        assert.equal(sent.body.url, DEFAULT_RETURN(Manager), 'An unparseable value must fall back, never be forwarded');
      },
    },

    {
      name: 'a-missing-return-url-falls-back',
      auth: 'none',
      async run({ assert, Manager }) {
        const sent = await openPortal(Manager, null);

        assert.equal(sent.body.url, DEFAULT_RETURN(Manager), 'No returnUrl should still return to the brand');
      },
    },

    {
      name: 'the-brands-own-return-url-passes-through',
      auth: 'none',
      async run({ assert, Manager }) {
        const returnUrl = new URL('/dashboard/account?tab=invoices', Manager.project.websiteUrl).toString();

        const sent = await openPortal(Manager, returnUrl);

        assert.equal(sent.body.url, returnUrl, "The brand's own URL should be honored exactly as asked");
      },
    },
  ],
};
