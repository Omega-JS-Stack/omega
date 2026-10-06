/**
 * Test: POST /admin/email — the `data.content.html` boundary
 *
 * The raw-HTML passthrough is internal-caller only: this route is the API lane (and the
 * surface behind the MCP `send_email` tool), so an admin-authenticated caller — human or
 * AI — must be turned away with a coded 400 instead of bypassing the escaped lane (#90).
 *
 * Lives outside email.test.js because that group is gated behind TEST_EXTENDED_MODE
 * (it sends for real). These probes are rejected before SendGrid is ever touched, so
 * they run in normal mode.
 *
 * The policy itself is unit-tested in test/email/content-html-policy.test.js.
 */

const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');
module.exports = defineCases({
  description: 'Admin send email — data.content.html boundary (route)',
  type: 'group',
  tests: [
    {
      name: 'content-html-rejected',
      auth: 'admin',
      timeout: 15000,

      async run({ http, expect, config }) {
        const response = await http.post('omega/admin/email', {
          subject: 'Raw HTML probe',
          to: [{ email: `_test-receiver@${config.domain}` }],
          copy: false,
          data: { content: { html: '<img src=x onerror="alert(1)">' } },
        });

        expect(response, 'data.content.html should be rejected with a 400').toBeError(400);
      },
    },

    {
      name: 'content-html-rejection-names-the-field',
      auth: 'admin',
      timeout: 15000,

      async run({ http, expect, config }) {
        const response = await http.post('omega/admin/email', {
          subject: 'Raw HTML probe',
          to: [{ email: `_test-receiver@${config.domain}` }],
          copy: false,
          data: { content: { html: '<p>x</p>' } },
        });

        expect(response, 'data.content.html should be rejected with a 400').toBeError(400);

        const message = String(response.error || '');

        expect(message.includes('data.content.html'), `Rejection should name the field, got: ${message}`).toBeTruthy();
      },
    },
  ],
});
