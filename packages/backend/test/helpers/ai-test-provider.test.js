/**
 * Test: deterministic AI test provider (libraries/ai/providers/test.js)
 *
 * The test provider is a first-class provider (the `test` payment-provider
 * precedent) that consumer suites drive with directives embedded in the last
 * user message. These tests exercise the full request() surface directly —
 * no network involved by design.
 */
const TestProvider = require('../../dist/omega/libraries/ai/providers/test.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');
const { parseScript } = TestProvider._internals;

function makeProvider() {
  // No Omega instance — the provider falls back to isTesting(), which the test
  // lane's OMEGA_ENVIRONMENT=testing answers
  return new TestProvider({});
}

// Build a no-instance provider and run one plain request under the given
// environment, off the emulator. Returns the refusal, or null when it answered.
async function attemptUnder(environment) {
  const saved = { OMEGA_ENVIRONMENT: process.env.OMEGA_ENVIRONMENT, FUNCTIONS_EMULATOR: process.env.FUNCTIONS_EMULATOR };

  process.env.OMEGA_ENVIRONMENT = environment;
  delete process.env.FUNCTIONS_EMULATOR;

  try {
    await makeProvider().request({ messages: [{ role: 'user', content: 'hello there' }] });
    return null;
  } catch (error) {
    return error;
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

module.exports = defineCases({
  description: 'AI test provider (scripted sequences)',
  type: 'group',
  tests: [
    // ─── The no-instance gate: the one environment decides ───

    {
      name: 'no-instance-provider-runs-when-the-one-input-names-testing',
      async run({ expect }) {
        const refusal = await attemptUnder('testing');

        expect(refusal, `OMEGA_ENVIRONMENT=testing allows the provider, got: ${refusal && refusal.message}`).toBe(null);
      },
    },

    {
      name: 'no-instance-provider-refuses-development-off-the-emulator',
      async run({ expect }) {
        const refusal = await attemptUnder('development');

        expect(refusal, 'development with no FUNCTIONS_EMULATOR refuses the provider').toBeTruthy();
        expect(refusal.message, `the refusal is the environment gate, got: ${refusal.message}`).toMatch(/AI test provider is only available in development or testing environments/);
      },
    },

    // ─── Script parsing ───

    {
      name: 'parse-script-orders-steps-and-strips-directives',
      async run({ expect }) {
        const { steps, cleanText } = parseScript(
          'Check my order [[tool:check_order {"orderNumber":"1"}]] please [[reply:{"message":"done"}]]',
        );

        expect(steps.length, 'two steps').toBe(2);
        expect(steps[0].type, 'first step is a tool call').toBe('tools');
        expect(steps[0].calls[0].name, 'tool name parsed').toBe('check_order');
        expect(steps[0].calls[0].arguments, 'tool args parsed').toEqual({ orderNumber: '1' });
        expect(steps[1].type, 'second step is the reply').toBe('reply');
        expect(cleanText, 'directives stripped from echo text').toBe('Check my order  please');
      },
    },

    {
      name: 'parse-script-delay-attaches-to-next-step',
      async run({ expect }) {
        const { steps } = parseScript('[[delay:50]][[tool:slow_tool]]');

        expect(steps.length, 'one step').toBe(1);
        expect(steps[0].delay, 'delay attached to the tool step').toBe(50);
      },
    },

    // ─── Echo default ───

    {
      name: 'echo-reply-without-directives',
      async run({ expect }) {
        const provider = makeProvider();
        const result = await provider.request({
          messages: [
            { role: 'system', content: 'sys' },
            { role: 'user', content: 'hello there' },
          ],
        });

        expect(result.content, 'echoes the user message').toBe('Echo: hello there');
        expect(result.stopReason, 'final turn').toBe('end');
        expect(result.toolCalls, 'no tool calls').toEqual([]);
        expect(result.tokens.total.count > 0, 'tokens accounted').toBe(true);
      },
    },

    {
      name: 'echo-reply-json-mode-wraps-message',
      async run({ expect }) {
        const provider = makeProvider();
        const result = await provider.request({
          response: 'json',
          messages: [{ role: 'user', content: 'hi' }],
        });

        expect(typeof result.content, 'parsed object').toBe('object');
        expect(result.content.message, 'wrapped message').toBe('Echo: hi');
      },
    },

    // ─── Scripted reply ───

    {
      name: 'scripted-json-reply',
      async run({ expect }) {
        const provider = makeProvider();
        const result = await provider.request({
          response: 'json',
          messages: [
            { role: 'user', content: 'whatever [[reply:{"message":"Hi!","actions":[{"type":"reply","label":"More"}]}]]' },
          ],
        });

        expect(result.content.message, 'scripted message').toBe('Hi!');
        expect(result.content.actions[0].label, 'scripted actions').toBe('More');
        expect(result.stopReason, 'final turn').toBe('end');
      },
    },

    // ─── Tool loop sequence ───

    {
      name: 'tool-then-reply-sequence-across-turns',
      async run({ expect }) {
        const provider = makeProvider();
        const script = 'check it [[tool:check_order {"orderNumber":"42"}]] [[reply:{"message":"Order 42 shipped"}]]';

        // Turn 1: the provider emits the tool call
        const first = await provider.request({
          response: 'json',
          messages: [
            { role: 'system', content: 'sys' },
            { role: 'user', content: script },
          ],
        });

        expect(first.stopReason, 'first turn requests the tool').toBe('tool_use');
        expect(first.toolCalls.length, 'one call').toBe(1);
        expect(first.toolCalls[0].name, 'tool name').toBe('check_order');
        expect(first.toolCalls[0].arguments, 'tool args').toEqual({ orderNumber: '42' });

        // Turn 2: caller appended the ctx turn + tool result — provider
        // moves to the next step (the reply)
        const second = await provider.request({
          response: 'json',
          messages: [
            { role: 'system', content: 'sys' },
            { role: 'user', content: script },
            { role: 'assistant', toolCalls: first.toolCalls },
            { role: 'tool', toolCallId: first.toolCalls[0].id, content: '{"status":"shipped"}' },
          ],
        });

        expect(second.stopReason, 'second turn is final').toBe('end');
        expect(second.content.message, 'scripted final reply').toBe('Order 42 shipped');
      },
    },

    {
      name: 'parallel-tools-directive-emits-multiple-calls',
      async run({ expect }) {
        const provider = makeProvider();
        const result = await provider.request({
          messages: [
            { role: 'user', content: '[[tools:[{"name":"a","arguments":{"x":1}},{"name":"b","arguments":{"y":2}}]]]' },
          ],
        });

        expect(result.stopReason, 'tool turn').toBe('tool_use');
        expect(result.toolCalls.length, 'two parallel calls').toBe(2);
        expect(result.toolCalls[0].name, 'first call').toBe('a');
        expect(result.toolCalls[1].name, 'second call').toBe('b');
        expect(result.toolCalls[1].arguments, 'second args').toEqual({ y: 2 });
      },
    },

    // ─── Scripted error ───

    {
      name: 'scripted-error-throws',
      async run({ expect }) {
        const provider = makeProvider();
        let threw = false;

        try {
          await provider.request({
            messages: [{ role: 'user', content: '[[error:boom]]' }],
          });
        } catch (e) {
          threw = true;
          expect(e.message, 'scripted error message').toBe('boom');
        }

        expect(threw, 'throws the scripted error').toBe(true);
      },
    },

    // ─── Script exhaustion ───

    {
      name: 'exhausted-script-falls-back-to-echo',
      async run({ expect }) {
        const provider = makeProvider();
        const script = 'hi [[tool:t1]]';

        const second = await provider.request({
          messages: [
            { role: 'user', content: script },
            { role: 'assistant', toolCalls: [{ id: 'c', name: 't1', arguments: {} }] },
            { role: 'tool', toolCallId: 'c', content: 'r' },
          ],
        });

        expect(second.stopReason, 'falls back to a final turn').toBe('end');
        expect(String(second.content).startsWith('Echo:'), 'echo fallback').toBe(true);
      },
    },

    // ─── Path-based messages (@omega.js/backend prompt-template style) ───

    {
      name: 'reply-directive-from-path-based-message-settings',
      async run({ expect }) {
        // Routes idiomatically pass message: { path, settings } — the real
        // providers render the template, so directives arrive via settings values
        const provider = makeProvider();
        const result = await provider.request({
          response: 'json',
          message: {
            path: '/prompts/user.md',
            settings: {
              level: 'college',
              message: 'What is 2+2? [[reply:{"answer":"4"}]]',
            },
          },
        });

        expect(typeof result.content, 'parsed object').toBe('object');
        expect(result.content.answer, 'directive extracted from settings values').toBe('4');
      },
    },
  ],
});
