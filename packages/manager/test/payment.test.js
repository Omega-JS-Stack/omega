/**
 * Payment service tests — all 11 operations against method-level recording
 * fakes for Stripe, PayPal, and Chargebee. Proves skip semantics (enabled
 * flag, paid-product gate, per-processor credentials, --processor filter,
 * config `false` disables), the converged zero-mutation no-op across all
 * three processors, product resolution self-heal (Stripe by metadata,
 * PayPal by exact name, Chargebee by deterministic ID), price/plan drift
 * reconciliation, webhook create/diff/re-enable with exact payloads, the
 * no-API manual-guidance ops (radar/disputes warned until confirmed), and
 * the dry-run zero-mutation guarantee on a fully drifted account.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { OPERATIONS, DEFAULTS } = require('../src/config.js');
const service = require('../src/services/payment/index.js');
const { openTtyPrompt } = require('./lib/interactive.js');

// Tests must never see real credentials from the shell environment
delete process.env.STRIPE_SECRET_KEY;
delete process.env.PAYPAL_CLIENT_SECRET;
delete process.env.CHARGEBEE_API_KEY;
delete process.env.BACKEND_MANAGER_WEBHOOK_KEY;

const BRAND_ID = 'fixture-brand';
const DOMAIN = 'fixture-brand.test';
const BRAND_NAME = 'Fixture Brand';
const BRAND_URL = `https://${DOMAIN}`;
const BRAND_DESC = 'A fixture brand';
const CONTACT_EMAIL = `support@${DOMAIN}`;
const BRANDMARK = `${BRAND_URL}/brandmark.png`;
const WEBHOOK_KEY = 'fixture-webhook-key';
const STRIPE_WEBHOOK_URL = `https://api.${DOMAIN}/backend-manager/payments/webhook?processor=stripe&key=${WEBHOOK_KEY}`;
const PAYPAL_WEBHOOK_URL = `https://api.${DOMAIN}/backend-manager/payments/webhook?processor=paypal&key=${WEBHOOK_KEY}`;
const CHARGEBEE_WEBHOOK_URL = `https://api.${DOMAIN}/backend-manager/payments/webhook?processor=chargebee&brand=${BRAND_ID}&key=${WEBHOOK_KEY}`;

// Mirrors of the handlers' event lists (pins the desired sets)
const STRIPE_EVENTS = [
  'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted',
  'customer.subscription.paused', 'customer.subscription.resumed', 'customer.subscription.trial_will_end',
  'invoice.created', 'invoice.paid', 'invoice.payment_succeeded', 'invoice.payment_failed',
  'invoice.payment_action_required',
  'checkout.session.completed', 'charge.succeeded', 'charge.failed', 'charge.refunded',
  'payment_intent.succeeded', 'payment_intent.payment_failed',
];
const PAYPAL_EVENTS = [
  'BILLING.SUBSCRIPTION.CREATED', 'BILLING.SUBSCRIPTION.ACTIVATED', 'BILLING.SUBSCRIPTION.UPDATED',
  'BILLING.SUBSCRIPTION.CANCELLED', 'BILLING.SUBSCRIPTION.SUSPENDED', 'BILLING.SUBSCRIPTION.EXPIRED',
  'BILLING.SUBSCRIPTION.PAYMENT.FAILED', 'BILLING.SUBSCRIPTION.RE-ACTIVATED',
  'CHECKOUT.ORDER.COMPLETED', 'CHECKOUT.ORDER.APPROVED',
  'PAYMENT.SALE.COMPLETED', 'PAYMENT.SALE.DENIED', 'PAYMENT.SALE.REFUNDED',
  'PAYMENT.CAPTURE.COMPLETED', 'PAYMENT.CAPTURE.DENIED', 'PAYMENT.CAPTURE.REFUNDED',
  'INVOICING.INVOICE.CREATED', 'INVOICING.INVOICE.PAID', 'INVOICING.INVOICE.CANCELLED',
];
const CHARGEBEE_EVENTS = [
  'subscription_created', 'subscription_started', 'subscription_activated', 'subscription_changed',
  'subscription_cancelled', 'subscription_paused', 'subscription_resumed', 'subscription_renewed',
  'subscription_reactivated', 'subscription_trial_end_reminder',
  'payment_succeeded', 'payment_failed', 'payment_refunded',
  'invoice_generated', 'invoice_updated',
];

// ─── Fixtures ────────────────────────────────────────────────────────────────

/**
 * Product set: a free tier (no prices — never reconciled), a subscription
 * with a trial, a one-time product, and an archived leftover (never
 * reconciled). Per-processor IDs are injected per test via `ids`.
 */
function makeProducts({ ids = {} } = {}) {
  return [
    { id: 'free', name: 'Free', type: 'subscription' },
    {
      id: 'plus',
      name: 'Plus',
      type: 'subscription',
      trial: { days: 14 },
      prices: { monthly: 10, annually: 100 },
      ...(ids.plus || {}),
    },
    {
      id: 'credits',
      name: 'Credits',
      type: 'one-time',
      prices: { once: 5 },
      ...(ids.credits || {}),
    },
    { id: 'old', name: 'Old', type: 'subscription', archived: true, prices: { monthly: 3 } },
  ];
}

