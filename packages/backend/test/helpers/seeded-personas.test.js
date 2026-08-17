const { TEST_ACCOUNTS, getAccountDefinitions, getFirstPaidProduct, buildOrderFixture } = require('../../src/test/test-accounts.js');
const isTrialing = require('../../src/manager/routes/payments/cancel/_is-trialing.js');

/**
 * Test: the seeded personas' billing data ([#263](https://github.com/Omega-JS-Stack/omega/issues/263))
 *
 * A persona that HOLDS a paid plan is a persona that BOUGHT one, and a purchase
 * leaves three marks: a price and a cadence the brand actually sells, a term that
 * ends when the billing cycle does, and an order record behind it. A hollow seed
 * (no price, no cadence, an expiry a decade out, an orderId naming a document that
 * was never written) renders as an empty billing panel and answers a cancel with a
 * plan nobody sells.
 *
 * And every persona is a FULL account ([#327](https://github.com/Omega-JS-Stack/omega/issues/327)),
 * journey ones included: identical in shape AND in substance to a real user, so QA
 * signed in as one sees exactly what a customer sees. The completeness cases below
 * are what stops a persona added tomorrow from arriving half-built.
 *
 * PURE: reads the seeder's own definitions against the brand catalog — no emulator,
 * no Firestore. What it pins is the SEED, which is what every payment suite and the
 * dev palette start from.
 *
 * Run: npx omega test helpers/seeded-personas
 */
