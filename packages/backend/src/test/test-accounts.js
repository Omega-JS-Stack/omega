const uuid = require('uuid');

// Deterministic password for EVERY seeded persona (N6) — makes manual dev signin
// possible: boot the emulators, open an emulator-connected dev site, and sign in
// as any persona with email + this password. Personas only ever exist in the
// emulator (seeding wipes + recreates them), so a fixed password is safe.
const TEST_ACCOUNT_PASSWORD = 'omega-test-password';

/**
 * Resolve the first paid subscription product from config
 * Falls back to 'premium' if no config or no paid products found
 */
function getFirstPaidProduct(config) {
  const products = config?.payment?.products || [];
  const paid = products.find(p => p.type === 'subscription' && p.id !== 'basic');
  return paid
    ? { id: paid.id, name: paid.name }
    : { id: 'premium', name: 'Premium' };
}

/**
 * Helper to create a future expiration date for premium subscriptions
 * User() checks subscription.expires to determine if subscription is active
 * If expires is in the past (or default 1970), subscription gets downgraded to basic
 */
function getFutureExpires(years = 10) {
  const futureDate = new Date();
  futureDate.setFullYear(futureDate.getFullYear() + years);
  return {
    timestamp: futureDate.toISOString(),
    timestampUNIX: Math.floor(futureDate.getTime() / 1000),
  };
}

/**
 * Helper to create a past expiration date for expired subscriptions
 */
function getPastExpires(years = 1) {
  const pastDate = new Date();
  pastDate.setFullYear(pastDate.getFullYear() - years);
  return {
    timestamp: pastDate.toISOString(),
    timestampUNIX: Math.floor(pastDate.getTime() / 1000),
  };
}

/**
 * Static test accounts - always created with fixed properties
 * Used for testing access control levels
 * Both @omega.js/backend and consuming projects rely on these
 *
 * Structure: { id, uid, email, properties }
 * - id: Account identifier
 * - uid: Firebase Auth UID
 * - email: Email with {domain} placeholder (resolved at runtime)
 * - properties: Object to merge into user doc after auth:on-create
 *
 * IMPORTANT: Premium accounts MUST have subscription.expires set to a future date
 * and subscription.status set to 'active'
 */
const STATIC_ACCOUNTS = {
  admin: {
    id: 'admin',
    uid: '_test-admin',
    email: '_test.admin@{domain}',
    properties: {
      roles: { admin: true },
      subscription: { product: { id: 'basic' }, status: 'active' },
      personal: { name: { first: 'Admin', last: 'User' } },
    },
  },
  basic: {
    id: 'basic',
    uid: '_test-basic',
    email: '_test.basic@{domain}',
    properties: {
      roles: {},
      subscription: { product: { id: 'basic' }, status: 'active' },
      personal: { name: { first: 'Alex', last: 'Basic' } },
    },
  },
  'premium-active': {
    id: 'premium-active',
    uid: '_test-premium-active',
    email: '_test.premium-active@{domain}',
    properties: {
      roles: {},
      subscription: { product: { id: 'premium' }, status: 'active', expires: getFutureExpires() },
    },
  },
  'premium-expired': {
    id: 'premium-expired',
    uid: '_test-premium-expired',
    email: '_test.premium-expired@{domain}',
    properties: {
      roles: {},
      subscription: { product: { id: 'premium' }, status: 'cancelled', expires: getPastExpires() },
    },
  },
  'premium-suspended': {
    id: 'premium-suspended',
    uid: '_test-premium-suspended',
    email: '_test.premium-suspended@{domain}',
    properties: {
      roles: {},
      subscription: { product: { id: 'premium' }, status: 'suspended', expires: getFutureExpires() },
    },
  },
  'premium-cancelling': {
    id: 'premium-cancelling',
    uid: '_test-premium-cancelling',
    email: '_test.premium-cancelling@{domain}',
    properties: {
      roles: {},
      subscription: { product: { id: 'premium' }, status: 'active', expires: getFutureExpires(), cancellation: { pending: true } },
    },
  },
  // Post-refund end state (N6 persona): the refund webhook cancels the subscription —
  // the refund itself lives on the ORDER doc, not the user doc — so what remains is a
  // cancelled sub on the test processor with no remaining term. "Unauthed" needs no
  // persona: that's http.as('none') / a signed-out browser.
  refunded: {
    id: 'refunded',
    uid: '_test-refunded',
    email: '_test.refunded@{domain}',
    properties: {
      roles: {},
      subscription: { product: { id: 'premium', name: 'Premium' }, status: 'cancelled', expires: getPastExpires(), cancellation: { pending: false }, payment: { processor: 'test', resourceId: 'sub_test_refunded' } },
    },
  },
  delete: {
    id: 'delete',
    uid: '_test-delete',
    email: '_test.delete@{domain}',
    properties: {
      roles: {},
      subscription: { product: { id: 'premium' }, status: 'active', expires: getFutureExpires() }, // Active subscription - deletion should be blocked initially
    },
  },
  'delete-by-admin': {
    id: 'delete-by-admin',
    uid: '_test-delete-by-admin',
    email: '_test.delete-by-admin@{domain}',
    properties: {
      roles: {},
      // No subscription - can be deleted immediately by admin
    },
  },
  referrer: {
    id: 'referrer',
    uid: '_test-referrer',
    email: '_test.referrer@{domain}',
    properties: {
      roles: {},
      subscription: { product: { id: 'basic' }, status: 'active' },
      affiliate: { code: 'TESTREF', referrals: [] },
    },
  },
};

/**
 * Journey test accounts - for testing subscription/payment flows
 * These accounts transition through states via webhook tests
 */
