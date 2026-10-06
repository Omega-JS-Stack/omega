/**
 * Test: POST /marketing/campaign — Send a marketing campaign (Single Send)
 *
 * Normal mode: creates campaign doc in Firestore, verifies structure
 * Extended mode (TEST_EXTENDED_MODE=true): sends a real test campaign via SendGrid/Beehiiv
 *   targeting the test_admin segment (hello@itwcreativeworks.com only)
 */

const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');

module.exports = defineCases({
  description: 'Marketing campaign (POST create + send)',
  type: 'group',
  tests: [
    {
      name: 'send-test-campaign',
      auth: 'admin',
      timeout: 60000,
      skip: !process.env.TEST_EXTENDED_MODE
        ? 'TEST_EXTENDED_MODE not set (real provider send)'
        : false,

      async run({ http, expect, state }) {
        const response = await http.post('omega/marketing/campaign', {
          name: '@omega.js/backend Test Campaign',
          subject: 'Test Marketing Email',
          template: 'card',
          data: {
            content: {
              title: 'Test Marketing Email',
              message: 'This is a **test marketing email** sent from the @omega.js/backend test suite.\n\nIf you received this, the SendGrid Single Send pipeline is working correctly.',
              button: { text: 'Visit Dashboard →', url: '{brand.url}' },
            },
          },
          test: true,
          sendAt: 'now',
        });

        expect(response, 'Campaign creation should succeed').toBeSuccess();
        expect(response, 'Response should contain campaign ID').toHaveProperty('data.id');
        expect(response, 'Response should contain provider results').toHaveProperty('data.providers');

        const providers = response.data.providers || {};

        console.log('Campaign results:', JSON.stringify(providers, null, 2));

        if (providers.campaigns) {
          state.sendgridId = providers.campaigns.id;

          expect(response, `SendGrid should succeed. Error: ${providers.campaigns.error || 'none'}`).toHaveProperty('data.providers.campaigns.success', true);
        }

        if (providers.newsletter) {
          expect(response, 'Should have Beehiiv result').toHaveProperty('data.providers.newsletter');
        }

        state.campaignId = response.data.id;
      },

      async cleanup({ state }) {
        if (state.campaignId) {
          console.log(`Campaign ID: ${state.campaignId}`);
        }
        if (state.sendgridId) {
          console.log(`SendGrid Single Send ID: ${state.sendgridId}`);
        }
      },
    },

    {
      name: 'create-future-campaign-is-pending',
      auth: 'admin',
      timeout: 30000,

      async run({ http, expect, firestore }) {
        // Future sendAt → campaign is saved as 'pending' for cron pickup, not sent immediately
        const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

        const response = await http.post('omega/marketing/campaign', {
          name: 'Future Campaign',
          subject: 'Future Subject',
          content: 'Future content',
          test: true,
          sendAt: futureDate,
        });

        expect(response, 'Future campaign creation should succeed').toBeSuccess();
        expect(response, 'Response should contain campaign ID').toHaveProperty('data.id');
        expect(response, 'Future campaign should be pending').toHaveProperty('data.status', 'pending');

        const doc = await firestore.get(`marketing-campaigns/${response.data.id}`);
        expect(doc, 'Campaign doc should exist in Firestore').toBeTruthy();
        expect(doc.status, 'Firestore doc status should be pending').toBe('pending');
        expect(doc.settings.name, 'Name should match input').toBe('Future Campaign');
        expect(response, 'Future campaign should not have provider results').toHaveProperty('data.providers', null);
      },
    },

    {
      name: 'campaign-rejects-raw-content-html',
      auth: 'admin',
      timeout: 15000,

      async run({ http, expect }) {
        // The raw-HTML passthrough is internal-caller only — an admin (or the MCP
        // create_campaign tool it fronts) must not bypass the escaped lane (#90).
        const response = await http.post('omega/marketing/campaign', {
          name: 'Raw HTML Campaign',
          subject: 'Should fail',
          test: true,
          data: { content: { html: '<img src=x onerror="alert(1)">' } },
        });

        expect(response, 'data.content.html should be rejected with a 400').toBeError(400);
      },
    },

    {
      name: 'campaign-doc-cannot-carry-caller-content-html',
      auth: 'admin',
      timeout: 30000,

      async run({ http, expect, firestore }) {
        // The stored doc is what the cron sender reads later, and the marketing library
        // reads contentHtml / data.content.html AHEAD of the escaped renderer — so
        // neither may ever land in it from a caller. Two layers stop this: the schema
        // strips the undeclared top-level contentHtml, and the handler's
        // internalOnlyFieldFault() rejects data.content.html outright.
        const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

        const response = await http.post('omega/marketing/campaign', {
          name: 'Raw HTML Persistence Probe',
          subject: 'Probe',
          contentHtml: '<img src=x onerror=alert(1)>',
          test: true,
          sendAt: futureDate,
        });

        expect(response, 'A campaign carrying only the stripped field should still create').toBeSuccess();

        const doc = await firestore.get(`marketing-campaigns/${response.data.id}`);

        expect(doc, 'Campaign doc should exist in Firestore').toBeTruthy();
        expect(doc.settings.contentHtml, 'Caller-supplied contentHtml persisted into the stored campaign doc').toBe(undefined);
        expect(!JSON.stringify(doc).includes('onerror'), 'Raw HTML payload persisted into the stored campaign doc').toBeTruthy();
      },
    },

    {
      name: 'campaign-requires-admin',
      auth: 'user',
      timeout: 15000,

      async run({ http, expect }) {
        const response = await http.post('omega/marketing/campaign', {
          name: 'Unauthorized Campaign',
          subject: 'Should fail',
          content: 'Should fail',
        });

        expect(response, 'Non-admin should get 403').toBeError(403);
      },
    },

    {
      name: 'campaign-requires-auth',
      auth: 'none',
      timeout: 15000,

      async run({ http, expect }) {
        const response = await http.post('omega/marketing/campaign', {
          name: 'Unauthenticated Campaign',
          subject: 'Should fail',
          content: 'Should fail',
        });

        expect(response, 'Unauthenticated should get 401').toBeError(401);
      },
    },
  ],
});