function brandConfig({ url = BRAND_URL, products = makeProducts(), payment = {}, brandmark = BRANDMARK, firebase = {} } = {}) {
  const paymentDefaults = structuredClone(DEFAULTS.payment);
  return {
    brand: {
      id: BRAND_ID,
      name: BRAND_NAME,
      url,
      description: BRAND_DESC,
      contact: { email: CONTACT_EMAIL },
      images: brandmark ? { brandmark } : {},
    },
    firebase: { shared: false, ...firebase },
    payment: {
      ...paymentDefaults,
      ...payment,
      processors: { ...paymentDefaults.processors, ...(payment.processors || {}) },
      products,
    },
    targets: { web: {}, backend: {} },
  };
}

/** Method-level recording fake — a call with no configured response throws LOUDLY. */
function makeFake(name, readMethods, mutatingMethods, responses, { syncMethods = [], props = {} } = {}) {
  const api = { calls: [], ...props };

  for (const method of [...readMethods, ...mutatingMethods]) {
    const respond = (...args) => {
      api.calls.push({ method, args });
      if (!(method in responses)) {
        throw new Error(`${name}: unexpected call ${method}(${JSON.stringify(args)})`);
      }
      const responder = responses[method];
      const result = typeof responder === 'function' ? responder(...args) : structuredClone(responder);
      return result;
    };
    // getAccountInfo is synchronous on the real PayPalAPI
    api[method] = syncMethods.includes(method) ? respond : async (...args) => respond(...args);
  }

  api.mutations = () => api.calls.filter((c) => mutatingMethods.includes(c.method));
  api.callsTo = (method) => api.calls.filter((c) => c.method === method);
  return api;
}

const STRIPE_READS = ['getAccount', 'getProduct', 'listAllProducts', 'listPricesForProduct', 'listWebhookEndpoints'];
const STRIPE_MUTATIONS = ['updateAccount', 'createProduct', 'updateProduct', 'createRecurringPrice', 'createOneTimePrice', 'archivePrice', 'createWebhookEndpoint', 'updateWebhookEndpoint'];
const fakeStripe = (responses = {}) => makeFake('fakeStripe', STRIPE_READS, STRIPE_MUTATIONS, responses);

const PAYPAL_READS = ['getAccessToken', 'getAccountInfo', 'listProducts', 'getProduct', 'listPlansForProduct', 'listWebhooks'];
const PAYPAL_MUTATIONS = ['createProduct', 'updateProduct', 'createPlan', 'deactivatePlan', 'createWebhook', 'updateWebhook'];
const fakePaypal = (responses = {}) => makeFake('fakePaypal', PAYPAL_READS, PAYPAL_MUTATIONS, responses, { syncMethods: ['getAccountInfo'] });

const CHARGEBEE_READS = ['makeRequest', 'getItemFamily', 'getItem', 'listItemPricesForItem', 'getPlan', 'listWebhooks'];
const CHARGEBEE_MUTATIONS = ['createItemFamily', 'updateItemFamily', 'createItem', 'updateItem', 'createItemPrice', 'updateItemPrice', 'createWebhook', 'updateWebhook'];
const fakeChargebee = (responses = {}) => makeFake('fakeChargebee', CHARGEBEE_READS, CHARGEBEE_MUTATIONS, responses, { props: { site: 'fixture-site' } });

// ─── Converged responders ────────────────────────────────────────────────────

const STRIPE_ACCOUNT = {
  id: 'acct_1',
  business_profile: { name: BRAND_NAME, url: BRAND_URL, support_email: CONTACT_EMAIL, support_url: BRAND_URL },
};

function stripeConverged() {
  return {
    getAccount: STRIPE_ACCOUNT,
    getProduct: (id) => ({
      id,
      active: true,
      name: id === 'prod_plus' ? `${BRAND_NAME} - Plus` : `${BRAND_NAME} - Credits`,
      description: BRAND_DESC,
      url: BRAND_URL,
      images: [BRANDMARK],
      metadata: { brandId: BRAND_ID, productId: id === 'prod_plus' ? 'plus' : 'credits' },
    }),
    listPricesForProduct: (id) => (id === 'prod_plus'
      ? [
        { id: 'price_m', active: true, recurring: { interval: 'month' }, unit_amount: 1000 },
        { id: 'price_y', active: true, recurring: { interval: 'year' }, unit_amount: 10000 },
      ]
      : [{ id: 'price_o', active: true, unit_amount: 500 }]),
    listWebhookEndpoints: { data: [{ id: 'we_1', url: STRIPE_WEBHOOK_URL, status: 'enabled', enabled_events: [...STRIPE_EVENTS] }] },
  };
}

function paypalPlan(id, intervalUnit, value, trialDays) {
  const cycles = [];
  if (trialDays > 0) {
    cycles.push({ tenure_type: 'TRIAL', total_cycles: trialDays });
  }
  cycles.push({
    tenure_type: 'REGULAR',
    frequency: { interval_unit: intervalUnit },
    pricing_scheme: { fixed_price: { value } },
  });
  return { id, name: `plan ${id}`, status: 'ACTIVE', billing_cycles: cycles };
}

function paypalConverged() {
  return {
    getAccessToken: 'token',
    getAccountInfo: { appId: 'APP-1', environment: 'live', clientId: 'client-id-fixture' },
    getProduct: (id) => ({
      id,
      name: id === 'PROD-PLUS' ? `${BRAND_NAME} - Plus` : `${BRAND_NAME} - Credits`,
      description: BRAND_DESC,
      image_url: BRANDMARK,
      home_url: BRAND_URL,
    }),
    listPlansForProduct: (id) => (id === 'PROD-PLUS'
      ? [paypalPlan('P-M', 'MONTH', '10.00', 14), paypalPlan('P-Y', 'YEAR', '100.00', 14)]
      : []),
    listWebhooks: { webhooks: [{ id: 'WH-1', url: PAYPAL_WEBHOOK_URL, event_types: PAYPAL_EVENTS.map((name) => ({ name })) }] },
  };
}

