/**
 * Payment service tests — all 11 operations against method-level recording
 * fakes for Stripe, PayPal, and Chargebee. Proves skip semantics (enabled
 * flag, paid-product gate, per-provider credentials, --provider filter,
 * config `false` disables), the converged zero-mutation no-op across all
 * three providers, product resolution self-heal (Stripe by metadata,
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
delete process.env.OMEGA_WEBHOOK_KEY;

const BRAND_ID = 'fixture-brand';
const DOMAIN = 'fixture-brand.test';
const BRAND_NAME = 'Fixture Brand';
const BRAND_URL = `https://${DOMAIN}`;
const BRAND_DESC = 'A fixture brand';
const CONTACT_EMAIL = `support@${DOMAIN}`;
const BRANDMARK = `${BRAND_URL}/brandmark.png`;
const WEBHOOK_KEY = 'fixture-webhook-key';
const STRIPE_WEBHOOK_URL = `https://api.${DOMAIN}/omega/payments/webhook?provider=stripe&key=${WEBHOOK_KEY}`;
const PAYPAL_WEBHOOK_URL = `https://api.${DOMAIN}/omega/payments/webhook?provider=paypal&key=${WEBHOOK_KEY}`;
const CHARGEBEE_WEBHOOK_URL = `https://api.${DOMAIN}/omega/payments/webhook?provider=chargebee&brand=${BRAND_ID}&key=${WEBHOOK_KEY}`;

// Legacy twins on the brand's OWN host (omega-manager wrote `?processor=`) and
// a stranger on another host: only the twins are stale (#570)
const STRIPE_LEGACY_WEBHOOK_URL = `https://api.${DOMAIN}/omega/payments/webhook?processor=stripe&key=${WEBHOOK_KEY}`;
const PAYPAL_LEGACY_WEBHOOK_URL = `https://api.${DOMAIN}/omega/payments/webhook?processor=paypal&key=${WEBHOOK_KEY}`;
const CHARGEBEE_LEGACY_WEBHOOK_URL = `https://api.${DOMAIN}/omega/payments/webhook?processor=chargebee&brand=${BRAND_ID}&key=${WEBHOOK_KEY}`;
const FOREIGN_WEBHOOK_URL = 'https://api.someone-else.test/omega/payments/webhook?provider=stripe&key=not-ours';

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
 * reconciled). Per-provider IDs are injected per test via `ids`.
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
    cloud: { shared: false, ...firebase },
    payment: {
      ...paymentDefaults,
      ...payment,
      providers: { ...paymentDefaults.providers, ...(payment.providers || {}) },
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
const STRIPE_MUTATIONS = ['updateAccount', 'createProduct', 'updateProduct', 'createRecurringPrice', 'createOneTimePrice', 'archivePrice', 'createWebhookEndpoint', 'updateWebhookEndpoint', 'deleteWebhookEndpoint'];
const fakeStripe = (responses = {}) => makeFake('fakeStripe', STRIPE_READS, STRIPE_MUTATIONS, responses);

const PAYPAL_READS = ['getAccessToken', 'getAccountInfo', 'listProducts', 'getProduct', 'listPlansForProduct', 'listWebhooks'];
const PAYPAL_MUTATIONS = ['createProduct', 'updateProduct', 'createPlan', 'deactivatePlan', 'createWebhook', 'updateWebhook', 'deleteWebhook'];
const fakePaypal = (responses = {}) => makeFake('fakePaypal', PAYPAL_READS, PAYPAL_MUTATIONS, responses, { syncMethods: ['getAccountInfo'] });

const CHARGEBEE_READS = ['makeRequest', 'getItemFamily', 'getItem', 'listItemPricesForItem', 'getPlan', 'listWebhooks'];
const CHARGEBEE_MUTATIONS = ['createItemFamily', 'updateItemFamily', 'createItem', 'updateItem', 'createItemPrice', 'updateItemPrice', 'createWebhook', 'updateWebhook', 'deleteWebhook'];
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
    // Plus configures trial days, so each interval carries TWIN plans: the
    // trial twin and the skip-trial twin (#761)
    listPlansForProduct: (id) => (id === 'PROD-PLUS'
      ? [
        paypalPlan('P-M', 'MONTH', '10.00', 14),
        paypalPlan('P-M-NT', 'MONTH', '10.00', 0),
        paypalPlan('P-Y', 'YEAR', '100.00', 14),
        paypalPlan('P-Y-NT', 'YEAR', '100.00', 0),
      ]
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

// Config where every provider already knows its product IDs
const CONVERGED_IDS = {
  plus: { stripe: { productId: 'prod_plus' }, paypal: { productId: 'PROD-PLUS' } },
  credits: { stripe: { productId: 'prod_credits' }, paypal: { productId: 'PROD-CREDITS' } },
};

const { makeBrandRoot, readConfigSource } = require('./lib/config-fixture.js');

/** Writeback target mirroring the config's products — matcher paths self-locate by id. */
function writebackSource(config) {
  const rows = (config.payment?.products || []).map((p) => `      { id: '${p.id}' }, // ${p.name || p.id}`).join('\n');
  return `// Payment fixture — comments must survive product-id writeback\n{\n  payment: {\n    products: [\n${rows}\n    ],\n  },\n}\n`;
}

/**
 * The two Dashboard-only confirmations live in config now (#434), so a
 * fixture brand that has already stamped them says so there.
 * true = both, 'radar' / 'disputes' = just that one.
 */
function withConfirmed(config, confirmed) {
  if (!confirmed) {
    return config;
  }

  const stripe = {
    ...config.payment?.providers?.stripe,
    ...(confirmed === true || confirmed === 'radar' ? { radarConfirmed: true } : {}),
    ...(confirmed === true || confirmed === 'disputes' ? { disputesConfirmed: true } : {}),
  };

  return {
    ...config,
    payment: { ...config.payment, providers: { ...config.payment?.providers, stripe } },
  };
}

function runService(rawConfig, { stripe = null, paypal = null, chargebee = null, options = {}, confirmed = false, webhookKey = true, brandRoot } = {}) {
  if (webhookKey) {
    process.env.OMEGA_WEBHOOK_KEY = WEBHOOK_KEY;
  } else {
    delete process.env.OMEGA_WEBHOOK_KEY;
  }

  const config = withConfirmed(rawConfig, confirmed);

  return service.run({
    brandId: BRAND_ID,
    brandRoot: brandRoot || makeBrandRoot(writebackSource(config)), // product ops write into config/omega.json5 here
    brandConfig: config,
    brand: { id: BRAND_ID, config, enabledTargets: Object.keys(config.targets || {}), targets: [] },
    targets: [],
    operations: OPERATIONS.payment,
    options,
    stripeApi: stripe,
    paypalApi: paypal,
    chargebeeApi: chargebee,
  });
}