const JOURNEY_ACCOUNTS = {
  // EVERY account the signup suites sign up lives here — journey, not
  // static: a static seed stamps flags.signupProcessed + consent (cp157),
  // which 400s the very signup these accounts exist to exercise (cp197
  // corpus catch — latently red since cp157; `referrer` stays static, the
  // pre-existing affiliate owner must be established before signups run).
  // The two `consent-*` allow-accounts keep the `_test.allow_*` prefix so
  // the EXTENDED-mode lifecycle test can round-trip SendGrid + Beehiiv
  // (it establishes its own consent state — no seed needed).
  'consent-granted': {
    id: 'consent-granted',
    uid: '_test-allow-consent-granted',
    email: '_test.allow_consent-granted@{domain}',
    properties: {
      roles: {},
      subscription: { product: { id: 'basic' }, status: 'active' },
    },
  },
  'consent-declined': {
    id: 'consent-declined',
    uid: '_test-allow-consent-declined',
    email: '_test.allow_consent-declined@{domain}',
    properties: {
      roles: {},
      subscription: { product: { id: 'basic' }, status: 'active' },
    },
  },
  'consent-missing': {
    id: 'consent-missing',
    uid: '_test-consent-missing',
    email: '_test.consent-missing@{domain}',
    properties: {
      roles: {},
      subscription: { product: { id: 'basic' }, status: 'active' },
    },
  },
  // Used to verify the never-downgrade guard: the test seeds this account's doc with already-
  // granted consent, then re-fires /user/signup with an empty consent payload and asserts the
  // grant is preserved (not flipped to revoked). Dedicated account so the seeded state is isolated.
  'consent-preserve': {
    id: 'consent-preserve',
    uid: '_test-consent-preserve',
    email: '_test.consent-preserve@{domain}',
    properties: {
      roles: {},
      subscription: { product: { id: 'basic' }, status: 'active' },
    },
  },
  // Used to verify buildUserRecord's layered deep-merge: the test seeds this account's doc with
  // real values (api keys, paid subscription, admin role, a custom non-schema field) + a partial
  // attribution, fires /user/signup, and asserts the merge PRESERVES those real/custom values
  // while still filling every schema leaf and applying the signup data on top.
  'signup-merge': {
    id: 'signup-merge',
    uid: '_test-signup-merge',
    email: '_test.signup-merge@{domain}',
    properties: {
      roles: {},
      subscription: { product: { id: 'basic' }, status: 'active' },
    },
  },
  referred: {
    id: 'referred',
    uid: '_test-referred',
    email: '_test.referred@{domain}',
    properties: {
      roles: {},
      subscription: { product: { id: 'basic' }, status: 'active' },
    },
  },
  'referred-invalid': {
    id: 'referred-invalid',
    uid: '_test-referred-invalid',
    email: '_test.referred-invalid@{domain}',
    properties: {
      roles: {},
      subscription: { product: { id: 'basic' }, status: 'active' },
    },
  },
  'referred-disposable': {
    id: 'referred-disposable',
    uid: '_test-referred-disposable',
    email: '_test.referred-disposable@mailinator.com',
    properties: {
      roles: {},
      subscription: { product: { id: 'basic' }, status: 'active' },
    },
  },
  'journey-payments-upgrade': {
    id: 'journey-payments-upgrade',
    uid: '_test-journey-payments-upgrade',
    email: '_test.journey-payments-upgrade@{domain}',
    properties: {
      roles: {},
      subscription: { product: { id: 'basic' }, status: 'active' },
      personal: { name: { first: 'Jordan', last: 'Upgrade' } },
    },
  },
  'journey-payments-cancel': {
    id: 'journey-payments-cancel',
    uid: '_test-journey-payments-cancel',
    email: '_test.journey-payments-cancel@{domain}',
    properties: {
      roles: {},
      subscription: { product: { id: 'basic' }, status: 'active' },
      personal: { name: { first: 'Casey', last: 'Cancel' } },
    },
  },
  'journey-payments-suspend': {
    id: 'journey-payments-suspend',
    uid: '_test-journey-payments-suspend',
    email: '_test.journey-payments-suspend@{domain}',
    properties: {
      roles: {},
      subscription: { product: { id: 'basic' }, status: 'active' },
      personal: { name: { first: 'Sam', last: 'Suspend' } },
    },
  },
  'journey-payments-trial': {
    id: 'journey-payments-trial',
    uid: '_test-journey-payments-trial',
    email: '_test.journey-payments-trial@{domain}',
    properties: {
      roles: {},
      subscription: { product: { id: 'basic' }, status: 'active' },
      personal: { name: { first: 'Taylor', last: 'Trial' } },
    },
  },
  'journey-payments-trial-cancel': {
    id: 'journey-payments-trial-cancel',
    uid: '_test-journey-payments-trial-cancel',
    email: '_test.journey-payments-trial-cancel@{domain}',
    properties: {
      roles: {},
      subscription: { product: { id: 'basic' }, status: 'active' },
      personal: { name: { first: 'Morgan', last: 'Trial' } },
    },
  },
  'journey-payments-failure': {
    id: 'journey-payments-failure',
    uid: '_test-journey-payments-failure',
    email: '_test.journey-payments-failure@{domain}',
    properties: {
      roles: {},
      subscription: { product: { id: 'basic' }, status: 'active' },
      personal: { name: { first: 'Riley', last: 'Failure' } },
    },
  },
  'journey-payments-decline': {
    id: 'journey-payments-decline',
    uid: '_test-journey-payments-decline',
    email: '_test.journey-payments-decline@{domain}',
    properties: {
      roles: {},
      subscription: { product: { id: 'basic' }, status: 'active' },
      personal: { name: { first: 'Dana', last: 'Decline' } },
    },
  },
  'journey-payments-plan-change': {
    id: 'journey-payments-plan-change',
    uid: '_test-journey-payments-plan-change',
    email: '_test.journey-payments-plan-change@{domain}',
    properties: {
      roles: {},
      subscription: { product: { id: 'basic' }, status: 'active' },
      personal: { name: { first: 'Avery', last: 'Planchg' } },
    },
  },
  'journey-payments-one-time': {
    id: 'journey-payments-one-time',
    uid: '_test-journey-payments-one-time',
    email: '_test.journey-payments-one-time@{domain}',
    properties: {
      roles: {},
      subscription: { product: { id: 'basic' }, status: 'active' },
    },
  },
  'journey-payments-intent': {
    id: 'journey-payments-intent',
    uid: '_test-journey-payments-intent',
    email: '_test.journey-payments-intent@{domain}',
    properties: {
      roles: {},
      subscription: { product: { id: 'basic' }, status: 'active' },
    },
  },
  'journey-payments-cancel-route': {
    id: 'journey-payments-cancel-route',
    uid: '_test-journey-payments-cancel-route',
    email: '_test.journey-payments-cancel-route@{domain}',
    properties: {
      roles: {},
      subscription: { product: { id: 'basic' }, status: 'active' },
    },
  },
  'route-cancel-success': {
    id: 'route-cancel-success',
    uid: '_test-route-cancel-success',
    email: '_test.route-cancel-success@{domain}',
    properties: {
      roles: {},
      subscription: { product: { id: 'basic' }, status: 'active' },
    },
  },
  'journey-payments-portal-route': {
    id: 'journey-payments-portal-route',
    uid: '_test-journey-payments-portal-route',
    email: '_test.journey-payments-portal-route@{domain}',
    properties: {
      roles: {},
      subscription: { product: { id: 'basic' }, status: 'active' },
    },
  },
  'journey-payments-intent-discount': {
    id: 'journey-payments-intent-discount',
    uid: '_test-journey-payments-intent-discount',
    email: '_test.journey-payments-intent-discount@{domain}',
    properties: {
      roles: {},
      subscription: { product: { id: 'basic' }, status: 'active' },
      personal: { name: { first: 'Drew', last: 'Discount' } },
    },
  },
  'intent-discount-validation': {
    id: 'intent-discount-validation',
    uid: '_test-intent-discount-validation',
    email: '_test.intent-discount-validation@{domain}',
    properties: {
      roles: {},
      subscription: { product: { id: 'basic' }, status: 'active' },
    },
  },
  'journey-payments-intent-attribution': {
    id: 'journey-payments-intent-attribution',
    uid: '_test-journey-payments-intent-attribution',
    email: '_test.journey-payments-intent-attribution@{domain}',
    properties: {
      roles: {},
      subscription: { product: { id: 'basic' }, status: 'active' },
    },
  },
  'journey-payments-intent-trial': {
    id: 'journey-payments-intent-trial',
    uid: '_test-journey-payments-intent-trial',
    email: '_test.journey-payments-intent-trial@{domain}',
    properties: {
      roles: {},
      subscription: { product: { id: 'basic' }, status: 'active' },
    },
  },
  // Dedicated accounts for cancel validation tests — each needs a distinct, non-conflicting subscription state
  'cancel-no-processor': {
    id: 'cancel-no-processor',
    uid: '_test-cancel-no-processor',
    email: '_test.cancel-no-processor@{domain}',
    properties: {
      roles: {},
      subscription: { product: { id: 'premium', name: 'Premium' }, status: 'active', expires: getFutureExpires(), cancellation: { pending: false }, payment: { processor: null, resourceId: null } },
    },
  },
  'cancel-already-pending': {
    id: 'cancel-already-pending',
    uid: '_test-cancel-already-pending',
    email: '_test.cancel-already-pending@{domain}',
    properties: {
      roles: {},
      subscription: { product: { id: 'premium', name: 'Premium' }, status: 'active', expires: getFutureExpires(), cancellation: { pending: true }, payment: { processor: 'stripe', resourceId: 'sub_test_fake' } },
    },
  },
  'cancel-unknown-processor': {
    id: 'cancel-unknown-processor',
    uid: '_test-cancel-unknown-processor',
    email: '_test.cancel-unknown-processor@{domain}',
    properties: {
      roles: {},
      subscription: { product: { id: 'premium', name: 'Premium' }, status: 'active', expires: getFutureExpires(), cancellation: { pending: false }, payment: { processor: 'unknown-processor', resourceId: 'sub_test_fake' } },
    },
  },
  'cancel-too-young': {
    id: 'cancel-too-young',
    uid: '_test-cancel-too-young',
    email: '_test.cancel-too-young@{domain}',
    properties: {
      roles: {},
      subscription: { product: { id: 'premium', name: 'Premium' }, status: 'active', expires: getFutureExpires(), cancellation: { pending: false }, payment: { processor: 'test', resourceId: 'sub_test_fake', startDate: { timestamp: new Date().toISOString(), timestampUNIX: Math.floor(Date.now() / 1000) } } },
    },
  },
  'cancel-suspended': {
    id: 'cancel-suspended',
    uid: '_test-cancel-suspended',
    email: '_test.cancel-suspended@{domain}',
    properties: {
      roles: {},
      subscription: { product: { id: 'premium', name: 'Premium' }, status: 'suspended', expires: getPastExpires(), cancellation: { pending: false }, payment: { processor: 'test', resourceId: 'sub_test_suspended', startDate: getPastExpires() } },
    },
  },
  // A paid subscriber whose order doc never existed (#210): payment.orderId stays null,
  // so the cancel processor has to resolve the plan's product from the subscription itself.
  'cancel-no-order': {
    id: 'cancel-no-order',
    uid: '_test-cancel-no-order',
    email: '_test.cancel-no-order@{domain}',
    properties: {
      roles: {},
      subscription: { product: { id: 'premium', name: 'Premium' }, status: 'active', expires: getFutureExpires(), cancellation: { pending: false }, payment: { processor: 'test', resourceId: 'sub_test_no_order', startDate: getPastExpires() } },
    },
  },
  // Dedicated accounts for portal validation tests
  'portal-no-processor': {
    id: 'portal-no-processor',
    uid: '_test-portal-no-processor',
    email: '_test.portal-no-processor@{domain}',
    properties: {
      roles: {},
      subscription: { product: { id: 'premium', name: 'Premium' }, status: 'active', expires: getFutureExpires(), payment: { processor: null, resourceId: null } },
    },
  },
  'portal-unknown-processor': {
    id: 'portal-unknown-processor',
    uid: '_test-portal-unknown-processor',
    email: '_test.portal-unknown-processor@{domain}',
    properties: {
      roles: {},
      subscription: { product: { id: 'premium', name: 'Premium' }, status: 'active', expires: getFutureExpires(), payment: { processor: 'unknown-processor', resourceId: 'sub_test_fake' } },
    },
  },
  // Dedicated accounts for refund validation tests
  'refund-active-no-cancel': {
    id: 'refund-active-no-cancel',
    uid: '_test-refund-active-no-cancel',
    email: '_test.refund-active-no-cancel@{domain}',
    properties: {
      roles: {},
      subscription: { product: { id: 'premium', name: 'Premium' }, status: 'active', expires: getFutureExpires(), cancellation: { pending: false }, payment: { processor: 'test', resourceId: 'sub_test_fake' } },
    },
  },
  'refund-no-processor': {
    id: 'refund-no-processor',
    uid: '_test-refund-no-processor',
    email: '_test.refund-no-processor@{domain}',
    properties: {
      roles: {},
      subscription: { product: { id: 'premium', name: 'Premium' }, status: 'cancelled', expires: getPastExpires(), cancellation: { pending: false }, payment: { processor: null, resourceId: null } },
    },
  },
  'refund-unknown-processor': {
    id: 'refund-unknown-processor',
    uid: '_test-refund-unknown-processor',
    email: '_test.refund-unknown-processor@{domain}',
    properties: {
      roles: {},
      subscription: { product: { id: 'premium', name: 'Premium' }, status: 'cancelled', expires: getPastExpires(), cancellation: { pending: false }, payment: { processor: 'unknown-processor', resourceId: 'sub_test_fake' } },
    },
  },
  'refund-expired-payment': {
    id: 'refund-expired-payment',
    uid: '_test-refund-expired-payment',
    email: '_test.refund-expired-payment@{domain}',
    properties: {
      roles: {},
      subscription: { product: { id: 'premium', name: 'Premium' }, status: 'cancelled', expires: getPastExpires(), cancellation: { pending: false }, payment: { processor: 'test', resourceId: 'sub_test_fake', startDate: getPastExpires() } },
    },
  },
  // A paid subscriber, pending cancellation, whose order doc never existed (#216):
  // payment.orderId stays null, so the refund processor has to resolve the plan's
  // product from the subscription itself.
  'refund-no-order': {
    id: 'refund-no-order',
    uid: '_test-refund-no-order',
    email: '_test.refund-no-order@{domain}',
    properties: {
      roles: {},
      subscription: { product: { id: 'premium', name: 'Premium' }, status: 'active', expires: getFutureExpires(), cancellation: { pending: true }, payment: { processor: 'test', resourceId: 'sub_test_refund_no_order', startDate: { timestamp: new Date().toISOString(), timestampUNIX: Math.floor(Date.now() / 1000) } } },
    },
  },
  'route-refund-success': {
    id: 'route-refund-success',
    uid: '_test-route-refund-success',
    email: '_test.route-refund-success@{domain}',
    properties: {
      roles: {},
      subscription: { product: { id: 'basic' }, status: 'active' },
    },
  },
  // Journey: refund webhook transition (charge.refunded fires payment-refunded transition)
  'journey-payments-refund-webhook': {
    id: 'journey-payments-refund-webhook',
    uid: '_test-journey-payments-refund-webhook',
    email: '_test.journey-payments-refund-webhook@{domain}',
    properties: {
      roles: {},
      subscription: { product: { id: 'basic' }, status: 'active' },
    },
  },
  // Journey: one-time purchase refunded end-to-end (buy with the test processor, refund it)
  'journey-payments-one-time-refund': {
    id: 'journey-payments-one-time-refund',
    uid: '_test-journey-payments-one-time-refund',
    email: '_test.journey-payments-one-time-refund@{domain}',
    properties: {
      roles: {},
      subscription: { product: { id: 'basic' }, status: 'active' },
    },
  },
  // Journey: UID resolution fallback (webhook without uid in metadata, resolved from fetched resource)
  'journey-payments-uid-resolution': {
    id: 'journey-payments-uid-resolution',
    uid: '_test-journey-payments-uid-resolution',
    email: '_test.journey-payments-uid-resolution@{domain}',
    properties: {
      roles: {},
      subscription: { product: { id: 'basic' }, status: 'active' },
    },
  },
  // Journey: legacy product ID resolution (webhook with legacy product ID maps to correct product)
  'journey-payments-legacy-product': {
    id: 'journey-payments-legacy-product',
    uid: '_test-journey-payments-legacy-product',
    email: '_test.journey-payments-legacy-product@{domain}',
    properties: {
      roles: {},
      subscription: { product: { id: 'basic' }, status: 'active' },
    },
  },
  // Dedicated accounts for user resolve tests — must not be reused by other tests
  'resolve-premium-active': {
    id: 'resolve-premium-active',
    uid: '_test-resolve-premium-active',
    email: '_test.resolve-premium-active@{domain}',
    properties: {
      roles: {},
      subscription: { product: { id: 'premium' }, status: 'active', expires: getFutureExpires() },
    },
  },
  'resolve-premium-expired': {
    id: 'resolve-premium-expired',
    uid: '_test-resolve-premium-expired',
    email: '_test.resolve-premium-expired@{domain}',
    properties: {
      roles: {},
      subscription: { product: { id: 'premium' }, status: 'cancelled', expires: getPastExpires() },
    },
  },
  // Journey: marketing webhook revocation (test/routes/marketing/webhook.js). The
  // SendGrid/Beehiiv revoke-event tests repeatedly write consent.marketing.status='revoked'
  // to the target account — persistent side-effect data, so it must never be the shared
  // `basic` account (revoked consent would persist for the rest of the run and trip the
  // email library's consent gate for every later sync of that account).
  'journey-webhook-revoke': {
    id: 'journey-webhook-revoke',
    uid: '_test-journey-webhook-revoke',
    email: '_test.journey-webhook-revoke@{domain}',
    properties: {
      roles: {},
      subscription: { product: { id: 'basic' }, status: 'active' },
      personal: { name: { first: 'Webb', last: 'Revoke' } },
    },
  },
  // Journey: live-provider sync round-trip (test/email/marketing-lifecycle.js, extended
  // mode only). The `_test.allow_*` email prefix bypasses the `_test.*` marketing block so
  // sync() reaches real SendGrid/Beehiiv; the suite's cleanup DELETE then removes the
  // contact AND mirrors revoked consent to this account's doc. Dedicated account so that
  // side effect stays isolated — the shared `consent-granted` sentinel is used by the
  // signup and consent-lifecycle suites and must keep its granted state.
  'journey-marketing-sync': {
    id: 'journey-marketing-sync',
    uid: '_test-journey-marketing-sync',
    email: '_test.allow_journey-marketing-sync@{domain}',
    properties: {
      roles: {},
      subscription: { product: { id: 'basic' }, status: 'active' },
      personal: { name: { first: 'Lifecycle', last: 'Sync' } },
    },
  },
  // Flows-lane billing journeys (#209): the root `npm run test:flows` lane
  // drives a REAL browser through upgrade, cancel, a declined renewal, and a
  // trial. Ian's rule is one DEDICATED persona per journey — shared with no
  // other journey and no other lane — so no journey can inherit another's
  // subscription state. They are their own personas rather than the
  // same-named `journey-payments-*` ones for exactly that reason (and because
  // the cancel journey needs a paid start, which the payments cancel journey
  // must NOT have — it buys its own subscription first).
  //
  // Unlike every other journey account these are seeded as ESTABLISHED users
  // (signup-processed, legal consent granted, like the static personas): the
  // frontend consent guard signs a processed-but-unconsented doc out on its
  // NEXT page load, and a browser journey spans several loads.
  //
  // Trial-INELIGIBLE by design: this journey proves the DIRECT paid path, so
  // it must never be handed the 14-day trial the trial journey exists to
  // cover. Eligibility is NOT read off this doc — /payments/trial-eligibility
  // and the intent route's own downgrade guard both run the SAME query
  // (payments-orders where owner == uid and type == 'subscription'), so the
  // flows lane stands `orderId` up as a lapsed purchase record beside this
  // seed. The doc carries the matching story: it subscribed two years ago,
  // the term ran out a year ago, and it is back on basic — the shape the
  // cancel route itself writes when it resets a dead subscription.
  'journey-flows-upgrade': {
    id: 'journey-flows-upgrade',
    uid: '_test-journey-flows-upgrade',
    email: '_test.journey-flows-upgrade@{domain}',
    properties: {
      roles: {},
      subscription: {
        product: { id: 'basic' },
        status: 'cancelled',
        expires: getPastExpires(),
        cancellation: { pending: false },
        payment: { processor: 'test', resourceId: 'sub_test_journey_flows_upgrade', orderId: '_test-order-journey-flows-upgrade', startDate: getPastExpires(2) },
      },
      personal: { name: { first: 'Jules', last: 'Upgrade' } },
      flags: { signupProcessed: true },
      consent: seededConsent(),
    },
  },
  // The one journey that starts PAID: a cancellation needs something to
  // cancel, and the cancel route requires an active paid subscription with
  // processor details that is older than 24 hours (its age guard), so the
  // start state is seeded rather than bought. `orderId` names the purchase
  // record the flows lane stands up beside this doc — the test cancel
  // processor reads the plan's processor product id off that order.
  'journey-flows-cancel': {
    id: 'journey-flows-cancel',
    uid: '_test-journey-flows-cancel',
    email: '_test.journey-flows-cancel@{domain}',
    properties: {
      roles: {},
      subscription: {
        product: { id: 'premium' },
        status: 'active',
        expires: getFutureExpires(),
        cancellation: { pending: false },
        payment: { processor: 'test', resourceId: 'sub_test_journey_flows_cancel', orderId: '_test-order-journey-flows-cancel', startDate: getPastExpires() },
      },
      personal: { name: { first: 'Kit', last: 'Cancel' } },
      flags: { signupProcessed: true },
      consent: seededConsent(),
    },
  },
  // Trial-INELIGIBLE for the same reason, and by the same means: a declined
  // RENEWAL is a PAYER's event, so this journey's checkout has to land a paid
  // subscription rather than the 14-day trial a pristine account is offered.
  // Same lapsed-history shape as the upgrade persona, with its own order
  // record — the eligibility query is per-owner.
  'journey-flows-failure': {
    id: 'journey-flows-failure',
    uid: '_test-journey-flows-failure',
    email: '_test.journey-flows-failure@{domain}',
    properties: {
      roles: {},
      subscription: {
        product: { id: 'basic' },
        status: 'cancelled',
        expires: getPastExpires(),
        cancellation: { pending: false },
        payment: { processor: 'test', resourceId: 'sub_test_journey_flows_failure', orderId: '_test-order-journey-flows-failure', startDate: getPastExpires(2) },
      },
      personal: { name: { first: 'Robin', last: 'Failure' } },
      flags: { signupProcessed: true },
      consent: seededConsent(),
    },
  },
  'journey-flows-trial': {
    id: 'journey-flows-trial',
    uid: '_test-journey-flows-trial',
    email: '_test.journey-flows-trial@{domain}',
    properties: {
      roles: {},
      subscription: { product: { id: 'basic' }, status: 'active' },
      personal: { name: { first: 'Quinn', last: 'Trial' } },
      flags: { signupProcessed: true },
      consent: seededConsent(),
    },
  },
};