function chargebeeConverged() {
  return {
    makeRequest: { list: [] }, // account probe
    getItemFamily: { id: BRAND_ID, name: BRAND_NAME },
    getItem: (id) => ({
      id,
      name: id === `${BRAND_ID}-plus` ? `${BRAND_NAME} - Plus` : `${BRAND_NAME} - Credits`,
      external_name: id === `${BRAND_ID}-plus` ? 'Plus' : 'Credits',
      description: BRAND_DESC,
      redirect_url: BRAND_URL,
      metadata: { brandId: BRAND_ID, productId: id === `${BRAND_ID}-plus` ? 'plus' : 'credits' },
    }),
    listItemPricesForItem: (id) => (id === `${BRAND_ID}-plus`
      ? [
        { id: `${BRAND_ID}-plus-monthly`, price: 1000, status: 'active', trial_period: 14, external_name: `${BRAND_NAME} - Plus (Monthly)` },
        { id: `${BRAND_ID}-plus-annually`, price: 10000, status: 'active', trial_period: 14, external_name: `${BRAND_NAME} - Plus (Annually)` },
      ]
      : []),
    listWebhooks: [{ id: 'cbwh_1', url: CHARGEBEE_WEBHOOK_URL, disabled: false }],
  };
}

// Config where every processor already knows its product IDs
const CONVERGED_IDS = {
  plus: { stripe: { productId: 'prod_plus' }, paypal: { productId: 'PROD-PLUS' } },
  credits: { stripe: { productId: 'prod_credits' }, paypal: { productId: 'PROD-CREDITS' } },
};

function runService(config, { stripe = null, paypal = null, chargebee = null, options = {}, serviceData = {}, webhookKey = true } = {}) {
  if (webhookKey) {
    process.env.BACKEND_MANAGER_WEBHOOK_KEY = WEBHOOK_KEY;
  } else {
    delete process.env.BACKEND_MANAGER_WEBHOOK_KEY;
  }

  return service.run({
    brandId: BRAND_ID,
    brandRoot: '/tmp/omega-manager-payment-unused', // no handler touches disk
    brandConfig: config,
    brand: { id: BRAND_ID, config, targets: Object.keys(config.targets || {}), apps: [] },
    brandState: {},
    apps: [],
    operations: OPERATIONS.payment,
    options,
    serviceData,
    stripeApi: stripe,
    paypalApi: paypal,
    chargebeeApi: chargebee,
  });
}

// ─── Defaults pins ───────────────────────────────────────────────────────────

test('payment: manager defaults — enabled, null public keys, radar rules, NO company organizationId', () => {
  assert.equal(DEFAULTS.payment.enabled, true);
  assert.equal(DEFAULTS.payment.processors.stripe.publishableKey, null);
  assert.equal(DEFAULTS.payment.processors.stripe.updateAccountInfo, true);
  assert.equal(DEFAULTS.payment.processors.stripe.radar.length, 9);
  assert.equal(DEFAULTS.payment.processors.paypal.clientId, null);
  assert.equal(DEFAULTS.payment.processors.chargebee.site, null);
  assert.equal(DEFAULTS.payment.processors.coinbase.enabled, false);
  assert.deepEqual(DEFAULTS.payment.products, []);
  // De-ITW pins: no company Stripe org ID; product images come from
  // brand.images.brandmark, not a hardcoded company CDN
  assert.ok(!('organizationId' in DEFAULTS.payment.processors.stripe));
});

// ─── Setup / skip semantics ──────────────────────────────────────────────────

test('payment: payment.enabled = false skips the service', async () => {
  const result = await runService(brandConfig({ payment: { enabled: false } }), { stripe: fakeStripe() });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /payment\.enabled/);
});

test('payment: skips without brand.url', async () => {
  const result = await runService(brandConfig({ url: '' }), { stripe: fakeStripe() });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /brand\.url/);
});

test('payment: skips when no product has prices (free/archived only)', async () => {
  const products = [
    { id: 'free', name: 'Free', type: 'subscription' },
    { id: 'old', name: 'Old', type: 'subscription', archived: true, prices: { monthly: 3 } },
  ];
  const result = await runService(brandConfig({ products }), { stripe: fakeStripe() });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /no paid products/);
});

test('payment: skips without any processor credentials, naming all three', async () => {
  const result = await runService(brandConfig()); // no injected apis, env scrubbed
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /STRIPE_SECRET_KEY/);
  assert.match(result.reason, /PAYPAL_CLIENT_SECRET/);
  assert.match(result.reason, /CHARGEBEE_API_KEY/);
});

test('payment: --processor filter narrows to that processor and ignores the others’ clients', async () => {
  const stripe = fakeStripe();
  const paypal = fakePaypal(paypalConverged());
  const config = brandConfig({ products: makeProducts({ ids: CONVERGED_IDS }) });

  const result = await runService(config, { stripe, paypal, options: { processor: 'paypal' } });

  assert.equal(result.status, 'success');
  assert.equal(stripe.calls.length, 0); // filtered out — never touched, not even getAccount
  assert.ok(paypal.calls.length > 0);
});

test('payment: unknown --processor skips with guidance', async () => {
  const result = await runService(brandConfig(), { stripe: fakeStripe(), options: { processor: 'venmo' } });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /unknown --processor "venmo"/);
});

