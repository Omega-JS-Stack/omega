const { TEST_ACCOUNTS, getAccountDefinitions, getFirstPaidProduct, buildOrderFixture, buildSessionFixtures } = require('../../dist/test/test-accounts.js');
const isTrialing = require('../../dist/omega/routes/payments/cancel/_is-trialing.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

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
 * are what stops a persona added tomorrow from arriving half-built — the referrals
 * and the active sessions an established account carries included
 * ([#343](https://github.com/Omega-JS-Stack/omega/issues/343)), because those two
 * lists were the last ones a persona could not fill.
 *
 * PURE: reads the seeder's own definitions against the brand catalog — no emulator,
 * no Firestore. What it pins is the SEED, which is what every payment suite and the
 * dev palette start from.
 *
 * Run: npx omega test helpers/seeded-personas
 */
module.exports = defineCases({
  description: 'Seeded personas carry legitimate billing data',
  type: 'group',
  auth: 'none',

  tests: [
    // A persona holding a paid plan — or carrying a purchase record for one it
    // has since lapsed from — quotes the catalog's own price and cadence.
    {
      name: 'purchased-personas-quote-the-catalog',
      async run({ expect, config, skip }) {
        if (!paidPlan(config)) {
          skip('No paid subscription product configured in this brand');
        }

        const definitions = getAccountDefinitions('example.com', config);
        const purchased = Object.entries(definitions).filter(([, definition]) => isPurchase(definition.properties?.subscription));

        expect(purchased.length > 0, 'The seeder must define personas that bought a subscription').toBeTruthy();

        for (const [key, definition] of purchased) {
          const subscription = definition.properties.subscription;
          const payment = subscription.payment || {};
          const plan = planBought(subscription, config);

          expect(plan, `Persona '${key}' names a plan the catalog does not carry`).toBeTruthy();
          expect(
            payment.frequency && plan.prices[payment.frequency] !== undefined,
            `Persona '${key}' must be billed at a cadence the catalog sells ${plan.id} at (got ${payment.frequency})`,
          ).toBeTruthy();
          expect(
            payment.price,
            `Persona '${key}' must quote the catalog price for ${plan.id}/${payment.frequency}`,
          ).toBe(plan.prices[payment.frequency]);
          expect(payment.price > 0, `Persona '${key}' bought a paid plan, so its price cannot be 0`).toBeTruthy();
        }
      },
    },

    // A live term runs to the end of the cycle it is being billed on — not to a
    // date a decade away no real provider would ever record.
    {
      name: 'live-terms-end-with-the-billing-cycle',
      async run({ expect, config }) {
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

          expect(cycleDays, `Persona '${key}' is billed at an unknown cadence (${cadence})`).toBeTruthy();
          expect(
            remaining <= cycleDays + 1,
            `Persona '${key}' expires ${Math.round(remaining)} days out — a ${cadence} term ends within ${cycleDays}`,
          ).toBeTruthy();
        }
      },
    },

    // The orderId on a seeded subscription names a purchase record the backend
    // reads back (the test cancel provider's plan lookup, the test webhook
    // library's resource rebuild, the per-owner trial-eligibility query). Every
    // one of them must have a fixture behind it.
    {
      name: 'every-seeded-orderid-has-an-order-fixture',
      async run({ expect, config, skip }) {
        if (!paidPlan(config)) {
          skip('No paid subscription product configured in this brand');
        }

        const paidProduct = getFirstPaidProduct(config);
        const definitions = getAccountDefinitions('example.com', config);
        const seeded = Object.entries(TEST_ACCOUNTS).filter(([, account]) => account.properties?.subscription?.payment?.orderId);

        expect(seeded.length > 0, 'The seeder must define personas whose subscription names an order').toBeTruthy();

        for (const [key, account] of seeded) {
          const orderId = account.properties.subscription.payment.orderId;
          const held = definitions[key].properties.subscription.product;
          // The plan the order records is the persona's own — the catalog's first
          // paid plan only stands in for one that lapsed back to basic.
          const bought = held.id !== 'basic' ? held.id : paidProduct.id;
          const fixture = buildOrderFixture(key, config);

          expect(fixture, `Persona '${key}' names order ${orderId} but the seeder builds no fixture for it`).toBeTruthy();
          expect(fixture.orderId, `The fixture for '${key}' must be the order its subscription names`).toBe(orderId);
          expect(fixture.doc.id, 'The order document is keyed by its own id').toBe(orderId);
          expect(fixture.doc.owner, `The order for '${key}' belongs to that persona`).toBe(account.uid);
          expect(fixture.doc.type, `The order for '${key}' records a subscription purchase`).toBe('subscription');
          expect(fixture.doc.productId, `The order for '${key}' names the plan that was bought`).toBe(bought);
          expect(fixture.doc.unified.product.id, `The order's unified product for '${key}' is the plan that was bought`).toBe(bought);
          expect(fixture.doc.unified.status, `The order for '${key}' mirrors the subscription's state`).toBe(account.properties.subscription.status);
          expect(fixture.doc.unified.payment.price > 0, `The order for '${key}' records what was paid`).toBeTruthy();
          expect(fixture.doc.unified.payment.frequency, `The order for '${key}' records the cadence it was bought on`).toBeTruthy();

          // The blocks a real order carries: the cancel/refund requests the routes
          // write onto it, and the stamps of what last touched it.
          expect(fixture.doc.requests.cancellation, `Nothing has requested a cancellation of '${key}' order`).toBe(null);
          expect(fixture.doc.requests.refund, `Nothing has requested a refund of '${key}' order`).toBe(null);
          expect(fixture.doc.metadata.created.timestampUNIX > 0, `The order for '${key}' records when it was created`).toBeTruthy();
          expect(fixture.doc.metadata.updated.timestampUNIX > 0, `The order for '${key}' records when it was last written`).toBeTruthy();
          expect(fixture.doc.metadata.updatedBy.event.name, `The order for '${key}' names the seed as its writer, not a webhook`).toBe('seed');
        }
      },
    },

    // A project's own personas (`test/_init.js` accounts) are seeded by the same
    // seeder, so a purchase in a project persona's name is as real as a
    // framework one's — and the order names the plan THAT persona holds.
    {
      name: 'project-personas-get-their-own-order-fixtures',
      async run({ expect, config, skip }) {
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
                payment: { provider: 'test', resourceId: 'sub_test_project', orderId: '_test-order-project-subscriber' },
              },
            },
          },
        };

        const fixture = buildOrderFixture('project-subscriber', config, extraAccounts);

        expect(fixture, 'A project persona naming an order must get a fixture, not a dangling id').toBeTruthy();
        expect(fixture.orderId, 'The fixture is the order the project persona names').toBe('_test-order-project-subscriber');
        expect(fixture.doc.owner, 'The order belongs to the project persona').toBe('_test-project-subscriber');
        expect(fixture.doc.productId, 'The order names the plan the persona actually holds, not the catalog default').toBe(plan.id);
        expect(fixture.doc.unified.payment.price, 'The order records the catalog price of that plan').toBe(plan.prices[Object.keys(plan.prices)[0]]);
      },
    },

    // A plan the catalog does not sell has no price to quote, so the seeder
    // quotes none: a persona on one keeps its seed exactly as written rather
    // than gaining null billing data that reads like an answer.
    {
      name: 'unpriced-plans-invent-no-billing-data',
      async run({ expect, config }) {
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
                payment: { provider: 'test', resourceId: 'sub_test_unpriced' },
              },
            },
          },
        };

        const definition = getAccountDefinitions('example.com', config, extraAccounts)['project-unpriced'];
        const payment = definition.properties.subscription.payment;

        expect(payment.provider, 'The seeded payment record is left as written').toBe('test');
        expect(payment.frequency, 'A plan with no catalog price gets no cadence written onto it').toBe(undefined);
        expect(payment.price, 'A plan with no catalog price gets no price written onto it').toBe(undefined);
      },
    },

    // The counterpart guard: a persona that never bought anything must stay
    // pristine. `journey-flows-trial` in particular — any subscription order in
    // its name disqualifies it from the trial its journey exists to prove.
    {
      name: 'never-subscribed-personas-stay-hollow',
      async run({ expect, config }) {
        const definitions = getAccountDefinitions('example.com', config);

        for (const key of ['basic', 'journey-flows-trial', 'consent-granted']) {
          const subscription = definitions[key].properties.subscription;

          expect(subscription.product.id, `Persona '${key}' is a free account`).toBe('basic');
          expect(subscription.payment, `Persona '${key}' never bought anything, so it carries no payment record`).toBe(undefined);
          expect(buildOrderFixture(key, config), `Persona '${key}' must have no order behind it`).toBe(null);
        }
      },
    },

    // The suite-exclusive purchasers ([#406](https://github.com/Omega-JS-Stack/omega/issues/406)):
    // the discount suites' cases each BUY a subscription, which is why they get
    // one account apiece. Every one of them has to ARRIVE owning nothing — the
    // checkout guard refuses a caller already holding a paid plan, and the trial
    // cases read eligibility off a per-owner order query that any seeded
    // purchase record would answer for them.
    {
      name: 'the-discount-suites-purchasers-arrive-owning-nothing',
      async run({ expect, config }) {
        const definitions = getAccountDefinitions('example.com', config);
        const purchasers = Object.keys(TEST_ACCOUNTS).filter((key) => key.startsWith('intent-discount-'));

        expect(purchasers.length > 0, 'The seeder must declare the discount suites their own purchasers').toBeTruthy();

        for (const key of purchasers) {
          const subscription = definitions[key].properties.subscription;

          expect(subscription.product.id, `Persona '${key}' must arrive on the free tier`).toBe('basic');
          expect(subscription.payment, `Persona '${key}' has bought nothing yet, so it carries no payment record`).toBe(undefined);
          expect(buildOrderFixture(key, config), `Persona '${key}' must have no order behind it`).toBe(null);
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
      async run({ expect, config, skip }) {
        if (!paidPlan(config)) {
          skip('No paid subscription product configured in this brand');
        }

        const plan = getFirstPaidProduct(config);
        const definition = getAccountDefinitions('example.com', config)['premium-trialing'];

        expect(definition, 'The seeder must define a mid-trial persona').toBeTruthy();

        const subscription = definition.properties.subscription;

        expect(subscription.product.id, 'The trialing persona holds the catalog\'s paid plan').toBe(plan.id);
        expect(subscription.status, 'A live trial IS an active subscription: the providers\' trialing status maps to active').toBe('active');
        expect(subscription.trial.claimed, 'The trial has been claimed').toBe(true);
        expect(subscription.trial.outcome, 'A trial that is still running has not ended in anything yet').toBe(null);
        expect(
          subscription.expires.timestampUNIX,
          'The term ends exactly when the trial does — the equality that makes it read as trialing',
        ).toBe(subscription.trial.expires.timestampUNIX);
        expect(isTrialing(subscription), 'The cancel flow must read this persona as trialing').toBeTruthy();

        // The trial runs for as long as the BRAND offers it on that plan, not a
        // hand-typed length the catalog never promised.
        const catalogDays = (config.payment?.products || []).find((product) => product.id === plan.id)?.trial?.days || 14;
        const remaining = (subscription.trial.expires.timestampUNIX - Math.floor(Date.now() / 1000)) / 86400;

        expect(
          Math.abs(remaining - catalogDays) < 1,
          `The trial must run the catalog's ${catalogDays} days (got ${Math.round(remaining)})`,
        ).toBeTruthy();

        // And the purchase record behind it carries the same trial (the order's
        // `unified` IS the subscription).
        const fixture = buildOrderFixture('premium-trialing', config);

        expect(fixture, 'The trialing persona names an order, so it must have one').toBeTruthy();
        expect(fixture.doc.unified.trial.claimed, 'The purchase record shows the subscription was bought on a trial').toBe(true);
        expect(
          fixture.doc.unified.expires.timestampUNIX,
          'The order records the same term the persona holds',
        ).toBe(subscription.expires.timestampUNIX);
      },
    },

    // Every persona is a FULL account ([#327](https://github.com/Omega-JS-Stack/omega/issues/327)):
    // account creation writes the schema's SHAPE and nothing else, so a persona
    // that stopped there is a nameless account from nowhere on every surface that
    // shows a person. This is the guard that a persona added tomorrow cannot
    // regress to that.
    {
      name: 'every-persona-is-a-full-account',
      async run({ expect, config }) {
        const definitions = getAccountDefinitions('example.com', config);

        for (const [key, definition] of Object.entries(definitions)) {
          const { personal, activity } = definition.properties;

          for (const path of REAL_ACCOUNT_LEAVES) {
            const value = leafAt({ personal, activity }, path);

            expect(
              value !== undefined && value !== null && value !== '',
              `Persona '${key}' must carry ${path} — a real user has one`,
            ).toBeTruthy();
          }

          // The numeric leaves default to 0, which is the schema saying "unset".
          expect(personal.telephone.national > 0, `Persona '${key}' must carry a telephone number`).toBeTruthy();
          expect(personal.birthday.timestampUNIX > 0, `Persona '${key}' must carry a birthday`).toBeTruthy();
          expect(activity.geolocation.latitude, `Persona '${key}' must be somewhere (latitude)`).not.toBe(0);
          expect(activity.geolocation.longitude, `Persona '${key}' must be somewhere (longitude)`).not.toBe(0);
          expect(typeof activity.client.mobile, `Persona '${key}' signed up on a known form factor`).toBe('boolean');

          // The location is ONE fact: where the request came from is where the
          // person says they are. A persona split across two places is a bug in
          // the seeder, and it renders as one on the account page.
          expect(personal.location.country, `Persona '${key}' lives where it signed up from (country)`).toBe(activity.geolocation.country);
          expect(personal.location.city, `Persona '${key}' lives where it signed up from (city)`).toBe(activity.geolocation.city);
        }
      },
    },

    // The dev palette's roster ([#400](https://github.com/Omega-JS-Stack/omega/issues/400)).
    // The palette kept its own hand-curated copy of this list, so a persona
    // seeded without somebody remembering to add it was invisible in the
    // switcher for weeks (the referral pair, #363). The `palette` label makes
    // the SEED the one owner: a labeled persona is human-facing, and what
    // routes/test/roster hands the palette is exactly the list below, in
    // exactly this order.
    {
      name: 'the-palette-roster-is-the-seeds-own',
      async run({ expect, config }) {
        const labelled = Object.entries(TEST_ACCOUNTS).filter(([, account]) => account.palette);

        expect(
          labelled.map(([, account]) => [account.email.split('@')[0], account.palette]),
          'The palette-facing personas are these, in the order the seeder declares them',
        ).toEqual([
          ['_test.admin', 'Admin'],
          ['_test.basic', 'Basic'],
          ['_test.premium-active', 'Premium'],
          ['_test.premium-trialing', 'Trialing'],
          ['_test.premium-expired', 'Expired'],
          ['_test.premium-suspended', 'Suspended'],
          ['_test.premium-cancelling', 'Cancelling'],
          ['_test.refunded', 'Refunded'],
          ['_test.usage-spread', 'Usage'],
          ['_test.referrer', 'Referrer'],
          ['_test.referred', 'Referred'],
          ['_test.journey-flows-upgrade', 'Journey: Upgrade'],
          ['_test.journey-flows-cancel', 'Journey: Cancel'],
          ['_test.journey-flows-failure', 'Journey: Failure'],
          ['_test.journey-flows-trial', 'Journey: Trial'],
        ]);

        // The machinery an automated suite drives is never offered to somebody
        // mid-suite: a deletion fixture, a signup the suite has to perform
        // itself, a consent state a lifecycle test establishes, and — since
        // [#406](https://github.com/Omega-JS-Stack/omega/issues/406) — the
        // suite-exclusive accounts that used to be minted mid-test.
        for (const key of [
          'delete', 'delete-by-admin', 'signup-merge', 'consent-granted',
          'journey-payments-winback', 'journey-payments-winback-decline',
          'journey-payments-plan-switch', 'journey-payments-plan-switch-trial',
          'journey-payments-uncancel',
          'webhook-chargebee-unreachable', 'webhook-retry-sweep',
          'intent-discount-percent-url', 'intent-discount-amount-trial',
        ]) {
          expect(TEST_ACCOUNTS[key].palette, `Persona '${key}' is machinery, so the palette must not offer it`).toBe(undefined);
        }

        // A persona a human signs in as is a persona a human LOOKS at, so every
        // labeled one is a full account (#327): the same leaves the sweep
        // above requires of the whole table, asserted here as the roster's own
        // entry requirement.
        const definitions = getAccountDefinitions('example.com', config);

        for (const [key] of labelled) {
          const definition = definitions[key];

          expect(definition, `Palette persona '${key}' must be a seeded account`).toBeTruthy();

          for (const path of REAL_ACCOUNT_LEAVES) {
            const value = leafAt(definition.properties, path);

            expect(
              value !== undefined && value !== null && value !== '',
              `Palette persona '${key}' must carry ${path}: QA signs in as it and sees exactly that`,
            ).toBeTruthy();
          }
        }
      },
    },

    // The profile is DERIVED from the persona key, never rolled — so the account
    // QA screenshotted last week is the account in front of them today, and a
    // reseed never shuffles who anybody is.
    {
      name: 'a-persona-profile-is-the-same-on-every-boot',
      async run({ expect, config }) {
        const first = getAccountDefinitions('example.com', config);
        const second = getAccountDefinitions('example.com', config);

        for (const key of Object.keys(first)) {
          expect(
            second[key].properties.personal,
            `Persona '${key}' must draw the same identity on every seed`,
          ).toEqual(first[key].properties.personal);
          expect(
            second[key].properties.activity,
            `Persona '${key}' must draw the same signup context on every seed`,
          ).toEqual(first[key].properties.activity);
        }
      },
    },

    // A persona bought through the TEST provider carries what that provider
    // writes. The negative-path fixtures are excluded by construction, not by an
    // exemption list: they name a null or unknown provider, which is the whole
    // point of them.
    {
      name: 'test-provider-personas-carry-the-record-it-writes',
      async run({ expect, config, skip }) {
        if (!paidPlan(config)) {
          skip('No paid subscription product configured in this brand');
        }

        const definitions = getAccountDefinitions('example.com', config);
        const bought = Object.entries(definitions).filter(([, definition]) => definition.properties.subscription?.payment?.provider === 'test');

        expect(bought.length > 0, 'The seeder must define personas bought through the test provider').toBeTruthy();

        for (const [key, definition] of bought) {
          const payment = definition.properties.subscription.payment;

          expect(payment.resourceId, `Persona '${key}' must name the resource the provider holds its subscription under`).toBeTruthy();
          expect(payment.startDate?.timestampUNIX > 0, `Persona '${key}' must record when its subscription began`).toBeTruthy();
          expect(payment.updatedBy?.event?.name, `Persona '${key}' must name the event that last wrote its subscription`).toBeTruthy();
          expect(payment.updatedBy?.date?.timestampUNIX > 0, `Persona '${key}' must record when that event landed`).toBeTruthy();

          // The write's DATE follows the term: a term that already ended cannot
          // have been written to today (the email layer prints this stamp as the
          // last payment date). One day of slack absorbs boundary rounding.
          const expires = definition.properties.subscription.expires;
          if (expires?.timestampUNIX && expires.timestampUNIX <= Math.floor(Date.now() / 1000)) {
            expect(
              payment.updatedBy.date.timestampUNIX <= expires.timestampUNIX + 86400,
              `Persona '${key}' ended ${expires.timestamp} but its last write claims ${payment.updatedBy.date.timestamp}`,
            ).toBeTruthy();
          }
        }
      },
    },

    // The reported break (#327): the dev palette's Premium persona had a resolved
    // plan and no provider record, so every payment-gated surface skipped it —
    // the billing panel offers the winback discount only where it can actually be
    // applied (a provider and its resource: core/js/pages/dashboard/account/
    // sections/billing.js), and QA read the missing pitch as a product bug.
    {
      name: 'the-premium-persona-is-a-real-subscriber',
      async run({ expect, config, skip }) {
        if (!paidPlan(config)) {
          skip('No paid subscription product configured in this brand');
        }

        const subscription = getAccountDefinitions('example.com', config)['premium-active'].properties.subscription;
        const payment = subscription.payment;

        expect(subscription.status, 'The Premium persona holds a live subscription').toBe('active');
        expect(subscription.product.id, 'The Premium persona holds the catalog\'s paid plan').toBe(getFirstPaidProduct(config).id);
        expect(subscription.cancellation.pending, 'Nothing has been cancelled: this is the steady-state subscriber').toBe(false);

        // The winback pitch's own gate, asserted as the gate reads it.
        expect(payment.provider && payment.resourceId, 'A payment-gated surface must be able to reach this persona at its provider').toBeTruthy();
        expect(payment.provider, 'The persona is held at the TEST provider: demo-safe, never a live one').toBe('test');

        expect(payment.startDate.timestampUNIX < Math.floor(Date.now() / 1000), 'The persona subscribed in the past, not this instant').toBeTruthy();
        expect(payment.price > 0, 'The persona pays what the catalog charges').toBeTruthy();

        // And the purchase behind it exists, like any real subscriber's.
        const fixture = buildOrderFixture('premium-active', config);

        expect(fixture, 'The Premium persona names an order, so it must have one').toBeTruthy();
        expect(fixture.doc.owner, 'The order belongs to the Premium persona').toBe('_test-premium-active');
        expect(fixture.doc.unified.status, 'The order records the live subscription it bought').toBe('active');
      },
    },

    // The referrals an established account has earned (#343). They were the last
    // list on the account page still coming from client-side fixtures, which is
    // exactly why they were wrong: the shape those fixtures invented is not the
    // shape a signup writes, and nobody could tell while no persona carried one.
    {
      name: 'referrers-carry-the-referrals-a-signup-writes',
      async run({ expect, config }) {
        const definitions = getAccountDefinitions('example.com', config);
        const byUid = new Map(Object.values(definitions).map((definition) => [definition.uid, definition]));
        const referrers = Object.entries(definitions).filter(([, definition]) => (definition.properties.affiliate?.referrals || []).length > 0);
        const nowUNIX = Math.floor(Date.now() / 1000);

        expect(referrers.length > 0, 'The seeder must define personas that referred somebody').toBeTruthy();

        for (const [key, definition] of referrers) {
          const referrals = definition.properties.affiliate.referrals;
          const converted = [];
          const pending = [];

          expect(referrals.length > 1, `Persona '${key}' should carry a few referrals, not one`).toBeTruthy();

          for (const referral of referrals) {
            // The record processAffiliate appends (routes/user/signup/post.js):
            // a uid and an ISO timestamp, and nothing else. A seed with extra
            // fields would let a reader lean on data no real referral has.
            expect(
              Object.keys(referral).sort(),
              `Persona '${key}' must record referrals exactly as a signup writes them`,
            ).toEqual(['timestamp', 'uid']);

            const at = Math.floor(new Date(referral.timestamp).getTime() / 1000);

            expect(at > 0, `Persona '${key}' has a referral with an unreadable timestamp (${referral.timestamp})`).toBeTruthy();
            expect(at < nowUNIX, `Persona '${key}' has a referral dated in the future`).toBeTruthy();

            // The referred account exists: the panel prints the uid, and a
            // referral pointing at nobody is a uid the emulator cannot resolve.
            const referred = byUid.get(referral.uid);

            expect(referred, `Persona '${key}' referred ${referral.uid}, which is no seeded persona`).toBeTruthy();

            const isConverted = referred.properties.subscription?.product?.id !== 'basic'
              || Boolean(referred.properties.subscription?.payment?.orderId);

            (isConverted ? converted : pending).push(referral.uid);
          }

          // A real referral list is mixed: some of the people who signed up went
          // on to subscribe and some never did. Conversion is a fact about the
          // REFERRED account (the referral record itself carries no status), so
          // the mix only exists when the referrals name real personas.
          expect(converted.length > 0, `Persona '${key}' referred nobody who ever subscribed`).toBeTruthy();
          expect(pending.length > 0, `Persona '${key}' referred nobody who is still on the free tier`).toBeTruthy();
        }
      },
    },

    // And they are the DEDICATED referrer's alone (Ian 2026-08-18,
    // [#363](https://github.com/Omega-JS-Stack/omega/issues/363)). A persona
    // demonstrates exactly its own scenario: premium-active is the steady-state
    // subscriber QA signs in as, and an affiliate list on it is a second story
    // told by an account that exists to tell the billing one.
    {
      name: 'only-the-referrer-persona-carries-referrals',
      async run({ expect, config }) {
        const definitions = getAccountDefinitions('example.com', config);
        const carriers = Object.entries(definitions)
          .filter(([, definition]) => (definition.properties.affiliate?.referrals || []).length > 0)
          .map(([key]) => key);

        expect(carriers, 'The referrer persona is the only account seeded with referrals').toEqual(['referrer']);
        expect(
          (definitions['premium-active'].properties.affiliate?.referrals || []).length,
          'The Premium persona demonstrates a subscription, not an affiliate link',
        ).toBe(0);

        // The inbound half obeys the same rule (#369): being referred is the
        // referred persona's ONE state, so it is the only account seeded with an
        // affiliate attribution — a second one would be a persona telling the
        // referral story on the side of the story it was built for.
        const attributed = Object.entries(definitions)
          .filter(([, definition]) => definition.properties.attribution?.affiliate?.code)
          .map(([key]) => key);

        expect(attributed, 'The referred persona is the only account seeded as having come in through a referral').toEqual(['referred']);

        // The one that DOES carry them stays a full realistic account (Ian
        // 2026-08-17, #327), and its dates stay the shape a signup writes: the
        // account page reads the timestamp as an ISO STRING, and the epoch
        // millis the old client-side fixtures invented rendered every row as
        // `NaN years ago` (#343).
        const referrals = definitions.referrer.properties.affiliate.referrals;

        expect(referrals.length >= 3, `The referrer persona must carry a real list of referrals (got ${referrals.length})`).toBeTruthy();

        for (const referral of referrals) {
          expect(
            typeof referral.timestamp,
            `Referral ${referral.uid} must be dated with the ISO string a signup writes, never epoch millis`,
          ).toBe('string');
          expect(referral.timestamp, `Referral ${referral.uid} is dated '${referral.timestamp}', which no signup would write`).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        }
      },
    },

    // The OTHER half of the referral pair (Ian 2026-08-19,
    // [#369](https://github.com/Omega-JS-Stack/omega/issues/369)). A referral is
    // two facts, written to two docs: the record on the referrer's list, and the
    // attribution on the account that arrived through the link. While only the
    // outbound half was seeded, every surface that reads the INBOUND one — "you
    // were referred by" — had no persona to render, and no test could tell the
    // two halves had drifted apart.
    {
      name: 'the-referred-persona-is-the-inbound-half-of-the-pair',
      async run({ expect, config }) {
        const definitions = getAccountDefinitions('example.com', config);
        const referred = definitions.referred;

        expect(referred, 'The seeder must define the persona that came in through a referral').toBeTruthy();

        const affiliate = referred.properties.attribution?.affiliate;

        // The block routes/user/signup writes from the request, exactly as the
        // account schema defines it (packages/account/src/schema.js): a code, a
        // click stamp, and where it was clicked. Extra fields would let a reader
        // lean on data no signup has ever written.
        expect(
          Object.keys(affiliate || {}).sort(),
          'The referred persona must carry attribution.affiliate exactly as a signup writes it',
        ).toEqual(['code', 'page', 'timestamp', 'url']);
        expect(
          affiliate.code,
          'The referred persona came in through the REFERRER persona\'s own code',
        ).toBe(definitions.referrer.properties.affiliate.code);
        expect(affiliate.url, `The link it arrived on carries the code (got ${affiliate.url})`).toMatch(new RegExp(`ref=${affiliate.code}$`));
        expect(affiliate.page, 'The referred persona records the page it landed on').toBeTruthy();

        // The two halves are ONE event: the referrer's record for this account
        // and the account's own attribution are dated the same instant, which is
        // the only way a pair could have come from a single signup.
        const outbound = definitions.referrer.properties.affiliate.referrals.find((referral) => referral.uid === referred.uid);

        expect(outbound, 'The referrer\'s outbound list must include the account it referred').toBeTruthy();
        expect(outbound.timestamp, 'Both halves of the referral are dated the same signup').toBe(affiliate.timestamp);
        expect(affiliate.timestamp, `The click is dated with the ISO string a signup writes (got ${affiliate.timestamp})`).toMatch(/^\d{4}-\d{2}-\d{2}T/);

        // ONE distinguishing state: it was referred. It is a full realistic
        // account around that ([#327](https://github.com/Omega-JS-Stack/omega/issues/327)) —
        // the exhaustive leaf sweep is 'every-persona-is-a-full-account' above —
        // and it tells no second story: no billing history, no referrals of its own.
        expect(referred.properties.personal.name.first, 'The referred persona is a real person, not a bare account').toBeTruthy();
        expect(referred.properties.activity.geolocation.city, 'The referred persona signed up from somewhere').toBeTruthy();
        expect(referred.properties.subscription.product.id, 'The referred persona demonstrates a referral, not a purchase').toBe('basic');
        expect(buildOrderFixture('referred', config), 'The referred persona bought nothing, so it has no order behind it').toBe(null);
        expect((referred.properties.affiliate?.referrals || []).length, 'The referred persona is the referred one: it has referred nobody').toBe(0);
      },
    },

    // The devices an account is signed in on (#343). Sessions are the one part
    // of an account that lives OUTSIDE the user doc — a Realtime Database record
    // an app writes while it is signed in — so account creation alone leaves the
    // security panel showing the browser in front of you and nothing else.
    {
      name: 'personas-are-signed-in-on-their-other-devices',
      async run({ expect }) {
        const withSessions = Object.keys(TEST_ACCOUNTS)
          .map((key) => [key, buildSessionFixtures(key, TEST_ACCOUNTS)])
          .filter(([, sessions]) => sessions);
        const nowUNIX = Math.floor(Date.now() / 1000);

        expect(withSessions.length > 0, 'The seeder must define personas that are signed in somewhere').toBeTruthy();

        for (const [key, sessions] of withSessions) {
          const ids = Object.keys(sessions);
          const platforms = new Set();

          expect(ids.length >= 2 && ids.length <= 3, `Persona '${key}' should carry 2-3 devices (got ${ids.length})`).toBeTruthy();

          for (const id of ids) {
            const session = sessions[id];

            // The route finds a user's sessions with `orderByChild('uid')`
            // (routes/user/sessions/get.js), so a record whose uid is not the
            // persona's is a session nothing will ever return.
            expect(session.uid, `Session ${id} must belong to persona '${key}'`).toBe(TEST_ACCOUNTS[key].uid);

            expect(session.platform, `Session ${id} must name the platform it runs on: the panel renders the device from it`).toBeTruthy();
            expect(session.ip, `Session ${id} must record where it connected from`).toBeTruthy();
            expect(session.timestampUNIX > 0, `Session ${id} must record when it last checked in`).toBeTruthy();
            expect(session.timestampUNIX < nowUNIX, `Session ${id} checked in from the future`).toBeTruthy();

            // ACTIVE sessions: a device that last checked in a month ago is not
            // somebody who is signed in right now.
            expect(session.timestampUNIX > nowUNIX - (7 * 86400), `Session ${id} is too stale to read as an active session`).toBeTruthy();

            platforms.add(session.platform);
          }

          expect(platforms.size, `Persona '${key}' should be signed in on ${ids.length} DIFFERENT devices`).toBe(ids.length);

          // The ids are derived from the persona, so a re-seed replaces the same
          // records instead of piling a second set on top of them.
          expect(
            Object.keys(buildSessionFixtures(key, TEST_ACCOUNTS)),
            `Persona '${key}' must seed the same session ids on every boot`,
          ).toEqual(ids);
        }
      },
    },
  ],
});

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
  'personal.location.postalCode',
  'personal.location.street',
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
 * it carries the record of one it has since lapsed from (a provider, a resource,
 * an order).
 */
function isPurchase(subscription) {
  if (!subscription) {
    return false;
  }

  const payment = subscription.payment || {};

  return subscription.product?.id !== 'basic'
    || Boolean(payment.provider || payment.resourceId || payment.orderId);
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
