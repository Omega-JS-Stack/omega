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
const expect = require('../../dist/vendor/devkit/test/expect.js');

const lane = require('../../dist/cli/commands/test-lanes/stripe-live.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

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

/** A reader fault the lane must surface as a skip rather than a crash */
function readerFault() {
  const error = new Error('STRIPE_SECRET_KEY is not declared in the env schema');
  error.name = 'UnknownEnvKeyError';
  return error;
}

const CATALOGUE = [
  { id: 'basic', name: 'Basic', type: 'subscription' },
  { id: 'premium', name: 'Premium', type: 'subscription', prices: { monthly: 4.99, annually: 49.99 } },
  { id: 'credits', name: 'Credits', type: 'one-time', prices: { once: 9.5 } },
  { id: 'legacy', name: 'Legacy', type: 'subscription', prices: { monthly: 1 }, archived: true },
];

module.exports = defineCases({
  description: 'The stripe-live lane: the gate that keeps it shut, and the fixtures it plans',
  type: 'group',
  timeout: 30000,

  tests: [
    // ─── The gate ───

    {
      name: 'a-test-key-and-a-cli-open-the-lane',

      async run() {
        const decision = lane.resolveGate({ env: reader('sk_test_abc123'), hasStripeCli: true });

        expect(decision.ok, 'a test secret key with the CLI installed is the whole requirement').toBe(true);
        expect(decision.key, 'and the resolved key rides along, so nothing reads it twice').toBe('sk_test_abc123');
      },
    },

    {
      name: 'no-key-keeps-the-lane-shut',

      async run() {
        for (const answer of [undefined, null, '']) {
          const decision = lane.resolveGate({ env: reader(answer), hasStripeCli: true });

          expect(decision.ok, `a ${JSON.stringify(answer)} secret must not open the lane`).toBe(false);
          expect(decision.reason.includes('.env.testing'), `the skip line names the overlay to put the key in, got: ${decision.reason}`).toBeTruthy();
        }
      },
    },

    {
      name: 'a-live-key-keeps-the-lane-shut',

      async run() {
        // #586 retired the reader's live-shape refusal: the `.env.testing`
        // overlay is where a test credential goes, and every value is trusted.
        // The `sk_test_` gate below is what keeps a live key out of a lane that
        // creates subscriptions — it is the ONLY latch now, so it is pinned
        // against every live shape a Stripe key can carry.
        for (const live of ['sk_live_abc123', 'rk_live_abc123']) {
          const decision = lane.resolveGate({ env: reader(live), hasStripeCli: true });

          expect(decision.ok, `${live} must never open a lane that creates subscriptions`).toBe(false);
          expect(decision.reason.includes('sk_test_'), `the skip line names what it wanted, got: ${decision.reason}`).toBeTruthy();
        }

        // A reader FAULT is surfaced as a skip too, not a crash
        const faulted = lane.resolveGate({ env: reader(readerFault()), hasStripeCli: true });

        expect(faulted.ok, 'a lane that cannot resolve its key must not run').toBe(false);
        expect(faulted.reason.includes('STRIPE_SECRET_KEY'), `the skip line carries the reader's own words, got: ${faulted.reason}`).toBeTruthy();
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

          expect(decision.ok, `${key.split('_')[0]}_… must not open the lane`).toBe(false);
          expect(decision.reason.includes(lane.TEST_KEY_PREFIX), `the skip line says what shape is required, got: ${decision.reason}`).toBeTruthy();
        }
      },
    },

    {
      name: 'no-stripe-cli-keeps-the-lane-shut',

      async run() {
        const decision = lane.resolveGate({ env: reader('sk_test_abc123'), hasStripeCli: false });

        expect(decision.ok, 'the lane forwards with the CLI — without it there is nothing to forward').toBe(false);
        expect(decision.reason.includes('stripe.com/docs/stripe-cli'), `the skip line says how to install it, got: ${decision.reason}`).toBeTruthy();
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

          expect(decision.ok, `${key} should be refused`).toBe(false);
          expect(!decision.reason.includes(key), `the skip line must never quote the credential, got: ${decision.reason}`).toBeTruthy();
        }

        expect(!lane.skipLine('a reason').includes('sk_'), 'and the printed line carries only the reason').toBeTruthy();
      },
    },

    // ─── The fixture plan ───

    {
      name: 'the-plan-covers-every-price-a-brand-configures',

      async run() {
        const { fixtures } = lane.planFixtures(CATALOGUE, 'USD');
        const ids = fixtures.map((f) => `${f.productId}/${f.frequency}`).sort();

        expect(ids, 'every priced, unarchived, non-basic product needs a fixture — and basic and archived need none').toEqual(['credits/once', 'premium/annually', 'premium/monthly']);
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
        expect(monthly.unitAmount, '$4.99 is 499 minor units').toBe(499);
        expect(monthly.interval, 'monthly maps to Stripe\'s `month`').toBe('month');

        const annually = fixtures.find((f) => f.frequency === 'annually');
        expect(annually.unitAmount, '$49.99 is 4999 minor units').toBe(4999);
        expect(annually.interval, 'annually maps to Stripe\'s `year` — not `annual`').toBe('year');

        const once = fixtures.find((f) => f.frequency === 'once');
        expect(once.unitAmount, '$9.50 is 950 minor units, not 95').toBe(950);
        expect(once.interval, 'a one-time price has no recurring interval at all').toBe(null);

        expect(fixtures.every((f) => f.currency === 'usd'), 'Stripe wants the currency lower-cased').toBeTruthy();
      },
    },

    {
      name: 'a-product-the-plan-cannot-represent-is-named-not-dropped',

      async run() {
        const { fixtures, unsupported } = lane.planFixtures([
          { id: 'odd', name: 'Odd', type: 'subscription', prices: { fortnightly: 3 } },
          { id: 'empty', name: 'Empty', type: 'one-time', prices: {} },
        ], 'USD');

        expect(fixtures.length, 'neither can be represented').toBe(0);
        expect(unsupported.length, 'and both are reported rather than silently skipped').toBe(2);
        expect(unsupported[0].reason.includes('fortnightly'), `the reason names the frequency, got: ${unsupported[0].reason}`).toBeTruthy();
        expect(unsupported[1].reason.includes('once'), `the reason names the missing price, got: ${unsupported[1].reason}`).toBeTruthy();
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

        expect(lane.findSatisfyingPrice(monthly, existing).id, 'a rerun reuses the price the first run made').toBe('price_right');
        expect(lane.findSatisfyingPrice(monthly, []), 'and a first run finds nothing to reuse').toBe(null);
        expect(lane.findSatisfyingPrice(monthly, [{ id: 'price_once', unit_amount: 499 }]), 'a one-time price never satisfies a recurring fixture, however right the amount').toBe(null);
      },
    },

    {
      name: 'a-one-time-fixture-is-satisfied-only-by-a-non-recurring-price',

      async run() {
        const [once] = lane.planFixtures([CATALOGUE[2]], 'USD').fixtures;

        expect(lane.findSatisfyingPrice(once, [{ id: 'price_sub', unit_amount: 950, recurring: { interval: 'month' } }]), 'a subscription price is not a one-time price').toBe(null);
        expect(lane.findSatisfyingPrice(once, [{ id: 'price_once', unit_amount: 950 }]).id, 'a bare price at the right amount is').toBe('price_once');
      },
    },

    // ─── The forwarder's readiness ───

    {
      name: 'the-forwarder-is-ready-only-on-the-cli-line-that-says-so',

      async run() {
        // The tunnel exists only once `stripe listen` says it does — resolving
        // earlier would let a trigger fire into nothing. That same line also
        // carries the CLI's signing secret, which is why it is never logged.
        expect(lane.isReadyLine('> Ready! You are using Stripe API Version [2024-06-20]. Your webhook signing secret is whsec_abc123XYZ (^C to quit)'), 'the ready line opens the gate').toBe(true);
        expect(lane.isReadyLine('2026-08-25 22:00:00  --> customer.subscription.created [evt_1]'), 'a delivery line does not').toBe(false);
        expect(lane.isReadyLine(''), 'and neither does an empty one').toBe(false);
      },
    },

    // ─── The lane stays shut to the default run ───

    {
      name: 'the-lanes-suites-are-unreachable-without-the-gate',

      async run() {
        // The runner keeps test/<lane>/ out of a default run by matching the
        // directory against the lanes the manifest declares. Drift the two
        // apart and the lane either vanishes from every run or joins the
        // default one, a suite hitting a real payment API.
        const { declaredLanes } = require('../../dist/utils/test-lanes.js');

        expect(declaredLanes(), `the runner must skip test/${lane.LANE}/ by default; the declared lanes are ${declaredLanes().join(', ')}`).toContain(lane.LANE);
        expect(lane.LANE_ENV, 'and the runner reads the open lane off exactly this env var').toBe('OMEGA_TEST_LANE');
      },
    },

    {
      name: 'the-forward-url-is-the-real-webhook-door',

      async run() {
        const url = lane.forwardUrl({ hostingPort: 5099, webhookKey: '_test-key' });

        expect(url.startsWith('http://localhost:5099/omega/payments/webhook'), `the lane forwards to the route itself, got ${url}`).toBeTruthy();
        expect(url.includes('provider=stripe'), 'as the STRIPE provider — the whole point is that nothing is simulated').toBeTruthy();
        expect(url.includes('key=_test-key'), 'carrying the shared key the route also checks').toBeTruthy();
      },
    },
  ],
});