/**
 * Google picker personas (Ian 2026-07-16) — the Auth emulator's "Sign in
 * with Google" picker only lists accounts whose auth record carries a
 * google.com provider, so a fresh emulator showed "No Google accounts".
 * These are IMPORT-ONLY (importUsers with providerData — the one server-side
 * surface that writes it; the emulator refuses imports over an existing uid,
 * so they never go through createAccount). Deliberately NO user doc at seed
 * time: their FIRST popup sign-in fires auth:on-create and materializes the
 * doc exactly like a production Google user. Not part of TEST_ACCOUNTS —
 * they exist for the picker, not for API-credentialed test flows.
 */
const GOOGLE_ACCOUNTS = {
  'google-one': {
    id: 'google-one',
    uid: '_test-google-one',
    email: '_test.google.one@{domain}',
    name: 'Google One',
  },
  'google-two': {
    id: 'google-two',
    uid: '_test-google-two',
    email: '_test.google.two@{domain}',
    name: 'Google Two',
  },
};

/**
 * All test accounts combined
 */
const TEST_ACCOUNTS = {
  ...STATIC_ACCOUNTS,
  ...JOURNEY_ACCOUNTS,
};

/**
 * Canonical seeded-consent record (mirrors buildConsentRecord's granted
 * shape, source 'seed'): legal granted — the consent guard's requirement —
 * and marketing revoked (personas never join real marketing lists; the
 * _test.* block at the providers is the second fence).
 * @returns {object} consent user-doc section
 */
