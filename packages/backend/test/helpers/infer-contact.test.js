/**
 * Test: libraries/infer-contact.js
 * Unit tests for contact inference from email addresses
 *
 * AI tests only run when TEST_EXTENDED_MODE is set.
 */
const { inferContact, capitalize } = require('../../dist/omega/libraries/infer-contact.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');
const Context = require('../../dist/omega/context.js');

module.exports = defineCases({
  description: 'Infer contact from email',
  type: 'group',

  tests: [
    // ─── capitalize ───

    {
      name: 'capitalize-single-word',
      async run({ expect }) {
        expect(capitalize('john'), 'Should capitalize first letter').toBe('John');
      },
    },

    {
      name: 'capitalize-multiple-words',
      async run({ expect }) {
        expect(capitalize('john doe'), 'Should capitalize each word').toBe('John Doe');
      },
    },

    {
      name: 'capitalize-all-uppercase',
      async run({ expect }) {
        expect(capitalize('JOHN'), 'Should lowercase after first letter').toBe('John');
      },
    },

    {
      name: 'capitalize-mixed-case',
      async run({ expect }) {
        expect(capitalize('jOHN dOE'), 'Should normalize mixed case').toBe('John Doe');
      },
    },

    {
      name: 'capitalize-empty-string',
      async run({ expect }) {
        expect(capitalize(''), 'Empty string should return empty').toBe('');
      },
    },

    {
      name: 'capitalize-null',
      async run({ expect }) {
        expect(capitalize(null), 'Null should return empty').toBe('');
      },
    },

    {
      name: 'capitalize-undefined',
      async run({ expect }) {
        expect(capitalize(undefined), 'Undefined should return empty').toBe('');
      },
    },

    // ─── inferContact: returns empty without AI key ───

    {
      name: 'infer-contact-no-ai-returns-none',
      async run({ expect }) {
        // Without OPENAI_API_KEY, should return empty result
        const originalKey = process.env.OPENAI_API_KEY;
        delete process.env.OPENAI_API_KEY;

        try {
          const result = await inferContact('alice.wonderland@example.com');

          expect(result.firstName, 'No first name without AI').toBe('');
          expect(result.lastName, 'No last name without AI').toBe('');
          expect(result.company, 'No company without AI').toBe('');
          expect(result.method, 'Method should be none').toBe('none');
          expect(result.confidence, 'Confidence should be 0').toBe(0);
        } finally {
          if (originalKey) {
            process.env.OPENAI_API_KEY = originalKey;
          }
        }
      },
    },

    // ─── inferContact: the ONE key name (#639) ───
    // The prefixed OMEGA_OPENAI_API_KEY is gone: the bare name is the only
    // one, and a company-wide value reaches it through the .env cascade's
    // company layer under that same name.

    {
      name: 'infer-contact-reads-the-bare-openai-key',
      async run({ expect }) {
        const originalKey = process.env.OPENAI_API_KEY;
        process.env.OPENAI_API_KEY = 'openai-key-fixture';

        let handedKey = null;
        const ctx = {
          log: () => {},
          error: () => {},
          ai: {
            request: async (options) => {
              handedKey = options.apiKey;
              return {
                content: { firstName: 'john', lastName: 'smith', company: 'acme', confidence: 0.9 },
              };
            },
          },
        };

        try {
          const result = await inferContact('john.smith@acme.com', ctx);

          expect(handedKey, 'OPENAI_API_KEY reaches the AI request').toBe('openai-key-fixture');
          expect(result.method, 'the AI path ran').toBe('ai');
          expect(result.firstName, 'the inferred name comes back capitalized').toBe('John');
        } finally {
          if (originalKey) {
            process.env.OPENAI_API_KEY = originalKey;
          } else {
            delete process.env.OPENAI_API_KEY;
          }
        }
      },
    },

    // ─── inferContact: AI path (requires TEST_EXTENDED_MODE) ───

    {
      name: 'infer-contact-ai',
      skip: !process.env.TEST_EXTENDED_MODE ? 'TEST_EXTENDED_MODE not set (skipping AI inference test)' : false,
      timeout: 30000,

      async run({ expect, omega, skip }) {
        if (!process.env.OPENAI_API_KEY) {
          return skip('OPENAI_API_KEY not set');
        }

        const ctx = new Context(omega);
        const result = await inferContact('john.smith@microsoft.com', ctx);

        expect(result, 'Should return a result').toBeTruthy();
        expect(result.method, 'Should use AI method').toBe('ai');
        expect(result, 'Should have firstName').toHaveProperty('firstName');
        expect(result, 'Should have lastName').toHaveProperty('lastName');
        expect(typeof result.confidence === 'number', 'Confidence should be a number').toBeTruthy();
      },
    },
  ],
});
