/**
 * Test: AI request payload shape (libraries/ai/providers/openai.js)
 *
 * Verifies the transformation from the @omega.js/backend-facing `ai.request()` options
 * (specifically `options.prompt` in either legacy object form or array form)
 * into the eventual OpenAI HTTP payload (the `input: [...]` array), including
 * the `normalizeOptions()` hop `ai.request()` makes before the provider sees
 * the options.
 *
 * The same prompt forms must reach the two Claude providers (anthropic,
 * claude-code) through their shared `anthropic-format.buildMessages`, so the
 * Claude side of each form is asserted here too.
 *
 * These tests exercise the pure helpers `normalizeOptions`, `normalizePrompt`,
 * `loadContent`, `formatHistory` and `buildMessages` directly — no network, no
 * ctx required.
 */
const path = require('path');
const jetpack = require('fs-jetpack');
const OpenAI = require('../../src/manager/libraries/ai/providers/openai.js');
const format = require('../../src/manager/libraries/ai/providers/anthropic-format.js');
const AI = require('../../src/manager/libraries/ai/index.js');
const { normalizePrompt, loadContent, formatHistory, VALID_PROMPT_ROLES } = OpenAI._internals;
const { normalizeOptions, SYSTEM_PROMPT_INJECTIONS } = AI._internals;

function noopLog() {}

const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures', 'ai-prompt');
const HOUSE_STYLE_PATH = path.join(FIXTURES_DIR, 'house-style.md');
const OPERATOR_PATH = path.join(FIXTURES_DIR, 'operator.md');

// The runner has no before/after hooks (module contract: tests[] + cleanup),
// so each test that reads from disk seeds the fixtures itself (idempotent).
function ensureFixtures() {
  jetpack.write(HOUSE_STYLE_PATH, 'House style for {brand}.');
  jetpack.write(OPERATOR_PATH, 'Operator config.');
}

function baseOptions(overrides = {}) {
  return {
    dedupeConsecutiveRoles: true,
    history: { messages: [], limit: 5 },
    message: { attachments: [] },
    ...overrides,
  };
}