test('payment: processors.stripe = false disables Stripe even with credentials present', async () => {
  const stripe = fakeStripe();
  const paypal = fakePaypal(paypalConverged());
  const config = brandConfig({
    products: makeProducts({ ids: CONVERGED_IDS }),
    payment: { processors: { stripe: false, chargebee: false } },
  });

  const result = await runService(config, { stripe, paypal });

  assert.equal(result.status, 'success');
  assert.equal(stripe.calls.length, 0);
  assert.ok(paypal.calls.length > 0);
});

// ─── The flagship: converged account = zero mutations ────────────────────────

test('payment: fully converged across all three processors — reads only, zero mutations', async () => {
  const stripe = fakeStripe(stripeConverged());
  const paypal = fakePaypal(paypalConverged());
  const chargebee = fakeChargebee(chargebeeConverged());
  const config = brandConfig({ products: makeProducts({ ids: CONVERGED_IDS }) });

  const result = await runService(config, {
    stripe, paypal, chargebee,
    serviceData: { radarConfirmed: true, disputesConfirmed: true },
  });

  assert.equal(result.status, 'success');
  assert.deepEqual(stripe.mutations(), []);
  assert.deepEqual(paypal.mutations(), []);
  assert.deepEqual(chargebee.mutations(), []);

  // Setup captured the account ID into state; manual-action confirms persist
  assert.equal(result.state.stripeAccountId, 'acct_1');
  assert.equal(result.state.radarConfirmed, true);
  assert.equal(result.state.disputesConfirmed, true);

  // Free + archived products were never reconciled anywhere
  const stripeProductIds = stripe.callsTo('getProduct').map((c) => c.args[0]);
  assert.deepEqual(stripeProductIds.sort(), ['prod_credits', 'prod_plus']);
  const chargebeeItemIds = chargebee.callsTo('getItem').map((c) => c.args[0]);
  assert.deepEqual(chargebeeItemIds.sort(), [`${BRAND_ID}-credits`, `${BRAND_ID}-plus`]);
});

// ─── Stripe ──────────────────────────────────────────────────────────────────

test('stripe-radar: warned with rules + account deep-link until confirmed', async () => {
  const stripe = fakeStripe(stripeConverged());
  const config = brandConfig({ products: makeProducts({ ids: CONVERGED_IDS }) });

  const result = await runService(config, { stripe, serviceData: { disputesConfirmed: true } });

  assert.equal(result.status, 'warned');
  assert.equal(result.output.stripeRadar.rules, 9);
  assert.equal(result.output.stripeRadar.radarUrl, 'https://dashboard.stripe.com/acct_1/radar/rules');
  assert.equal(result.state.radarConfirmed, false);
  assert.deepEqual(stripe.mutations(), []);
});

test('stripe-disputes: warned with settings deep-link until confirmed', async () => {
  const stripe = fakeStripe(stripeConverged());
  const config = brandConfig({ products: makeProducts({ ids: CONVERGED_IDS }) });

  const result = await runService(config, { stripe, serviceData: { radarConfirmed: true } });

  assert.equal(result.status, 'warned');
  assert.equal(result.output.stripeDisputes.disputesUrl, 'https://dashboard.stripe.com/acct_1/settings/disputes');
  assert.equal(result.state.disputesConfirmed, false);
  assert.deepEqual(stripe.mutations(), []);
});

test('stripe-radar + disputes: interactive confirms stamp both flags, service passes', async () => {
  const stripe = fakeStripe(stripeConverged());
  const config = brandConfig({ products: makeProducts({ ids: CONVERGED_IDS }) });
  const tty = openTtyPrompt();

  try {
    const run = runService(config, { stripe });
    await tty.answer('Radar rules added in the Dashboard?', 'y\r');
    await tty.answer('Enhanced Dispute Protection activated in the Dashboard?', 'y\r');
    const result = await run;

    assert.equal(result.status, 'success');
    assert.equal(result.state.radarConfirmed, true);
    assert.equal(result.state.disputesConfirmed, true);
    assert.deepEqual(stripe.mutations(), []);
  } finally {
    tty.close();
  }
});

test('stripe-radar: interactive decline stays warned and unstamped', async () => {
  const stripe = fakeStripe(stripeConverged());
  const config = brandConfig({ products: makeProducts({ ids: CONVERGED_IDS }) });
  const tty = openTtyPrompt();

  try {
    const run = runService(config, { stripe, serviceData: { disputesConfirmed: true } });
    await tty.answer('Radar rules added in the Dashboard?', 'n\r');
    const result = await run;

    assert.equal(result.status, 'warned');
    assert.equal(result.state.radarConfirmed, false);
  } finally {
    tty.close();
  }
});

test('stripe-radar: dry-run never prompts, even with a TTY', async () => {
  const stripe = fakeStripe(stripeConverged());
  const config = brandConfig({ products: makeProducts({ ids: CONVERGED_IDS }) });
  const tty = openTtyPrompt();

  try {
    // No tty.answer — if the handler wrongly prompted, this would time out
    const result = await runService(config, {
      stripe, serviceData: { disputesConfirmed: true }, options: { dryRun: true },
    });

    assert.equal(result.status, 'warned');
    assert.equal(result.state.radarConfirmed, false);
  } finally {
    tty.close();
  }
});

