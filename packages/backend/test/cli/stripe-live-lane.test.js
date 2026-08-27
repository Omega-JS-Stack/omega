/**
 * Test: the opt-in real-Stripe lane's gate and its fixture plan
 *
 * The lane runs real Stripe API calls and forwards real webhooks, so the two
 * things that decide whether it runs at all — and what it creates when it does —
 * are pure functions, testable with no account, no CLI and no network
 * ([#212](https://github.com/Omega-JS-Stack/omega/issues/212)).
 *
 * The GATE is the safety property. A lane that ran with the wrong credential
 * would charge a real card, so every refusal is pinned here: no key, a key that
 * is not test-shaped, the ONE reader's own live-credential refusal (#586), and a
 * missing CLI. And the refusals are pinned to say the KEY and the fix and never
 * the value — a lane that printed a secret to explain itself would be a worse
 * bug than the one it prevents.
 *
 * The FIXTURE PLAN is the correctness property. `resolvePriceId()` matches a
 * config price to a Stripe price by interval and amount and NOTHING else, so a
 * plan that is a cent off or names the wrong interval produces fixtures that can
 * never resolve — a failure that would otherwise surface as a broken checkout.
 *
 * Run: npx omega test backend:cli/stripe-live-lane
 */
const assert = require('node:assert');

const lane = require('../../src/cli/commands/test-lanes/stripe-live.js');

/** An env reader stand-in: the ONE reader's surface, answering what a suite says */
function reader(answer) {
  return {
    get: () => {
      if (answer instanceof Error) {
        throw answer;
      }

      return answer;
    },
  };
}

/** The live-credential refusal the real reader throws outside production (#586) */
function liveRefusal() {
  const error = new Error('STRIPE_SECRET_KEY holds a LIVE credential and this process is running in testing — refusing to use it. Put the provider\'s TEST credential in STRIPE_SECRET_KEY_DEV');
  error.name = 'LiveSecretOutsideProductionError';
  return error;
}

const CATALOGUE = [
  { id: 'basic', name: 'Basic', type: 'subscription' },
  { id: 'premium', name: 'Premium', type: 'subscription', prices: { monthly: 4.99, annually: 49.99 } },
  { id: 'credits', name: 'Credits', type: 'one-time', prices: { once: 9.5 } },
  { id: 'legacy', name: 'Legacy', type: 'subscription', prices: { monthly: 1 }, archived: true },
];

