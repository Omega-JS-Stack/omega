/**
 * Test: AI token accounting (libraries/ai/tokens.js + libraries/ai/index.js)
 *
 * Usage must be computed from the response of the call that asked for it. The
 * old accounting handed every caller the provider's running counter object and
 * reconstructed per-call numbers from a `_lastTokens` delta on the shared AI
 * instance — two overlapping calls interleaved their deltas and each caller
 * read the other's tokens (#287).
 *
 * The parallel cases drive the real `test` provider (a first-class provider,
 * not a mock) whose `[[delay:ms]]` directive makes the calls resolve out of
 * order. No network involved by design.
 */
const AI = require('../../dist/omega/libraries/ai/index.js');
const { emptyTokens, buildTokens, addTokens } = require('../../dist/omega/libraries/ai/tokens.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

// No Omega instance — the test provider falls back to isTesting(), which the test
// lane's OMEGA_ENVIRONMENT=testing answers
function makeAI() {
  return new AI({}, 'test');
}

const SHORT_CALL = {
  provider: 'test',
  messages: [
    { role: 'system', content: 'sys' },
    { role: 'user',   content: 'hi' },
  ],
};

// Longer input + a delay so this call resolves AFTER the short one started and
// finished — the interleaving that misattributed usage
const LONG_CALL = {
  provider: 'test',
  messages: [
    { role: 'system', content: 'sys' },
    { role: 'user',   content: `[[delay:60]]${'a lengthy customer question '.repeat(20)}` },
  ],
};

module.exports = defineCases({
  description: 'AI token accounting (per-call usage, parallel callers)',
  type: 'group',
  tests: [
    // ─── tokens.js pure helpers ───

    {
      name: 'build-tokens-computes-counts-and-prices-for-one-call',
      async run({ expect }) {
        const tokens = buildTokens(1000, 500, { input: 2, output: 10 });

        expect(tokens.input.count, 'input count').toBe(1000);
        expect(tokens.output.count, 'output count').toBe(500);
        expect(tokens.total.count, 'total count').toBe(1500);
        expect(tokens.input.price, 'input price per 1M').toBe(0.002);
        expect(tokens.output.price, 'output price per 1M').toBe(0.005);
        expect(tokens.total.price, 'total price').toBe(0.007);
      },
    },

    {
      name: 'build-tokens-treats-missing-usage-as-zero',
      async run({ expect }) {
        const tokens = buildTokens(undefined, undefined, { input: 2, output: 10 });

        expect(tokens, 'missing usage → zeroed report').toEqual(emptyTokens());
      },
    },

    {
      name: 'add-tokens-accumulates-calls-into-a-running-counter',
      async run({ expect }) {
        const running = emptyTokens();
        const modelConfig = { input: 10, output: 100 };

        addTokens(running, buildTokens(100000, 50000, modelConfig));
        addTokens(running, buildTokens(300000, 150000, modelConfig));

        expect(running.input.count, 'input counts summed').toBe(400000);
        expect(running.output.count, 'output counts summed').toBe(200000);
        expect(running.total.count, 'total count summed').toBe(600000);
        expect(running.input.price, 'input prices summed').toBe(4);
        expect(running.output.price, 'output prices summed').toBe(20);
        expect(running.total.price, 'total price summed').toBe(24);
      },
    },

    // ─── ai.request(): usage belongs to the call that made it ───

    {
      name: 'sequential-calls-each-report-only-their-own-usage',
      async run({ expect }) {
        const ai = makeAI();

        const first = await ai.request(SHORT_CALL);
        const second = await ai.request(SHORT_CALL);

        expect(second.tokens, 'identical calls report identical usage').toEqual(first.tokens);
        expect(ai.tokens.total.count, 'instance counter is the sum of both calls').toBe(first.tokens.total.count + second.tokens.total.count);
      },
    },

    {
      name: 'parallel-calls-report-their-own-usage-not-the-running-total',
      async run({ expect }) {
        // Reference: what each call reports with nothing else in flight
        const shortAlone = (await makeAI().request(SHORT_CALL)).tokens;
        const longAlone = (await makeAI().request(LONG_CALL)).tokens;

        expect(longAlone.input.count > shortAlone.input.count, 'the two calls have distinct usage').toBe(true);

        // Same AI instance, both in flight, resolving out of order (the long
        // call is delayed, so the short call finishes first)
        const ai = makeAI();
        const [long, short] = await Promise.all([
          ai.request(LONG_CALL),
          ai.request(SHORT_CALL),
        ]);

        expect(short.tokens, 'short caller reads its own response usage').toEqual(shortAlone);
        expect(long.tokens, 'long caller reads its own response usage').toEqual(longAlone);
        expect(short.tokens, 'callers do not share one tokens object').not.toBe(long.tokens);
        expect(ai.tokens.total.count, 'instance counter still totals every call').toBe(shortAlone.total.count + longAlone.total.count);
      },
    },

    {
      name: 'parallel-calls-do-not-mutate-an-earlier-callers-report',
      async run({ expect }) {
        const ai = makeAI();

        const first = await ai.request(SHORT_CALL);
        const snapshot = JSON.parse(JSON.stringify(first.tokens));

        await ai.request(LONG_CALL);

        expect(first.tokens, 'a later call cannot change an earlier report').toEqual(snapshot);
      },
    },
  ],
});
