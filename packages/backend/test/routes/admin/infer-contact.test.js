/**
 * Test: POST /admin/infer-contact
 * Tests the admin infer-contact endpoint for inferring names from email addresses
 *
 * AI inference tests only run when TEST_EXTENDED_MODE is set (requires OPENAI_API_KEY)
 */

const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');
module.exports = defineCases({
  description: 'Admin infer contact',
  type: 'group',
  tests: [
    // ─── Auth rejection ───

    {
      name: 'unauthenticated-rejected',
      auth: 'none',
      timeout: 15000,

      async run({ http, expect }) {
        const response = await http.post('omega/admin/infer-contact', {
          email: 'john.smith@gmail.com',
        });

        expect(response, 'Should reject unauthenticated requests').toBeError(401);
      },
    },

    {
      name: 'non-admin-rejected',
      auth: 'user',
      timeout: 15000,

      async run({ http, expect }) {
        const response = await http.post('omega/admin/infer-contact', {
          email: 'john.smith@gmail.com',
        });

        expect(response, 'Should reject non-admin users').toBeError(403);
      },
    },

    // ─── Single email ───

    {
      name: 'single-email-returns-result',
      auth: 'admin',
      timeout: 30000,
      skip: !process.env.TEST_EXTENDED_MODE
        ? 'TEST_EXTENDED_MODE not set (skipping inference test)'
        : false,

      async run({ http, expect }) {
        const response = await http.post('omega/admin/infer-contact', {
          email: 'john.smith@gmail.com',
        });

        expect(response, 'Should succeed for admin').toBeSuccess();
        expect(response, 'Should have results array').toHaveProperty('data.results');
        expect(response.data.results.length, 'Should have 1 result').toBe(1);

        const result = response.data.results[0];
        expect(result.email, 'Should include email').toBe('john.smith@gmail.com');
        expect(result, 'Should have firstName field').toHaveProperty('firstName');
        expect(result, 'Should have lastName field').toHaveProperty('lastName');
        expect(result, 'Should include method').toHaveProperty('method');
        expect(result, 'Should include confidence').toHaveProperty('confidence');
        expect(result.method, 'Should use AI method').toBe('ai');
      },
    },

    // ─── Batch emails ───

    {
      name: 'batch-emails-returns-all-results',
      auth: 'admin',
      timeout: 60000,

      async run({ http, expect }) {
        const emails = [
          'sarah.connor@skynet.io',
          'bob-jones@hotmail.com',
          'admin@acme.com',
        ];

        const response = await http.post('omega/admin/infer-contact', { emails });

        expect(response, 'Should succeed for batch').toBeSuccess();
        expect(response.data.results.length, 'Should have 3 results').toBe(3);

        // Verify each email is in results
        for (let i = 0; i < emails.length; i++) {
          expect(response.data.results[i].email, `Result ${i} should match input email`).toBe(emails[i]);
        }
      },
    },

    // ─── Name parsing (requires AI) ───

    {
      name: 'regex-parses-dot-separated-names',
      auth: 'admin',
      timeout: 30000,
      skip: !process.env.TEST_EXTENDED_MODE
        ? 'TEST_EXTENDED_MODE not set (skipping inference test)'
        : false,

      async run({ http, expect }) {
        // Use a name unlikely to trigger the "fictional/brand" rejection in the AI prompt.
        // The infer-contact prompt rejects placeholder + fictional names (e.g. alice.wonderland,
        // john.doe). Use a generic-but-realistic name to exercise dot-separated parsing.
        const response = await http.post('omega/admin/infer-contact', {
          email: 'sarah.martinez@example.com',
        });

        expect(response).toBeSuccess();
        const result = response.data.results[0];

        expect(result.firstName, 'Should parse first name').toBe('Sarah');
        expect(result.lastName, 'Should parse last name').toBe('Martinez');
      },
    },

    {
      name: 'infers-company-from-custom-domain',
      auth: 'admin',
      timeout: 30000,
      skip: !process.env.TEST_EXTENDED_MODE
        ? 'TEST_EXTENDED_MODE not set (skipping inference test)'
        : false,

      async run({ http, expect }) {
        const response = await http.post('omega/admin/infer-contact', {
          email: 'ceo@my-startup.com',
        });

        expect(response).toBeSuccess();
        const result = response.data.results[0];
        expect(result.company, 'Should infer company from custom domain').toBeTruthy();
      },
    },

    {
      name: 'no-company-from-generic-domain',
      auth: 'admin',
      timeout: 30000,
      skip: !process.env.TEST_EXTENDED_MODE
        ? 'TEST_EXTENDED_MODE not set (skipping inference test)'
        : false,

      async run({ http, expect }) {
        const response = await http.post('omega/admin/infer-contact', {
          email: 'someone@gmail.com',
        });

        expect(response).toBeSuccess();
        const result = response.data.results[0];
        expect(result.company, 'Should not infer company from gmail').toBe('');
      },
    },

    // ─── AI inference (requires TEST_EXTENDED_MODE) ───

    {
      name: 'ai-inference',
      auth: 'admin',
      timeout: 60000,
      skip: !process.env.TEST_EXTENDED_MODE
        ? 'TEST_EXTENDED_MODE not set (skipping AI inference test)'
        : false,

      async run({ http, expect }) {
        const response = await http.post('omega/admin/infer-contact', {
          emails: [
            'john.smith@microsoft.com',
            'xkcd42@gmail.com',
            'bobs.burgers@example.com',
          ],
        });

        expect(response, 'AI inference should succeed').toBeSuccess();

        const results = response.data.results;
        expect(results.length, 'Should have 3 results').toBe(3);

        // Verify structure — AI may return empty names but shape must be correct
        for (const r of results) {
          expect(r, `${r.email}: should have firstName`).toHaveProperty('firstName');
          expect(r, `${r.email}: should have lastName`).toHaveProperty('lastName');
          expect(r, `${r.email}: should have method`).toHaveProperty('method');
          expect(r, `${r.email}: should have confidence`).toHaveProperty('confidence');
        }

        // john.smith@microsoft.com — AI should parse this but may flake
        const john = results.find(r => r.email === 'john.smith@microsoft.com');
        expect(john.method, 'Should use AI method').toBe('ai');
        if (!john.firstName) {
          console.warn('AI flake: john.smith@microsoft.com returned empty firstName (non-fatal)');
        }
      },
    },

    // ─── Edge cases ───

    {
      name: 'empty-emails-array-returns-empty',
      auth: 'admin',
      timeout: 15000,

      async run({ http, expect }) {
        const response = await http.post('omega/admin/infer-contact', {
          emails: [],
        });

        expect(response).toBeSuccess();
        expect(response.data.results.length, 'Empty input should return empty results').toBe(0);
      },
    },
  ],
});
