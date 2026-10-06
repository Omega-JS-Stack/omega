/**
 * Test: cross-provider AI tools formatting (libraries/ai)
 *
 * Verifies the unified tools interface added for agentic tool loops:
 *   - anthropic-format.js — tool defs, tool choice, unified-message → Claude
 *     Messages API mapping (tool_use / tool_result blocks), stop reasons
 *   - openai.js formatMessages/normalizeToolEntry/normalizeToolChoice — the
 *     direct-messages path and Responses API tool envelopes
 *   - ai/index.js normalizeOptions — structured conversations are NOT
 *     string-flattened; system injections still apply
 *
 * All pure helpers — no network, no ctx.
 */
const format = require('../../dist/omega/libraries/ai/providers/anthropic-format.js');
const OpenAI = require('../../dist/omega/libraries/ai/providers/openai.js');
const AI = require('../../dist/omega/libraries/ai/index.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

const { formatMessages, normalizeToolEntry, normalizeToolChoice } = OpenAI._internals;
const { normalizeOptions, isStructuredMessages, SYSTEM_PROMPT_INJECTIONS } = AI._internals;

function noopLog() {}

const SAMPLE_TOOL = {
  name: 'check_order',
  description: 'Look up an order',
  parameters: { type: 'object', properties: { orderNumber: { type: 'string' } }, required: ['orderNumber'] },
};

module.exports = defineCases({
  description: 'AI cross-provider tools formatting',
  type: 'group',
  tests: [
    // ─── anthropic-format: tool definitions ───

    {
      name: 'anthropic-tool-defs-map-parameters-to-input-schema',
      async run({ expect }) {
        const defs = format.buildToolDefs([SAMPLE_TOOL]);

        expect(defs.length, 'one def').toBe(1);
        expect(defs[0].name, 'name preserved').toBe('check_order');
        expect(defs[0].description, 'description preserved').toBe('Look up an order');
        expect(defs[0].input_schema, 'parameters → input_schema').toEqual(SAMPLE_TOOL.parameters);
      },
    },

    {
      name: 'anthropic-tool-defs-accept-explicit-function-type',
      async run({ expect }) {
        const defs = format.buildToolDefs([{ ...SAMPLE_TOOL, type: 'function' }]);

        expect(defs[0].name, 'function-typed entry accepted').toBe('check_order');
      },
    },

    {
      name: 'anthropic-tool-defs-reject-hosted-tools',
      async run({ expect }) {
        let threw = false;

        try {
          format.buildToolDefs([{ type: 'web_search' }]);
        } catch (e) {
          threw = true;
        }

        expect(threw, 'hosted tool types throw on Anthropic').toBe(true);
      },
    },

    {
      name: 'anthropic-tool-defs-empty-list-returns-empty',
      async run({ expect }) {
        expect(format.buildToolDefs(undefined), 'undefined → []').toEqual([]);
        expect(format.buildToolDefs([]), '[] → []').toEqual([]);
      },
    },

    // ─── anthropic-format: tool choice ───

    {
      name: 'anthropic-tool-choice-mapping',
      async run({ expect }) {
        expect(format.buildToolChoice('auto'), 'auto').toEqual({ type: 'auto' });
        expect(format.buildToolChoice('required'), 'required → any').toEqual({ type: 'any' });
        expect(format.buildToolChoice('none'), 'none').toEqual({ type: 'none' });
        expect(format.buildToolChoice({ name: 'check_order' }), 'specific tool').toEqual({ type: 'tool', name: 'check_order' });
        expect(format.buildToolChoice(undefined), 'undefined passes through').toBe(undefined);
      },
    },

    // ─── anthropic-format: message building ───

    {
      name: 'anthropic-messages-ctx-toolcalls-become-tool-use-blocks',
      async run({ expect }) {
        const { system, messages } = format.buildMessages({
          messages: [
            { role: 'system', content: 'sys' },
            { role: 'user', content: 'check my order 123' },
            { role: 'assistant', content: 'Let me check.', toolCalls: [{ id: 'call_1', name: 'check_order', arguments: { orderNumber: '123' } }] },
          ],
        });

        expect(system, 'system extracted').toBe('sys');
        expect(messages.length, 'user + ctx').toBe(2);

        const assistantTurn = messages[1];
        expect(assistantTurn.role, 'ctx role').toBe('assistant');
        expect(assistantTurn.content[0].type, 'text block first').toBe('text');
        expect(assistantTurn.content[0].text, 'text content').toBe('Let me check.');
        expect(assistantTurn.content[1].type, 'tool_use block').toBe('tool_use');
        expect(assistantTurn.content[1].id, 'call id').toBe('call_1');
        expect(assistantTurn.content[1].input, 'arguments → input').toEqual({ orderNumber: '123' });
      },
    },

    {
      name: 'anthropic-messages-consecutive-tool-results-merge-into-one-user-turn',
      async run({ expect }) {
        const { messages } = format.buildMessages({
          messages: [
            { role: 'user', content: 'hi' },
            { role: 'assistant', toolCalls: [
              { id: 'call_1', name: 'a', arguments: {} },
              { id: 'call_2', name: 'b', arguments: {} },
            ] },
            { role: 'tool', toolCallId: 'call_1', content: 'result A' },
            { role: 'tool', toolCallId: 'call_2', content: 'result B' },
          ],
        });

        expect(messages.length, 'user + ctx + ONE merged tool-result user turn').toBe(3);

        const resultTurn = messages[2];
        expect(resultTurn.role, 'tool results ride a user turn').toBe('user');
        expect(resultTurn.content.length, 'both results in one turn').toBe(2);
        expect(resultTurn.content[0].type, 'tool_result block').toBe('tool_result');
        expect(resultTurn.content[0].tool_use_id, 'first result id').toBe('call_1');
        expect(resultTurn.content[1].tool_use_id, 'second result id').toBe('call_2');
      },
    },

    {
      name: 'anthropic-messages-developer-role-folds-into-system',
      async run({ expect }) {
        const { system, messages } = format.buildMessages({
          messages: [
            { role: 'system', content: 'platform' },
            { role: 'developer', content: 'operator' },
            { role: 'user', content: 'hi' },
          ],
        });

        expect(system, 'developer folded into system').toBe('platform\n\noperator');
        expect(messages.length, 'only the user turn remains').toBe(1);
      },
    },

    {
      name: 'anthropic-messages-raw-block-arrays-pass-through',
      async run({ expect }) {
        const rawBlocks = [{ type: 'text', text: 'hello' }, { type: 'tool_use', id: 'x', name: 't', input: {} }];
        const { messages } = format.buildMessages({
          messages: [
            { role: 'user', content: 'hi' },
            { role: 'assistant', content: rawBlocks },
          ],
        });

        expect(messages[1].content, 'raw blocks untouched').toEqual(rawBlocks);
      },
    },

    {
      name: 'anthropic-messages-legacy-prompt-message-form-unchanged',
      async run({ expect }) {
        const { system, messages } = format.buildMessages({
          prompt: { content: 'sys prompt' },
          message: { content: 'user msg' },
        });

        expect(system, 'system from prompt').toBe('sys prompt');
        expect(messages, 'single user turn').toEqual([{ role: 'user', content: 'user msg' }]);
      },
    },

    // ─── anthropic-format: response extraction ───

    {
      name: 'anthropic-extract-tool-calls-and-stop-reasons',
      async run({ expect }) {
        const calls = format.extractToolCalls([
          { type: 'text', text: 'thinking...' },
          { type: 'tool_use', id: 'call_9', name: 'check_order', input: { orderNumber: '9' } },
        ]);

        expect(calls.length, 'one call').toBe(1);
        expect(calls[0], 'normalized shape').toEqual({ id: 'call_9', name: 'check_order', arguments: { orderNumber: '9' } });

        expect(format.mapStopReason('tool_use'), 'tool_use').toBe('tool_use');
        expect(format.mapStopReason('max_tokens'), 'max_tokens').toBe('max_tokens');
        expect(format.mapStopReason('end_turn'), 'end_turn → end').toBe('end');
        expect(format.mapStopReason('stop_sequence'), 'stop_sequence → end').toBe('end');
      },
    },

    // ─── openai: direct-messages path ───

    {
      name: 'openai-format-messages-maps-toolcalls-to-function-call-items',
      async run({ expect }) {
        const input = formatMessages([
          { role: 'system', content: 'sys' },
          { role: 'user', content: 'check order 123' },
          { role: 'assistant', content: 'Checking.', toolCalls: [{ id: 'call_1', name: 'check_order', arguments: { orderNumber: '123' } }] },
          { role: 'tool', toolCallId: 'call_1', content: '{"status":"shipped"}' },
        ], noopLog);

        expect(input.length, 'system + user + ctx text + function_call + function_call_output').toBe(5);
        expect(input[0].role, 'system turn').toBe('system');
        expect(input[1].role, 'user turn').toBe('user');
        expect(input[2].role, 'ctx text turn').toBe('assistant');
        expect(input[2].content[0].type, 'ctx uses output_text').toBe('output_text');

        const callItem = input[3];
        expect(callItem.type, 'function_call item').toBe('function_call');
        expect(callItem.call_id, 'call id').toBe('call_1');
        expect(callItem.name, 'name').toBe('check_order');
        expect(callItem.arguments, 'arguments stringified').toBe(JSON.stringify({ orderNumber: '123' }));

        const outputItem = input[4];
        expect(outputItem.type, 'function_call_output item').toBe('function_call_output');
        expect(outputItem.call_id, 'output call id').toBe('call_1');
        expect(outputItem.output, 'output string').toBe('{"status":"shipped"}');
      },
    },

    {
      name: 'openai-format-messages-toolcall-turn-without-text-emits-no-message-item',
      async run({ expect }) {
        const input = formatMessages([
          { role: 'user', content: 'hi' },
          { role: 'assistant', toolCalls: [{ id: 'c1', name: 't', arguments: {} }] },
        ], noopLog);

        expect(input.length, 'user + function_call only').toBe(2);
        expect(input[1].type, 'no empty ctx message item').toBe('function_call');
      },
    },

    // ─── openai: tool envelopes ───

    {
      name: 'openai-tool-entry-normalization',
      async run({ expect }) {
        const normalized = normalizeToolEntry(SAMPLE_TOOL);

        expect(normalized.type, 'function envelope added').toBe('function');
        expect(normalized.name, 'name preserved').toBe('check_order');
        expect(normalized.parameters, 'parameters preserved').toEqual(SAMPLE_TOOL.parameters);

        const hosted = normalizeToolEntry({ type: 'web_search' });
        expect(hosted, 'hosted tools pass verbatim').toEqual({ type: 'web_search' });
      },
    },

    {
      name: 'openai-tool-choice-normalization',
      async run({ expect }) {
        expect(normalizeToolChoice('auto'), 'auto passes').toBe('auto');
        expect(normalizeToolChoice('required'), 'required passes').toBe('required');
        expect(normalizeToolChoice('none'), 'none passes').toBe('none');
        expect(normalizeToolChoice({ name: 'check_order' }), 'specific tool').toEqual({ type: 'function', name: 'check_order' });
      },
    },

    // ─── index.js: normalizeOptions on structured conversations ───

    {
      name: 'structured-detection',
      async run({ expect }) {
        expect(isStructuredMessages([{ role: 'user', content: 'hi' }]), 'plain text is not structured').toBe(false);
        expect(isStructuredMessages([{ role: 'tool', toolCallId: 'x', content: 'r' }]), 'tool turn is structured').toBe(true);
        expect(isStructuredMessages([{ role: 'assistant', toolCalls: [{ id: 'x', name: 't' }] }]), 'toolCalls turn is structured').toBe(true);
        expect(isStructuredMessages([{ role: 'assistant', content: [{ type: 'tool_use', id: 'x' }] }]), 'raw tool_use blocks are structured').toBe(true);
      },
    },

    {
      name: 'normalize-options-structured-keeps-turns-and-injects-system-rules',
      async run({ expect }) {
        const messages = [
          { role: 'system', content: 'agent instructions' },
          { role: 'user', content: 'check order 1' },
          { role: 'assistant', toolCalls: [{ id: 'c1', name: 'check_order', arguments: {} }] },
          { role: 'tool', toolCallId: 'c1', content: 'shipped' },
        ];
        const out = normalizeOptions({ messages });

        expect(out.messages.length, 'no turns added or dropped').toBe(4);
        expect(out.messages[0].content.includes(SYSTEM_PROMPT_INJECTIONS[0]), 'system rules injected into the system turn').toBe(true);
        expect(out.messages[0].content.includes('agent instructions'), 'original system content preserved').toBe(true);
        expect(out.messages[2], 'toolCalls turn untouched').toEqual(messages[2]);
        expect(out.messages[3], 'tool result turn untouched').toEqual(messages[3]);
        expect(out.prompt, 'prompt NOT synthesized in structured mode').toBe(undefined);
      },
    },

    {
      name: 'normalize-options-structured-without-system-prepends-rules-turn',
      async run({ expect }) {
        const out = normalizeOptions({
          messages: [
            { role: 'user', content: 'hi' },
            { role: 'tool', toolCallId: 'c1', content: 'r' },
          ],
        });

        expect(out.messages.length, 'rules turn prepended').toBe(3);
        expect(out.messages[0].role, 'first turn is system').toBe('system');
        expect(out.messages[0].content.includes(SYSTEM_PROMPT_INJECTIONS[1]), 'rules content').toBe(true);
      },
    },

    {
      name: 'normalize-options-legacy-plain-messages-unchanged-behavior',
      async run({ expect }) {
        const out = normalizeOptions({
          messages: [
            { role: 'system', content: 'sys' },
            { role: 'user', content: 'hello' },
          ],
        });

        expect(typeof out.prompt?.content, 'prompt synthesized for legacy mode').toBe('string');
        expect(out.prompt.content.includes('sys'), 'prompt carries system content').toBe(true);
        expect(out.message?.content, 'message carries last user turn').toBe('hello');
      },
    },

    {
      name: 'normalize-options-structured-systomega-content-as-array-injects-rules',
      async run({ expect }) {
        const messages = [
          {
            role: 'system',
            content: [
              { type: 'text', text: 'existing instruction' },
              { type: 'image', source: { type: 'url', url: 'https://example.com/img.png' } },
            ],
          },
          { role: 'user', content: 'check order 1' },
          { role: 'assistant', toolCalls: [{ id: 'c1', name: 'check_order', arguments: {} }] },
          { role: 'tool', toolCallId: 'c1', content: 'shipped' },
        ];
        const out = normalizeOptions({ messages });

        expect(out.messages.length, 'no turns added or dropped').toBe(4);
        expect(Array.isArray(out.messages[0].content), 'system content stays as array').toBe(true);
        expect(out.messages[0].content[0].type, 'rules prepended as text block').toBe('text');
        expect(out.messages[0].content[0].text.includes(SYSTEM_PROMPT_INJECTIONS[0]), 'system rules injected into prepended text block').toBe(true);
        expect(out.messages[0].content[1].type, 'original text block preserved').toBe('text');
        expect(out.messages[0].content[1].text, 'original text content intact').toBe('existing instruction');
        expect(out.messages[0].content[2].type, 'original image block preserved').toBe('image');
        expect(out.messages[2], 'toolCalls turn untouched').toEqual(messages[2]);
        expect(out.messages[3], 'tool result turn untouched').toEqual(messages[3]);
      },
    },
  ],
});
