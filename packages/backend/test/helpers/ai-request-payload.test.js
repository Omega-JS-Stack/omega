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
const OpenAI = require('../../dist/omega/libraries/ai/providers/openai.js');
const format = require('../../dist/omega/libraries/ai/providers/anthropic-format.js');
const AI = require('../../dist/omega/libraries/ai/index.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');
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

module.exports = defineCases({
  description: 'AI request payload shape (system/developer/user roles)',
  type: 'group',
  tests: [
    // ─── normalizePrompt ───

    {
      name: 'normalize-undefined-returns-empty-array',
      async run({ expect }) {
        expect(normalizePrompt(undefined), 'undefined → []').toEqual([]);
      },
    },

    {
      name: 'normalize-null-returns-empty-array',
      async run({ expect }) {
        expect(normalizePrompt(null), 'null → []').toEqual([]);
      },
    },

    {
      name: 'normalize-empty-object-returns-empty-array',
      async run({ expect }) {
        expect(normalizePrompt({}), 'empty object → []').toEqual([]);
      },
    },

    {
      name: 'normalize-legacy-object-form-wraps-as-system-segment',
      async run({ expect }) {
        const result = normalizePrompt({ path: '/tmp/example.md', settings: { foo: 'bar' } });

        expect(result.length, 'one segment').toBe(1);
        expect(result[0].role, 'legacy object defaults to system role').toBe('system');
        expect(result[0].path, 'path preserved').toBe('/tmp/example.md');
        expect(result[0].settings, 'settings preserved').toEqual({ foo: 'bar' });
      },
    },

    {
      name: 'normalize-legacy-object-with-content-only',
      async run({ expect }) {
        const result = normalizePrompt({ content: 'inline prompt text' });

        expect(result.length, 'one segment').toBe(1);
        expect(result[0].role, 'defaults to system').toBe('system');
        expect(result[0].content, 'content preserved').toBe('inline prompt text');
        expect(result[0].path, 'no path').toBe('');
      },
    },

    {
      name: 'normalize-array-form-preserves-roles-and-order',
      async run({ expect }) {
        const result = normalizePrompt([
          { role: 'system',    content: 'platform rules' },
          { role: 'developer', content: 'operator config' },
        ]);

        expect(result.length, 'two segments').toBe(2);
        expect(result[0].role, 'first is system').toBe('system');
        expect(result[0].content, 'first content').toBe('platform rules');
        expect(result[1].role, 'second is developer').toBe('developer');
        expect(result[1].content, 'second content').toBe('operator config');
      },
    },

    {
      name: 'normalize-array-segment-without-role-defaults-to-system',
      async run({ expect }) {
        const result = normalizePrompt([
          { content: 'rule 1' },
          { role: 'developer', content: 'rule 2' },
        ]);

        expect(result[0].role, 'missing role → system').toBe('system');
        expect(result[1].role, 'explicit role preserved').toBe('developer');
      },
    },

    {
      name: 'normalize-array-with-invalid-role-throws',
      async run({ expect }) {
        let threw = false;
        try {
          normalizePrompt([{ role: 'admin', content: 'bad' }]);
        } catch (e) {
          threw = true;
          expect(String(e.message).includes('Invalid prompt role'), 'error mentions Invalid prompt role').toBe(true);
        }
        expect(threw, 'should throw on invalid role').toBe(true);
      },
    },

    {
      name: 'normalize-valid-roles-set-matches-openai-model-spec',
      async run({ expect }) {
        const expected = ['system', 'developer', 'user', 'assistant'];
        const actual = [...VALID_PROMPT_ROLES].sort();

        expect(actual, 'valid roles per OpenAI Model Spec').toEqual(expected.sort());
      },
    },

    {
      name: 'normalize-all-valid-roles-accepted',
      async run({ expect }) {
        const segments = ['system', 'developer', 'user', 'assistant'].map((role) => ({
          role,
          content: `content for ${role}`,
        }));

        const result = normalizePrompt(segments);

        expect(result.length, 'all four segments accepted').toBe(4);
        result.forEach((segment, i) => {
          expect(segment.role, `segment ${i} role preserved`).toBe(segments[i].role);
        });
      },
    },

    // ─── formatHistory → OpenAI Responses API payload shape ───

    {
      name: 'format-single-system-prompt-emits-system-then-user',
      async run({ expect }) {
        const promptSegments = normalizePrompt({ content: 'You are a helpful ctx.' });
        const formatted = formatHistory(baseOptions(), promptSegments, 'Hello!', noopLog);

        expect(formatted.length, 'two messages: system + user').toBe(2);
        expect(formatted[0].role, 'first message is system').toBe('system');
        expect(formatted[0].content[0].type, 'system uses input_text').toBe('input_text');
        expect(formatted[0].content[0].text, 'system text').toBe('You are a helpful ctx.');
        expect(formatted[1].role, 'second message is user').toBe('user');
        expect(formatted[1].content[0].text, 'user text').toBe('Hello!');
      },
    },

    {
      name: 'format-system-plus-developer-emits-three-messages-in-order',
      async run({ expect }) {
        const promptSegments = normalizePrompt([
          { role: 'system',    content: 'Platform rules go here.' },
          { role: 'developer', content: 'Operator config goes here.' },
        ]);
        const formatted = formatHistory(baseOptions(), promptSegments, 'Customer email body.', noopLog);

        expect(formatted.length, 'three messages').toBe(3);
        expect(formatted[0].role, 'order: system').toBe('system');
        expect(formatted[1].role, 'order: developer').toBe('developer');
        expect(formatted[2].role, 'order: user').toBe('user');
        expect(formatted[0].content[0].text, 'system content').toBe('Platform rules go here.');
        expect(formatted[1].content[0].text, 'developer content').toBe('Operator config goes here.');
        expect(formatted[2].content[0].text, 'user content').toBe('Customer email body.');
      },
    },

    {
      name: 'format-empty-prompt-array-emits-only-user-message',
      async run({ expect }) {
        const formatted = formatHistory(baseOptions(), [], 'Just a user message.', noopLog);

        expect(formatted.length, 'only the user message').toBe(1);
        expect(formatted[0].role, 'role: user').toBe('user');
        expect(formatted[0].content[0].text, 'text preserved').toBe('Just a user message.');
      },
    },

    {
      name: 'format-interleaves-prompt-history-and-new-user-message',
      async run({ expect }) {
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
        expect(roleSequence, 'prompts → history → new user message').toEqual(['system', 'developer', 'user', 'assistant', 'user']);
      },
    },

    {
      name: 'format-ctx-history-uses-output_text-type',
      async run({ expect }) {
        const options = baseOptions({
          history: {
            messages: [{ role: 'assistant', content: 'previous reply' }],
            limit: 5,
          },
        });
        const formatted = formatHistory(options, [], 'new message', noopLog);

        const assistantMsg = formatted.find((m) => m.role === 'assistant');
        expect(assistantMsg.content[0].type, 'ctx uses output_text').toBe('output_text');
      },
    },

    {
      name: 'format-respects-history-limit',
      async run({ expect }) {
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
        expect(formatted.length, 'system + 2 history + new user').toBe(4);
        expect(formatted[1].content[0].text, 'second-to-last history kept').toBe('msg 5');
        expect(formatted[2].content[0].text, 'last history kept').toBe('msg 6');
        expect(formatted[3].content[0].text, 'new user message appended').toBe('now');
      },
    },

    {
      name: 'format-dedupes-trailing-user-history-when-flag-set',
      async run({ expect }) {
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
        expect(formatted.length, 'ctx + new user only').toBe(2);
        expect(formatted[0].role, 'kept ctx').toBe('assistant');
        expect(formatted[1].role, 'new user').toBe('user');
        expect(formatted[1].content[0].text, 'new user content').toBe('real new message');
      },
    },

    {
      name: 'format-strips-and-trims-content',
      async run({ expect }) {
        const promptSegments = normalizePrompt({ content: '  padded system content  \n' });
        const formatted = formatHistory(baseOptions(), promptSegments, '  padded user content  ', noopLog);

        expect(formatted[0].content[0].text, 'system trimmed').toBe('padded system content');
        expect(formatted[1].content[0].text, 'user trimmed').toBe('padded user content');
      },
    },

    // ─── normalizeOptions: every prompt form collapses to the one shape ───

    {
      name: 'normalize-options-array-prompt-becomes-resolved-segments',
      async run({ expect }) {
        ensureFixtures();

        const out = normalizeOptions({
          prompt: [
            { role: 'system',    path: HOUSE_STYLE_PATH, settings: { brand: 'OMEGA Playground' } },
            { role: 'developer', content: 'operator config' },
          ],
          message: { content: 'hello' },
        });

        expect(Array.isArray(out.prompt), 'the internal shape is a segment array').toBe(true);
        expect(out.prompt.length, 'rules segment + the two caller segments').toBe(3);
        expect(out.prompt[0].role, 'rules ride as a leading system segment').toBe('system');
        expect(out.prompt[0].content.includes(SYSTEM_PROMPT_INJECTIONS[0]), 'rules content').toBe(true);
        expect(out.prompt[1].content, 'caller segment file read and templated here').toBe('House style for OMEGA Playground.');
        expect(out.prompt[1].path, 'the path is consumed at the one load point').toBe(undefined);
        expect(out.prompt[2].role, 'caller segment role preserved').toBe('developer');
        expect(out.prompt[2].content, 'caller segment content preserved').toBe('operator config');
        expect(out.prompt.content, 'segments NOT collapsed into a content-only object').toBe(undefined);
      },
    },

    {
      name: 'normalize-options-array-prompt-resolves-prompt-files',
      async run({ expect }) {
        ensureFixtures();

        const out = normalizeOptions({
          prompt: [
            { role: 'system',    path: HOUSE_STYLE_PATH, settings: { brand: 'OMEGA Playground' } },
            { role: 'developer', path: OPERATOR_PATH },
          ],
        });
        const loaded = normalizePrompt(out.prompt).map((segment) => ({
          role: segment.role,
          content: loadContent(segment, noopLog),
        }));

        expect(loaded.length, 'rules + both file-backed segments').toBe(3);
        expect(loaded.some((s) => s.content instanceof Error), 'no segment failed to load').toBe(false);
        expect(loaded[0].content.includes(SYSTEM_PROMPT_INJECTIONS[0]), 'rules segment loaded').toBe(true);
        expect(loaded[1].content, 'system prompt file read and templated').toBe('House style for OMEGA Playground.');
        expect(loaded[2].role, 'developer role preserved through loading').toBe('developer');
        expect(loaded[2].content, 'developer prompt file read').toBe('Operator config.');
      },
    },

    {
      name: 'normalize-options-array-prompt-with-messages-fails-loudly',
      async run({ expect }) {
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
          expect(String(e.message).includes('messages'), 'error names the conflicting form').toBe(true);
        }

        expect(threw, 'the array prompt and messages[] cannot combine').toBe(true);
      },
    },

    {
      name: 'normalize-options-messages-system-turn-keeps-caller-content',
      async run({ expect }) {
        const out = normalizeOptions({
          messages: [
            { role: 'system', content: 'caller system turn' },
            { role: 'user',   content: 'hello' },
          ],
        });

        expect(out.messages[0].role, 'system turn stays first').toBe('system');
        expect(out.messages[0].content.includes(SYSTEM_PROMPT_INJECTIONS[0]), 'rules prepended').toBe(true);
        expect(out.messages[0].content.includes('caller system turn'), 'caller system content survives').toBe(true);
        expect(out.message.content, 'last user turn becomes the message').toBe('hello');
      },
    },

    {
      name: 'normalize-options-object-prompt-becomes-resolved-segments',
      async run({ expect }) {
        ensureFixtures();

        const out = normalizeOptions({
          prompt: { path: HOUSE_STYLE_PATH, settings: { brand: 'OMEGA Playground' } },
          message: { content: 'hello' },
        });

        expect(Array.isArray(out.prompt), 'the object form collapses into the same segment array').toBe(true);
        expect(out.prompt.length, 'rules segment + the caller segment').toBe(2);
        expect(out.prompt[0].content.includes(SYSTEM_PROMPT_INJECTIONS[0]), 'rules lead').toBe(true);
        expect(out.prompt[1].role, 'the object form is one implicit system segment').toBe('system');
        expect(out.prompt[1].content, 'prompt file read and templated here').toBe('House style for OMEGA Playground.');
      },
    },

    {
      name: 'normalize-options-string-prompt-content-keeps-caller-text',
      async run({ expect }) {
        const out = normalizeOptions({
          prompt: { content: 'You are a helpful assistant.' },
          message: { content: 'hello' },
        });

        expect(out.prompt[0].content.includes(SYSTEM_PROMPT_INJECTIONS[0]), 'rules prepended').toBe(true);
        expect(out.prompt[1].content, 'caller text preserved').toBe('You are a helpful assistant.');
      },
    },

    {
      name: 'normalize-options-path-and-content-together-throws',
      async run({ expect }) {
        ensureFixtures();

        const cases = [
          {
            label: 'options.prompt',
            options: { prompt: { path: HOUSE_STYLE_PATH, content: 'inline system text' } },
          },
          {
            label: 'options.message',
            options: { message: { path: OPERATOR_PATH, content: 'inline user text' } },
          },
        ];

        for (const testCase of cases) {
          let threw = false;

          try {
            normalizeOptions(testCase.options);
          } catch (e) {
            threw = true;
            expect(String(e.message).includes(testCase.label), `error names ${testCase.label}`).toBe(true);
            expect(String(e.message).includes('path'), 'error names the path').toBe(true);
            expect(String(e.message).includes('content'), 'error names the content').toBe(true);
          }

          expect(threw, `${testCase.label} with both a path and a content fails loudly`).toBe(true);
        }
      },
    },

    {
      name: 'normalize-options-object-prompt-with-messages-system-turn-throws',
      async run({ expect }) {
        let threw = false;

        try {
          normalizeOptions({
            prompt: { content: 'prompt system text' },
            messages: [
              { role: 'system', content: 'caller system turn' },
              { role: 'user',   content: 'hello' },
            ],
          });
        } catch (e) {
          threw = true;
          expect(String(e.message).includes('options.prompt'), 'error names the prompt').toBe(true);
          expect(String(e.message).includes('system-role turn'), 'error names the competing system turn').toBe(true);
        }

        expect(threw, 'two system prompts in one call fail loudly').toBe(true);
      },
    },

    {
      name: 'normalize-options-message-path-loads-once-for-every-format',
      async run({ expect }) {
        ensureFixtures();

        const out = normalizeOptions({
          prompt: { content: 'You are terse.' },
          message: { path: OPERATOR_PATH },
        });

        // OpenAI reads the message through its own loader (a no-op second pass
        // now the path is consumed); the Claude formatters read message.content
        const promptSegments = normalizePrompt(out.prompt).map((segment) => ({
          role: segment.role,
          content: loadContent(segment, noopLog),
        }));
        const openaiPayload = formatHistory(
          baseOptions({ message: { ...out.message, attachments: [] } }),
          promptSegments,
          loadContent(out.message, noopLog),
          noopLog,
        );
        const openaiUserText = openaiPayload[openaiPayload.length - 1].content[0].text;

        // Both Claude providers (anthropic, claude-code) share buildMessages
        const { messages } = format.buildMessages(out);
        const claudeUserText = messages[messages.length - 1].content;

        expect(openaiUserText, 'the message file reaches the OpenAI payload').toBe('Operator config.');
        expect(claudeUserText, 'the Claude formats carry the same file text').toBe(openaiUserText);
      },
    },

    // ─── anthropic-format: the same prompt forms reach the Claude providers ───

    {
      name: 'anthropic-format-array-prompt-carries-rules-and-caller-segments',
      async run({ expect }) {
        ensureFixtures();

        const out = normalizeOptions({
          prompt: [
            { role: 'system',    path: HOUSE_STYLE_PATH, settings: { brand: 'OMEGA Playground' } },
            { role: 'developer', content: 'operator config' },
          ],
          message: { content: 'hello' },
        });
        const { system, messages } = format.buildMessages(out);

        expect(system.includes(SYSTEM_PROMPT_INJECTIONS[0]), 'first universal rule reaches Claude').toBe(true);
        expect(system.includes(SYSTEM_PROMPT_INJECTIONS[1]), 'second universal rule reaches Claude').toBe(true);
        expect(system.includes('House style for OMEGA Playground.'), 'prompt-file segment loaded and templated').toBe(true);
        expect(system.includes('operator config'), 'developer segment folded into the system prompt').toBe(true);
        expect(messages, 'the message is the only turn').toEqual([{ role: 'user', content: 'hello' }]);
      },
    },

    {
      name: 'anthropic-format-object-prompt-path-is-loaded',
      async run({ expect }) {
        ensureFixtures();

        const out = normalizeOptions({
          prompt: { path: HOUSE_STYLE_PATH, settings: { brand: 'OMEGA Playground' } },
          message: { content: 'hello' },
        });
        const { system } = format.buildMessages(out);

        // The object form is loaded at the ONE normalize point, so the file text
        // and the universal rules both reach Claude: nothing competes for the
        // `content` slot inside a provider any more
        expect(system.includes(SYSTEM_PROMPT_INJECTIONS[0]), 'first universal rule survives the object form').toBe(true);
        expect(system.includes(SYSTEM_PROMPT_INJECTIONS[1]), 'second universal rule survives the object form').toBe(true);
        expect(system.includes('House style for OMEGA Playground.'), 'object-form prompt file loaded and templated').toBe(true);
      },
    },

    {
      name: 'anthropic-format-array-prompt-user-segment-joins-the-user-turn',
      async run({ expect }) {
        const { system, messages } = format.buildMessages({
          prompt: [
            { role: 'system', content: 'platform rules' },
            { role: 'user',   content: 'seed question' },
          ],
          message: { content: 'real question' },
        });

        expect(system, 'only system/developer segments feed the system prompt').toBe('platform rules');
        expect(messages, 'consecutive user content rides ONE turn (the Messages API rejects repeats)').toEqual([{ role: 'user', content: 'seed question\n\nreal question' }]);
      },
    },

    {
      name: 'anthropic-format-missing-prompt-file-throws',
      async run({ expect }) {
        let threw = false;

        try {
          format.buildMessages({ prompt: [{ role: 'system', path: path.join(FIXTURES_DIR, 'nope.md') }] });
        } catch (e) {
          threw = true;
          expect(String(e.message).includes('nope.md'), 'error names the missing file').toBe(true);
        }

        expect(threw, 'a missing prompt file fails loudly').toBe(true);
      },
    },
  ],

  async cleanup() {
    jetpack.remove(FIXTURES_DIR);
  },
});