function seededConsent() {
  const now = new Date();
  const stamp = {
    timestamp: now.toISOString(),
    timestampUNIX: Math.floor(now.getTime() / 1000),
    source: 'seed',
    ip: null,
    text: null,
  };
  const emptyMeta = { timestamp: null, timestampUNIX: null, source: null, ip: null, text: null };

  return {
    legal: { status: 'granted', grantedAt: { ...stamp } },
    marketing: { status: 'revoked', grantedAt: { ...emptyMeta }, revokedAt: { ...stamp } },
  };
}

/**
 * Get all test account definitions with resolved emails and dynamic product IDs
 * @param {string} domain - Domain for email addresses (e.g., 'itwcreativeworks.com')
 * @param {object} [config] - @omega.js/backend config (used to resolve first paid product)
 * @param {object} [extraAccounts] - Project-defined accounts from test/_init.js,
 *   keyed by id, each `{ id, uid, email, properties }`. Merged after the built-in
 *   accounts; a project account may override a built-in one by reusing its key.
 * @returns {object} Account definitions with resolved emails
 */
function getAccountDefinitions(domain, config, extraAccounts) {
  const paidProduct = getFirstPaidProduct(config);
  const accounts = {};

  const all = { ...TEST_ACCOUNTS, ...(extraAccounts || {}) };

  for (const [key, account] of Object.entries(all)) {
    const properties = JSON.parse(JSON.stringify(account.properties || {}));

    // Replace hardcoded 'premium' product with the actual first paid product from config
    if (properties.subscription?.product?.id === 'premium') {
      properties.subscription.product.id = paidProduct.id;
      properties.subscription.product.name = paidProduct.name;
    }

    // STATIC personas are ESTABLISHED users: born signup-processed with
    // granted legal consent (source 'seed'), so the frontend consent guard —
    // which signs out processed-but-unconsented docs as signup orphans —
    // accepts every auth flow (password, custom token, Google picker).
    // JOURNEY accounts stay untouched: their tests exercise the signup
    // pipeline and seed their own flag/consent states explicitly.
    if (STATIC_ACCOUNTS[key]) {
      properties.flags = { signupProcessed: true, ...(properties.flags || {}) };
      properties.consent = properties.consent || seededConsent();
    }

    accounts[key] = {
      id: account.id,
      uid: account.uid,
      email: (account.email || '').replace('{domain}', domain),
      properties,
    };
  }

  return accounts;
}

