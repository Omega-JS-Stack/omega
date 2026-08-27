/**
 * The opt-in real-Stripe test lane
 *
 * Every other payment suite proves the pipeline against a fabricated event. This
 * lane proves it against Stripe's own: real test-mode objects, real webhook
 * deliveries, real signatures, forwarded into the local emulator by the Stripe
 * CLI ([#212](https://github.com/Omega-JS-Stack/omega/issues/212)).
 *
 * It is OFF by default and stays off. It needs credentials and the network, so it
 * can never be part of a suite anybody runs without asking for it:
 * `npx omega test --lane=stripe-live` is the only way in, and a run that cannot
 * satisfy the gate prints ONE line saying which condition failed and exits clean.
 * A skipped lane is a normal outcome, not a failure.
 *
 * The gate, in order:
 *   1. A Stripe secret resolves through the ONE env reader
 *      ([../../../manager/libraries/env.js](../../../manager/libraries/env.js)),
 *      which outside production prefers `STRIPE_SECRET_KEY_DEV` and REFUSES a
 *      live-shaped credential outright ([#586]).
 *   2. That secret is test-shaped (`sk_test_`). The reader's refusal already
 *      catches `sk_live_`, and this catches everything else a key slot might
 *      hold — a restricted key, a publishable key, a paste of the wrong line.
 *   3. The Stripe CLI is installed, because the forwarding and the event triggers
 *      are its job.
 *
 * The FIXTURES are Stripe products and prices matching the brand's configured
 * catalogue, because `resolvePriceId()` matches on interval + amount and nothing
 * else — a price that is a cent off resolves to nothing. They are created
 * idempotently and tagged (`metadata.omega_lane`), so a second run reuses the
 * first run's objects instead of littering the account with duplicates.
 *
 * NOTHING here ever prints a secret. The gate's refusals name the KEY and the
 * fix; the forwarding hands its signing secret to the child process by env.
 */
const { execSync, spawn } = require('child_process');
const chalk = require('chalk').default;

const env = require('../../../manager/libraries/env.js');

// The lane's name, as `--lane=` spells it and as the runner reads it off the env
const LANE = 'stripe-live';

// The env var the lane sets for the runner child. The runner's discovery skips
// `test/stripe-live/` unless it names this lane, so the suites are unreachable by
// any run that did not deliberately ask for them.
const LANE_ENV = 'OMEGA_TEST_LANE';

// What a Stripe TEST secret key looks like. Restricted keys (`rk_test_`) are
// deliberately excluded: the lane creates products and prices, and a restricted
// key would fail deep inside the fixture step instead of at the gate.
const TEST_KEY_PREFIX = 'sk_test_';

// The tag every object this lane creates carries, and the key a rerun finds it by
const FIXTURE_TAG_KEY = 'omega_lane';

// Config frequency → Stripe recurring interval, the same map resolvePriceId uses
const FREQUENCY_TO_INTERVAL = { daily: 'day', weekly: 'week', monthly: 'month', annually: 'year' };

/**
 * Can this lane run here?
 *
 * A pure decision over the two facts that gate it, so the answer is testable
 * without a Stripe account and without the CLI installed. The `reason` is the one
 * line a skipped run prints, and it never contains a credential.
 *
 * @param {object} options
 * @param {object} options.env - The env reader (injected so a suite can drive it)
 * @param {boolean} options.hasStripeCli - Whether `stripe` is on PATH
 * @returns {{ ok: boolean, reason: string, key?: string }} The decision; `key` only when ok
 */
function resolveGate({ env: reader, hasStripeCli }) {
  let key;

  try {
    key = reader.get('STRIPE_SECRET_KEY');
  } catch (error) {
    // The reader refuses a LIVE credential outside production ([#586]). That is
    // exactly the refusal this lane wants — surfaced as a skip, because a lane
    // that would have charged a real card must not merely fail, it must not run.
    return { ok: false, reason: error.message };
  }

  if (!key) {
    return {
      ok: false,
      reason: 'no Stripe secret is configured — put the TEST key (sk_test_…) in STRIPE_SECRET_KEY_DEV in the brand .env and run `npx omega manage`',
    };
  }

  if (!key.startsWith(TEST_KEY_PREFIX)) {
    return {
      ok: false,
      reason: `the resolved Stripe secret is not a test secret key (expected ${TEST_KEY_PREFIX}…) — this lane creates products, prices and subscriptions, so it runs against a TEST account or not at all`,
    };
  }

  if (!hasStripeCli) {
    return {
      ok: false,
      reason: 'the Stripe CLI is not installed — this lane forwards real webhooks with `stripe listen` and fires events with `stripe trigger` (https://stripe.com/docs/stripe-cli)',
    };
  }

  return { ok: true, reason: 'ready', key: key };
}

/**
 * Is the Stripe CLI on PATH?
 *
 * @returns {string|null} Its path, or null when it is not installed
 */