test('stripe-account: business profile drift → minimal update payload', async () => {
  const responses = stripeConverged();
  responses.getAccount = {
    id: 'acct_1',
    business_profile: { name: 'Old Name', url: BRAND_URL, support_email: CONTACT_EMAIL, support_url: BRAND_URL },
  };
  responses.updateAccount = { id: 'acct_1' };
  const stripe = fakeStripe(responses);
  const config = brandConfig({ products: makeProducts({ ids: CONVERGED_IDS }) });

  await runService(config, { stripe, serviceData: { radarConfirmed: true, disputesConfirmed: true } });

  assert.deepEqual(stripe.callsTo('updateAccount').map((c) => c.args), [
    ['acct_1', { business_profile: { name: BRAND_NAME } }],
  ]);
});

test('stripe-products: missing everywhere → exact create payloads + prices + state', async () => {
  const products = [
    { id: 'plus', name: 'Plus', type: 'subscription', trial: { days: 14 }, prices: { monthly: 10, annually: 100 } },
  ];
  const responses = stripeConverged();
  responses.listAllProducts = []; // nothing to self-heal against
  responses.createProduct = { id: 'prod_new' };
  responses.listPricesForProduct = [];
  responses.createRecurringPrice = (productId, amount, interval) => ({ id: `price_${interval}` });
  const stripe = fakeStripe(responses);

  const result = await runService(brandConfig({ products }), {
    stripe, serviceData: { radarConfirmed: true, disputesConfirmed: true },
  });

  assert.deepEqual(stripe.callsTo('createProduct').map((c) => c.args), [[{
    name: `${BRAND_NAME} - Plus`,
    brandId: BRAND_ID,
    productId: 'plus',
    description: BRAND_DESC,
    images: [BRANDMARK],
    url: BRAND_URL,
  }]]);
  assert.deepEqual(stripe.callsTo('createRecurringPrice').map((c) => c.args), [
    ['prod_new', 10, 'monthly'],
    ['prod_new', 100, 'annually'],
  ]);
  assert.deepEqual(result.state.stripeProducts, { plus: 'prod_new' });
});

test('stripe-products: lost state self-heals by metadata match — no create', async () => {
  const products = [
    { id: 'plus', name: 'Plus', type: 'subscription', trial: { days: 14 }, prices: { monthly: 10, annually: 100 } },
  ];
  const responses = stripeConverged();
  responses.listAllProducts = [structuredClone(responses.getProduct('prod_plus'))];
  const stripe = fakeStripe(responses);

  const result = await runService(brandConfig({ products }), {
    stripe, serviceData: { radarConfirmed: true, disputesConfirmed: true },
  });

  assert.equal(stripe.callsTo('createProduct').length, 0);
  assert.equal(stripe.callsTo('getProduct').length, 0); // list objects are full — no refetch
  assert.deepEqual(result.state.stripeProducts, { plus: 'prod_plus' });
});

test('stripe-products: price drift → stale actives archived, correct price created', async () => {
  const responses = stripeConverged();
  responses.listPricesForProduct = (id) => (id === 'prod_plus'
    ? [
      { id: 'price_m_old', active: true, recurring: { interval: 'month' }, unit_amount: 900 }, // wrong amount
      { id: 'price_y', active: true, recurring: { interval: 'year' }, unit_amount: 10000 },    // converged
    ]
    : [{ id: 'price_o', active: true, unit_amount: 500 }]);
  responses.archivePrice = { id: 'price_m_old', active: false };
  responses.createRecurringPrice = { id: 'price_m_new' };
  const stripe = fakeStripe(responses);
  const config = brandConfig({ products: makeProducts({ ids: CONVERGED_IDS }) });

  await runService(config, { stripe, serviceData: { radarConfirmed: true, disputesConfirmed: true } });

  assert.deepEqual(stripe.callsTo('archivePrice').map((c) => c.args), [['price_m_old']]);
  assert.deepEqual(stripe.callsTo('createRecurringPrice').map((c) => c.args), [['prod_plus', 10, 'monthly']]);
});

test('stripe-webhook: missing → created with exact URL + events', async () => {
  const responses = stripeConverged();
  responses.listWebhookEndpoints = { data: [{ id: 'we_other', url: 'https://elsewhere.test/hook', status: 'enabled', enabled_events: ['charge.succeeded'] }] };
  responses.createWebhookEndpoint = { id: 'we_new' };
  const stripe = fakeStripe(responses);
  const config = brandConfig({ products: makeProducts({ ids: CONVERGED_IDS }) });

  await runService(config, { stripe, serviceData: { radarConfirmed: true, disputesConfirmed: true } });

  assert.deepEqual(stripe.callsTo('createWebhookEndpoint').map((c) => c.args), [
    [STRIPE_WEBHOOK_URL, STRIPE_EVENTS],
  ]);
});

test('stripe-webhook: event drift → single enabled_events update', async () => {
  const responses = stripeConverged();
  responses.listWebhookEndpoints = {
    data: [{ id: 'we_1', url: STRIPE_WEBHOOK_URL, status: 'enabled', enabled_events: STRIPE_EVENTS.slice(0, 5).concat(['obsolete.event']) }],
  };
  responses.updateWebhookEndpoint = { id: 'we_1' };
  const stripe = fakeStripe(responses);
  const config = brandConfig({ products: makeProducts({ ids: CONVERGED_IDS }) });

  await runService(config, { stripe, serviceData: { radarConfirmed: true, disputesConfirmed: true } });

  assert.deepEqual(stripe.callsTo('updateWebhookEndpoint').map((c) => c.args), [
    ['we_1', { enabled_events: STRIPE_EVENTS }],
  ]);
});