/**
 * Fetch privateKeys for test accounts from Firestore
 * @param {object} admin - Firebase admin instance
 * @param {string} domain - Domain for email addresses (e.g., 'itwcreativeworks.com')
 * @param {object} [config] - @omega.js/backend config (used to resolve first paid product)
 * @param {object} [extraAccounts] - Project-defined accounts from test/_init.js
 * @returns {Promise<object>} Account credentials with privateKeys
 */
async function fetchPrivateKeys(admin, domain, config, extraAccounts) {
  const definitions = getAccountDefinitions(domain, config, extraAccounts);
  const accounts = {};

  // Fetch all in parallel
  const entries = Object.entries(definitions);
  const results = await Promise.all(
    entries.map(async ([key, account]) => {
      try {
        const doc = await admin.firestore().doc(`users/${account.uid}`).get();

        if (doc.exists) {
          const data = doc.data();
          return {
            key,
            data: {
              uid: account.uid,
              email: account.email,
              privateKey: data.api?.privateKey || null,
              exists: true,
            },
          };
        }

        return {
          key,
          data: {
            uid: account.uid,
            email: account.email,
            privateKey: null,
            exists: false,
          },
        };
      } catch (error) {
        console.error(`Error fetching account ${key}:`, error.message);
        return {
          key,
          data: {
            uid: account.uid,
            email: account.email,
            privateKey: null,
            exists: false,
            error: error.message,
          },
        };
      }
    })
  );

  // Convert array back to object
  for (const { key, data } of results) {
    accounts[key] = data;
  }

  return accounts;
}