module.exports = {
  description: 'Seeded personas carry legitimate billing data',
  type: 'group',
  auth: 'none',

  tests: [
    // A persona holding a paid plan — or carrying a purchase record for one it
    // has since lapsed from — quotes the catalog's own price and cadence.
    {
      name: 'purchased-personas-quote-the-catalog',
      async run({ assert, config, skip }) {
        if (!paidPlan(config)) {
          skip('No paid subscription product configured in this brand');
        }

        const definitions = getAccountDefinitions('example.com', config);
        const purchased = Object.entries(definitions).filter(([, definition]) => isPurchase(definition.properties?.subscription));

        assert.ok(purchased.length > 0, 'The seeder must define personas that bought a subscription');

        for (const [key, definition] of purchased) {
          const subscription = definition.properties.subscription;
          const payment = subscription.payment || {};
          const plan = planBought(subscription, config);

          assert.ok(plan, `Persona '${key}' names a plan the catalog does not carry`);
          assert.ok(
            payment.frequency && plan.prices[payment.frequency] !== undefined,
            `Persona '${key}' must be billed at a cadence the catalog sells ${plan.id} at (got ${payment.frequency})`,
          );
          assert.equal(
            payment.price,
            plan.prices[payment.frequency],
            `Persona '${key}' must quote the catalog price for ${plan.id}/${payment.frequency}`,
          );
          assert.ok(payment.price > 0, `Persona '${key}' bought a paid plan, so its price cannot be 0`);
        }
      },
    },

    // A live term runs to the end of the cycle it is being billed on — not to a
    // date a decade away no real processor would ever record.
    {
      name: 'live-terms-end-with-the-billing-cycle',
      async run({ assert, config }) {
        const definitions = getAccountDefinitions('example.com', config);
        const nowUNIX = Math.floor(Date.now() / 1000);

        for (const [key, definition] of Object.entries(definitions)) {
          const subscription = definition.properties?.subscription;
          const expiresUNIX = subscription?.expires?.timestampUNIX;

          // Lapsed and never-subscribed personas are out: a past expiry (or none
          // at all) is exactly what they are seeded to represent.
          if (!expiresUNIX || expiresUNIX <= nowUNIX) {
            continue;
          }

          const cadence = subscription.payment?.frequency || 'monthly';
          const cycleDays = { daily: 1, weekly: 7, monthly: 30, annually: 365 }[cadence];
          const remaining = (expiresUNIX - nowUNIX) / 86400;

          assert.ok(cycleDays, `Persona '${key}' is billed at an unknown cadence (${cadence})`);
          assert.ok(
            remaining <= cycleDays + 1,
            `Persona '${key}' expires ${Math.round(remaining)} days out — a ${cadence} term ends within ${cycleDays}`,
          );
        }
      },
    },

    // The orderId on a seeded subscription names a purchase record the backend
    // reads back (the test cancel processor's plan lookup, the test webhook
    // library's resource rebuild, the per-owner trial-eligibility query). Every
    // one of them must have a fixture behind it.
    {
      name: 'every-seeded-orderid-has-an-order-fixture',
      async run({ assert, config, skip }) {
        if (!paidPlan(config)) {
          skip('No paid subscription product configured in this brand');
        }

        const paidProduct = getFirstPaidProduct(config);
        const definitions = getAccountDefinitions('example.com', config);
        const seeded = Object.entries(TEST_ACCOUNTS).filter(([, account]) => account.properties?.subscription?.payment?.orderId);

        assert.ok(seeded.length > 0, 'The seeder must define personas whose subscription names an order');

        for (const [key, account] of seeded) {
          const orderId = account.properties.subscription.payment.orderId;
          const held = definitions[key].properties.subscription.product;
          // The plan the order records is the persona's own — the catalog's first
          // paid plan only stands in for one that lapsed back to basic.
          const bought = held.id !== 'basic' ? held.id : paidProduct.id;
          const fixture = buildOrderFixture(key, config);

          assert.ok(fixture, `Persona '${key}' names order ${orderId} but the seeder builds no fixture for it`);
          assert.equal(fixture.orderId, orderId, `The fixture for '${key}' must be the order its subscription names`);
          assert.equal(fixture.doc.id, orderId, 'The order document is keyed by its own id');
          assert.equal(fixture.doc.owner, account.uid, `The order for '${key}' belongs to that persona`);
          assert.equal(fixture.doc.type, 'subscription', `The order for '${key}' records a subscription purchase`);
          assert.equal(fixture.doc.productId, bought, `The order for '${key}' names the plan that was bought`);
          assert.equal(fixture.doc.unified.product.id, bought, `The order's unified product for '${key}' is the plan that was bought`);
          assert.equal(fixture.doc.unified.status, account.properties.subscription.status, `The order for '${key}' mirrors the subscription's state`);
          assert.ok(fixture.doc.unified.payment.price > 0, `The order for '${key}' records what was paid`);
          assert.ok(fixture.doc.unified.payment.frequency, `The order for '${key}' records the cadence it was bought on`);

          // The blocks a real order carries: the cancel/refund requests the routes
          // write onto it, and the stamps of what last touched it.
          assert.equal(fixture.doc.requests.cancellation, null, `Nothing has requested a cancellation of '${key}' order`);
          assert.equal(fixture.doc.requests.refund, null, `Nothing has requested a refund of '${key}' order`);
          assert.ok(fixture.doc.metadata.created.timestampUNIX > 0, `The order for '${key}' records when it was created`);
          assert.ok(fixture.doc.metadata.updated.timestampUNIX > 0, `The order for '${key}' records when it was last written`);
          assert.equal(fixture.doc.metadata.updatedBy.event.name, 'seed', `The order for '${key}' names the seed as its writer, not a webhook`);
        }
      },
    },

    // A project's own personas (`test/_init.js` accounts) are seeded by the same
    // seeder, so a purchase in a project persona's name is as real as a
    // framework one's — and the order names the plan THAT persona holds.
    {
      name: 'project-personas-get-their-own-order-fixtures',
      async run({ assert, config, skip }) {
        const plan = otherPaidPlan(config) || paidPlan(config);

        if (!plan) {
          skip('No paid subscription product configured in this brand');
        }

        const extraAccounts = {
          'project-subscriber': {
            id: 'project-subscriber',
            uid: '_test-project-subscriber',
            email: '_test.project-subscriber@{domain}',
            properties: {
              roles: {},
              subscription: {
                product: { id: plan.id, name: plan.name },
                status: 'active',
                payment: { processor: 'test', resourceId: 'sub_test_project', orderId: '_test-order-project-subscriber' },
              },
            },
          },
        };

        const fixture = buildOrderFixture('project-subscriber', config, extraAccounts);

        assert.ok(fixture, 'A project persona naming an order must get a fixture, not a dangling id');
        assert.equal(fixture.orderId, '_test-order-project-subscriber', 'The fixture is the order the project persona names');
        assert.equal(fixture.doc.owner, '_test-project-subscriber', 'The order belongs to the project persona');
        assert.equal(fixture.doc.productId, plan.id, 'The order names the plan the persona actually holds, not the catalog default');
        assert.equal(fixture.doc.unified.payment.price, plan.prices[Object.keys(plan.prices)[0]], 'The order records the catalog price of that plan');
      },
    },

    // A plan the catalog does not sell has no price to quote, so the seeder
    // quotes none: a persona on one keeps its seed exactly as written rather
    // than gaining null billing data that reads like an answer.
    {
      name: 'unpriced-plans-invent-no-billing-data',
      async run({ assert, config }) {
        const extraAccounts = {
          'project-unpriced': {
            id: 'project-unpriced',
            uid: '_test-project-unpriced',
            email: '_test.project-unpriced@{domain}',
            properties: {
              roles: {},
              subscription: {
                product: { id: '_test-unsold-plan', name: 'Unsold' },
                status: 'active',
                payment: { processor: 'test', resourceId: 'sub_test_unpriced' },
              },
            },
          },
        };

        const definition = getAccountDefinitions('example.com', config, extraAccounts)['project-unpriced'];
        const payment = definition.properties.subscription.payment;

        assert.equal(payment.processor, 'test', 'The seeded payment record is left as written');
        assert.equal(payment.frequency, undefined, 'A plan with no catalog price gets no cadence written onto it');
        assert.equal(payment.price, undefined, 'A plan with no catalog price gets no price written onto it');
      },
    },

    // The counterpart guard: a persona that never bought anything must stay
    // pristine. `journey-flows-trial` in particular — any subscription order in
    // its name disqualifies it from the trial its journey exists to prove.
    {
      name: 'never-subscribed-personas-stay-hollow',
      async run({ assert, config }) {
        const definitions = getAccountDefinitions('example.com', config);

        for (const key of ['basic', 'journey-flows-trial', 'consent-granted']) {
          const subscription = definitions[key].properties.subscription;

          assert.equal(subscription.product.id, 'basic', `Persona '${key}' is a free account`);
          assert.equal(subscription.payment, undefined, `Persona '${key}' never bought anything, so it carries no payment record`);
          assert.equal(buildOrderFixture(key, config), null, `Persona '${key}' must have no order behind it`);
        }
      },
    },

    // The steady-state mid-trial persona ([#301](https://github.com/Omega-JS-Stack/omega/issues/301)):
    // a subscriber inside the trial the catalog offers, which only reads as one
    // if its term ends exactly when the trial does — the equality
    // routes/payments/cancel/_is-trialing.js tells a running trial from a
    // converted one by.
    {
      name: 'the-trialing-persona-is-inside-its-trial',
      async run({ assert, config, skip }) {
        if (!paidPlan(config)) {
          skip('No paid subscription product configured in this brand');
        }

        const plan = getFirstPaidProduct(config);
        const definition = getAccountDefinitions('example.com', config)['premium-trialing'];

        assert.ok(definition, 'The seeder must define a mid-trial persona');

        const subscription = definition.properties.subscription;

        assert.equal(subscription.product.id, plan.id, 'The trialing persona holds the catalog\'s paid plan');
        assert.equal(subscription.status, 'active', 'A live trial IS an active subscription — the processors\' trialing status maps to active');
        assert.equal(subscription.trial.claimed, true, 'The trial has been claimed');
        assert.equal(subscription.trial.outcome, null, 'A trial that is still running has not ended in anything yet');
        assert.equal(
          subscription.expires.timestampUNIX,
          subscription.trial.expires.timestampUNIX,
          'The term ends exactly when the trial does — the equality that makes it read as trialing',
        );
        assert.ok(isTrialing(subscription), 'The cancel flow must read this persona as trialing');

        // The trial runs for as long as the BRAND offers it on that plan, not a
        // hand-typed length the catalog never promised.
        const catalogDays = (config.payment?.products || []).find((product) => product.id === plan.id)?.trial?.days || 14;
        const remaining = (subscription.trial.expires.timestampUNIX - Math.floor(Date.now() / 1000)) / 86400;

        assert.ok(
          Math.abs(remaining - catalogDays) < 1,
          `The trial must run the catalog's ${catalogDays} days (got ${Math.round(remaining)})`,
        );

        // And the purchase record behind it carries the same trial (the order's
        // `unified` IS the subscription).
        const fixture = buildOrderFixture('premium-trialing', config);

        assert.ok(fixture, 'The trialing persona names an order, so it must have one');
        assert.equal(fixture.doc.unified.trial.claimed, true, 'The purchase record shows the subscription was bought on a trial');
        assert.equal(
          fixture.doc.unified.expires.timestampUNIX,
          subscription.expires.timestampUNIX,
          'The order records the same term the persona holds',
        );
      },
    },

    // Every persona is a FULL account ([#327](https://github.com/Omega-JS-Stack/omega/issues/327)):
    // account creation writes the schema's SHAPE and nothing else, so a persona
    // that stopped there is a nameless account from nowhere on every surface that
    // shows a person. This is the guard that a persona added tomorrow cannot
    // regress to that.
    {
      name: 'every-persona-is-a-full-account',
      async run({ assert, config }) {
        const definitions = getAccountDefinitions('example.com', config);

        for (const [key, definition] of Object.entries(definitions)) {
          const { personal, activity } = definition.properties;

          for (const path of REAL_ACCOUNT_LEAVES) {
            const value = leafAt({ personal, activity }, path);

            assert.ok(
              value !== undefined && value !== null && value !== '',
              `Persona '${key}' must carry ${path} — a real user has one`,
            );
          }

          // The numeric leaves default to 0, which is the schema saying "unset".
          assert.ok(personal.telephone.national > 0, `Persona '${key}' must carry a telephone number`);
          assert.ok(personal.birthday.timestampUNIX > 0, `Persona '${key}' must carry a birthday`);
          assert.notEqual(activity.geolocation.latitude, 0, `Persona '${key}' must be somewhere (latitude)`);
          assert.notEqual(activity.geolocation.longitude, 0, `Persona '${key}' must be somewhere (longitude)`);
          assert.equal(typeof activity.client.mobile, 'boolean', `Persona '${key}' signed up on a known form factor`);

          // The location is ONE fact: where the request came from is where the
          // person says they are. A persona split across two places is a bug in
          // the seeder, and it renders as one on the account page.
          assert.equal(personal.location.country, activity.geolocation.country, `Persona '${key}' lives where it signed up from (country)`);
          assert.equal(personal.location.city, activity.geolocation.city, `Persona '${key}' lives where it signed up from (city)`);
        }
      },
    },

    // The profile is DERIVED from the persona key, never rolled — so the account
    // QA screenshotted last week is the account in front of them today, and a
    // reseed never shuffles who anybody is.
    {
      name: 'a-persona-profile-is-the-same-on-every-boot',
      async run({ assert, config }) {
        const first = getAccountDefinitions('example.com', config);
        const second = getAccountDefinitions('example.com', config);

        for (const key of Object.keys(first)) {
          assert.deepEqual(
            second[key].properties.personal,
            first[key].properties.personal,
            `Persona '${key}' must draw the same identity on every seed`,
          );
          assert.deepEqual(
            second[key].properties.activity,
            first[key].properties.activity,
            `Persona '${key}' must draw the same signup context on every seed`,
          );
        }
      },
    },

    // A persona bought through the TEST processor carries what that processor
    // writes. The negative-path fixtures are excluded by construction, not by an
    // exemption list: they name a null or unknown processor, which is the whole
    // point of them.
    {
      name: 'test-processor-personas-carry-the-record-it-writes',
      async run({ assert, config, skip }) {
        if (!paidPlan(config)) {
          skip('No paid subscription product configured in this brand');
        }

        const definitions = getAccountDefinitions('example.com', config);
        const bought = Object.entries(definitions).filter(([, definition]) => definition.properties.subscription?.payment?.processor === 'test');

        assert.ok(bought.length > 0, 'The seeder must define personas bought through the test processor');

        for (const [key, definition] of bought) {
          const payment = definition.properties.subscription.payment;

          assert.ok(payment.resourceId, `Persona '${key}' must name the resource the processor holds its subscription under`);
          assert.ok(payment.startDate?.timestampUNIX > 0, `Persona '${key}' must record when its subscription began`);
          assert.ok(payment.updatedBy?.event?.name, `Persona '${key}' must name the event that last wrote its subscription`);
          assert.ok(payment.updatedBy?.date?.timestampUNIX > 0, `Persona '${key}' must record when that event landed`);

          // The write's DATE follows the term: a term that already ended cannot
          // have been written to today (the email layer prints this stamp as the
          // last payment date). One day of slack absorbs boundary rounding.
          const expires = definition.properties.subscription.expires;
          if (expires?.timestampUNIX && expires.timestampUNIX <= Math.floor(Date.now() / 1000)) {
            assert.ok(
              payment.updatedBy.date.timestampUNIX <= expires.timestampUNIX + 86400,
              `Persona '${key}' ended ${expires.timestamp} but its last write claims ${payment.updatedBy.date.timestamp}`
            );
          }
        }
      },
    },

    // The reported break (#327): the dev palette's Premium persona had a resolved
    // plan and no processor record, so every payment-gated surface skipped it —
    // the billing panel offers the winback discount only where it can actually be
    // applied (a processor and its resource: core/js/pages/dashboard/account/
    // sections/billing.js), and QA read the missing pitch as a product bug.
    {
      name: 'the-premium-persona-is-a-real-subscriber',
      async run({ assert, config, skip }) {
        if (!paidPlan(config)) {
          skip('No paid subscription product configured in this brand');
        }

        const subscription = getAccountDefinitions('example.com', config)['premium-active'].properties.subscription;
        const payment = subscription.payment;

        assert.equal(subscription.status, 'active', 'The Premium persona holds a live subscription');
        assert.equal(subscription.product.id, getFirstPaidProduct(config).id, 'The Premium persona holds the catalog\'s paid plan');
        assert.equal(subscription.cancellation.pending, false, 'Nothing has been cancelled — this is the steady-state subscriber');

        // The winback pitch's own gate, asserted as the gate reads it.
        assert.ok(payment.processor && payment.resourceId, 'A payment-gated surface must be able to reach this persona at its processor');
        assert.equal(payment.processor, 'test', 'The persona is held at the TEST processor — demo-safe, never a live one');

        assert.ok(payment.startDate.timestampUNIX < Math.floor(Date.now() / 1000), 'The persona subscribed in the past, not this instant');
        assert.ok(payment.price > 0, 'The persona pays what the catalog charges');

        // And the purchase behind it exists, like any real subscriber's.
        const fixture = buildOrderFixture('premium-active', config);

        assert.ok(fixture, 'The Premium persona names an order, so it must have one');
        assert.equal(fixture.doc.owner, '_test-premium-active', 'The order belongs to the Premium persona');
        assert.equal(fixture.doc.unified.status, 'active', 'The order records the live subscription it bought');
      },
    },
  ],
};

