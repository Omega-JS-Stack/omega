/**
 * Test: libraries/infer-contact.js
 * Unit tests for contact inference from email addresses
 *
 * AI tests only run when TEST_EXTENDED_MODE is set.
 */
const { inferContact, capitalize } = require('../../src/manager/libraries/infer-contact.js');

module.exports = {
  description: 'Infer contact from email',
  type: 'group',

  tests: [
    // ─── capitalize ───

    {
      name: 'capitalize-single-word',
      async run({ assert }) {
        assert.equal(capitalize('john'), 'John', 'Should capitalize first letter');
      },
    },

    {
      name: 'capitalize-multiple-words',
      async run({ assert }) {
        assert.equal(capitalize('john doe'), 'John Doe', 'Should capitalize each word');
      },
    },

    {
      name: 'capitalize-all-uppercase',
      async run({ assert }) {
        assert.equal(capitalize('JOHN'), 'John', 'Should lowercase after first letter');
      },
    },

    {
      name: 'capitalize-mixed-case',
      async run({ assert }) {
        assert.equal(capitalize('jOHN dOE'), 'John Doe', 'Should normalize mixed case');
      },
    },

    {
      name: 'capitalize-empty-string',
      async run({ assert }) {
        assert.equal(capitalize(''), '', 'Empty string should return empty');
      },
    },

    {
      name: 'capitalize-null',
      async run({ assert }) {
        assert.equal(capitalize(null), '', 'Null should return empty');
      },
    },

    {
      name: 'capitalize-undefined',
      async run({ assert }) {
        assert.equal(capitalize(undefined), '', 'Undefined should return empty');
      },
    },

    // ─── inferContact: returns empty without AI key ───

    {
      name: 'infer-contact-no-ai-returns-none',
      async run({ assert }) {
        // Without OPENAI_API_KEY, should return empty result
        const originalKey = process.env.OPENAI_API_KEY;
        delete process.env.OPENAI_API_KEY;

        try {
          const result = await inferContact('alice.wonderland@example.com');

          assert.equal(result.firstName, '', 'No first name without AI');
          assert.equal(result.lastName, '', 'No last name without AI');
          assert.equal(result.company, '', 'No company without AI');
          assert.equal(result.method, 'none', 'Method should be none');
          assert.equal(result.confidence, 0, 'Confidence should be 0');
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
      async run({ assert }) {
        const originalKey = process.env.OPENAI_API_KEY;
        process.env.OPENAI_API_KEY = 'openai-key-fixture';

        let handedKey = null;
        const ctx = {
          log: () => {},
          error: () => {},
          Manager: {
            AI: (_ctx, key) => {
              handedKey = key;
              return {
                request: async () => ({
                  content: { firstName: 'john', lastName: 'smith', company: 'acme', confidence: 0.9 },
                }),
              };
            },
          },
        };

        try {
          const result = await inferContact('john.smith@acme.com', ctx);

          assert.equal(handedKey, 'openai-key-fixture', 'OPENAI_API_KEY reaches the AI factory');
          assert.equal(result.method, 'ai', 'the AI path ran');
          assert.equal(result.firstName, 'John', 'the inferred name comes back capitalized');
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

      async run({ assert, Manager, skip }) {
        if (!process.env.OPENAI_API_KEY) {
          return skip('OPENAI_API_KEY not set');
        }

        const ctx = Manager.RouteContext();
        const result = await inferContact('john.smith@microsoft.com', ctx);

        assert.ok(result, 'Should return a result');
        assert.equal(result.method, 'ai', 'Should use AI method');
        assert.hasProperty(result, 'firstName', 'Should have firstName');
        assert.hasProperty(result, 'lastName', 'Should have lastName');
        assert.ok(typeof result.confidence === 'number', 'Confidence should be a number');
      },
    },
  ],
};
