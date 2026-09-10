/**
 * Test: an order id nobody already holds
 * ([#664](https://github.com/Omega-JS-Stack/omega/issues/664)).
 *
 * `generate()` mints 12 random digits and the intent route wrote
 * `payments-intents/<orderId>` with no existence check at all, so a collision
 * OVERWROTE another customer's intent — and handed the two purchases the same
 * analytics dedupe id. About 1 in 20,000 across 10,000 orders, and it grows with
 * volume.
 *
 * `mint()` is the answer: generate, check, retry, and give up LOUDLY rather than
 * hand back an id that is already taken. The generator is injectable, which is
 * the only way to make a collision happen on demand — a random 12-digit repeat
 * cannot be waited for.
 *
 * The in-memory Firestore stand-in is the webhook suites' own (`buildAdmin`), so
 * the existence check runs against real read semantics with no emulator.
 *
 * Run: npx omega test framework:helpers/payment/order-id
 */
const OrderId = require('../../../dist/manager/libraries/payment/order-id.js');
const { buildAdmin } = require('../../events/payments/_webhook-harness.js');
const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');

const TAKEN = '1111-2222-3333';
const FREE = '4444-5555-6666';

/** A generator that hands back each id in turn, then repeats the last one */
function scripted(ids) {
  let index = 0;

  return () => ids[Math.min(index++, ids.length - 1)];
}

function context() {
  const logs = [];
  const { admin } = buildAdmin({ seed: { [`payments-intents/${TAKEN}`]: { id: TAKEN, owner: 'somebody-else' } } });

  return {
    logs: logs,
    admin: admin,
    ctx: {
      log: (...args) => logs.push(args.join(' ')),
      warn: (...args) => logs.push(args.join(' ')),
      error: (...args) => logs.push(args.join(' ')),
    },
  };
}

module.exports = defineCases({
  description: 'Order ids are minted against the intents that already exist',
  type: 'group',

  tests: [
    {
      name: 'an-unused-id-is-handed-back-on-the-first-try',
      async run({ assert }) {
        const { admin, ctx, logs } = context();

        const orderId = await OrderId.mint({ admin, ctx, generate: scripted([FREE]) });

        assert.equal(orderId, FREE, 'An id no intent holds is the id the checkout gets');
        assert.equal(logs.length, 0, `Nothing to say about an uncontended mint, got: ${logs.join(' | ')}`);
      },
    },

    {
      name: 'a-duplicate-is-thrown-away-and-the-next-id-is-used',
      async run({ assert }) {
        const { admin, ctx, logs } = context();

        // The collision, on demand: the first id is one an intent already holds
        const orderId = await OrderId.mint({ admin, ctx, generate: scripted([TAKEN, FREE]) });

        assert.equal(orderId, FREE, 'The taken id is never handed out — the next one is');
        assert.ok(
          logs.some((line) => line.includes(TAKEN) && /collision/i.test(line)),
          `The collision must be recorded, got: ${logs.join(' | ')}`,
        );
      },
    },

    {
      name: 'a-generator-that-only-ever-collides-fails-loudly',
      async run({ assert }) {
        const { admin, ctx } = context();

        // Never silently: an id that is already an intent would overwrite the
        // purchase behind it, so an exhausted mint is an error, not a fallback.
        let thrown = null;

        await OrderId.mint({ admin, ctx, generate: scripted([TAKEN]) }).catch((e) => { thrown = e; });

        assert.ok(thrown, 'Exhausting every attempt must throw rather than return a taken id');
        assert.match(thrown.message, /order id/i, `The error should say what could not be minted, got: ${thrown?.message}`);
      },
    },
  ],
});