// ─── Defaults pins ───────────────────────────────────────────────────────────

test('payment: manager defaults — enabled, null public keys, radar rules, NO company organizationId', () => {
  assert.equal(DEFAULTS.payment.enabled, true);
  assert.equal(DEFAULTS.payment.providers.stripe.publishableKey, null);
  assert.equal(DEFAULTS.payment.providers.stripe.updateAccountInfo, true);
  assert.equal(DEFAULTS.payment.providers.stripe.radar.length, 9);
  assert.equal(DEFAULTS.payment.providers.paypal.clientId, null);
  assert.equal(DEFAULTS.payment.providers.chargebee.site, null);
  // #642: the coinbase provider is real again (Coinbase Commerce, crypto,
  // one-time purchases), so the default advertises one that exists — and it is
  // OFF, because its whole credential is a secret the manager cannot detect.
  // #636 deleted the stub for the opposite reason: back then nothing read it.
  assert.equal(DEFAULTS.payment.providers.coinbase.enabled, false);
  assert.deepEqual(DEFAULTS.payment.products, []);
  // De-ITW pins: no company Stripe org ID; product images come from
  // brand.images.brandmark, not a hardcoded company CDN
  assert.ok(!('organizationId' in DEFAULTS.payment.providers.stripe));
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

test('payment: skips without any provider credentials, naming all three', async () => {
  const result = await runService(brandConfig()); // no injected apis, env scrubbed
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /STRIPE_SECRET_KEY/);
  assert.match(result.reason, /PAYPAL_CLIENT_SECRET/);
  assert.match(result.reason, /CHARGEBEE_API_KEY/);
});

test('payment: --provider filter narrows to that provider and ignores the others’ clients', async () => {
  const stripe = fakeStripe();
  const paypal = fakePaypal(paypalConverged());
  const config = brandConfig({ products: makeProducts({ ids: CONVERGED_IDS }) });

  const result = await runService(config, { stripe, paypal, options: { provider: 'paypal' } });

  assert.equal(result.status, 'success');
  assert.equal(stripe.calls.length, 0); // filtered out — never touched, not even getAccount
  assert.ok(paypal.calls.length > 0);
});

test('payment: unknown --provider skips with guidance', async () => {
  const result = await runService(brandConfig(), { stripe: fakeStripe(), options: { provider: 'venmo' } });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /unknown --provider "venmo"/);
});

test('payment: --provider=coinbase asks for the key and then says it reconciles nothing (#642)', async () => {
  // Coinbase Commerce is a real provider with ZERO operations: no catalog, no
  // webhook API. Narrowing a run to it must not answer the sibling sentence
  // ("not configured"), which would read as a setup failure on a brand that is
  // configured perfectly well. Non-interactive here, so no gate opens.
  const result = await runService(brandConfig(), { stripe: fakeStripe(), options: { provider: 'coinbase' } });

  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /coinbase has nothing to reconcile/);
  assert.doesNotMatch(result.reason, /not configured/, 'a configured brand is never told it is unconfigured');
});

test('payment: providers.stripe = false disables Stripe even with credentials present', async () => {
  const stripe = fakeStripe();
  const paypal = fakePaypal(paypalConverged());
  const config = brandConfig({
    products: makeProducts({ ids: CONVERGED_IDS }),
    payment: { providers: { stripe: false, chargebee: false } },
  });

  const result = await runService(config, { stripe, paypal });

  assert.equal(result.status, 'success');
  assert.equal(stripe.calls.length, 0);
  assert.ok(paypal.calls.length > 0);
});

// ─── The flagship: converged account = zero mutations ────────────────────────

test('payment: fully converged across all three providers — reads only, zero mutations', async () => {
  const stripe = fakeStripe(stripeConverged());
  const paypal = fakePaypal(paypalConverged());
  const chargebee = fakeChargebee(chargebeeConverged());
  const config = brandConfig({ products: makeProducts({ ids: CONVERGED_IDS }) });

  const result = await runService(config, {
    stripe, paypal, chargebee,
    confirmed: true,
  });

  assert.equal(result.status, 'success');
  assert.deepEqual(stripe.mutations(), []);
  assert.deepEqual(paypal.mutations(), []);
  assert.deepEqual(chargebee.mutations(), []);

  // Setup resolves the account ID fresh and carries it to the deep-links
  assert.equal(result.state.stripeAccountId, 'acct_1');

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

  const result = await runService(config, { stripe, confirmed: 'disputes' });

  assert.equal(result.status, 'warned');
  assert.equal(result.output.stripeRadar.rules, 9);
  assert.equal(result.output.stripeRadar.radarUrl, 'https://dashboard.stripe.com/acct_1/radar/rules');
  assert.deepEqual(stripe.mutations(), []);
});

test('stripe-disputes: warned with settings deep-link until confirmed', async () => {
  const stripe = fakeStripe(stripeConverged());
  const config = brandConfig({ products: makeProducts({ ids: CONVERGED_IDS }) });

  const result = await runService(config, { stripe, confirmed: 'radar' });

  assert.equal(result.status, 'warned');
  assert.equal(result.output.stripeDisputes.disputesUrl, 'https://dashboard.stripe.com/acct_1/settings/disputes');
  assert.deepEqual(stripe.mutations(), []);
});

test('stripe-radar + disputes: Enter-gated opens + interactive confirms stamp both flags, service passes', async () => {
  const stripe = fakeStripe(stripeConverged());
  // paypal/chargebee disabled — enabled-but-unconfigured providers would
  // offer their credential-entry flow first in an interactive run
  const config = brandConfig({ products: makeProducts({ ids: CONVERGED_IDS }), payment: { providers: { paypal: false, chargebee: false } } });

  // pressEnterToOpen launches via prompt's openInBrowser — stub it
  const promptModule = require('@omega.js/devkit/prompt');
  const opened = [];
  const realOpen = promptModule.openInBrowser;
  promptModule.openInBrowser = (url) => { opened.push(url); return true; };
  const tty = openTtyPrompt();
  const brandRoot = makeBrandRoot(writebackSource(config));

  try {
    const run = runService(config, { stripe, brandRoot });
    await tty.answer('Press Enter to open the Stripe Radar rules page', '\r');
    await tty.answer('Radar rules added in the Dashboard?', 'y\r');
    await tty.answer('Press Enter to open the Stripe dispute settings', '\r');
    await tty.answer('Enhanced Dispute Protection activated in the Dashboard?', 'y\r');
    const result = await run;

    assert.equal(result.status, 'success');
    // Both confirms stamp their home in omega.json5 (#434) — nothing else
    // can re-check them, so the next run believes the file
    const written = readConfigSource(brandRoot);
    assert.match(written, /radarConfirmed: true/);
    assert.match(written, /disputesConfirmed: true/);
    assert.deepEqual(opened, [
      'https://dashboard.stripe.com/acct_1/radar/rules',
      'https://dashboard.stripe.com/acct_1/settings/disputes',
    ]);
    assert.deepEqual(stripe.mutations(), []);
  } finally {
    promptModule.openInBrowser = realOpen;
    tty.close();
  }
});

