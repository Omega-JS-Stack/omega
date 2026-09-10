/**
 * The account page's ORDERS list and the refund it makes reachable
 * ([#672](https://github.com/Omega-JS-Stack/omega/issues/672)).
 *
 * Nothing under `dashboard/**` read `payments-orders` — billing.js is
 * subscription-only — yet the confirmation copy and the receipt email both told
 * the customer their purchase was waiting in their account. And the refund
 * section gated eligibility on `account.subscription` and posted no `orderId`,
 * so the backend's complete, guarded one-time refund lane could not be reached
 * from the product at all.
 *
 * The harness is account-persona-previews.test.js's: the REAL modules through
 * esbuild with @omega.js/client stubbed, over a hand-rolled document that is
 * only what the sections touch (node has no DOM and web pulls in no jsdom). The
 * one seam is the backend: `GET /user/orders` answers whatever the case needs.
 */
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');
const { resolveSubscription } = require('@omega.js/account');

const CORE_DIR = path.join(__dirname, '..', 'core');
const SECTIONS_DIR = path.join(CORE_DIR, 'js', 'pages', 'dashboard', 'account', 'sections');
const ACCOUNT_LAYOUT = path.join(__dirname, '..', 'themes', 'base', '_layouts', 'frontend', 'pages', 'account', 'index.html');

const BUNDLE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-account-orders-'));
const BUNDLE = path.join(BUNDLE_DIR, 'sections.cjs');

const DAY = 24 * 60 * 60;

let building = null;

// One entry exposing both sections, bundled the way the page bundle imports
// them — so they share the ONE orders module, which is the point.
function bundleOnce() {
  building ||= esbuild.build({
    stdin: {
      contents: [
        `export * as orders from './orders.js';`,
        `export * as refund from './refund.js';`,
      ].join('\n'),
      resolveDir: SECTIONS_DIR,
      loader: 'js',
    },
    outfile: BUNDLE,
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    plugins: [{
      name: 'harness-aliases',
      setup(build) {
        build.onResolve({ filter: /^__main_assets__\// }, (args) => {
          return { path: path.join(CORE_DIR, args.path.slice('__main_assets__/'.length)) };
        });
        build.onResolve({ filter: /^@omega\.js\/client$/ }, () => {
          return { path: 'client', namespace: 'omega-client-stub' };
        });
        build.onLoad({ filter: /.*/, namespace: 'omega-client-stub' }, () => {
          return { contents: 'export default globalThis.__omegaClient;' };
        });
        // The refund form's manager, standing in for the real one: it hands the
        // section's submit handler back out so a case can RUN it, which is the
        // only way to see the body the form posts.
        build.onResolve({ filter: /^@omega\.js\/client\/modules\/form-manager\.js$/ }, () => {
          return { path: 'form-manager', namespace: 'omega-form-manager-stub' };
        });
        build.onLoad({ filter: /.*/, namespace: 'omega-form-manager-stub' }, () => {
          return {
            contents: [
              'export class FormManager {',
              '  constructor() { globalThis.__refundForm = this; }',
              '  on(name, handler) { if (name === \'submit\') { this.submit = handler; } }',
              '  showSuccess(message) { this.success = message; }',
              '}',
            ].join('\n'),
          };
        });
      },
    }],
  });

  return building;
}

/** An order summary as GET /user/orders hands it back (routes/user/orders/get.js) */
function orderSummary(id, { type = 'one-time', name = '100 Credits', ago = DAY, status = 'completed', refundable = true, amount = 9.99 } = {}) {
  const created = Math.floor(Date.now() / 1000) - ago;

  return {
    id: id,
    type: type,
    productId: 'credits-100',
    productName: name,
    status: status,
    refunded: status === 'refunded',
    refundable: refundable,
    amount: amount,
    currency: 'USD',
    frequency: type === 'one-time' ? 'once' : 'monthly',
    provider: 'stripe',
    date: { timestamp: new Date(created * 1000).toISOString(), timestampUNIX: created },
  };
}