test('stripe-webhook: disabled endpoint → re-enabled (events already converged)', async () => {
  const responses = stripeConverged();
  responses.listWebhookEndpoints = {
    data: [{ id: 'we_1', url: STRIPE_WEBHOOK_URL, status: 'disabled', enabled_events: [...STRIPE_EVENTS] }],
  };
  responses.updateWebhookEndpoint = { id: 'we_1' };
  const stripe = fakeStripe(responses);
  const config = brandConfig({ products: makeProducts({ ids: CONVERGED_IDS }) });

  await runService(config, { stripe, serviceData: { radarConfirmed: true, disputesConfirmed: true } });

  assert.deepEqual(stripe.callsTo('updateWebhookEndpoint').map((c) => c.args), [
    ['we_1', { disabled: false }],
  ]);
});

test('payment: missing BACKEND_MANAGER_WEBHOOK_KEY → warned, webhooks never listed', async () => {
  const stripe = fakeStripe(stripeConverged());
  const config = brandConfig({ products: makeProducts({ ids: CONVERGED_IDS }) });

  const result = await runService(config, {
    stripe, webhookKey: false,
    serviceData: { radarConfirmed: true, disputesConfirmed: true },
  });

  assert.equal(result.status, 'warned');
  assert.deepEqual(result.output.stripeWebhook, { skipped: 'no BACKEND_MANAGER_WEBHOOK_KEY' });
  assert.equal(stripe.callsTo('listWebhookEndpoints').length, 0);
  assert.deepEqual(stripe.mutations(), []);
});

test('payment: firebase.shared brand → webhook operations skip without touching the API', async () => {
  const stripe = fakeStripe(stripeConverged());
  const config = brandConfig({ products: makeProducts({ ids: CONVERGED_IDS }), firebase: { shared: true } });

  const result = await runService(config, {
    stripe, serviceData: { radarConfirmed: true, disputesConfirmed: true },
  });

  assert.equal(result.status, 'success');
  assert.equal(stripe.callsTo('listWebhookEndpoints').length, 0);
  assert.deepEqual(stripe.mutations(), []);
});

// ─── PayPal ──────────────────────────────────────────────────────────────────

test('paypal-account: reports environment + app ID', async () => {
  const paypal = fakePaypal(paypalConverged());
  const config = brandConfig({ products: makeProducts({ ids: CONVERGED_IDS }) });

  const result = await runService(config, { paypal, options: { processor: 'paypal' } });

  assert.equal(result.status, 'success');
  assert.deepEqual(result.output.paypalAccount, { authenticated: true, environment: 'live', appId: 'APP-1' });
});

test('paypal-account: auth failure → warned, then the webhook operation fails the service', async () => {
  const responses = paypalConverged();
  responses.getAccessToken = () => {
    throw new Error('PayPal auth failed on both live and sandbox — check paypal.clientId and PAYPAL_CLIENT_SECRET');
  };
  delete responses.listWebhooks; // auth is down — any webhook call explodes too
  const paypal = fakePaypal(responses);
  const config = brandConfig({ products: makeProducts({ ids: CONVERGED_IDS }) });

  const result = await runService(config, { paypal, options: { processor: 'paypal' } });

  assert.equal(result.status, 'error');
  assert.equal(result.output.paypalAccount.authenticated, false);
  assert.deepEqual(paypal.mutations(), []);
});

test('paypal-products: missing everywhere → exact product + plan create payloads + state', async () => {
  const products = [
    { id: 'plus', name: 'Plus', type: 'subscription', trial: { days: 14 }, prices: { monthly: 10, annually: 100 } },
  ];
  const responses = paypalConverged();
  responses.listProducts = []; // nothing to self-heal against
  responses.createProduct = { id: 'PROD-NEW' };
  responses.listPlansForProduct = [];
  responses.createPlan = ({ interval }) => ({ id: `P-NEW-${interval}` });
  const paypal = fakePaypal(responses);

  const result = await runService(brandConfig({ products }), { paypal, options: { processor: 'paypal' } });

  assert.deepEqual(paypal.callsTo('createProduct').map((c) => c.args), [[{
    name: `${BRAND_NAME} - Plus`,
    description: BRAND_DESC,
    type: 'SERVICE',
    imageUrl: BRANDMARK,
    homeUrl: BRAND_URL,
  }]]);
  assert.deepEqual(paypal.callsTo('createPlan').map((c) => c.args), [
    [{ productId: 'PROD-NEW', name: `${BRAND_NAME} - Plus (Monthly)`, interval: 'monthly', amount: 10, trialDays: 14 }],
    [{ productId: 'PROD-NEW', name: `${BRAND_NAME} - Plus (Annually)`, interval: 'annually', amount: 100, trialDays: 14 }],
  ]);
  assert.deepEqual(result.state.paypalProducts, { plus: 'PROD-NEW' });
});

test('paypal-products: lost state self-heals by exact name match — no create', async () => {
  const products = [
    { id: 'plus', name: 'Plus', type: 'subscription', trial: { days: 14 }, prices: { monthly: 10, annually: 100 } },
  ];
  const responses = paypalConverged();
  responses.listProducts = [{ id: 'PROD-PLUS', name: `${BRAND_NAME} - Plus` }]; // summarized list entry
  const paypal = fakePaypal(responses);

  const result = await runService(brandConfig({ products }), { paypal, options: { processor: 'paypal' } });

  assert.equal(paypal.callsTo('createProduct').length, 0);
  assert.equal(paypal.callsTo('getProduct').length, 1); // list is summarized — full fetch before diffing
  assert.deepEqual(result.state.paypalProducts, { plus: 'PROD-PLUS' });
});