test('stripe-radar: interactive decline stays warned and unstamped', async () => {
  const stripe = fakeStripe(stripeConverged());
  const config = brandConfig({ products: makeProducts({ ids: CONVERGED_IDS }), payment: { providers: { paypal: false, chargebee: false } } });

  const promptModule = require('@omega.js/devkit/prompt');
  const realOpen = promptModule.openInBrowser;
  promptModule.openInBrowser = () => true;
  const tty = openTtyPrompt();
  const brandRoot = makeBrandRoot(writebackSource(config));

  try {
    const run = runService(config, { stripe, confirmed: 'disputes', brandRoot });
    await tty.answer('Press Enter to open the Stripe Radar rules page', '\r');
    await tty.answer('Radar rules added in the Dashboard?', 'n\r');
    const result = await run;

    assert.equal(result.status, 'warned');
    assert.ok(!readConfigSource(brandRoot).includes('radarConfirmed'));
  } finally {
    promptModule.openInBrowser = realOpen;
    tty.close();
  }
});

test('stripe-radar: dry-run never prompts, even with a TTY', async () => {
  const stripe = fakeStripe(stripeConverged());
  const config = brandConfig({ products: makeProducts({ ids: CONVERGED_IDS }) });
  const tty = openTtyPrompt();
  const brandRoot = makeBrandRoot(writebackSource(config));

  try {
    // No tty.answer — if the handler wrongly prompted, this would time out
    const result = await runService(config, {
      stripe, confirmed: 'disputes', options: { dryRun: true }, brandRoot,
    });

    assert.equal(result.status, 'warned');
    assert.ok(!readConfigSource(brandRoot).includes('radarConfirmed'));
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

  await runService(config, { stripe, confirmed: true });

  assert.deepEqual(stripe.callsTo('updateAccount').map((c) => c.args), [
    ['acct_1', { business_profile: { name: BRAND_NAME } }],
  ]);
});

test('stripe-products: missing everywhere → exact create payloads + prices + config writeback', async () => {
  const products = [
    { id: 'plus', name: 'Plus', type: 'subscription', trial: { days: 14 }, prices: { monthly: 10, annually: 100 } },
  ];
  const responses = stripeConverged();
  responses.listAllProducts = []; // nothing to self-heal against
  responses.createProduct = { id: 'prod_new' };
  responses.listPricesForProduct = [];
  responses.createRecurringPrice = (productId, amount, interval) => ({ id: `price_${interval}` });
  const stripe = fakeStripe(responses);

  const config = brandConfig({ products });
  const brandRoot = makeBrandRoot(writebackSource(config));
  const result = await runService(config, {
    stripe, confirmed: true, brandRoot,
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
  const written = readConfigSource(brandRoot);
  assert.ok(written.includes(`{ id: 'plus', stripe: { productId: "prod_new" } }, // Plus`));
  assert.ok(written.includes('// Payment fixture — comments must survive product-id writeback'));
});

test('stripe-products: an unconfigured id self-heals by metadata match — no create', async () => {
  const products = [
    { id: 'plus', name: 'Plus', type: 'subscription', trial: { days: 14 }, prices: { monthly: 10, annually: 100 } },
  ];
  const responses = stripeConverged();
  responses.listAllProducts = [structuredClone(responses.getProduct('prod_plus'))];
  const stripe = fakeStripe(responses);

  const config = brandConfig({ products });
  const brandRoot = makeBrandRoot(writebackSource(config));
  await runService(config, { stripe, confirmed: true, brandRoot });

  assert.equal(stripe.callsTo('createProduct').length, 0);
  assert.equal(stripe.callsTo('getProduct').length, 0); // list objects are full — no refetch
  assert.ok(readConfigSource(brandRoot).includes(`{ id: 'plus', stripe: { productId: "prod_plus" } }, // Plus`));
});

test('stripe-products: a self-healed id is also written back into omega.json5', async () => {
  const products = [
    { id: 'plus', name: 'Plus', type: 'subscription', trial: { days: 14 }, prices: { monthly: 10, annually: 100 } },
  ];
  const responses = stripeConverged();
  responses.listAllProducts = [structuredClone(responses.getProduct('prod_plus'))];
  const config = brandConfig({ products });
  const brandRoot = makeBrandRoot(writebackSource(config));

  await runService(config, {
    stripe: fakeStripe(responses), confirmed: true, brandRoot,
  });

  assert.ok(readConfigSource(brandRoot).includes(`{ id: 'plus', stripe: { productId: "prod_plus" } }, // Plus`));
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

  await runService(config, { stripe, confirmed: true });

  assert.deepEqual(stripe.callsTo('archivePrice').map((c) => c.args), [['price_m_old']]);
  assert.deepEqual(stripe.callsTo('createRecurringPrice').map((c) => c.args), [['prod_plus', 10, 'monthly']]);
});

test('stripe-webhook: missing → created with exact URL + events', async () => {
  const responses = stripeConverged();
  responses.listWebhookEndpoints = { data: [{ id: 'we_other', url: 'https://elsewhere.test/hook', status: 'enabled', enabled_events: ['charge.succeeded'] }] };
  responses.createWebhookEndpoint = { id: 'we_new' };
  const stripe = fakeStripe(responses);
  const config = brandConfig({ products: makeProducts({ ids: CONVERGED_IDS }) });

  await runService(config, { stripe, confirmed: true });

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

  await runService(config, { stripe, confirmed: true });

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

  await runService(config, { stripe, confirmed: true });

  assert.deepEqual(stripe.callsTo('updateWebhookEndpoint').map((c) => c.args), [
    ['we_1', { disabled: false }],
  ]);
});

test('stripe-webhook: legacy twin on the brand host → deleted; the desired URL and other hosts untouched', async () => {
  const responses = stripeConverged();
  responses.listWebhookEndpoints = {
    data: [
      { id: 'we_1', url: STRIPE_WEBHOOK_URL, status: 'enabled', enabled_events: [...STRIPE_EVENTS] },
      { id: 'we_legacy', url: STRIPE_LEGACY_WEBHOOK_URL, status: 'enabled', enabled_events: [...STRIPE_EVENTS] },
      { id: 'we_foreign', url: FOREIGN_WEBHOOK_URL, status: 'enabled', enabled_events: [...STRIPE_EVENTS] },
    ],
  };
  responses.deleteWebhookEndpoint = { id: 'we_legacy', deleted: true };
  const stripe = fakeStripe(responses);
  const config = brandConfig({ products: makeProducts({ ids: CONVERGED_IDS }) });

  const log = captureLog();
  try {
    await runService(config, { stripe, confirmed: true });
  } finally {
    log.restore();
  }

  assert.deepEqual(stripe.callsTo('deleteWebhookEndpoint').map((c) => c.args), [['we_legacy']]);
  assert.deepEqual(stripe.callsTo('updateWebhookEndpoint'), []);
  assert.deepEqual(stripe.callsTo('createWebhookEndpoint'), []);

  // One loud line naming the URL — with the key redacted, never the secret
  const loud = log.lines.filter((line) => line.includes('Deleted stale webhook'));
  assert.equal(loud.length, 1);
  assert.ok(loud[0].includes(`https://api.${DOMAIN}/omega/payments/webhook?processor=stripe&key=***`));
  assert.ok(!log.lines.some((line) => line.includes(WEBHOOK_KEY)));
});

test('stripe-webhook: converged host → a second run still makes no webhook calls', async () => {
  const stripe = fakeStripe(stripeConverged());
  const config = brandConfig({ products: makeProducts({ ids: CONVERGED_IDS }) });

  await runService(config, { stripe, confirmed: true });
  await runService(config, { stripe, confirmed: true });

  assert.deepEqual(stripe.mutations(), []);
});

test('stripe-webhook: dry run on a legacy twin reads only', async () => {
  const responses = stripeConverged();
  responses.listWebhookEndpoints = {
    data: [
      { id: 'we_1', url: STRIPE_WEBHOOK_URL, status: 'enabled', enabled_events: [...STRIPE_EVENTS] },
      { id: 'we_legacy', url: STRIPE_LEGACY_WEBHOOK_URL, status: 'enabled', enabled_events: [...STRIPE_EVENTS] },
    ],
  };
  const stripe = fakeStripe(responses);
  const config = brandConfig({ products: makeProducts({ ids: CONVERGED_IDS }) });

  await runService(config, { stripe, options: { dryRun: true }, confirmed: true });

  assert.deepEqual(stripe.mutations(), []);
});

test('payment: a missing OMEGA_WEBHOOK_KEY is MINTED in place — the webhook is managed, never skipped (#635)', async () => {
  const responses = stripeConverged();
  responses.listWebhookEndpoints = { data: [] };
  responses.createWebhookEndpoint = { id: 'we_new' };
  const stripe = fakeStripe(responses);
  const config = brandConfig({ products: makeProducts({ ids: CONVERGED_IDS }) });

  await runService(config, {
    stripe, webhookKey: false,
    confirmed: true,
  });

  // OMEGA mints its own key, so the run never steps aside for it
  const minted = process.env.OMEGA_WEBHOOK_KEY;
  assert.match(minted, /^[A-Za-z0-9_-]{43}$/);
  // ...and the freshly minted key is what the webhook URL is built from
  assert.deepEqual(stripe.callsTo('createWebhookEndpoint').map((c) => c.args), [
    [`https://api.${DOMAIN}/omega/payments/webhook?provider=stripe&key=${minted}`, STRIPE_EVENTS],
  ]);
});

test('payment: firebase.shared brand → webhook operations skip without touching the API', async () => {
  const stripe = fakeStripe(stripeConverged());
  const config = brandConfig({ products: makeProducts({ ids: CONVERGED_IDS }), firebase: { shared: true } });

  const result = await runService(config, {
    stripe, confirmed: true,
  });

  assert.equal(result.status, 'success');
  assert.equal(stripe.callsTo('listWebhookEndpoints').length, 0);
  assert.deepEqual(stripe.mutations(), []);
});

// ─── PayPal ──────────────────────────────────────────────────────────────────

test('paypal-account: reports environment + app ID', async () => {
  const paypal = fakePaypal(paypalConverged());
  const config = brandConfig({ products: makeProducts({ ids: CONVERGED_IDS }) });

  const result = await runService(config, { paypal, options: { provider: 'paypal' } });

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

  const result = await runService(config, { paypal, options: { provider: 'paypal' } });

  assert.equal(result.status, 'error');
  assert.equal(result.output.paypalAccount.authenticated, false);
  assert.deepEqual(paypal.mutations(), []);
});

test('paypal-products: missing everywhere → exact product + plan create payloads + config writeback', async () => {
  const products = [
    { id: 'plus', name: 'Plus', type: 'subscription', trial: { days: 14 }, prices: { monthly: 10, annually: 100 } },
  ];
  const responses = paypalConverged();
  responses.listProducts = []; // nothing to self-heal against
  responses.createProduct = { id: 'PROD-NEW' };
  responses.listPlansForProduct = [];
  responses.createPlan = ({ interval }) => ({ id: `P-NEW-${interval}` });
  const paypal = fakePaypal(responses);

  const config = brandConfig({ products });
  const brandRoot = makeBrandRoot(writebackSource(config));
  const result = await runService(config, { paypal, options: { provider: 'paypal' }, brandRoot });

  assert.deepEqual(paypal.callsTo('createProduct').map((c) => c.args), [[{
    name: `${BRAND_NAME} - Plus`,
    description: BRAND_DESC,
    type: 'SERVICE',
    imageUrl: BRANDMARK,
    homeUrl: BRAND_URL,
  }]]);
  assert.deepEqual(paypal.callsTo('createPlan').map((c) => c.args), [
    [{ productId: 'PROD-NEW', name: `${BRAND_NAME} - Plus (Monthly)`, interval: 'monthly', amount: 10, trialDays: 14 }],
    [{ productId: 'PROD-NEW', name: `${BRAND_NAME} - Plus (Monthly, no trial)`, interval: 'monthly', amount: 10, trialDays: 0 }],
    [{ productId: 'PROD-NEW', name: `${BRAND_NAME} - Plus (Annually)`, interval: 'annually', amount: 100, trialDays: 14 }],
    [{ productId: 'PROD-NEW', name: `${BRAND_NAME} - Plus (Annually, no trial)`, interval: 'annually', amount: 100, trialDays: 0 }],
  ]);
  assert.ok(readConfigSource(brandRoot).includes(`{ id: 'plus', paypal: { productId: "PROD-NEW" } }, // Plus`));
});

test('paypal-products: an unconfigured id self-heals by exact name match — no create', async () => {
  const products = [
    { id: 'plus', name: 'Plus', type: 'subscription', trial: { days: 14 }, prices: { monthly: 10, annually: 100 } },
  ];
  const responses = paypalConverged();
  responses.listProducts = [{ id: 'PROD-PLUS', name: `${BRAND_NAME} - Plus` }]; // summarized list entry
  const paypal = fakePaypal(responses);

  const config = brandConfig({ products });
  const brandRoot = makeBrandRoot(writebackSource(config));
  const result = await runService(config, { paypal, options: { provider: 'paypal' }, brandRoot });

  assert.equal(paypal.callsTo('createProduct').length, 0);
  assert.equal(paypal.callsTo('getProduct').length, 1); // list is summarized — full fetch before diffing
  assert.ok(readConfigSource(brandRoot).includes(`{ id: 'plus', paypal: { productId: "PROD-PLUS" } }, // Plus`));
});

test('paypal-products: plan drift → stale + duplicate deactivated, correct plan created', async () => {
  const responses = paypalConverged();
  responses.listPlansForProduct = (id) => (id === 'PROD-PLUS'
    ? [
      paypalPlan('P-M-STALE', 'MONTH', '9.00', 14),   // wrong amount → deactivate + recreate
      paypalPlan('P-M-NT', 'MONTH', '10.00', 0),      // converged skip-trial twin
      paypalPlan('P-Y', 'YEAR', '100.00', 14),        // converged trial twin
      paypalPlan('P-Y-DUP', 'YEAR', '100.00', 14),    // duplicate match → deactivate
      paypalPlan('P-Y-NT', 'YEAR', '100.00', 0),      // converged skip-trial twin
    ]
    : []);
  responses.deactivatePlan = null;
  responses.createPlan = { id: 'P-M-NEW' };
  const paypal = fakePaypal(responses);
  const config = brandConfig({ products: makeProducts({ ids: CONVERGED_IDS }) });

  await runService(config, { paypal, options: { provider: 'paypal' } });

  assert.deepEqual(paypal.callsTo('deactivatePlan').map((c) => c.args).sort(), [['P-M-STALE'], ['P-Y-DUP']]);
  assert.deepEqual(paypal.callsTo('createPlan').map((c) => c.args), [
    [{ productId: 'PROD-PLUS', name: `${BRAND_NAME} - Plus (Monthly)`, interval: 'monthly', amount: 10, trialDays: 14 }],
  ]);
});

test('paypal-products: a trial product mints BOTH twins per interval — trial and skip-trial (#761)', async () => {
  // A buyer who is not owed a trial has to land on a plan with no TRIAL cycle
  // to skip, so a trial product carries two active plans per paid interval
  const products = [
    { id: 'plus', name: 'Plus', type: 'subscription', trial: { days: 14 }, prices: { monthly: 10 } },
  ];
  const responses = paypalConverged();
  responses.listProducts = [];
  responses.createProduct = { id: 'PROD-NEW' };
  responses.listPlansForProduct = [];
  responses.createPlan = ({ trialDays }) => ({ id: trialDays > 0 ? 'P-NEW-TRIAL' : 'P-NEW-NT' });
  const paypal = fakePaypal(responses);

  const config = brandConfig({ products });
  await runService(config, { paypal, options: { provider: 'paypal' }, brandRoot: makeBrandRoot(writebackSource(config)) });

  assert.deepEqual(paypal.callsTo('createPlan').map((c) => c.args), [
    [{ productId: 'PROD-NEW', name: `${BRAND_NAME} - Plus (Monthly)`, interval: 'monthly', amount: 10, trialDays: 14 }],
    [{ productId: 'PROD-NEW', name: `${BRAND_NAME} - Plus (Monthly, no trial)`, interval: 'monthly', amount: 10, trialDays: 0 }],
  ]);
  assert.deepEqual(paypal.callsTo('deactivatePlan'), []);
});

test('paypal-products: converged twins rerun — nothing created, nothing deactivated (#761)', async () => {
  // Neither twin is a duplicate or a stale copy of the other, so a second walk
  // over an already-twinned product is read-only
  const products = [
    { id: 'plus', name: 'Plus', type: 'subscription', trial: { days: 14 }, prices: { monthly: 10, annually: 100 }, paypal: { productId: 'PROD-PLUS' } },
  ];
  const paypal = fakePaypal(paypalConverged());
  const config = brandConfig({ products });

  const result = await runService(config, { paypal, options: { provider: 'paypal' } });

  assert.equal(result.status, 'success');
  assert.deepEqual(paypal.mutations(), []);
});

test('paypal-products: a stale plan on a trial product is deactivated and BOTH twins created (#761)', async () => {
  // The pre-twin world's single plan, at a price config has since moved off:
  // it matches neither twin, so it goes and the pair is minted
  const products = [
    { id: 'plus', name: 'Plus', type: 'subscription', trial: { days: 14 }, prices: { monthly: 10 }, paypal: { productId: 'PROD-PLUS' } },
  ];
  const responses = paypalConverged();
  responses.listPlansForProduct = (id) => (id === 'PROD-PLUS' ? [paypalPlan('P-M-OLD', 'MONTH', '9.00', 14)] : []);
  responses.deactivatePlan = null;
  responses.createPlan = ({ trialDays }) => ({ id: trialDays > 0 ? 'P-NEW-TRIAL' : 'P-NEW-NT' });
  const paypal = fakePaypal(responses);
  const config = brandConfig({ products });

  await runService(config, { paypal, options: { provider: 'paypal' } });

  assert.deepEqual(paypal.callsTo('deactivatePlan').map((c) => c.args), [['P-M-OLD']]);
  assert.deepEqual(paypal.callsTo('createPlan').map((c) => c.args), [
    [{ productId: 'PROD-PLUS', name: `${BRAND_NAME} - Plus (Monthly)`, interval: 'monthly', amount: 10, trialDays: 14 }],
    [{ productId: 'PROD-PLUS', name: `${BRAND_NAME} - Plus (Monthly, no trial)`, interval: 'monthly', amount: 10, trialDays: 0 }],
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

  await runService(config, { paypal, options: { provider: 'paypal' } });

  assert.deepEqual(paypal.callsTo('deactivatePlan').map((c) => c.args), [['P-LEGACY']]);
});

// #348 — `hidden: true` is a PRESENTATION flag the web pricing composer
// honors; the walk must keep reconciling the product, or the QA tier the
// payments drives buy by id would have no provider objects to buy.
test('payment: a hidden product is presentation-only — the walk still ensures its provider objects (#348)', async () => {
  const products = [
    { id: 'proof-press', name: 'Proof Press', type: 'subscription', hidden: true, prices: { monthly: 5 } },
  ];

  const paypalResponses = paypalConverged();
  paypalResponses.listProducts = [];
  paypalResponses.createProduct = { id: 'PROD-QA' };
  paypalResponses.listPlansForProduct = [];
  paypalResponses.createPlan = { id: 'P-QA' };
  const paypal = fakePaypal(paypalResponses);
  const paypalConfig = brandConfig({ products });
  const paypalRoot = makeBrandRoot(writebackSource(paypalConfig));
  await runService(paypalConfig, { paypal, options: { provider: 'paypal' }, brandRoot: paypalRoot });

  assert.deepEqual(paypal.callsTo('createProduct').map((c) => c.args), [[{
    name: `${BRAND_NAME} - Proof Press`,
    description: BRAND_DESC,
    type: 'SERVICE',
    imageUrl: BRANDMARK,
    homeUrl: BRAND_URL,
  }]]);
  assert.deepEqual(paypal.callsTo('createPlan').map((c) => c.args), [
    [{ productId: 'PROD-QA', name: `${BRAND_NAME} - Proof Press (Monthly)`, interval: 'monthly', amount: 5, trialDays: 0 }],
  ]);
  assert.ok(readConfigSource(paypalRoot).includes(`{ id: 'proof-press', paypal: { productId: "PROD-QA" } }, // Proof Press`));

  const stripeResponses = stripeConverged();
  stripeResponses.listAllProducts = [];
  stripeResponses.createProduct = { id: 'prod_qa' };
  stripeResponses.listPricesForProduct = [];
  stripeResponses.createRecurringPrice = { id: 'price_qa' };
  const stripe = fakeStripe(stripeResponses);
  const stripeConfig = brandConfig({ products });
  const stripeRoot = makeBrandRoot(writebackSource(stripeConfig));
  await runService(stripeConfig, {
    stripe, options: { provider: 'stripe' }, confirmed: true, brandRoot: stripeRoot,
  });

  assert.deepEqual(stripe.callsTo('createProduct').map((c) => c.args), [[{
    name: `${BRAND_NAME} - Proof Press`,
    brandId: BRAND_ID,
    productId: 'proof-press',
    description: BRAND_DESC,
    images: [BRANDMARK],
    url: BRAND_URL,
  }]]);
  assert.deepEqual(stripe.callsTo('createRecurringPrice').map((c) => c.args), [['prod_qa', 5, 'monthly']]);
  assert.ok(readConfigSource(stripeRoot).includes(`{ id: 'proof-press', stripe: { productId: "prod_qa" } }, // Proof Press`));
});

// #348 (buyer half) — PayPal mints no sandbox buyer through any API, so the
// walk reminds instead of precreating: sandbox runs close paypal-products with
// the buyer note, live runs and unconfigured PayPal stay silent.

/** Capture console.log lines around a walk run (the walk's report is console output). */
function captureLog() {
  const lines = [];
  const original = console.log;
  console.log = (...args) => { lines.push(args.join(' ')); };
  return { lines, restore: () => { console.log = original; } };
}

const BUYER_REMINDER = 'sandbox BUYER account';

test('paypal-products: sandbox mode closes with the sandbox-buyer reminder (#348)', async () => {
  const responses = paypalConverged();
  responses.getAccountInfo = { appId: 'APP-1', environment: 'sandbox', clientId: 'client-id-fixture' };
  const paypal = fakePaypal(responses);
  const config = brandConfig({ products: makeProducts({ ids: CONVERGED_IDS }) });

  const log = captureLog();
  let result;
  try {
    result = await runService(config, { paypal, options: { provider: 'paypal' } });
  } finally {
    log.restore();
  }

  assert.equal(result.status, 'success');
  const reminder = log.lines.find((line) => line.includes(BUYER_REMINDER));
  assert.ok(reminder, 'sandbox run printed no buyer reminder');
  assert.ok(reminder.includes('proof-press'), 'the reminder names the QA fixture product');
  const pointer = log.lines.find((line) => line.includes('https://developer.paypal.com/dashboard/accounts'));
  assert.ok(pointer, 'the reminder points at the Developer Dashboard sandbox accounts page');
  assert.ok(pointer.includes('@omega.js/backend/docs/paypal-sandbox-qa.md'), 'the reminder points at the runbook');
  assert.deepEqual(paypal.mutations(), []); // a reminder, never a mutation
});

test('paypal-products: live mode prints no buyer reminder (#348)', async () => {
  const paypal = fakePaypal(paypalConverged()); // environment: 'live'
  const config = brandConfig({ products: makeProducts({ ids: CONVERGED_IDS }) });

  const log = captureLog();
  try {
    await runService(config, { paypal, options: { provider: 'paypal' } });
  } finally {
    log.restore();
  }

  assert.ok(!log.lines.some((line) => line.includes(BUYER_REMINDER)));
});

test('paypal-products: unconfigured PayPal prints no buyer reminder (#348)', async () => {
  const stripe = fakeStripe(stripeConverged());
  const config = brandConfig({ products: makeProducts({ ids: CONVERGED_IDS }) }); // no paypal client injected

  const log = captureLog();
  try {
    await runService(config, { stripe, confirmed: true });
  } finally {
    log.restore();
  }

  assert.ok(log.lines.some((line) => line.includes('PayPal not configured')));
  assert.ok(!log.lines.some((line) => line.includes(BUYER_REMINDER)));
});

test('paypal-webhook: missing → created with exact URL + events', async () => {
  const responses = paypalConverged();
  responses.listWebhooks = { webhooks: [] };
  responses.createWebhook = { id: 'WH-NEW' };
  const paypal = fakePaypal(responses);
  const config = brandConfig({ products: makeProducts({ ids: CONVERGED_IDS }) });

  await runService(config, { paypal, options: { provider: 'paypal' } });

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

  await runService(config, { paypal, options: { provider: 'paypal' } });

  assert.deepEqual(paypal.callsTo('updateWebhook').map((c) => c.args), [
    ['WH-1', [{ op: 'replace', path: '/event_types', value: PAYPAL_EVENTS.map((name) => ({ name })) }]],
  ]);
});

test('paypal-webhook: legacy twin on the brand host → deleted; the desired URL and other hosts untouched', async () => {
  const responses = paypalConverged();
  responses.listWebhooks = {
    webhooks: [
      { id: 'WH-1', url: PAYPAL_WEBHOOK_URL, event_types: PAYPAL_EVENTS.map((name) => ({ name })) },
      { id: 'WH-LEGACY', url: PAYPAL_LEGACY_WEBHOOK_URL, event_types: PAYPAL_EVENTS.map((name) => ({ name })) },
      { id: 'WH-FOREIGN', url: FOREIGN_WEBHOOK_URL, event_types: PAYPAL_EVENTS.map((name) => ({ name })) },
    ],
  };
  responses.deleteWebhook = null;
  const paypal = fakePaypal(responses);
  const config = brandConfig({ products: makeProducts({ ids: CONVERGED_IDS }) });

  await runService(config, { paypal, options: { provider: 'paypal' } });

  assert.deepEqual(paypal.callsTo('deleteWebhook').map((c) => c.args), [['WH-LEGACY']]);
  assert.deepEqual(paypal.callsTo('updateWebhook'), []);
  assert.deepEqual(paypal.callsTo('createWebhook'), []);
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

  await runService(brandConfig({ products }), { chargebee, options: { provider: 'chargebee' } });

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

  await runService(config, { chargebee, options: { provider: 'chargebee' } });

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

  await runService(config, { chargebee, options: { provider: 'chargebee' } });

  assert.deepEqual(chargebee.callsTo('getPlan').map((c) => c.args), [['old-plan']]);
  assert.deepEqual(chargebee.mutations(), []);
});

test('chargebee-webhook: missing → created with &brand= URL, name, and 15 events', async () => {
  const responses = chargebeeConverged();
  responses.listWebhooks = [];
  responses.createWebhook = { id: 'cbwh_new' };
  const chargebee = fakeChargebee(responses);
  const config = brandConfig({ products: makeProducts({ ids: CONVERGED_IDS }) });

  await runService(config, { chargebee, options: { provider: 'chargebee' } });

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

  await runService(config, { chargebee, options: { provider: 'chargebee' } });

  assert.deepEqual(chargebee.callsTo('updateWebhook').map((c) => c.args), [
    ['cbwh_1', { status: 'active' }],
  ]);
});

test('chargebee-webhook: legacy twin on the brand host → deleted; the desired URL and other hosts untouched', async () => {
  const responses = chargebeeConverged();
  responses.listWebhooks = [
    { id: 'cbwh_1', url: CHARGEBEE_WEBHOOK_URL, disabled: false },
    { id: 'cbwh_legacy', url: CHARGEBEE_LEGACY_WEBHOOK_URL, disabled: false },
    { id: 'cbwh_foreign', url: FOREIGN_WEBHOOK_URL, disabled: false },
  ];
  responses.deleteWebhook = { id: 'cbwh_legacy' };
  const chargebee = fakeChargebee(responses);
  const config = brandConfig({ products: makeProducts({ ids: CONVERGED_IDS }) });

  await runService(config, { chargebee, options: { provider: 'chargebee' } });

  assert.deepEqual(chargebee.callsTo('deleteWebhook').map((c) => c.args), [['cbwh_legacy']]);
  assert.deepEqual(chargebee.callsTo('updateWebhook'), []);
  assert.deepEqual(chargebee.callsTo('createWebhook'), []);
});

// ─── Dry-run ─────────────────────────────────────────────────────────────────

test('payment: dry-run on a fully drifted account — zero mutations on all three providers', async () => {
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
  // No per-provider product IDs configured — full-create territory
  const config = brandConfig();
  const brandRoot = makeBrandRoot(writebackSource(config));

  const result = await runService(config, { stripe, paypal, chargebee, options: { dryRun: true }, brandRoot });

  assert.equal(result.status, 'warned'); // radar + disputes guidance still warns
  assert.deepEqual(stripe.mutations(), []);
  assert.deepEqual(paypal.mutations(), []);
  assert.deepEqual(chargebee.mutations(), []);
  // Dry-run lands no product ID in omega.json5 either
  assert.ok(!readConfigSource(brandRoot).includes('productId'));
});

// ─── Interactive provider credential entry (config-landing flow) ────────────

const { providerSetupFlow } = require('../src/services/payment/lib/provider-setup.js');
const { readFileSync, existsSync } = require('node:fs');
const { join: joinPath } = require('node:path');

const PROVIDER_FLOW_CONFIG = `{
  // Fixture Brand — provider writeback target
  brand: { id: 'fixture-brand', name: 'Fixture Brand', url: 'https://fixture-brand.test' },
  payment: {
    providers: {
      stripe: { updateAccountInfo: true }, // publishableKey lands here
    },
  },
}
`;

function providerFlowContext(brandRoot) {
  return {
    brandId: 'fixture-brand',
    brandRoot,
    options: {},
    brandConfig: {
      brand: { id: 'fixture-brand', name: 'Fixture Brand', url: 'https://fixture-brand.test' },
      payment: { providers: { stripe: { updateAccountInfo: true } } },
    },
  };
}

test('provider-setup: stripe flow lands the publishable key in config and the secret in .env + process.env', async () => {
  const saved = process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_SECRET_KEY;
  // The Enter-gated open runs through devkit/prompt's own launcher seam
  const promptModule = require('@omega.js/devkit/prompt');
  const realOpen = promptModule.openInBrowser;
  const opened = [];
  promptModule.openInBrowser = (url) => { opened.push(url); return true; };
  const brandRoot = makeBrandRoot(PROVIDER_FLOW_CONFIG);
  const context = providerFlowContext(brandRoot);
  const tty = openTtyPrompt();

  try {
    const run = providerSetupFlow(context, 'stripe');
    await tty.answer('Set up now?', '\r'); // Yes
    await tty.answer('Stripe publishable key', 'pk_test_fixture123\r');
    // The secret half rides the shared setup contract (#608) — the gate above
    // already ran, so it goes straight to the Enter-gated open + guided paste
    await tty.answer('Press Enter to open the Stripe secret key page', '\r');
    await tty.answer('Paste STRIPE_SECRET_KEY:', 'sk_test_fixture456\r');
    const landed = await run;

    assert.equal(landed, true);
    // ONE open, and only after Enter — never auto-opened
    assert.deepEqual(opened, ['https://dashboard.stripe.com/apikeys']);
    // Public half → omega.json5 (comment preserved), in-memory patched
    const written = readConfigSource(brandRoot);
    assert.ok(written.includes('publishableKey: "pk_test_fixture123"'));
    assert.ok(written.includes('// publishableKey lands here'));
    assert.equal(context.brandConfig.payment.providers.stripe.publishableKey, 'pk_test_fixture123');
    // Secret half → brand .env + the current process
    assert.ok(readFileSync(joinPath(brandRoot, '.env'), 'utf8').includes('STRIPE_SECRET_KEY="sk_test_fixture456"'));
    assert.equal(process.env.STRIPE_SECRET_KEY, 'sk_test_fixture456');
  } finally {
    tty.close();
    promptModule.openInBrowser = realOpen;
    if (saved === undefined) {
      delete process.env.STRIPE_SECRET_KEY;
    } else {
      process.env.STRIPE_SECRET_KEY = saved;
    }
  }
});

test('provider-setup: Disable writes payment.providers.stripe: false and lands nothing', async () => {
  const brandRoot = makeBrandRoot(PROVIDER_FLOW_CONFIG);
  const context = providerFlowContext(brandRoot);
  const tty = openTtyPrompt();

  try {
    const run = providerSetupFlow(context, 'stripe');
    await tty.answer('Set up now?', '\x1B[B\x1B[B\r'); // Disable (stop prompting)
    const landed = await run;

    assert.equal(landed, false);
    assert.equal(context.brandConfig.payment.providers.stripe, false);
    assert.ok(readConfigSource(brandRoot).includes('stripe: false, // publishableKey lands here'));
  } finally {
    tty.close();
  }
});

// ─── Coinbase Commerce: the ask with no public half (#642) ──────────────────

const COINBASE_FLOW_CONFIG = `{
  // Fixture Brand — provider writeback target
  brand: { id: 'fixture-brand', name: 'Fixture Brand', url: 'https://fixture-brand.test' },
  payment: {
    providers: {
      coinbase: { enabled: true }, // the whole switch
    },
  },
}
`;

function coinbaseFlowContext(brandRoot) {
  return {
    brandId: 'fixture-brand',
    brandRoot,
    options: {},
    brandConfig: {
      brand: { id: 'fixture-brand', name: 'Fixture Brand', url: 'https://fixture-brand.test' },
      payment: { providers: { coinbase: { enabled: true } } },
    },
  };
}

test('provider-setup: the coinbase flow asks for the API key ALONE — there is no public half', async () => {
  // Every sibling lands a public value in omega.json5 beside its secret
  // (publishableKey, clientId, site). Coinbase Commerce has none: the API key is
  // the entire credential, which is exactly why its config switch is `enabled`.
  const saved = process.env.COINBASE_COMMERCE_API_KEY;
  delete process.env.COINBASE_COMMERCE_API_KEY;
  const promptModule = require('@omega.js/devkit/prompt');
  const realOpen = promptModule.openInBrowser;
  const opened = [];
  promptModule.openInBrowser = (url) => { opened.push(url); return true; };
  const brandRoot = makeBrandRoot(COINBASE_FLOW_CONFIG);
  const context = coinbaseFlowContext(brandRoot);
  const tty = openTtyPrompt();

  try {
    const run = providerSetupFlow(context, 'coinbase');
    await tty.answer('Set up now?', '\r'); // Yes
    // No public-field prompt at all — straight to the shared secret ask (#608)
    await tty.answer('Press Enter to open the Coinbase Commerce', '\r');
    await tty.answer('Paste COINBASE_COMMERCE_API_KEY:', 'cb_fixture_key_789\r');
    const landed = await run;

    assert.equal(landed, true);
    assert.equal(opened.length, 1, 'ONE Enter-gated open, the page that mints the key');
    assert.match(opened[0], /commerce\.coinbase\.com/);
    // The secret lands in the brand .env and this run's process
    assert.ok(readFileSync(joinPath(brandRoot, '.env'), 'utf8').includes('COINBASE_COMMERCE_API_KEY="cb_fixture_key_789"'));
    assert.equal(process.env.COINBASE_COMMERCE_API_KEY, 'cb_fixture_key_789');
    // And NOTHING was written to omega.json5 — there is no public half to land
    assert.equal(readConfigSource(brandRoot), COINBASE_FLOW_CONFIG);
  } finally {
    tty.close();
    promptModule.openInBrowser = realOpen;
    if (saved === undefined) {
      delete process.env.COINBASE_COMMERCE_API_KEY;
    } else {
      process.env.COINBASE_COMMERCE_API_KEY = saved;
    }
  }
});

test('provider-setup: coinbase Disable writes payment.providers.coinbase.enabled: false', async () => {
  // The sibling providers disable at `payment.providers.<name>` because their
  // switch IS the block. Coinbase's switch is `enabled`, so Disable has to land
  // THERE — the one shape the schema declares and the checkout reads (#642).
  const saved = process.env.COINBASE_COMMERCE_API_KEY;
  delete process.env.COINBASE_COMMERCE_API_KEY;
  const brandRoot = makeBrandRoot(COINBASE_FLOW_CONFIG);
  const context = coinbaseFlowContext(brandRoot);
  const tty = openTtyPrompt();

  try {
    const run = providerSetupFlow(context, 'coinbase');
    await tty.answer('Set up now?', '\x1B[B\x1B[B\r'); // Disable (stop prompting)
    const landed = await run;

    assert.equal(landed, false);
    assert.equal(context.brandConfig.payment.providers.coinbase.enabled, false);
    assert.ok(readConfigSource(brandRoot).includes('enabled: false'), 'the switch is off in omega.json5');
    // Disable steps aside BEFORE the secret ask, so no brand .env is even created
    assert.equal(existsSync(joinPath(brandRoot, '.env')), false, 'and no key was asked for');
  } finally {
    tty.close();
    if (saved === undefined) {
      delete process.env.COINBASE_COMMERCE_API_KEY;
    } else {
      process.env.COINBASE_COMMERCE_API_KEY = saved;
    }
  }
});

test('payment: a brand with crypto OFF is never asked for a Coinbase key', async () => {
  // `enabled` is the whole switch, so an absent or false one means the brand has
  // no use for the key — asking would be a prompt for a credential nothing reads.
  const { REQUIRES } = require('../src/config.js');
  const input = REQUIRES.payment.env.find((entry) => entry.name === 'COINBASE_COMMERCE_API_KEY');

  assert.ok(input, 'the key is declared in the REQUIRES registry, or the setup contract cannot ask for it');
  assert.equal(input.gates, false, 'an optional input: a missing crypto key never gates the payment service');
  assert.equal(input.disablePath, 'payment.providers.coinbase.enabled', 'Disable lands on the switch the schema declares');

  for (const providers of [{}, { coinbase: {} }, { coinbase: { enabled: false } }, { coinbase: false }]) {
    assert.equal(
      input.when({ payment: { providers } }), false,
      `not asked when crypto is off: ${JSON.stringify(providers)}`,
    );
  }

  assert.equal(input.when({ payment: { providers: { coinbase: { enabled: true } } } }), true, 'asked when it is on');
});

test('provider-setup: non-interactive returns false without touching anything', async () => {
  const brandRoot = makeBrandRoot(PROVIDER_FLOW_CONFIG);
  const context = providerFlowContext(brandRoot);

  const landed = await providerSetupFlow(context, 'stripe');

  assert.equal(landed, false);
  assert.equal(readConfigSource(brandRoot), PROVIDER_FLOW_CONFIG);
});

test('absoluteBrandImage: relative brand.images join brand.url; full URLs pass through; unresolvable → null', () => {
  const { absoluteBrandImage } = require('../src/lib/brand.js');

  const relative = { brand: { url: 'https://playground.omegajs.dev/', images: { brandmark: '/assets/images/brand/brandmark.png' } } };
  assert.equal(
    absoluteBrandImage(relative, 'brandmark'),
    'https://playground.omegajs.dev/assets/images/brand/brandmark.png',
    'relative path joins brand.url (trailing slash collapsed)'
  );

  const absolute = { brand: { url: 'https://x.dev', images: { brandmark: 'https://cdn.example.com/mark.png' } } };
  assert.equal(absoluteBrandImage(absolute, 'brandmark'), 'https://cdn.example.com/mark.png', 'full URL passes through');

  assert.equal(absoluteBrandImage({ brand: { url: 'https://x.dev', images: {} } }, 'brandmark'), null, 'missing image → null');
  assert.equal(
    absoluteBrandImage({ brand: { images: { brandmark: '/mark.png' } } }, 'brandmark'),
    null,
    'relative path without brand.url is unresolvable → null'
  );
});