module.exports = {
  description: 'AI request payload shape (system/developer/user roles)',
  type: 'group',
  tests: [
    // ─── normalizePrompt ───

    {
      name: 'normalize-undefined-returns-empty-array',
      async run({ assert }) {
        assert.deepEqual(normalizePrompt(undefined), [], 'undefined → []');
      },
    },

    {
      name: 'normalize-null-returns-empty-array',
      async run({ assert }) {
        assert.deepEqual(normalizePrompt(null), [], 'null → []');
      },
    },

    {
      name: 'normalize-empty-object-returns-empty-array',
      async run({ assert }) {
        assert.deepEqual(normalizePrompt({}), [], 'empty object → []');
      },
    },

    {
      name: 'normalize-legacy-object-form-wraps-as-system-segment',
      async run({ assert }) {
        const result = normalizePrompt({ path: '/tmp/example.md', settings: { foo: 'bar' } });

        assert.equal(result.length, 1, 'one segment');
        assert.equal(result[0].role, 'system', 'legacy object defaults to system role');
        assert.equal(result[0].path, '/tmp/example.md', 'path preserved');
        assert.deepEqual(result[0].settings, { foo: 'bar' }, 'settings preserved');
      },
    },

    {
      name: 'normalize-legacy-object-with-content-only',
      async run({ assert }) {
        const result = normalizePrompt({ content: 'inline prompt text' });

        assert.equal(result.length, 1, 'one segment');
        assert.equal(result[0].role, 'system', 'defaults to system');
        assert.equal(result[0].content, 'inline prompt text', 'content preserved');
        assert.equal(result[0].path, '', 'no path');
      },
    },

    {
      name: 'normalize-array-form-preserves-roles-and-order',
      async run({ assert }) {
        const result = normalizePrompt([
          { role: 'system',    content: 'platform rules' },
          { role: 'developer', content: 'operator config' },
        ]);

        assert.equal(result.length, 2, 'two segments');
        assert.equal(result[0].role, 'system', 'first is system');
        assert.equal(result[0].content, 'platform rules', 'first content');
        assert.equal(result[1].role, 'developer', 'second is developer');
        assert.equal(result[1].content, 'operator config', 'second content');
      },
    },

    {
      name: 'normalize-array-segment-without-role-defaults-to-system',
      async run({ assert }) {
        const result = normalizePrompt([
          { content: 'rule 1' },
          { role: 'developer', content: 'rule 2' },
        ]);

        assert.equal(result[0].role, 'system', 'missing role → system');
        assert.equal(result[1].role, 'developer', 'explicit role preserved');
      },
    },

    {
      name: 'normalize-array-with-invalid-role-throws',
      async run({ assert }) {
        let threw = false;
        try {
          normalizePrompt([{ role: 'admin', content: 'bad' }]);
        } catch (e) {
          threw = true;
          assert.equal(
            String(e.message).includes('Invalid prompt role'),
            true,
            'error mentions Invalid prompt role',
          );
        }
        assert.equal(threw, true, 'should throw on invalid role');
      },
    },

    {
      name: 'normalize-valid-roles-set-matches-openai-model-spec',
      async run({ assert }) {
        const expected = ['system', 'developer', 'user', 'assistant'];
        const actual = [...VALID_PROMPT_ROLES].sort();

        assert.deepEqual(actual, expected.sort(), 'valid roles per OpenAI Model Spec');
      },
    },

    {
      name: 'normalize-all-valid-roles-accepted',
      async run({ assert }) {
        const segments = ['system', 'developer', 'user', 'assistant'].map((role) => ({
          role,
          content: `content for ${role}`,
        }));

        const result = normalizePrompt(segments);

        assert.equal(result.length, 4, 'all four segments accepted');
        result.forEach((segment, i) => {
          assert.equal(segment.role, segments[i].role, `segment ${i} role preserved`);
        });
      },
    },

    // ─── formatHistory → OpenAI Responses API payload shape ───

    {
      name: 'format-single-system-prompt-emits-system-then-user',
      async run({ assert }) {
        const promptSegments = normalizePrompt({ content: 'You are a helpful ctx.' });
        const formatted = formatHistory(baseOptions(), promptSegments, 'Hello!', noopLog);

        assert.equal(formatted.length, 2, 'two messages: system + user');
        assert.equal(formatted[0].role, 'system', 'first message is system');
        assert.equal(formatted[0].content[0].type, 'input_text', 'system uses input_text');
        assert.equal(formatted[0].content[0].text, 'You are a helpful ctx.', 'system text');
        assert.equal(formatted[1].role, 'user', 'second message is user');
        assert.equal(formatted[1].content[0].text, 'Hello!', 'user text');
      },
    },

    {
      name: 'format-system-plus-developer-emits-three-messages-in-order',
      async run({ assert }) {
        const promptSegments = normalizePrompt([
          { role: 'system',    content: 'Platform rules go here.' },
          { role: 'developer', content: 'Operator config goes here.' },
        ]);
        const formatted = formatHistory(baseOptions(), promptSegments, 'Customer email body.', noopLog);

        assert.equal(formatted.length, 3, 'three messages');
        assert.equal(formatted[0].role, 'system', 'order: system');
        assert.equal(formatted[1].role, 'developer', 'order: developer');
        assert.equal(formatted[2].role, 'user', 'order: user');
        assert.equal(formatted[0].content[0].text, 'Platform rules go here.', 'system content');
        assert.equal(formatted[1].content[0].text, 'Operator config goes here.', 'developer content');
        assert.equal(formatted[2].content[0].text, 'Customer email body.', 'user content');
      },
    },

    {
      name: 'format-empty-prompt-array-emits-only-user-message',
      async run({ assert }) {
        const formatted = formatHistory(baseOptions(), [], 'Just a user message.', noopLog);

        assert.equal(formatted.length, 1, 'only the user message');
        assert.equal(formatted[0].role, 'user', 'role: user');
        assert.equal(formatted[0].content[0].text, 'Just a user message.', 'text preserved');
      },
    },

    {
      name: 'format-interleaves-prompt-history-and-new-user-message',
      async run({ assert }) {
        const promptSegments = normalizePrompt([
          { role: 'system',    content: 'system rules' },
          { role: 'developer', content: 'developer rules' },
        ]);
        const options = baseOptions({
          history: {
            messages: [
              { role: 'user',      content: 'first user msg' },
              { role: 'assistant', content: 'first ai reply' },
            ],
            limit: 5,
          },
        });
        const formatted = formatHistory(options, promptSegments, 'second user msg', noopLog);

        const roleSequence = formatted.map((m) => m.role);
        assert.deepEqual(
          roleSequence,
          ['system', 'developer', 'user', 'assistant', 'user'],
          'prompts → history → new user message',
        );
      },
    },

    {
      name: 'format-ctx-history-uses-output_text-type',
      async run({ assert }) {
        const options = baseOptions({
          history: {
            messages: [{ role: 'assistant', content: 'previous reply' }],
            limit: 5,
          },
        });
        const formatted = formatHistory(options, [], 'new message', noopLog);

        const assistantMsg = formatted.find((m) => m.role === 'assistant');
        assert.equal(assistantMsg.content[0].type, 'output_text', 'ctx uses output_text');
      },
    },

    {
      name: 'format-respects-history-limit',
      async run({ assert }) {
        const options = baseOptions({
          history: {
            messages: [
              { role: 'user',      content: 'msg 1' },
              { role: 'assistant', content: 'msg 2' },
              { role: 'user',      content: 'msg 3' },
              { role: 'assistant', content: 'msg 4' },
              { role: 'user',      content: 'msg 5' },
              { role: 'assistant', content: 'msg 6' },
            ],
            limit: 2,
          },
        });
        const formatted = formatHistory(options, normalizePrompt({ content: 'sys' }), 'now', noopLog);

        // Expected: 1 system + 2 history + 1 user = 4 messages
        assert.equal(formatted.length, 4, 'system + 2 history + new user');
        assert.equal(formatted[1].content[0].text, 'msg 5', 'second-to-last history kept');
        assert.equal(formatted[2].content[0].text, 'msg 6', 'last history kept');
        assert.equal(formatted[3].content[0].text, 'now', 'new user message appended');
      },
    },

    {
      name: 'format-dedupes-trailing-user-history-when-flag-set',
      async run({ assert }) {
        const options = baseOptions({
          dedupeConsecutiveRoles: true,
          history: {
            messages: [
              { role: 'assistant', content: 'reply' },
              { role: 'user',      content: 'should be dropped' },
            ],
            limit: 5,
          },
        });
        const formatted = formatHistory(options, [], 'real new message', noopLog);

        // history's trailing 'user' is dropped, then the real new message is appended
        assert.equal(formatted.length, 2, 'ctx + new user only');
        assert.equal(formatted[0].role, 'assistant', 'kept ctx');
        assert.equal(formatted[1].role, 'user', 'new user');
        assert.equal(formatted[1].content[0].text, 'real new message', 'new user content');
      },
    },

    {
      name: 'format-strips-and-trims-content',
      async run({ assert }) {
        const promptSegments = normalizePrompt({ content: '  padded system content  \n' });
        const formatted = formatHistory(baseOptions(), promptSegments, '  padded user content  ', noopLog);

        assert.equal(formatted[0].content[0].text, 'padded system content', 'system trimmed');
        assert.equal(formatted[1].content[0].text, 'padded user content', 'user trimmed');
      },
    },

    // ─── normalizeOptions: every prompt form survives the ai.request() hop ───

    {
      name: 'normalize-options-array-prompt-stays-an-array',
      async run({ assert }) {
        const out = normalizeOptions({
          prompt: [
            { role: 'system',    path: HOUSE_STYLE_PATH, settings: { brand: 'Paperloom' } },
            { role: 'developer', content: 'operator config' },
          ],
          message: { content: 'hello' },
        });

        assert.equal(Array.isArray(out.prompt), true, 'array prompt stays an array');
        assert.equal(out.prompt.length, 3, 'rules segment + the two caller segments');
        assert.equal(out.prompt[0].role, 'system', 'rules ride as a leading system segment');
        assert.equal(out.prompt[0].content.includes(SYSTEM_PROMPT_INJECTIONS[0]), true, 'rules content');
        assert.equal(out.prompt[1].path, HOUSE_STYLE_PATH, 'caller segment path preserved');
        assert.deepEqual(out.prompt[1].settings, { brand: 'Paperloom' }, 'caller segment settings preserved');
        assert.equal(out.prompt[2].role, 'developer', 'caller segment role preserved');
        assert.equal(out.prompt[2].content, 'operator config', 'caller segment content preserved');
        assert.equal(out.prompt.content, undefined, 'segments NOT collapsed into a content-only object');
      },
    },

    {
      name: 'normalize-options-array-prompt-resolves-prompt-files',
      async run({ assert }) {
        ensureFixtures();

        const out = normalizeOptions({
          prompt: [
            { role: 'system',    path: HOUSE_STYLE_PATH, settings: { brand: 'Paperloom' } },
            { role: 'developer', path: OPERATOR_PATH },
          ],
        });
        const loaded = normalizePrompt(out.prompt).map((segment) => ({
          role: segment.role,
          content: loadContent(segment, noopLog),
        }));

        assert.equal(loaded.length, 3, 'rules + both file-backed segments');
        assert.equal(loaded.some((s) => s.content instanceof Error), false, 'no segment failed to load');
        assert.equal(loaded[0].content.includes(SYSTEM_PROMPT_INJECTIONS[0]), true, 'rules segment loaded');
        assert.equal(loaded[1].content, 'House style for Paperloom.', 'system prompt file read and templated');
        assert.equal(loaded[2].role, 'developer', 'developer role preserved through loading');
        assert.equal(loaded[2].content, 'Operator config.', 'developer prompt file read');
      },
    },

    {
      name: 'normalize-options-array-prompt-with-messages-fails-loudly',
      async run({ assert }) {
        let threw = false;

        try {
          normalizeOptions({
            prompt: [{ role: 'system', path: HOUSE_STYLE_PATH }],
            messages: [
              { role: 'system', content: 'caller system turn' },
              { role: 'user',   content: 'hello' },
            ],
          });
        } catch (e) {
          threw = true;
          assert.equal(String(e.message).includes('messages'), true, 'error names the conflicting form');
        }

        assert.equal(threw, true, 'the array prompt and messages[] cannot combine');
      },
    },

    {
      name: 'normalize-options-messages-system-turn-keeps-caller-content',
      async run({ assert }) {
        const out = normalizeOptions({
          messages: [
            { role: 'system', content: 'caller system turn' },
            { role: 'user',   content: 'hello' },
          ],
        });

        assert.equal(out.messages[0].role, 'system', 'system turn stays first');
        assert.equal(out.messages[0].content.includes(SYSTEM_PROMPT_INJECTIONS[0]), true, 'rules prepended');
        assert.equal(out.messages[0].content.includes('caller system turn'), true, 'caller system content survives');
        assert.equal(out.message.content, 'hello', 'last user turn becomes the message');
      },
    },

    {
      name: 'normalize-options-object-prompt-keeps-object-form',
      async run({ assert }) {
        const out = normalizeOptions({
          prompt: { path: HOUSE_STYLE_PATH, settings: { brand: 'Paperloom' } },
          message: { content: 'hello' },
        });

        assert.equal(Array.isArray(out.prompt), false, 'object form stays an object');
        assert.equal(out.prompt.path, HOUSE_STYLE_PATH, 'path preserved');
        assert.deepEqual(out.prompt.settings, { brand: 'Paperloom' }, 'settings preserved');
        assert.equal(out.prompt.content.includes(SYSTEM_PROMPT_INJECTIONS[0]), true, 'rules injected as content');
      },
    },

    {
      name: 'normalize-options-string-prompt-content-keeps-caller-text',
      async run({ assert }) {
        const out = normalizeOptions({
          prompt: { content: 'You are a helpful assistant.' },
          message: { content: 'hello' },
        });

        assert.equal(out.prompt.content.includes(SYSTEM_PROMPT_INJECTIONS[0]), true, 'rules prepended');
        assert.equal(out.prompt.content.includes('You are a helpful assistant.'), true, 'caller text preserved');
      },
    },

    // ─── anthropic-format: the same prompt forms reach the Claude providers ───

    {
      name: 'anthropic-format-array-prompt-carries-rules-and-caller-segments',
      async run({ assert }) {
        ensureFixtures();

        const out = normalizeOptions({
          prompt: [
            { role: 'system',    path: HOUSE_STYLE_PATH, settings: { brand: 'Paperloom' } },
            { role: 'developer', content: 'operator config' },
          ],
          message: { content: 'hello' },
        });
        const { system, messages } = format.buildMessages(out);

        assert.equal(system.includes(SYSTEM_PROMPT_INJECTIONS[0]), true, 'first universal rule reaches Claude');
        assert.equal(system.includes(SYSTEM_PROMPT_INJECTIONS[1]), true, 'second universal rule reaches Claude');
        assert.equal(system.includes('House style for Paperloom.'), true, 'prompt-file segment loaded and templated');
        assert.equal(system.includes('operator config'), true, 'developer segment folded into the system prompt');
        assert.deepEqual(messages, [{ role: 'user', content: 'hello' }], 'the message is the only turn');
      },
    },

    {
      name: 'anthropic-format-object-prompt-path-is-loaded',
      async run({ assert }) {
        ensureFixtures();

        const out = normalizeOptions({
          prompt: { path: HOUSE_STYLE_PATH, settings: { brand: 'Paperloom' } },
          message: { content: 'hello' },
        });
        const { system } = format.buildMessages(out);

        // Claude reads the object form exactly as OpenAI does: a `path` wins over
        // `content`, so the system prompt is the loaded file (the rules that
        // normalizeOptions writes into `content` are dropped by that precedence
        // on EVERY provider — pre-existing, not this path's doing)
        assert.equal(system, 'House style for Paperloom.', 'object-form prompt file loaded and templated');
      },
    },

    {
      name: 'anthropic-format-array-prompt-user-segment-joins-the-user-turn',
      async run({ assert }) {
        const { system, messages } = format.buildMessages({
          prompt: [
            { role: 'system', content: 'platform rules' },
            { role: 'user',   content: 'seed question' },
          ],
          message: { content: 'real question' },
        });

        assert.equal(system, 'platform rules', 'only system/developer segments feed the system prompt');
        assert.deepEqual(
          messages,
          [{ role: 'user', content: 'seed question\n\nreal question' }],
          'consecutive user content rides ONE turn (the Messages API rejects repeats)',
        );
      },
    },

    {
      name: 'anthropic-format-missing-prompt-file-throws',
      async run({ assert }) {
        let threw = false;

        try {
          format.buildMessages({ prompt: [{ role: 'system', path: path.join(FIXTURES_DIR, 'nope.md') }] });
        } catch (e) {
          threw = true;
          assert.equal(String(e.message).includes('nope.md'), true, 'error names the missing file');
        }

        assert.equal(threw, true, 'a missing prompt file fails loudly');
      },
    },
  ],

  async cleanup() {
    jetpack.remove(FIXTURES_DIR);
  },
};