/**
 * Create a single test account
 * Assumes deleteTestUsers() was called first to ensure clean state
 * Creates Firebase Auth user, waits for auth:on-create, then merges test properties
 * @param {object} admin - Firebase admin instance
 * @param {object} account - Account definition with uid, email, properties
 * @returns {Promise<object>} Result { uid, email }
 */
async function createAccount(admin, account) {
  const userRef = admin.firestore().doc(`users/${account.uid}`);

  // The Auth user for this UID was just deleted (deleteTestUsers). Its auth:on-delete
  // trigger deletes the Firestore doc ASYNCHRONOUSLY and the emulator does NOT guarantee
  // it fires (or finishes) before our subsequent createUser()'s auth:on-create. A stale
  // on-delete can therefore land AFTER on-create and silently wipe the freshly-written
  // doc — leaving the account with no api.clientId/privateKey. That intermittent clobber
  // is what made the account-structure validation (and every downstream auth/payment test)
  // flaky. We defend with a verify-and-repair retry: create → wait for the on-create write
  // to be COMPLETE (api keys present, not just metadata.tag) → merge props → re-verify the
  // keys survived. If a late on-delete clobbered the doc, recreate from scratch.
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Create Firebase Auth user - triggers auth:on-create. The deterministic
    // password is the manual-signin surface (see TEST_ACCOUNT_PASSWORD).
    await admin.auth().createUser({
      uid: account.uid,
      email: account.email,
      password: TEST_ACCOUNT_PASSWORD,
      emailVerified: true,
    }).catch(async (e) => {
      // A retry may find the Auth user already present (its doc was clobbered, not the
      // user). Delete it first so the fresh createUser re-fires a clean on-create.
      if (e.code === 'auth/uid-already-exists') {
        await admin.auth().deleteUser(account.uid).catch(() => {});
        await waitForDocGone(userRef);
        await admin.auth().createUser({
          uid: account.uid,
          email: account.email,
          password: TEST_ACCOUNT_PASSWORD,
          emailVerified: true,
        });
      } else {
        throw e;
      }
    });

    // Wait for auth:on-create to COMPLETE. Poll on the api keys themselves — the fields the
    // tests actually require — not just metadata.tag, which on its own doesn't prove the
    // doc wasn't subsequently clobbered.
    const ready = await waitForAccountReady(userRef);

    // Merge test-specific properties (roles, subscription, etc.)
    await userRef.set(account.properties, { merge: true });

    // Re-verify after the merge: a late on-delete could have struck between the poll and
    // here. If the api keys survived, the account is good. Otherwise loop and recreate.
    const finalDoc = await userRef.get();
    const data = finalDoc.data() || {};
    if (ready && data.api?.clientId && data.api?.privateKey) {
      return { uid: account.uid, email: account.email };
    }

    // Clobbered (or never completed). Tear down the Auth user so the next attempt starts
    // from a clean slate, then retry.
    if (attempt < maxAttempts) {
      await admin.auth().deleteUser(account.uid).catch(() => {});
      await waitForDocGone(userRef);
    }
  }

  // Exhausted retries — return anyway so the runner reports the downstream failure with a
  // meaningful test assertion rather than a setup throw.
  return { uid: account.uid, email: account.email };
}