module.exports = {
  description: 'The stripe-live lane: the gate that keeps it shut, and the fixtures it plans',
  type: 'group',
  timeout: 30000,

  tests: [
    // ─── The gate ───

    {
      name: 'a-test-key-and-a-cli-open-the-lane',

      async run() {
        const decision = lane.resolveGate({ env: reader('sk_test_abc123'), hasStripeCli: true });

        assert.equal(decision.ok, true, 'a test secret key with the CLI installed is the whole requirement');
        assert.equal(decision.key, 'sk_test_abc123', 'and the resolved key rides along, so nothing reads it twice');
      },
    },

    {
      name: 'no-key-keeps-the-lane-shut',

      async run() {
        for (const answer of [undefined, null, '']) {
          const decision = lane.resolveGate({ env: reader(answer), hasStripeCli: true });

          assert.equal(decision.ok, false, `a ${JSON.stringify(answer)} secret must not open the lane`);
          assert.ok(decision.reason.includes('STRIPE_SECRET_KEY_DEV'), `the skip line names the slot to put the key in, got: ${decision.reason}`);
        }
      },
    },

    {
      name: 'a-live-key-keeps-the-lane-shut-through-the-one-reader',

      async run() {
        // The reader refuses a live credential outside production before this
        // lane ever sees it (#586). The lane's job is to surface that as a SKIP,
        // not to crash — and certainly not to catch it and carry on.
        const decision = lane.resolveGate({ env: reader(liveRefusal()), hasStripeCli: true });

        assert.equal(decision.ok, false, 'a live credential must never open a lane that creates subscriptions');
        assert.ok(decision.reason.includes('LIVE'), `the skip line carries the reader's own words, got: ${decision.reason}`);
      },
    },

    {
      name: 'anything-that-is-not-a-test-secret-key-keeps-the-lane-shut',

      async run() {
        // The shapes a key slot picks up in practice: a restricted key (cannot
        // create products), a publishable key (pasted from the wrong line), a
        // live key the reader was never asked about.
        for (const key of ['rk_test_abc', 'pk_test_abc', 'sk_live_abc', 'whsec_abc', 'nonsense']) {
          const decision = lane.resolveGate({ env: reader(key), hasStripeCli: true });

          assert.equal(decision.ok, false, `${key.split('_')[0]}_… must not open the lane`);
          assert.ok(decision.reason.includes(lane.TEST_KEY_PREFIX), `the skip line says what shape is required, got: ${decision.reason}`);
        }
      },
    },

    {
      name: 'no-stripe-cli-keeps-the-lane-shut',

      async run() {
        const decision = lane.resolveGate({ env: reader('sk_test_abc123'), hasStripeCli: false });

        assert.equal(decision.ok, false, 'the lane forwards with the CLI — without it there is nothing to forward');
        assert.ok(decision.reason.includes('stripe.com/docs/stripe-cli'), `the skip line says how to install it, got: ${decision.reason}`);
      },
    },

    {
      name: 'no-refusal-ever-prints-the-secret',

      async run() {
        // The one rule that outranks helpfulness here. Every reason is a line a
        // human reads out of a terminal, and terminals get pasted into issues.
        const secret = 'sk_live_SUPERSECRETVALUE';

        for (const key of [secret, 'rk_test_ANOTHERSECRET', 'pk_test_THIRDSECRET']) {
          const decision = lane.resolveGate({ env: reader(key), hasStripeCli: true });

          assert.equal(decision.ok, false, `${key} should be refused`);
          assert.ok(!decision.reason.includes(key), `the skip line must never quote the credential, got: ${decision.reason}`);
        }

        assert.ok(!lane.skipLine('a reason').includes('sk_'), 'and the printed line carries only the reason');
      },
    },

    // ─── The fixture plan ───

    {
      name: 'the-plan-covers-every-price-a-brand-configures',

      async run() {
        const { fixtures } = lane.planFixtures(CATALOGUE, 'USD');
        const ids = fixtures.map((f) => `${f.productId}/${f.frequency}`).sort();

        assert.deepEqual(
          ids,
          ['credits/once', 'premium/annually', 'premium/monthly'],
          'every priced, unarchived, non-basic product needs a fixture — and basic and archived need none',
        );
      },
    },

    {
      name: 'the-plan-matches-what-resolvePriceId-looks-for',

      async run() {
        // The whole point: resolvePriceId() compares `unit_amount` against
        // Math.round(price * 100) and `recurring.interval` against the mapped
        // frequency. A fixture that does not carry exactly those two can never
        // be found, however correct it looks in the dashboard.
        const { fixtures } = lane.planFixtures(CATALOGUE, 'USD');

        const monthly = fixtures.find((f) => f.productId === 'premium' && f.frequency === 'monthly');
        assert.equal(monthly.unitAmount, 499, '$4.99 is 499 minor units');
        assert.equal(monthly.interval, 'month', 'monthly maps to Stripe\'s `month`');

        const annually = fixtures.find((f) => f.frequency === 'annually');
        assert.equal(annually.unitAmount, 4999, '$49.99 is 4999 minor units');
        assert.equal(annually.interval, 'year', 'annually maps to Stripe\'s `year` — not `annual`');

        const once = fixtures.find((f) => f.frequency === 'once');
        assert.equal(once.unitAmount, 950, '$9.50 is 950 minor units, not 95');
        assert.equal(once.interval, null, 'a one-time price has no recurring interval at all');

        assert.ok(fixtures.every((f) => f.currency === 'usd'), 'Stripe wants the currency lower-cased');
      },
    },

    {
      name: 'a-product-the-plan-cannot-represent-is-named-not-dropped',

      async run() {
        const { fixtures, unsupported } = lane.planFixtures([
          { id: 'odd', name: 'Odd', type: 'subscription', prices: { fortnightly: 3 } },
          { id: 'empty', name: 'Empty', type: 'one-time', prices: {} },
        ], 'USD');

        assert.equal(fixtures.length, 0, 'neither can be represented');
        assert.equal(unsupported.length, 2, 'and both are reported rather than silently skipped');
        assert.ok(unsupported[0].reason.includes('fortnightly'), `the reason names the frequency, got: ${unsupported[0].reason}`);
        assert.ok(unsupported[1].reason.includes('once'), `the reason names the missing price, got: ${unsupported[1].reason}`);
      },
    },

    // ─── Idempotency ───

    {
      name: 'an-existing-price-satisfies-a-fixture-so-a-rerun-creates-nothing',

      async run() {
        const [monthly] = lane.planFixtures([CATALOGUE[1]], 'USD').fixtures;

        const existing = [
          { id: 'price_wrong_amount', unit_amount: 500, recurring: { interval: 'month' } },
          { id: 'price_wrong_interval', unit_amount: 499, recurring: { interval: 'year' } },
          { id: 'price_right', unit_amount: 499, recurring: { interval: 'month' } },
        ];

        assert.equal(lane.findSatisfyingPrice(monthly, existing).id, 'price_right', 'a rerun reuses the price the first run made');
        assert.equal(lane.findSatisfyingPrice(monthly, []), null, 'and a first run finds nothing to reuse');
        assert.equal(
          lane.findSatisfyingPrice(monthly, [{ id: 'price_once', unit_amount: 499 }]),
          null,
          'a one-time price never satisfies a recurring fixture, however right the amount',
        );
      },
    },

    {
      name: 'a-one-time-fixture-is-satisfied-only-by-a-non-recurring-price',

      async run() {
        const [once] = lane.planFixtures([CATALOGUE[2]], 'USD').fixtures;

        assert.equal(lane.findSatisfyingPrice(once, [{ id: 'price_sub', unit_amount: 950, recurring: { interval: 'month' } }]), null, 'a subscription price is not a one-time price');
        assert.equal(lane.findSatisfyingPrice(once, [{ id: 'price_once', unit_amount: 950 }]).id, 'price_once', 'a bare price at the right amount is');
      },
    },

    // ─── The forwarder's secret ───

    {
      name: 'the-signing-secret-is-read-out-of-the-cli-line-that-carries-it',

      async run() {
        // `stripe listen` prints the endpoint secret once, in a sentence. That
        // secret is what the route verifies every forwarded delivery against, so
        // missing it would silently drop the run onto the key-only path — green,
        // and proving nothing about signatures.
        assert.equal(
          lane.readWebhookSecret('> Ready! You are using Stripe API Version [2024-06-20]. Your webhook signing secret is whsec_abc123XYZ (^C to quit)'),
          'whsec_abc123XYZ',
          'the secret is read out of the ready line',
        );
        assert.equal(lane.readWebhookSecret('2026-08-25 22:00:00  --> customer.subscription.created [evt_1]'), null, 'a delivery line carries none');
        assert.equal(lane.readWebhookSecret(''), null, 'and neither does an empty one');
      },
    },

    // ─── The lane stays shut to the default run ───

    {
      name: 'the-lanes-suites-are-unreachable-without-the-gate',

      async run() {
        // The exclusion is a STRING MATCH between the directory the suites live
        // in and the lane's own name, in two files. Drift either one and the
        // lane's suites either vanish from every run or, worse, join the default
        // one — which is a suite hitting a real payment API because a folder was
        // renamed.
        const TestRunner = require('../../src/test/runner.js');

        assert.ok(
          TestRunner.LANE_DIRECTORIES.has(lane.LANE),
          `the runner must skip test/${lane.LANE}/ by default — its lane list holds ${[...TestRunner.LANE_DIRECTORIES].join(', ')}`,
        );
        assert.equal(lane.LANE_ENV, 'OMEGA_TEST_LANE', 'and the runner reads the open lane off exactly this env var');
      },
    },

    {
      name: 'the-forward-url-is-the-real-webhook-door',

      async run() {
        const url = lane.forwardUrl({ hostingPort: 5099, webhookKey: '_test-key' });

        assert.ok(url.startsWith('http://localhost:5099/omega/payments/webhook'), `the lane forwards to the route itself, got ${url}`);
        assert.ok(url.includes('provider=stripe'), 'as the STRIPE provider — the whole point is that nothing is simulated');
        assert.ok(url.includes('key=_test-key'), 'carrying the shared key the route also checks');
      },
    },
  ],
};
