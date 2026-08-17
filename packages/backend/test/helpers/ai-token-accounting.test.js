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
const AI = require('../../src/manager/libraries/ai/index.js');
const { emptyTokens, buildTokens, addTokens } = require('../../src/manager/libraries/ai/tokens.js');

// No Manager — the test provider falls back to the OMEGA_TEST_MODE signal, which
// the test runner sets
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

module.exports = {
  description: 'AI token accounting (per-call usage, parallel callers)',
  type: 'group',
  tests: [
    // ─── tokens.js pure helpers ───

    {
      name: 'build-tokens-computes-counts-and-prices-for-one-call',
      async run({ assert }) {
        const tokens = buildTokens(1000, 500, { input: 2, output: 10 });

        assert.equal(tokens.input.count, 1000, 'input count');
        assert.equal(tokens.output.count, 500, 'output count');
        assert.equal(tokens.total.count, 1500, 'total count');
        assert.equal(tokens.input.price, 0.002, 'input price per 1M');
        assert.equal(tokens.output.price, 0.005, 'output price per 1M');
        assert.equal(tokens.total.price, 0.007, 'total price');
      },
    },

    {
      name: 'build-tokens-treats-missing-usage-as-zero',
      async run({ assert }) {
        const tokens = buildTokens(undefined, undefined, { input: 2, output: 10 });

        assert.deepEqual(tokens, emptyTokens(), 'missing usage → zeroed report');
      },
    },

    {
      name: 'add-tokens-accumulates-calls-into-a-running-counter',
      async run({ assert }) {
        const running = emptyTokens();
        const modelConfig = { input: 10, output: 100 };

        addTokens(running, buildTokens(100000, 50000, modelConfig));
        addTokens(running, buildTokens(300000, 150000, modelConfig));

        assert.equal(running.input.count, 400000, 'input counts summed');
        assert.equal(running.output.count, 200000, 'output counts summed');
        assert.equal(running.total.count, 600000, 'total count summed');
        assert.equal(running.input.price, 4, 'input prices summed');
        assert.equal(running.output.price, 20, 'output prices summed');
        assert.equal(running.total.price, 24, 'total price summed');
      },
    },

    // ─── ai.request(): usage belongs to the call that made it ───

    {
      name: 'sequential-calls-each-report-only-their-own-usage',
      async run({ assert }) {
        const ai = makeAI();

        const first = await ai.request(SHORT_CALL);
        const second = await ai.request(SHORT_CALL);

        assert.deepEqual(second.tokens, first.tokens, 'identical calls report identical usage');
        assert.equal(
          ai.tokens.total.count,
          first.tokens.total.count + second.tokens.total.count,
          'instance counter is the sum of both calls',
        );
      },
    },

    {
      name: 'parallel-calls-report-their-own-usage-not-the-running-total',
      async run({ assert }) {
        // Reference: what each call reports with nothing else in flight
        const shortAlone = (await makeAI().request(SHORT_CALL)).tokens;
        const longAlone = (await makeAI().request(LONG_CALL)).tokens;

        assert.equal(longAlone.input.count > shortAlone.input.count, true, 'the two calls have distinct usage');

        // Same AI instance, both in flight, resolving out of order (the long
        // call is delayed, so the short call finishes first)
        const ai = makeAI();
        const [long, short] = await Promise.all([
          ai.request(LONG_CALL),
          ai.request(SHORT_CALL),
        ]);

        assert.deepEqual(short.tokens, shortAlone, 'short caller reads its own response usage');
        assert.deepEqual(long.tokens, longAlone, 'long caller reads its own response usage');
        assert.notEqual(short.tokens, long.tokens, 'callers do not share one tokens object');
        assert.equal(
          ai.tokens.total.count,
          shortAlone.total.count + longAlone.total.count,
          'instance counter still totals every call',
        );
      },
    },

    {
      name: 'parallel-calls-do-not-mutate-an-earlier-callers-report',
      async run({ assert }) {
        const ai = makeAI();

        const first = await ai.request(SHORT_CALL);
        const snapshot = JSON.parse(JSON.stringify(first.tokens));

        await ai.request(LONG_CALL);

        assert.deepEqual(first.tokens, snapshot, 'a later call cannot change an earlier report');
      },
    },
  ],
};