/**
 * Import a FRESH auth record carrying a google.com provider so the Auth
 * emulator's Google sign-in picker lists it (the emulator refuses imports
 * over an existing uid — these accounts exist only via this import).
 * @param {object} admin - Firebase admin instance
 * @param {object} account - Definition with uid, resolved email, name
 */
async function importGoogleAccount(admin, account) {
  const result = await admin.auth().importUsers([{
    uid: account.uid,
    email: account.email,
    emailVerified: true,
    displayName: account.name || account.email,
    providerData: [{
      uid: `google-${account.uid}`,
      providerId: 'google.com',
      email: account.email,
      displayName: account.name || account.email,
    }],
  }]);

  if (result.failureCount > 0) {
    throw new Error(`importUsers (google provider): ${result.errors[0]?.error?.message || 'failed'}`);
  }
}

/**
 * Poll until a user doc reflects a COMPLETE auth:on-create write (api keys present).
 * Returns true if it became ready within the window, false on timeout.
 */
async function waitForAccountReady(userRef) {
  const maxWait = 15000;
  const pollInterval = 500;
  let waited = 0;

  while (waited < maxWait) {
    const doc = await userRef.get();
    const data = doc.exists ? doc.data() : null;
    if (
      data?.metadata?.tag === 'auth:on-create'
      && data.api?.clientId
      && data.api?.privateKey
    ) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, pollInterval));
    waited += pollInterval;
  }

  return false;
}

/**
 * Poll until a user doc no longer exists (on-delete settled). Bounded; best-effort.
 */
async function waitForDocGone(userRef) {
  const maxWait = 10000;
  const pollInterval = 200;
  let waited = 0;

  while (waited < maxWait) {
    const doc = await userRef.get();
    if (!doc.exists) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, pollInterval));
    waited += pollInterval;
  }

  // Fallback: force-delete the lingering doc so the next create starts clean.
  await userRef.delete().catch(() => {});
}

/**
 * Flush the ENTIRE emulator Firestore — every top-level collection, recursively.
 *
 * SAFETY: this is destructive, so it ONLY runs when connected to the Firestore
 * emulator (`FIRESTORE_EMULATOR_HOST` is set — which the test command always
 * sets). If that env var is absent, this is a no-op, so it can never wipe a real
 * project's data. The emulator DB is entirely test data, so a full flush is the
 * simplest correct "clean slate" — no per-collection allowlist to maintain.
 *
 * @param {object} admin - Firebase admin instance
 */
async function flushEmulatorFirestore(admin) {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    // Not pointed at the emulator — refuse to mass-delete. No-op.
    return;
  }

  const firestore = admin.firestore();
  const collections = await firestore.listCollections().catch(() => []);

  await Promise.all(
    collections.map((collectionRef) => firestore.recursiveDelete(collectionRef).catch(() => {}))
  );
}

/**
 * Delete all test users (both Auth and Firestore)
 * Uses TEST_ACCOUNTS (+ any project-defined accounts) as the source of truth for
 * which UIDs to delete. Deleting Auth users triggers on-delete which handles
 * Firestore doc + count decrement.
 * Called before test runs to ensure a clean slate. Flushes the ENTIRE emulator
 * Firestore (the emulator DB is 100% test data — there's nothing to preserve),
 * then deletes the Auth test users. `test/_init.js`'s `setup()` reseeds fixtures
 * afterward. Waits for Firestore docs to be deleted before returning.
 * @param {object} admin - Firebase admin instance
 * @param {object} [extraAccounts] - Project-defined accounts from test/_init.js
 * @returns {Promise<object>} Result with deleted count
 */
async function deleteTestUsers(admin, extraAccounts) {
  const results = { deleted: [], skipped: [], failed: [] };

  // Wipe the entire emulator Firestore up front (guarded to emulator-only).
  await flushEmulatorFirestore(admin);

  // Clear auth users via the emulator's bulk-clear REST API instead of
  // individual deleteUser() calls. Individual deletes trigger auth:on-delete
  // for EACH user, and those triggers fire asynchronously — a late on-delete
  // can land AFTER the subsequent createTestAccounts() on-create and clobber
  // the freshly-written doc (80% repro rate in stress tests). The bulk API
  // clears the auth store without triggering event handlers at all.
  const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const projectId = process.env.GCLOUD_PROJECT || 'demo-test';

  if (authHost) {
    try {
      const url = `http://${authHost}/emulator/v1/projects/${projectId}/accounts`;
      await fetch(url, { method: 'DELETE' });

      // Count all known accounts as deleted (the bulk API doesn't return per-user results)
      const allAccounts = { ...TEST_ACCOUNTS, ...(extraAccounts || {}) };
      results.deleted = Object.values(allAccounts).map(a => a.uid);
    } catch (e) {
      // Bulk clear failed — fall back to individual deletes
      const allAccounts = { ...TEST_ACCOUNTS, ...(extraAccounts || {}) };
      await _deleteAccountsIndividually(admin, allAccounts, results);
    }
  } else {
    // Not running against emulator — fall back to individual deletes
    const allAccounts = { ...TEST_ACCOUNTS, ...(extraAccounts || {}) };
    await _deleteAccountsIndividually(admin, allAccounts, results);
  }

  // Realtime Database: wipe the `_test` namespace in full. (The Firestore-wide
  // flush already ran in flushEmulatorFirestore() at the start of this function.)
  // `admin.database()` throws synchronously when no Database URL is configured,
  // so guard the whole thing — RTDB is optional for a project.
  try {
    await admin.database().ref('_test').remove();
  } catch (e) {
    // RTDB not configured / no database URL — ignore.
  }

  return {
    success: results.failed.length === 0,
    deleted: results.deleted.length,
    skipped: results.skipped.length,
    failed: results.failed.length,
    errors: results.failed,
  };
}