test('paypal-products: plan drift → stale + duplicate deactivated, correct plan created', async () => {
  const responses = paypalConverged();
  responses.listPlansForProduct = (id) => (id === 'PROD-PLUS'
    ? [
      paypalPlan('P-M-STALE', 'MONTH', '9.00', 14),   // wrong amount → deactivate + recreate
      paypalPlan('P-Y', 'YEAR', '100.00', 14),        // converged
      paypalPlan('P-Y-DUP', 'YEAR', '100.00', 14),    // duplicate match → deactivate
    ]
    : []);
  responses.deactivatePlan = null;
  responses.createPlan = { id: 'P-M-NEW' };
  const paypal = fakePaypal(responses);
  const config = brandConfig({ products: makeProducts({ ids: CONVERGED_IDS }) });

  await runService(config, { paypal, options: { processor: 'paypal' } });

  assert.deepEqual(paypal.callsTo('deactivatePlan').map((c) => c.args).sort(), [['P-M-STALE'], ['P-Y-DUP']]);
  assert.deepEqual(paypal.callsTo('createPlan').map((c) => c.args), [
    [{ productId: 'PROD-PLUS', name: `${BRAND_NAME} - Plus (Monthly)`, interval: 'monthly', amount: 10, trialDays: 14 }],
  ]);
});

test('paypal-products: legacy product plans are deactivated', async () => {
  const ids = structuredClone(CONVERGED_IDS);
  ids.plus.paypal.legacyProductIds = ['PROD-OLD'];
  const responses = paypalConverged();
  const basePlans = responses.listPlansForProduct;
  responses.listPlansForProduct = (id) => (id === 'PROD-OLD'
    ? [paypalPlan('P-LEGACY', 'MONTH', '5.00', 0)]
    : basePlans(id));
  responses.deactivatePlan = null;
  const paypal = fakePaypal(responses);
  const config = brandConfig({ products: makeProducts({ ids }) });

  await runService(config, { paypal, options: { processor: 'paypal' } });

  assert.deepEqual(paypal.callsTo('deactivatePlan').map((c) => c.args), [['P-LEGACY']]);
});

test('paypal-webhook: missing → created with exact URL + events', async () => {
  const responses = paypalConverged();
  responses.listWebhooks = { webhooks: [] };
  responses.createWebhook = { id: 'WH-NEW' };
  const paypal = fakePaypal(responses);
  const config = brandConfig({ products: makeProducts({ ids: CONVERGED_IDS }) });

  await runService(config, { paypal, options: { processor: 'paypal' } });

  assert.deepEqual(paypal.callsTo('createWebhook').map((c) => c.args), [
    [PAYPAL_WEBHOOK_URL, PAYPAL_EVENTS],
  ]);
});

test('paypal-webhook: event drift → single JSON Patch replacing event_types', async () => {
  const responses = paypalConverged();
  responses.listWebhooks = {
    webhooks: [{ id: 'WH-1', url: PAYPAL_WEBHOOK_URL, event_types: [{ name: 'BILLING.SUBSCRIPTION.CREATED' }] }],
  };
  responses.updateWebhook = { id: 'WH-1' };
  const paypal = fakePaypal(responses);
  const config = brandConfig({ products: makeProducts({ ids: CONVERGED_IDS }) });

  await runService(config, { paypal, options: { processor: 'paypal' } });

  assert.deepEqual(paypal.callsTo('updateWebhook').map((c) => c.args), [
    ['WH-1', [{ op: 'replace', path: '/event_types', value: PAYPAL_EVENTS.map((name) => ({ name })) }]],
  ]);
});

// ─── Chargebee ───────────────────────────────────────────────────────────────

test('chargebee-products: empty site → exact family + item + price create chain', async () => {
  const products = [
    { id: 'plus', name: 'Plus', type: 'subscription', trial: { days: 14 }, prices: { monthly: 10, annually: 100 } },
  ];
  const responses = chargebeeConverged();
  responses.getItemFamily = () => {
    throw new Error('Chargebee API error (404 GET /item_families/fixture-brand): resource_not_found');
  };
  responses.getItem = () => {
    throw new Error('Chargebee API error (404 GET /items/fixture-brand-plus): resource_not_found');
  };
  responses.createItemFamily = { id: BRAND_ID };
  responses.createItem = { id: `${BRAND_ID}-plus` };
  responses.listItemPricesForItem = [];
  responses.createItemPrice = ({ id }) => ({ id });
  const chargebee = fakeChargebee(responses);

  await runService(brandConfig({ products }), { chargebee, options: { processor: 'chargebee' } });

  assert.deepEqual(chargebee.callsTo('createItemFamily').map((c) => c.args), [[{
    id: BRAND_ID,
    name: BRAND_NAME,
    description: BRAND_DESC,
  }]]);
  assert.deepEqual(chargebee.callsTo('createItem').map((c) => c.args), [[{
    id: `${BRAND_ID}-plus`,
    name: `${BRAND_NAME} - Plus`,
    externalName: 'Plus',
    type: 'plan',
    itemFamilyId: BRAND_ID,
    description: BRAND_DESC,
    redirectUrl: BRAND_URL,
    metadata: { brandId: BRAND_ID, productId: 'plus' },
  }]]);
  assert.deepEqual(chargebee.callsTo('createItemPrice').map((c) => c.args), [
    [{
      id: `${BRAND_ID}-plus-monthly`, itemId: `${BRAND_ID}-plus`,
      name: `${BRAND_NAME} - Plus (Monthly)`, externalName: `${BRAND_NAME} - Plus (Monthly)`,
      pricingModel: 'flat_fee', price: 1000, currencyCode: 'USD',
      periodUnit: 'month', period: 1, trialPeriod: 14, trialPeriodUnit: 'day',
    }],
    [{
      id: `${BRAND_ID}-plus-annually`, itemId: `${BRAND_ID}-plus`,
      name: `${BRAND_NAME} - Plus (Annually)`, externalName: `${BRAND_NAME} - Plus (Annually)`,
      pricingModel: 'flat_fee', price: 10000, currencyCode: 'USD',
      periodUnit: 'year', period: 1, trialPeriod: 14, trialPeriodUnit: 'day',
    }],
  ]);
});

