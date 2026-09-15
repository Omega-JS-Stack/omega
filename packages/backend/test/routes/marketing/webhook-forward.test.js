/**
 * Test: POST /marketing/webhook/forward (parent forwarder)
 *
 * This route is gated to the webhook ROOT: a brand that names no company, or
 * names itself as one (`company: { id: 'self' }`, #677). Most test runs happen
 * on a brand that BELONGS to a company (its config names
 * `company: { id: 'itw-creative-works' }`), so the route should return 404.
 *
 * The actual fan-out behavior (reading brands collection, derive API URLs,
 * POST to each child) is verified by unit-style tests in test/helpers/webhook-forward.js
 * which exercise the forwarder logic against a mock admin + mock fetch — no emulator
 * round-trip required.
 *
 * This file only verifies the GATE: on a brand that belongs to a company, the
 * route is invisible.
 */

const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');
module.exports = defineCases({
  description: 'Marketing webhook forwarder gating (parent-only)',
  type: 'group',
  timeout: 15000,

  tests: [
    {
      name: 'forwarder-returns-404-on-non-parent-brand',
      auth: 'none',
      async run({ http, assert, config, skip }) {
        // This gate only applies to brands INSIDE a company. If this brand is
        // the webhook root (no company, or its own), the forwarder route is
        // visible by design, so there's nothing to assert here: skip rather
        // than fail.
        if (!config.company?.id || config.company.id === 'self') {
          skip('Brand is the webhook root (it names no company): forwarder gate does not apply');
        }

        const response = await http.as('none').post(
          `backend-manager/marketing/webhook/forward?provider=sendgrid&key=${process.env.OMEGA_WEBHOOK_KEY}`,
          [{ sg_event_id: 'should-not-process', event: 'group_unsubscribe', email: 'test@example.com' }]
        );

        assert.isError(response, 404, 'Forwarder should be invisible (404) on a brand inside a company');
      },
    },

    {
      name: 'forwarder-returns-404-even-with-valid-key',
      auth: 'none',
      async run({ http, assert, config, skip }) {
        // Only meaningful on a brand inside a company. On the webhook root the
        // forwarder is visible by design, so skip rather than fail.
        if (!config.company?.id || config.company.id === 'self') {
          skip('Brand is the webhook root (it names no company): forwarder gate does not apply');
        }

        // A valid key shouldn't unlock the forwarder: the gate is the company,
        // not the key.
        const response = await http.as('none').post(
          `backend-manager/marketing/webhook/forward?provider=beehiiv&key=${process.env.OMEGA_WEBHOOK_KEY}`,
          { id: 'should-not-process', event: 'subscription.unsubscribed', email: 'test@example.com' }
        );

        assert.isError(response, 404, 'Even with a valid key, a brand inside a company returns 404');
      },
    },
  ],
});