async function _deleteAccountsIndividually(admin, allAccounts, results) {
  await Promise.all(
    Object.values(allAccounts).map(async (account) => {
      try {
        await admin.auth().deleteUser(account.uid);

        const maxWait = 10000;
        const interval = 200;
        let waited = 0;

        while (waited < maxWait) {
          const doc = await admin.firestore().doc(`users/${account.uid}`).get();
          if (!doc.exists) {
            break;
          }
          await new Promise(resolve => setTimeout(resolve, interval));
          waited += interval;
        }

        if (waited >= maxWait) {
          await admin.firestore().doc(`users/${account.uid}`).delete().catch(() => {});
        }

        results.deleted.push(account.uid);
      } catch (error) {
        if (error.code === 'auth/user-not-found') {
          await admin.firestore().doc(`users/${account.uid}`).delete().catch(() => {});
          results.skipped.push(account.uid);
        } else {
          results.failed.push({ uid: account.uid, error: error.message });
        }
      }
    })
  );
}

/**
 * Create all test accounts
 * Assumes deleteTestUsers() was called first to ensure clean state
 * @param {object} admin - Firebase admin instance
 * @param {string} domain - Domain for email addresses (e.g., 'itwcreativeworks.com')
 * @param {object} [config] - @omega.js/backend config (used to resolve first paid product)
 * @param {object} [extraAccounts] - Project-defined accounts from test/_init.js
 * @returns {Promise<object>} Result with created/failed counts
 */
async function createTestAccounts(admin, domain, config, extraAccounts) {
  const definitions = getAccountDefinitions(domain, config, extraAccounts);
  const results = { created: [], failed: [] };

  // Create all accounts in parallel
  await Promise.all(
    Object.entries(definitions).map(async ([key, account]) => {
      try {
        await createAccount(admin, account);
        results.created.push({ id: key, uid: account.uid, email: account.email });
      } catch (error) {
        results.failed.push({ id: key, uid: account.uid, email: account.email, error: error.message });
      }
    })
  );

  // Google picker personas — import-only (fresh uids; see GOOGLE_ACCOUNTS)
  await Promise.all(
    Object.values(GOOGLE_ACCOUNTS).map(async (account) => {
      const email = account.email.replace('{domain}', domain);
      try {
        await importGoogleAccount(admin, { ...account, email });
        results.created.push({ id: account.id, uid: account.uid, email });
      } catch (error) {
        results.failed.push({ id: account.id, uid: account.uid, email, error: error.message });
      }
    })
  );

  return {
    success: results.failed.length === 0,
    created: results.created.length,
    failed: results.failed.length,
    accounts: results.created,
    errors: results.failed,
  };
}

/**
 * Seed a persona's canonical purchase record — the `payments-orders/{orderId}` doc
 * that account seeding itself never writes. Persona seeding writes user docs and
 * NOTHING else, so a seeded subscription arrives without the order record every real
 * purchase leaves behind, and two backend surfaces read exactly that record: the test
 * cancel processor (it reads the plan's processor product id off the LIVE order) and
 * the per-owner trial-eligibility query (any prior subscription order disqualifies).
 *
 * Only the personas whose seed carries `subscription.payment.orderId` have a purchase
 * record; everything else is a no-op (a pristine account has bought nothing).
 *
 * The record's status MIRRORS the seeded subscription's — an order's `unified.status`
 * IS the state of the subscription it bought, so it is not a second fact to keep in
 * step: an active paid persona carries a live order, a lapsed one a cancelled one.
 *
 * @param {object} admin - Firebase admin instance (pointed at the emulator)
 * @param {string} key - Account key in TEST_ACCOUNTS (e.g. 'journey-flows-cancel')
 * @param {object} [config] - @omega.js/backend config (resolves the paid product)
 * @returns {Promise<object|null>} `{ orderId, status }`, or null when the persona carries no order
 */
async function seedOrderFixture(admin, key, config) {
  const account = TEST_ACCOUNTS[key];

  if (!account) {
    throw new Error(`No seeded persona named ${key} — there is no order fixture to seed`);
  }

  const subscription = account.properties?.subscription || {};
  const payment = subscription.payment || {};

  if (!payment.orderId) {
    return null;
  }

  const paidProduct = getFirstPaidProduct(config);
  const status = subscription.status;

  await admin.firestore().doc(`payments-orders/${payment.orderId}`).set({
    id: payment.orderId,
    type: 'subscription',
    owner: account.uid,
    productId: paidProduct.id,
    processor: payment.processor,
    resourceId: payment.resourceId,
    unified: { product: { id: paidProduct.id, name: paidProduct.name }, status },
  }, { merge: true });

  return { orderId: payment.orderId, status };
}

/**
 * Test data constants - SSOT for test values
 */
const TEST_DATA = {
  affiliateCode: 'TESTREF',
  filterUid: 'test-user-uid-12345',
  defaultProjectId: 'demo-test',
};

module.exports = {
  STATIC_ACCOUNTS,
  JOURNEY_ACCOUNTS,
  GOOGLE_ACCOUNTS,
  TEST_ACCOUNTS,
  TEST_DATA,
  TEST_ACCOUNT_PASSWORD,
  getFirstPaidProduct,
  getAccountDefinitions,
  fetchPrivateKeys,
  deleteTestUsers,
  createAccount,
  createTestAccounts,
  seedOrderFixture,
};