test('chargebee-products: price amount drift → updated in place (deterministic ID)', async () => {
  const responses = chargebeeConverged();
  responses.listItemPricesForItem = (id) => (id === `${BRAND_ID}-plus`
    ? [
      { id: `${BRAND_ID}-plus-monthly`, price: 900, status: 'active', trial_period: 14, external_name: `${BRAND_NAME} - Plus (Monthly)` },
      { id: `${BRAND_ID}-plus-annually`, price: 10000, status: 'active', trial_period: 14, external_name: `${BRAND_NAME} - Plus (Annually)` },
    ]
    : []);
  responses.updateItemPrice = (id) => ({ id });
  const chargebee = fakeChargebee(responses);
  const config = brandConfig({ products: makeProducts({ ids: CONVERGED_IDS }) });

  await runService(config, { chargebee, options: { processor: 'chargebee' } });

  assert.deepEqual(chargebee.callsTo('updateItemPrice').map((c) => c.args), [
    [`${BRAND_ID}-plus-monthly`, { price: 1000 }],
  ]);
});

test('chargebee-products: legacy plans reported read-only', async () => {
  const ids = structuredClone(CONVERGED_IDS);
  ids.plus.chargebee = { legacyPlanIds: ['old-plan'] };
  const responses = chargebeeConverged();
  responses.getPlan = { id: 'old-plan', status: 'active', price: 500, period_unit: 'month', period: 1, name: 'Old Plan' };
  const chargebee = fakeChargebee(responses);
  const config = brandConfig({ products: makeProducts({ ids }) });

  await runService(config, { chargebee, options: { processor: 'chargebee' } });

  assert.deepEqual(chargebee.callsTo('getPlan').map((c) => c.args), [['old-plan']]);
  assert.deepEqual(chargebee.mutations(), []);
});

test('chargebee-webhook: missing → created with &brand= URL, name, and 15 events', async () => {
  const responses = chargebeeConverged();
  responses.listWebhooks = [];
  responses.createWebhook = { id: 'cbwh_new' };
  const chargebee = fakeChargebee(responses);
  const config = brandConfig({ products: makeProducts({ ids: CONVERGED_IDS }) });

  await runService(config, { chargebee, options: { processor: 'chargebee' } });

  assert.deepEqual(chargebee.callsTo('createWebhook').map((c) => c.args), [[{
    url: CHARGEBEE_WEBHOOK_URL,
    name: `${BRAND_NAME} Backend`,
    eventTypes: CHARGEBEE_EVENTS,
  }]]);
});

test('chargebee-webhook: disabled endpoint → re-activated', async () => {
  const responses = chargebeeConverged();
  responses.listWebhooks = [{ id: 'cbwh_1', url: CHARGEBEE_WEBHOOK_URL, disabled: true }];
  responses.updateWebhook = { id: 'cbwh_1' };
  const chargebee = fakeChargebee(responses);
  const config = brandConfig({ products: makeProducts({ ids: CONVERGED_IDS }) });

  await runService(config, { chargebee, options: { processor: 'chargebee' } });

  assert.deepEqual(chargebee.callsTo('updateWebhook').map((c) => c.args), [
    ['cbwh_1', { status: 'active' }],
  ]);
});

// ─── Dry-run ─────────────────────────────────────────────────────────────────

test('payment: dry-run on a fully drifted account — zero mutations on all three processors', async () => {
  // Everything is missing or wrong everywhere: account drifted, no products,
  // no webhooks, no item family. A dry run may only read.
  const stripe = fakeStripe({
    getAccount: { id: 'acct_1', business_profile: { name: 'Wrong', url: 'https://wrong.test', support_email: 'x@wrong.test', support_url: 'https://wrong.test' } },
    listAllProducts: [],
    listWebhookEndpoints: { data: [] },
  });
  const paypal = fakePaypal({
    getAccessToken: 'token',
    getAccountInfo: { appId: 'APP-1', environment: 'live', clientId: 'client-id-fixture' },
    listProducts: [],
    listWebhooks: { webhooks: [] },
  });
  const chargebee = fakeChargebee({
    makeRequest: { list: [] },
    getItemFamily: () => {
      throw new Error('Chargebee API error (404 GET /item_families/fixture-brand): resource_not_found');
    },
    getItem: (id) => {
      throw new Error(`Chargebee API error (404 GET /items/${id}): resource_not_found`);
    },
    listWebhooks: [],
  });
  // No per-processor product IDs configured — full-create territory
  const config = brandConfig();

  const result = await runService(config, { stripe, paypal, chargebee, options: { dryRun: true } });

  assert.equal(result.status, 'warned'); // radar + disputes guidance still warns
  assert.deepEqual(stripe.mutations(), []);
  assert.deepEqual(paypal.mutations(), []);
  assert.deepEqual(chargebee.mutations(), []);
  // Dry-run persists no product-ID state either
  assert.equal(result.state.stripeProducts, undefined);
  assert.equal(result.state.paypalProducts, undefined);
});
