/**
 * Test: AI schema resolution (libraries/ai/providers/openai.js)
 *
 * Verifies resolveSchema() — loading JSON Schema from inline objects or file paths.
 */
const path = require('path');
const jetpack = require('fs-jetpack');
const OpenAI = require('../../dist/omega/libraries/ai/providers/openai.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');
const { resolveSchema } = OpenAI._internals;

function noopLog() {}

const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures', 'ai-schema');
const VALID_SCHEMA_PATH = path.join(FIXTURES_DIR, 'valid.json');
const INVALID_SCHEMA_PATH = path.join(FIXTURES_DIR, 'invalid.json');
const VALID_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'The name' },
    tags: { type: 'array', items: { type: 'string' } },
  },
  required: ['name', 'tags'],
  additionalProperties: false,
};

// The runner has no before/after hooks (module contract: tests[] + cleanup),
// so each test that reads from disk seeds the fixtures itself (idempotent).
function ensureFixtures() {
  jetpack.write(VALID_SCHEMA_PATH, VALID_SCHEMA);
  jetpack.write(INVALID_SCHEMA_PATH, '{ not valid json !!!');
}

module.exports = defineCases({
  description: 'AI schema resolution (inline vs file path)',
  type: 'group',

  tests: [
    {
      name: 'undefined-returns-undefined',
      async run({ expect }) {
        expect(resolveSchema(undefined, noopLog), 'undefined → undefined').toBe(undefined);
      },
    },

    {
      name: 'null-returns-undefined',
      async run({ expect }) {
        expect(resolveSchema(null, noopLog), 'null → undefined').toBe(undefined);
      },
    },

    {
      name: 'false-returns-undefined',
      async run({ expect }) {
        expect(resolveSchema(false, noopLog), 'false → undefined').toBe(undefined);
      },
    },

    {
      name: 'inline-object-returned-as-is',
      async run({ expect }) {
        const inline = { type: 'object', properties: { x: { type: 'string' } } };
        const result = resolveSchema(inline, noopLog);
        expect(result, 'inline schema passed through unchanged').toEqual(inline);
      },
    },

    {
      name: 'path-loads-json-file',
      async run({ expect }) {
        ensureFixtures();
        const result = resolveSchema({ path: VALID_SCHEMA_PATH }, noopLog);
        expect(result, 'loaded schema matches fixture').toEqual(VALID_SCHEMA);
      },
    },

    {
      name: 'path-not-found-throws',
      async run({ expect }) {
        let threw = false;
        try {
          resolveSchema({ path: '/nonexistent/schema.json' }, noopLog);
        } catch (e) {
          threw = true;
          expect(e.message.includes('not found'), 'error mentions not found').toBe(true);
        }
        expect(threw, 'should throw on missing file').toBe(true);
      },
    },

    {
      name: 'path-to-directory-throws',
      async run({ expect }) {
        ensureFixtures();
        let threw = false;
        try {
          resolveSchema({ path: FIXTURES_DIR }, noopLog);
        } catch (e) {
          threw = true;
          expect(e.message.includes('is a directory'), 'error mentions directory').toBe(true);
        }
        expect(threw, 'should throw on directory path').toBe(true);
      },
    },

    {
      name: 'invalid-json-throws',
      async run({ expect }) {
        ensureFixtures();
        let threw = false;
        try {
          resolveSchema({ path: INVALID_SCHEMA_PATH }, noopLog);
        } catch (e) {
          threw = true;
        }
        expect(threw, 'should throw on invalid JSON').toBe(true);
      },
    },
  ],

  async cleanup() {
    jetpack.remove(FIXTURES_DIR);
  },
});