function findStripeCli() {
  try {
    return execSync('which stripe', { encoding: 'utf8' }).trim() || null;
  } catch (error) {
    return null;
  }
}

/**
 * What this lane needs to exist in Stripe for a brand's catalogue
 *
 * `resolvePriceId()` finds a price by INTERVAL and AMOUNT among a product's active
 * prices, so a fixture is only useful if it matches the config to the cent. This
 * turns the config into that list — pure, so the mapping is testable without an
 * account, and so a product the lane cannot represent is named rather than
 * silently skipped.
 *
 * @param {object[]} products - `config.payment.products`
 * @param {string} currency - `config.payment.currency`
 * @returns {{ fixtures: object[], unsupported: object[] }} What to create, and what could not be mapped
 */
function planFixtures(products, currency) {
  const fixtures = [];
  const unsupported = [];

  for (const product of products || []) {
    if (product.id === 'basic' || product.archived) {
      continue;
    }

    const type = product.type || 'subscription';
    const prices = product.prices || {};

    if (type === 'subscription') {
      for (const [frequency, amount] of Object.entries(prices)) {
        const interval = FREQUENCY_TO_INTERVAL[frequency];

        if (!interval) {
          unsupported.push({ productId: product.id, reason: `unknown frequency '${frequency}'` });
          continue;
        }

        fixtures.push({
          productId: product.id,
          name: product.name || product.id,
          stripeProductId: product.stripe?.productId || null,
          interval: interval,
          frequency: frequency,
          // Stripe counts in the currency's MINOR unit, and resolvePriceId
          // compares `unit_amount` against exactly this arithmetic
          unitAmount: Math.round(Number(amount) * 100),
          currency: (currency || 'USD').toLowerCase(),
        });
      }

      continue;
    }

    if (!prices.once && prices.once !== 0) {
      unsupported.push({ productId: product.id, reason: 'a one-time product with no `once` price' });
      continue;
    }

    fixtures.push({
      productId: product.id,
      name: product.name || product.id,
      stripeProductId: product.stripe?.productId || null,
      interval: null,
      frequency: 'once',
      unitAmount: Math.round(Number(prices.once) * 100),
      currency: (currency || 'USD').toLowerCase(),
    });
  }

  return { fixtures, unsupported };
}

/**
 * Does an existing Stripe price already satisfy a planned fixture?
 *
 * The idempotency rule, kept beside the plan that produces it and pure for the
 * same reason: a rerun must REUSE what the first run made. The comparison is the
 * one `resolvePriceId()` performs, so "already satisfied" and "will resolve" are
 * the same question asked once.
 *
 * @param {object} fixture - One entry from planFixtures()
 * @param {object[]} prices - The product's active Stripe prices
 * @returns {object|null} The price that satisfies it, or null
 */
function findSatisfyingPrice(fixture, prices) {
  return (prices || []).find((price) => {
    if (price.unit_amount !== fixture.unitAmount) {
      return false;
    }

    return fixture.interval
      ? price.recurring?.interval === fixture.interval
      : !price.recurring;
  }) || null;
}

/**
 * Create the products and prices this lane needs, reusing anything already there
 *
 * @param {object} options
 * @param {object} options.stripe - An initialized Stripe SDK client
 * @param {object[]} options.fixtures - From planFixtures()
 * @param {function} options.log - Where progress goes
 * @returns {Promise<object[]>} Each fixture with the ids it resolved to
 */
async function ensureFixtures({ stripe, fixtures, log }) {
  const resolved = [];
  const productCache = new Map();

  for (const fixture of fixtures) {
    let productId = fixture.stripeProductId || productCache.get(fixture.productId) || null;

    if (!productId) {
      // The tag is what makes a rerun idempotent: the lane's own products are
      // the ones carrying it, and nothing else in the account is touched.
      const search = await stripe.products.search({
        query: `active:'true' AND metadata['${FIXTURE_TAG_KEY}']:'${fixture.productId}'`,
        limit: 1,
      });

      productId = search.data[0]?.id || null;
    }

    if (!productId) {
      const created = await stripe.products.create({
        name: fixture.name,
        metadata: { [FIXTURE_TAG_KEY]: fixture.productId },
      });

      productId = created.id;
      log(`created Stripe product ${productId} for ${fixture.productId}`);
    }

    productCache.set(fixture.productId, productId);

    const prices = [];
    for await (const price of stripe.prices.list({ product: productId, active: true, limit: 100 })) {
      prices.push(price);
    }

    let price = findSatisfyingPrice(fixture, prices);

    if (!price) {
      price = await stripe.prices.create({
        product: productId,
        currency: fixture.currency,
        unit_amount: fixture.unitAmount,
        ...(fixture.interval ? { recurring: { interval: fixture.interval } } : {}),
        metadata: { [FIXTURE_TAG_KEY]: fixture.productId },
      });

      log(`created Stripe price ${price.id} for ${fixture.productId}/${fixture.frequency}`);
    } else {
      log(`reusing Stripe price ${price.id} for ${fixture.productId}/${fixture.frequency}`);
    }

    resolved.push({ ...fixture, stripeProductId: productId, priceId: price.id });
  }

  return resolved;
}