/** The pieces of a DOM element the sections use */
function makeEl(id) {
  const classes = new Set();
  const listeners = {};

  return {
    id,
    textContent: '',
    innerHTML: '',
    value: '',
    dataset: {},
    listeners,
    addEventListener: (type, handler) => { (listeners[type] ||= []).push(handler); },
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
      toggle: (name, force) => (force ? classes.add(name) : classes.delete(name)),
    },
  };
}

// What GET /user/orders answers for the case being run. Read at CALL time: the
// bundle captures `globalThis.__omegaClient` when it loads.
let ordersPayload = { orders: [] };
let requests = [];

// The reason the refund form's radios are answered with
const REFUND_REASON = 'Too expensive';

/**
 * Stand the sections up over a document, run `drive`, hand back the elements.
 *
 * @param {function} drive - (bundle, elements) => Promise, the case's own driving
 * @param {object} options - { orders } the backend answers with
 * @returns {Promise<Map>} The elements, by id
 */
async function renderSections(drive, { orders = [] } = {}) {
  await bundleOnce();

  ordersPayload = { orders };
  requests = [];

  const ids = ['orders-list', 'orders-badge', 'refund-eligible', 'refund-ineligible', 'refund-subject', 'refund-subject-picker', 'refund-form'];
  const elements = new Map(ids.map((id) => [id, makeEl(id)]));

  // Both blocks ship hidden, the way the layout hands them to the section
  elements.get('refund-eligible').classList.add('d-none');
  elements.get('refund-subject-picker').classList.add('d-none');

  globalThis.window = { location: { href: 'https://example.com/dashboard/account', origin: 'https://example.com', search: '', hash: '#orders' } };
  globalThis.document = {
    getElementById: (id) => elements.get(id) || null,
    // The reason radios are the one control the submit handler reads off the
    // document rather than off an id — an unanswered form throws before it posts
    querySelector: (selector) => (String(selector).includes('refund_reason') ? { value: REFUND_REASON } : null),
    querySelectorAll: () => [],
    addEventListener: () => {},
  };
  globalThis.__omegaClient = globalThis.__omegaClient || {
    getApiUrl: () => 'https://example.com/api',
    request: async (url, options) => {
      requests.push({ url, options });
      return ordersPayload;
    },
    auth: () => ({ resolveSubscription: (account) => resolveSubscription(account) }),
    utilities: () => ({
      escapeHTML: (value) => String(value ?? '').replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`),
      showNotification: () => {},
    }),
  };

  delete require.cache[require.resolve(BUNDLE)];
  const bundle = require(BUNDLE);

  await drive(bundle, elements);

  return elements;
}

const FREE_ACCOUNT = { subscription: { product: { id: 'basic', name: 'Basic' }, status: 'active' } };

test('#672: the orders list renders the purchases the route hands back', async () => {
  const orders = [
    orderSummary('1111-2222-3333', { name: '100 Credits', amount: 9.99 }),
    orderSummary('4444-5555-6666', { name: 'Launch Kit', amount: 49.99, ago: 40 * DAY, status: 'refunded', refundable: false }),
  ];

  const elements = await renderSections(async (bundle) => {
    await bundle.orders.loadData();
  }, { orders });

  const list = elements.get('orders-list').innerHTML;

  assert.ok(list.includes('100 Credits'), 'the purchase is named');
  assert.ok(list.includes('1111-2222-3333'), 'with its order number');
  assert.ok(list.includes('$9.99'), 'and what was paid');
  assert.ok(list.includes('Launch Kit'), 'every purchase is listed, not just the refundable ones');
  assert.ok(list.includes('Refunded'), 'and a refunded purchase says so');
  assert.equal(elements.get('orders-badge').textContent, '2', 'the badge counts them');
  assert.ok(!/NaN|undefined|Invalid Date/.test(list), `every row reads as a real purchase: ${list}`);
});

test('#672: an account with no purchases is told so, not left on the loading copy', async () => {
  const elements = await renderSections(async (bundle) => {
    await bundle.orders.loadData();
  }, { orders: [] });

  assert.match(elements.get('orders-list').innerHTML, /not made any purchases/i, 'the empty state replaces the loading line');
  assert.equal(elements.get('orders-badge').textContent, '0', 'and the badge agrees');
});

test('#672: only an order the BACKEND calls refundable is offered the button', async () => {
  const orders = [
    orderSummary('1111-1111-1111', { refundable: true }),
    orderSummary('2222-2222-2222', { refundable: false, status: 'refunded' }),
  ];

  const elements = await renderSections(async (bundle) => {
    await bundle.orders.loadData();
  }, { orders });

  const list = elements.get('orders-list').innerHTML;
  const offered = [...list.matchAll(/data-order-id="([^"]+)"/g)].map((match) => match[1]);

  assert.deepStrictEqual(offered, ['1111-1111-1111'], 'the refunded purchase is never offered a second refund');
});

test('#672: a purchase that never completed reads as unpaid, not as Unknown', async () => {
  // The status is the provider's own word passed straight through
  // (libraries/payment/providers/stripe.js:485), so a checkout that was opened
  // and abandoned lands as `open` — a pill with no entry read "Unknown", which
  // tells the customer nothing about a payment that simply did not happen.
  const elements = await renderSections(async (bundle) => {
    await bundle.orders.loadData();
  }, { orders: [orderSummary('7070-7070-7070', { status: 'open', refundable: false })] });

  const list = elements.get('orders-list').innerHTML;

  assert.ok(list.includes('Unpaid'), `an incomplete purchase says so: ${list}`);
  assert.ok(!list.includes('Unknown'), 'and never falls through to the unknown pill');
});

test('#672: a one-time purchase alone makes the refund section eligible', async () => {
  // The bug in one line: a Basic account with a refundable purchase used to be
  // told it was not eligible for anything, because eligibility read the
  // subscription and a one-time purchase never touches it.
  const elements = await renderSections(async (bundle) => {
    await bundle.refund.loadData(FREE_ACCOUNT);
  }, { orders: [orderSummary('3333-3333-3333')] });

  assert.ok(!elements.get('refund-eligible').classList.contains('d-none'), 'the form is offered');
  assert.ok(elements.get('refund-ineligible').classList.contains('d-none'), 'and the "not eligible" notice is gone');
});

test('#672: with nothing refundable at all, the section still says no', async () => {
  const elements = await renderSections(async (bundle) => {
    await bundle.refund.loadData(FREE_ACCOUNT);
  }, { orders: [orderSummary('4444-4444-4444', { refundable: false })] });

  assert.ok(elements.get('refund-eligible').classList.contains('d-none'), 'no form for an account with nothing to refund');
  assert.ok(!elements.get('refund-ineligible').classList.contains('d-none'), 'the notice explains why');
});

test('#672: the subject picker names each refundable purchase, and the pick from the orders list is honoured', async () => {
  const orders = [
    orderSummary('5555-5555-5555', { name: '100 Credits' }),
    orderSummary('6666-6666-6666', { name: 'Launch Kit', amount: 49.99 }),
  ];

  const elements = await renderSections(async (bundle, els) => {
    // init() is what the page calls before any data lands — it wires the
    // list's delegated click, which is the handoff under test.
    bundle.orders.init();

    await bundle.orders.loadData();
    await bundle.refund.loadData(FREE_ACCOUNT);

    // The click the list renders: it hands the pick to the shared module and
    // sends the page to the refund section, which reads it when shown.
    const [handler] = els.get('orders-list').listeners.click;
    handler({ target: { closest: () => ({ dataset: { orderId: '6666-6666-6666' } }) } });

    bundle.refund.onShow();
  }, { orders });

  const options = elements.get('refund-subject').innerHTML;

  assert.ok(options.includes('5555-5555-5555'), 'each refundable purchase is a subject');
  assert.ok(options.includes('6666-6666-6666'), 'both of them');
  assert.ok(options.includes('100 Credits') && options.includes('Launch Kit'), 'named by what was bought');
  assert.ok(!elements.get('refund-subject-picker').classList.contains('d-none'), 'the picker shows when there is a choice');
  assert.equal(elements.get('refund-subject').value, '6666-6666-6666', 'the order the customer pressed the button on is the one selected');
});

test('#672: a refund on a picked purchase posts that order id', async () => {
  // One endpoint, two subjects: the orderId is the ONLY thing that tells the
  // route which one it is being asked for (payments/refund/post.js), and it is
  // read off the picker at submit time — so nothing but running the handler sees it.
  await renderSections(async (bundle, els) => {
    bundle.orders.init();
    bundle.refund.init();

    await bundle.orders.loadData();
    await bundle.refund.loadData(FREE_ACCOUNT);

    const [handler] = els.get('orders-list').listeners.click;
    handler({ target: { closest: () => ({ dataset: { orderId: '8888-8888-8888' } }) } });
    bundle.refund.onShow();

    await globalThis.__refundForm.submit({ data: { feedback: 'Bought the wrong one' } });
  }, { orders: [orderSummary('8888-8888-8888')] });

  const [refundRequest] = requests.filter((request) => request.url.includes('/payments/refund'));

  assert.ok(refundRequest, `the form posts to the refund route, got: ${requests.map((request) => request.url).join(', ')}`);
  assert.equal(refundRequest.options.method, 'POST', 'as a write');
  assert.deepStrictEqual(refundRequest.options.body, {
    confirmed: true,
    reason: REFUND_REASON,
    feedback: 'Bought the wrong one',
    orderId: '8888-8888-8888',
  }, 'the body names the purchase, the reason and the confirmation, and nothing else');
});

test('#672: a subscription refund posts no order id at all', async () => {
  // An ABSENT orderId is what the route reads as "the subscription" — an empty
  // string would be a named order it could not find, so the key must not ride
  const SUBSCRIBER = { subscription: { product: { id: 'pro', name: 'Pro' }, status: 'cancelled' } };

  await renderSections(async (bundle) => {
    bundle.refund.init();

    await bundle.refund.loadData(SUBSCRIBER);

    await globalThis.__refundForm.submit({ data: {} });
  }, { orders: [] });

  const [refundRequest] = requests.filter((request) => request.url.includes('/payments/refund'));

  assert.deepStrictEqual(refundRequest.options.body, {
    confirmed: true,
    reason: REFUND_REASON,
    feedback: '',
  }, 'the subscription subject is the ABSENCE of an orderId, never an empty one');
  assert.ok(!('orderId' in refundRequest.options.body), 'the key is not there at all');
});

test('#672: one fetch serves both sections', async () => {
  await renderSections(async (bundle) => {
    await bundle.orders.loadData();
    await bundle.refund.loadData(FREE_ACCOUNT);
  }, { orders: [orderSummary('7777-7777-7777')] });

  const orderRequests = requests.filter((request) => request.url.includes('/user/orders'));

  assert.equal(orderRequests.length, 1, `the history is asked for once, got ${orderRequests.length}`);
  assert.equal(orderRequests[0].options.method, 'GET', 'through the read route');
});

test('#672: the account layout carries the orders section and the refund subject picker', async () => {
  // The premise both modules are built on: a section that is not in the markup
  // renders into nothing, and no assertion over the modules alone would see it.
  const layout = fs.readFileSync(ACCOUNT_LAYOUT, 'utf8');

  assert.match(layout, /id="orders-section"/, 'the orders section exists');
  assert.match(layout, /id="orders-list"/, 'with the container the rows render into');
  assert.match(layout, /id="refund-subject"/, 'and the refund form carries its subject picker');

  const picker = layout.match(/<div[^>]*id="refund-subject-picker"[^>]*>/);

  assert.ok(picker, 'the picker wrapper is there');
  assert.match(picker[0], /class="[^"]*\bd-none\b/, 'and it ships hidden — a subscription-only account never sees it');

  // The nav rail is built from the frontmatter list, so a section with no entry
  // is a section nobody can click to.
  assert.match(layout, /- id: "orders"/, 'the section is in the page\'s own nav list');
});
