/**
 * Test: GET /payments/discount
 * Tests discount code validation endpoint
 */

const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');
module.exports = defineCases({
  description: 'Discount code validation',
  type: 'group',
  timeout: 15000,

  tests: [
    {
      name: 'rejects-missing-code',
      async run({ http, expect }) {
        const response = await http.as('none').get('omega/payments/discount');

        expect(response, 'Should reject missing code').toBeError(400);
      },
    },

    {
      name: 'returns-valid-for-known-code',
      async run({ http, expect }) {
        const response = await http.as('none').get('omega/payments/discount', {
          code: 'FLASH20',
        });

        expect(response, 'Should succeed for valid code').toBeSuccess();
        expect(response.data.valid, 'Should be valid').toBe(true);
        expect(response.data.code, 'Should return normalized code').toBe('FLASH20');
        expect(response.data.percent, 'Should return correct percent').toBe(20);
        expect(response.data.duration, 'Should return duration').toBe('once');
      },
    },

    {
      name: 'returns-valid-case-insensitive',
      async run({ http, expect }) {
        const response = await http.as('none').get('omega/payments/discount', {
          code: 'flash20',
        });

        expect(response, 'Should succeed for lowercase code').toBeSuccess();
        expect(response.data.valid, 'Should be valid (case-insensitive)').toBe(true);
        expect(response.data.code, 'Should return uppercase code').toBe('FLASH20');
      },
    },

    {
      name: 'returns-invalid-for-unknown-code',
      async run({ http, expect }) {
        const response = await http.as('none').get('omega/payments/discount', {
          code: 'NOTAREALCODE',
        });

        expect(response, 'Should return 200 even for invalid code').toBeSuccess();
        expect(response.data.valid, 'Should be invalid').toBe(false);
      },
    },

    {
      name: 'validates-all-known-codes',
      async run({ http, expect }) {
        const codes = [
          { code: 'FLASH20', percent: 20 },
          { code: 'SAVE10', percent: 10 },
          { code: 'WELCOME15', percent: 15 },
        ];

        for (const { code, percent } of codes) {
          const response = await http.as('none').get('omega/payments/discount', { code });

          expect(response, `Should succeed for ${code}`).toBeSuccess();
          expect(response.data.valid, `${code} should be valid`).toBe(true);
          expect(response.data.percent, `${code} should be ${percent}%`).toBe(percent);
          expect(response.data.duration, `${code} should be once`).toBe('once');
        }
      },
    },
  ],
});