/**
 * Start `stripe listen`, forwarding real deliveries into the local webhook route
 *
 * The signing secret it prints is what the route verifies against, so it is
 * captured and handed to the caller — never logged. Resolves once the CLI is
 * ready, so a trigger can never fire before the tunnel exists.
 *
 * @param {object} options
 * @param {string} options.stripePath - The Stripe CLI binary
 * @param {string} options.apiKey - The test secret key
 * @param {string} options.forwardUrl - The local webhook endpoint
 * @param {function} options.log - Where the CLI's own lines go
 * @param {number} [options.timeoutMs] - How long to wait for the secret
 * @returns {Promise<{ webhookSecret: string, stop: function }>}
 */
function startForwarding({ stripePath, apiKey, forwardUrl, log, timeoutMs = 30000 }) {
  return new Promise((resolve, reject) => {
    const child = spawn(stripePath, ['listen', '--forward-to', forwardUrl, '--api-key', apiKey], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let settled = false;
    const stop = () => { try { child.kill(); } catch (error) { /* already gone */ } };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      stop();
      reject(new Error(`stripe listen did not report a signing secret within ${timeoutMs}ms`));
    }, timeoutMs);

    const onLine = (line) => {
      const secret = readWebhookSecret(line);

      if (secret && !settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ webhookSecret: secret, stop });
        return;
      }

      // The secret line is the ONE line held back — everything else is the CLI
      // narrating deliveries, which is what a human watching this lane wants.
      if (!secret) {
        log(line);
      }
    };

    const consume = (stream) => stream.on('data', (data) => {
      data.toString().split('\n').map((l) => l.trim()).filter(Boolean).forEach(onLine);
    });

    consume(child.stdout);
    consume(child.stderr);

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
  });
}

/**
 * The webhook signing secret in a line of `stripe listen` output, if it holds one
 *
 * @param {string} line - One line of CLI output
 * @returns {string|null} The `whsec_…` secret, or null
 */
function readWebhookSecret(line) {
  const match = `${line}`.match(/whsec_[A-Za-z0-9]+/);
  return match ? match[0] : null;
}

/**
 * The local endpoint Stripe forwards to
 *
 * @param {object} options
 * @param {number} options.hostingPort - The resolved hosting port
 * @param {string} options.webhookKey - OMEGA_WEBHOOK_KEY, the route's shared param
 * @returns {string}
 */
function forwardUrl({ hostingPort, webhookKey }) {
  return `http://localhost:${hostingPort}/omega/payments/webhook?provider=stripe&key=${webhookKey}`;
}

/**
 * Fire one Stripe event through the forwarder
 *
 * `stripe trigger` is how the events with no other route in get here — a dispute,
 * a failed renewal invoice, a trial ending. Stripe's own fixture objects carry no
 * `metadata.uid`, and the pipeline refuses an event it cannot attribute
 * ([#399](https://github.com/Omega-JS-Stack/omega/issues/399)), so every trigger
 * takes the overrides that put one on.
 *
 * @param {object} options
 * @param {string} options.stripePath - The Stripe CLI binary
 * @param {string} options.apiKey - The test secret key
 * @param {string} options.event - The event type to trigger
 * @param {string[]} [options.overrides] - `--override`/`--add` arguments, e.g. `subscription:metadata.uid=…`
 * @returns {Promise<void>}
 */
function trigger({ stripePath, apiKey, event, overrides = [] }) {
  return new Promise((resolve, reject) => {
    const args = ['trigger', event, '--api-key', apiKey];

    for (const override of overrides) {
      args.push('--add', override);
    }

    const child = spawn(stripePath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';

    child.stderr.on('data', (data) => { stderr += data.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`stripe trigger ${event} exited ${code}: ${stderr.trim()}`));
    });
  });
}

/**
 * The one line a skipped lane prints
 *
 * @param {string} reason - From resolveGate()
 * @returns {string}
 */
function skipLine(reason) {
  return chalk.yellow(`  ⏭  Lane --lane=${LANE} SKIPPED: ${reason}`);
}

module.exports = {
  LANE,
  LANE_ENV,
  TEST_KEY_PREFIX,
  FIXTURE_TAG_KEY,
  FREQUENCY_TO_INTERVAL,
  resolveGate,
  findStripeCli,
  planFixtures,
  findSatisfyingPrice,
  ensureFixtures,
  startForwarding,
  readWebhookSecret,
  forwardUrl,
  trigger,
  skipLine,
  env,
};