/**
 * The leaves a REAL user doc carries a value in — the sections `routes/user/signup`
 * fills from the request (`activity`) and the person fills in about themselves
 * (`personal`). Every one of them is a field some surface renders.
 */
const REAL_ACCOUNT_LEAVES = [
  'personal.name.first',
  'personal.name.last',
  'personal.gender',
  'personal.location.country',
  'personal.location.region',
  'personal.location.city',
  'personal.company.name',
  'personal.company.position',
  'personal.telephone.countryCode',
  'activity.geolocation.ip',
  'activity.geolocation.continent',
  'activity.geolocation.country',
  'activity.geolocation.region',
  'activity.geolocation.city',
  'activity.client.language',
  'activity.client.device',
  'activity.client.platform',
  'activity.client.browser',
  'activity.client.runtime',
  'activity.client.userAgent',
  'activity.client.url',
];

/**
 * Read a dotted path off an object, undefined for anything missing on the way.
 */
function leafAt(source, path) {
  return path.split('.').reduce((value, segment) => (value === undefined || value === null ? value : value[segment]), source);
}

/**
 * The catalog's first plan that is actually for sale. A brand that sells nothing
 * has no billing data for its personas to carry — the suite skips rather than
 * failing a brand for a feature it does not use.
 */
function paidPlan(config) {
  return (config.payment?.products || []).find((product) => product.id !== 'basic' && product.prices) || null;
}

/**
 * A second plan for sale, so a persona can be stood on one the catalog default
 * would never resolve to. A brand selling a single plan has none.
 */
function otherPaidPlan(config) {
  const first = paidPlan(config);

  return (config.payment?.products || []).find((product) => {
    return product.type === 'subscription' && product.prices && product.id !== first?.id;
  }) || null;
}

/**
 * A seeded subscription represents a purchase when it holds a paid plan, or when
 * it carries the record of one it has since lapsed from (a processor, a resource,
 * an order).
 */
function isPurchase(subscription) {
  if (!subscription) {
    return false;
  }

  const payment = subscription.payment || {};

  return subscription.product?.id !== 'basic'
    || Boolean(payment.processor || payment.resourceId || payment.orderId);
}

/**
 * The catalog entry for the plan a persona bought — the plan it holds, or the
 * paid plan it lapsed from back to basic.
 */
function planBought(subscription, config) {
  const products = config.payment?.products || [];
  const paidProduct = getFirstPaidProduct(config);
  const id = subscription.product?.id !== 'basic' ? subscription.product?.id : paidProduct.id;

  return products.find((product) => product.id === id && product.prices) || null;
}
