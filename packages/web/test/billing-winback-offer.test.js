/**
 * The billing card's WINBACK OFFER (`core/js/pages/dashboard/account/sections/
 * billing.js`) — a customer who starts cancelling a PAID subscription is
 * pitched a discount on the next cycle before they are asked why they are
 * leaving ([#268](https://github.com/Omega-JS-Stack/omega/issues/268)).
 *
 * The system already records winbacks after the fact (the `subscription-winback`
 * transition reads a returning subscriber as a purchase); nothing offered
 * anything at the moment the customer was still there to keep. This is that
 * offer, and it sits in the same dialog flow the trial-cancel warning built
 * (#267): the "Cancel subscription" trigger is intercepted in the capture phase,
 * its declarative collapse toggle is taken away, and a dialog opens instead.
 *
 * What this suite pins:
 *  - the offer comes BEFORE the questionnaire, and the questionnaire does not
 *    move while it is up;
 *  - accepting calls the apply route and ABORTS the cancel (the questionnaire
 *    never opens);
 *  - declining continues to the questionnaire, unchanged, and is not offered
 *    again;
 *  - a brand that disabled the offer never sees the step at all;
 *  - a TRIAL cancel is never offered a discount on a cycle it has not paid for
 *    — that path is #267's warning and is untouched.
 *
 * The harness is billing-cancel-trial-warning.test.js's, for the same reasons:
 * the REAL module through esbuild over a document that answers nothing, real
 * subscription resolution via @omega.js/account, and Bootstrap's collapse
 * data-api modelled faithfully because the gate exists to beat it.
 */
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');
const { resolveSubscription } = require('@omega.js/account');
const { resolveWinbackOffer } = require('@omega.js/config/winback');

const CORE_DIR = path.join(__dirname, '..', 'core');
const BILLING_ENTRY = path.join(CORE_DIR, 'js', 'pages', 'dashboard', 'account', 'sections', 'billing.js');

const BUNDLE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-billing-winback-'));
const BUNDLE = path.join(BUNDLE_DIR, 'billing.cjs');

let building = null;

function bundleOnce() {
  building ||= esbuild.build({
    entryPoints: [BILLING_ENTRY],
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
        build.onResolve({ filter: /^@omega\.js\/client\/modules\/form-manager\.js$/ }, () => {
          return { path: 'form-manager', namespace: 'omega-form-manager-stub' };
        });
        build.onLoad({ filter: /.*/, namespace: 'omega-form-manager-stub' }, () => {
          return { contents: 'export class FormManager {}' };
        });
      },
    }],
  });

  return building;
}

const PRODUCTS = [
  { id: 'basic', name: 'Basic', type: 'subscription', prices: {} },
  { id: 'premium', name: 'Premium', type: 'subscription', prices: { monthly: 10, annually: 100 } },
];

/**
 * The payment config the BUILD hands the browser: the brand's own section with
 * the save offer already resolved (`resolveWinbackOffer`), which is exactly
 * what src/engine.js bakes into the client blob. Resolving through the real
 * function here means the default this suite asserts against is the framework's
 * one home for it, never a number copied into a fixture.
 */
function paymentConfig(winback) {
  const payment = { currency: 'USD', products: PRODUCTS, ...(winback === undefined ? {} : { winback: winback }) };

  return { ...payment, winback: resolveWinbackOffer(payment) };
}

/** The offer as the discount the apply route records and hands back. */
function appliedDiscount(offer) {
  const isAmount = offer.amount > 0;

  return {
    valid: true,
    code: isAmount ? `WINBACK${offer.amount}OFF` : `WINBACK${offer.percent}`,
    ...(isAmount ? { amount: offer.amount } : { percent: offer.percent }),
    duration: offer.duration,
  };
}

const WEEK_FROM_NOW = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60);
const MONTH_FROM_NOW = Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60);

/**
 * A paying subscriber — the only state the offer is ever made to. The payment
 * block carries the PROCESSOR DETAILS a real checkout writes (`processor` and
 * `resourceId`), because the apply route needs them to reach the subscription
 * at all and the pitch is gated on them ([#311]).
 */
function paidAccount(subscription) {
  return {
    subscription: {
      product: { id: 'premium', name: 'Premium' },
      status: 'active',
      payment: { frequency: 'monthly', price: 10, processor: 'stripe', resourceId: 'sub_live_premium' },
      expires: { timestampUNIX: MONTH_FROM_NOW },
      ...subscription,
    },
  };
}

/** A live trial: #267's warning owns this path, and no discount is pitched. */
function trialingAccount() {
  return {
    subscription: {
      product: { id: 'premium', name: 'Premium' },
      status: 'active',
      payment: { frequency: 'monthly', price: 10, processor: 'stripe', resourceId: 'sub_live_premium' },
      expires: { timestampUNIX: WEEK_FROM_NOW },
      trial: { claimed: true, expires: { timestampUNIX: WEEK_FROM_NOW } },
    },
  };
}

/**
 * Drive the REAL init() over a document built from ids, and hand back the
 * wired controls, what Bootstrap was asked to open, and every request the page
 * made.
 *
 * `request` is the ONE seam: the apply route is a network call with no server
 * here. Everything else — the gate, the state, the dialog choreography — is the
 * real module.
 */
async function wireCancelFlow(account, { winback, requestFails, without = [] } = {}) {
  await bundleOnce();

  const opened = [];
  const requests = [];
  const notifications = [];
  const updates = [];
  const elements = new Map();
  const handlersFor = (id) => elements.get(id).handlers;

  const makeEl = (id, attributes = {}) => {
    const classes = new Set();

    return {
      id,
      handlers: [],
      attributes: { ...attributes },
      disabled: false,
      classList: {
        contains: (name) => classes.has(name),
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
        toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)),
      },
      addEventListener(type, handler, capture) { this.handlers.push({ type, handler, capture }); },
      setAttribute(k, v) { this.attributes[k] = String(v); },
      getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; },
      removeAttribute(k) { delete this.attributes[k]; },
      querySelector: () => null,
      dispatch(type) {
        for (const { type: t, handler } of this.handlers) {
          if (t === type) handler({ target: this });
        }
      },
    };
  };

  for (const id of [
    'cancel-trial-warning-modal',
    'cancel-trial-continue-btn',
    'cancel-trial-keep-btn',
    'cancel-winback-modal',
    'cancel-winback-accept-btn',
    'cancel-winback-decline-btn',
    'cancel-subscription-accordion',
  ]) {
    if (without.includes(id)) {
      continue;
    }

    elements.set(id, makeEl(id));
  }

  elements.set('cancel-subscription-trigger-btn', makeEl('cancel-subscription-trigger-btn', {
    'data-bs-toggle': 'collapse',
    'data-bs-target': '#cancel-subscription-accordion',
    'aria-expanded': 'false',
  }));

  const openCollapse = ($el) => {
    if ($el.classList.contains('show')) return;
    $el.classList.add('show');
    $el.dispatch('shown.bs.collapse');
  };
  const closeCollapse = ($el) => {
    if (!$el.classList.contains('show')) return;
    $el.classList.remove('show');
    $el.dispatch('hidden.bs.collapse');
  };

  // Bootstrap's collapse data-api: the document-level CAPTURE delegate that
  // re-reads `data-bs-toggle` on every click. Taking the attribute off is the
  // only thing that stops it, which is what the gate does.
  const collapseDataApi = (event) => {
    const $el = event.target;

    if ($el.getAttribute('data-bs-toggle') !== 'collapse') return;

    const $target = elements.get(($el.getAttribute('data-bs-target') || '').slice(1));

    if (!$target) return;

    if ($target.classList.contains('show')) closeCollapse($target);
    else openCollapse($target);
  };

  globalThis.document = {
    getElementById: (id) => elements.get(id) || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
  };
  globalThis.window = {
    location: { pathname: '/dashboard/account', search: '', hash: '#billing' },
    history: { replaceState: () => {} },
  };
  globalThis.bootstrap = {
    Modal: {
      getOrCreateInstance: (el) => ({ show: () => opened.push(`modal:${el.id}`), hide: () => opened.push(`modal-hide:${el.id}`) }),
      getInstance: (el) => ({ hide: () => opened.push(`modal-hide:${el.id}`) }),
    },
    Collapse: {
      getOrCreateInstance: (el) => ({
        show: () => { opened.push(`collapse:${el.id}`); openCollapse(el); },
        hide: () => { opened.push(`collapse-hide:${el.id}`); closeCollapse(el); },
      }),
      getInstance: () => null,
    },
  };
  globalThis.__omegaClient = {
    auth: () => ({ resolveSubscription: (a) => resolveSubscription(a) }),
    bindings: () => ({ update: (state) => updates.push(state) }),
    utilities: () => ({
      showNotification: (message, type) => notifications.push({ message, type }),
      escapeHTML: (v) => v,
    }),
    request: async (url, options) => {
      requests.push({ url, options });

      if (requestFails) {
        throw requestFails;
      }

      // What the apply route answers with: the offer as the discount it
      // applied, in the discount-codes validate shape the payment stack speaks
      // (`libraries/payment/winback.js` toDiscount). The card reads it back
      // onto the account so the saving shows the moment it is earned ([#325]).
      return { success: true, discount: appliedDiscount(paymentConfig(winback).winback) };
    },
  };

  globalThis.gtag = () => {};
  globalThis.fbq = () => {};
  globalThis.ttq = { track: () => {} };

  delete require.cache[require.resolve(BUNDLE)];
  const billing = require(BUNDLE);

  await billing.init();
  await billing.loadData(account, paymentConfig(winback));

  const clickTrigger = () => {
    const $trigger = elements.get('cancel-subscription-trigger-btn');
    const event = { target: $trigger, defaultPrevented: false, propagationStopped: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.propagationStopped = true; } };

    collapseDataApi(event);

    for (const { type, handler } of handlersFor('cancel-subscription-trigger-btn')) {
      if (type === 'click') handler(event);
    }

    return event;
  };

  // Click a button and settle whatever it kicked off — the accept button's
  // handler awaits the apply route.
  const clickById = async (id) => {
    for (const { type, handler } of handlersFor(id)) {
      if (type === 'click') await handler({ preventDefault() {}, stopPropagation() {} });
    }
  };

  const isAccordionOpen = () => elements.get('cancel-subscription-accordion').classList.contains('show');
  const attributesOf = (id) => elements.get(id).attributes;
  // The bindings the card renders through ARE its state — the same read
  // #267's suite makes, so the gate and the assertions can never diverge.
  const state = () => updates.at(-1);

  return { opened, requests, notifications, clickTrigger, clickById, handlersFor, isAccordionOpen, attributesOf, state };
}

test('#268: the offer is the first step, and the questionnaire does not move behind it', async () => {
  const { opened, clickTrigger, isAccordionOpen, attributesOf } = await wireCancelFlow(paidAccount());

  const event = clickTrigger();

  assert.strictEqual(event.propagationStopped, true, 'the declarative collapse never gets the click');
  assert.strictEqual(event.defaultPrevented, true, 'and the default action is cancelled');
  assert.deepStrictEqual(opened, ['modal:cancel-winback-modal'], 'the offer is what opened');
  assert.strictEqual(isAccordionOpen(), false, 'and the questionnaire never moved');
  assert.strictEqual(attributesOf('cancel-subscription-trigger-btn')['data-bs-toggle'], undefined, 'a gated trigger is not a Bootstrap toggle at all');
});

test('#268: the gate is registered in the CAPTURE phase', async () => {
  // Bootstrap delegates from `document`, so a bubble-phase listener would fire
  // too late to stop it. Same detail #267's gate depends on.
  const { handlersFor } = await wireCancelFlow(paidAccount());
  const clicks = handlersFor('cancel-subscription-trigger-btn').filter((h) => h.type === 'click');

  assert.ok(clicks.length > 0, 'the trigger is gated at all');
  assert.ok(clicks.every((h) => h.capture === true), 'every gate on the trigger listens in the capture phase');
});

test('#268: accepting applies the discount and ABORTS the cancel', async () => {
  const { opened, requests, notifications, clickTrigger, clickById, isAccordionOpen } = await wireCancelFlow(paidAccount());

  clickTrigger();
  await clickById('cancel-winback-accept-btn');

  assert.deepStrictEqual(
    requests.map((r) => r.url),
    ['/omega/payments/winback'],
    'accepting is one call to the apply route',
  );
  assert.strictEqual(requests[0].options.method, 'POST');
  assert.strictEqual(requests[0].options.body.confirmed, true, 'the route requires explicit confirmation');

  assert.ok(opened.includes('modal-hide:cancel-winback-modal'), 'the dialog closes behind the answer');
  assert.strictEqual(isAccordionOpen(), false, 'and the questionnaire never opens — the cancel is off');
  assert.ok(!opened.some((entry) => entry.startsWith('collapse:')), 'nothing asked the questionnaire to open');
  assert.strictEqual(notifications.length, 1, 'the customer is told the discount landed');
});

test('#268: an accepted offer is not pitched a second time', async () => {
  // The discount is applied to a live subscription; re-opening the flow must
  // not offer another one, and the backend refuses a second claim anyway.
  const { opened, clickTrigger, clickById, isAccordionOpen, attributesOf } = await wireCancelFlow(paidAccount());

  clickTrigger();
  await clickById('cancel-winback-accept-btn');

  assert.strictEqual(attributesOf('cancel-subscription-trigger-btn')['data-bs-toggle'], 'collapse', 'the trigger is a plain Bootstrap toggle again');

  clickTrigger();

  assert.strictEqual(
    opened.filter((entry) => entry === 'modal:cancel-winback-modal').length,
    1,
    'the offer opened exactly once',
  );
  assert.strictEqual(isAccordionOpen(), true, 'and the next cancel click goes straight to the questionnaire');
});

test('#268: declining continues to the questionnaire, unchanged', async () => {
  const { opened, requests, clickTrigger, clickById, isAccordionOpen } = await wireCancelFlow(paidAccount());

  clickTrigger();
  await clickById('cancel-winback-decline-btn');

  assert.deepStrictEqual(requests, [], 'declining calls no route at all');
  assert.ok(opened.includes('modal-hide:cancel-winback-modal'), 'the offer closes');
  assert.ok(opened.includes('collapse:cancel-subscription-accordion'), 'and the questionnaire opens behind it');
  assert.strictEqual(isAccordionOpen(), true, 'the cancel flow carries on exactly as before');
});

test('#324: a fresh cancel attempt after a decline is pitched again', async () => {
  // Ian's QA: decline the offer, close the questionnaire, click cancel again —
  // and nothing was pitched. A decline is an answer to THIS attempt, not a
  // one-shot switch for the session: the subscription is still live, the offer
  // is still unclaimed, so the next attempt to cancel meets it again.
  const { opened, clickTrigger, clickById, isAccordionOpen } = await wireCancelFlow(paidAccount());

  clickTrigger();
  await clickById('cancel-winback-decline-btn');

  assert.strictEqual(isAccordionOpen(), true, 'declining carries on to the questionnaire');

  // Half of a toggle is closing — this click ends the attempt.
  clickTrigger();

  assert.strictEqual(isAccordionOpen(), false, 'the questionnaire is shut again');

  // A NEW cancel attempt, on an eligible and unclaimed subscription.
  clickTrigger();

  assert.strictEqual(
    opened.filter((entry) => entry === 'modal:cancel-winback-modal').length,
    2,
    'the offer is re-pitched',
  );
  assert.strictEqual(isAccordionOpen(), false, 'and the questionnaire waits behind it, exactly as the first time');
});

test('#324: every step of the reopened flow leaves a way forward', async () => {
  // The whole point of the rewire: no click may leave the customer with neither
  // the dialog nor the questionnaire. The second pitch answers the same two
  // ways the first one does, so both are walked end to end.
  const declined = await wireCancelFlow(paidAccount());

  declined.clickTrigger();
  await declined.clickById('cancel-winback-decline-btn');
  declined.clickTrigger();
  declined.clickTrigger();
  await declined.clickById('cancel-winback-decline-btn');

  assert.strictEqual(declined.isAccordionOpen(), true, 'declining the second pitch opens the questionnaire again');

  const accepted = await wireCancelFlow(paidAccount());

  accepted.clickTrigger();
  await accepted.clickById('cancel-winback-decline-btn');
  accepted.clickTrigger();
  accepted.clickTrigger();
  await accepted.clickById('cancel-winback-accept-btn');

  assert.strictEqual(accepted.isAccordionOpen(), false, 'accepting the second pitch calls the cancel off');
  assert.deepStrictEqual(accepted.requests.map((r) => r.url), ['/omega/payments/winback'], 'and applies the discount once');

  accepted.clickTrigger();

  assert.strictEqual(
    accepted.opened.filter((entry) => entry === 'modal:cancel-winback-modal').length,
    2,
    'a CLAIMED offer is never pitched again',
  );
  assert.strictEqual(accepted.isAccordionOpen(), true, 'and the cancel goes straight to the questionnaire');
});

test('#324: a refusal the account cannot answer stays refused across attempts', async () => {
  // `winbackSupported` is the other end of the state: the backend has said this
  // account can never take the offer, so a fresh attempt is not a fresh chance.
  const refusal = Object.assign(new Error('You have already claimed this offer'), {
    properties: { additional: { code: 'offer-already-claimed' } },
  });
  const { opened, clickTrigger, clickById, isAccordionOpen } = await wireCancelFlow(paidAccount(), { requestFails: refusal });

  clickTrigger();
  await clickById('cancel-winback-accept-btn');

  assert.strictEqual(isAccordionOpen(), true, 'the refusal opens the questionnaire');

  clickTrigger();
  clickTrigger();

  assert.strictEqual(
    opened.filter((entry) => entry === 'modal:cancel-winback-modal').length,
    1,
    'and no later attempt pitches it again',
  );
  assert.strictEqual(isAccordionOpen(), true, 'every later attempt goes straight to the questionnaire');
});

test('#324: a page missing a dialog falls back to the questionnaire, never to a dead button', async () => {
  // The gate works by taking the trigger's declarative toggle away, so the
  // dialog it opens instead had better exist. A layout that dropped one (a
  // consumer override, a trimmed template) must still be able to cancel.
  const { opened, clickTrigger, isAccordionOpen, attributesOf } = await wireCancelFlow(paidAccount(), { without: ['cancel-winback-modal'] });

  const event = clickTrigger();

  assert.deepStrictEqual(opened, [], 'no dialog opened — there is none to open');
  assert.strictEqual(event.propagationStopped, false, 'so the declarative collapse keeps the click');
  assert.strictEqual(attributesOf('cancel-subscription-trigger-btn')['data-bs-toggle'], 'collapse', 'the trigger stays a Bootstrap toggle');
  assert.strictEqual(isAccordionOpen(), true, 'and the questionnaire opens on the first click');
});

test('#268: a brand that disabled the offer never sees the step', async () => {
  const { opened, clickTrigger, isAccordionOpen, attributesOf } = await wireCancelFlow(paidAccount(), { winback: { enabled: false } });

  const event = clickTrigger();

  assert.deepStrictEqual(opened, [], 'no dialog opened');
  assert.strictEqual(event.propagationStopped, false, 'the declarative collapse handles the click, exactly as before');
  assert.strictEqual(attributesOf('cancel-subscription-trigger-btn')['data-bs-toggle'], 'collapse', 'the trigger keeps its Bootstrap toggle');
  assert.strictEqual(isAccordionOpen(), true, 'and Bootstrap opened the questionnaire on its own');
});

test('#268: a trial cancel is warned, never offered a discount', async () => {
  // A trial has paid for nothing, and #267's warning owns that click. Pitching
  // "off your next month" to someone whose access ends today is the wrong
  // sentence, so the two gates are mutually exclusive by state.
  const { opened, clickTrigger, state } = await wireCancelFlow(trialingAccount());

  clickTrigger();

  assert.deepStrictEqual(opened, ['modal:cancel-trial-warning-modal'], 'the trial warning is what opened');
  assert.strictEqual(state().billing.winbackOffer.show, false, 'the offer is not on the table for a trial');
  assert.strictEqual(state().billing.cancelWarning.show, true, 'and #267 is untouched');
});

test('#268: the offer names the brand\'s own number and the cycle it applies to', async () => {
  // The headline IS the dialog now (#323): short, forward, the whole pitch in
  // one line — and every number in it the brand's own.
  const fifty = await wireCancelFlow(paidAccount());
  assert.strictEqual(fifty.state().billing.winbackOffer.headline, 'Take 50% off your next month', 'the framework default is 50% off the next cycle');

  const quarter = await wireCancelFlow(paidAccount(), { winback: { percent: 25 } });
  assert.strictEqual(quarter.state().billing.winbackOffer.headline, 'Take 25% off your next month');

  const annual = await wireCancelFlow(paidAccount({ payment: { frequency: 'annually', price: 100, processor: 'stripe', resourceId: 'sub_live_premium' } }));
  assert.strictEqual(annual.state().billing.winbackOffer.headline, 'Take 50% off your next year', 'the cycle word follows the subscription, not the copy');

  const amount = await wireCancelFlow(paidAccount(), { winback: { amount: 10 } });
  assert.strictEqual(amount.state().billing.winbackOffer.headline, 'Take $10.00 off your next month', 'an amount offer reads in the brand currency');

  const forever = await wireCancelFlow(paidAccount(), { winback: { duration: 'forever' } });
  assert.strictEqual(forever.state().billing.winbackOffer.headline, 'Take 50% off for as long as you stay', 'a permanent cut does not promise one cycle');
});

test('#325: accepting the offer puts the discount on the card', async () => {
  // Ian's QA: the discount applied server-side and the dashboard showed
  // nothing. The route answers with the discount it applied, so the card can
  // say what was just earned without waiting for a webhook to land.
  const account = paidAccount();
  const { clickTrigger, clickById, state } = await wireCancelFlow(account);

  assert.strictEqual(state().billing.discount.show, false, 'nothing is applied before the offer is taken');

  clickTrigger();
  await clickById('cancel-winback-accept-btn');

  assert.deepStrictEqual(
    state().billing.discount,
    { show: true, label: '50% off', when: 'Applied to your next month' },
    'the saving is on the card, in words',
  );

  // The in-session patch carries the same source the backend persisted, so the
  // gate reads one truth whether the discount arrived by patch or by reload.
  assert.strictEqual(account.subscription.discount.source, 'winback', 'the patched discount is stamped as the claim');
});

test('#325: a declined offer leaves the card with no discount to announce', async () => {
  const { clickTrigger, clickById, state } = await wireCancelFlow(paidAccount());

  clickTrigger();
  await clickById('cancel-winback-decline-btn');

  assert.strictEqual(state().billing.discount.show, false, 'nothing was applied, so nothing is claimed on screen');
});

test('#325: a persisted winback claim suppresses the pitch, a checkout code does not', async () => {
  // The backend stamps the discount it applies with `source: 'winback'`
  // (payments/winback/post.js), so a claimant who reloads is never re-pitched a
  // discount they already hold. The SOURCE is the signal, not the node itself:
  // a checkout code rides the same `subscription.discount` shape, and holding
  // one must never cost a customer the save offer.
  const claimed = await wireCancelFlow(paidAccount({
    discount: { valid: true, code: 'WINBACK50', percent: 50, duration: 'once', source: 'winback' },
  }));

  assert.strictEqual(claimed.state().billing.winbackOffer.show, false, 'a persisted claim never re-pitches');
  assert.strictEqual(claimed.state().billing.discount.show, true, 'the discount it earned still shows on the card');

  claimed.clickTrigger();
  assert.strictEqual(claimed.isAccordionOpen(), true, 'and the cancel proceeds straight to the questionnaire');

  const checkout = await wireCancelFlow(paidAccount({
    discount: { valid: true, code: 'WELCOME15', percent: 15, duration: 'once', source: 'checkout' },
  }));

  assert.strictEqual(checkout.state().billing.winbackOffer.show, true, 'a checkout code leaves the offer open');
});

test('#311: a subscription with no processor payment details is never pitched the offer', async () => {
  // Paid, active, and unreachable: an admin-granted plan or an imported record
  // carries no `payment.processor` / `payment.resourceId`, so the apply route
  // has nothing to send a discount to and can only refuse. Pitching it anyway
  // put the customer in a dialog whose only button 400s, so the gate reads the
  // fields the accept path needs — and the cancel they came for is one click.
  const cases = [
    { what: 'no processor details at all', payment: { frequency: 'monthly', price: 10 } },
    { what: 'a processor but no resource', payment: { frequency: 'monthly', price: 10, processor: 'stripe' } },
    { what: 'a resource but no processor', payment: { frequency: 'monthly', price: 10, resourceId: 'sub_live_premium' } },
  ];

  for (const { what, payment } of cases) {
    const { opened, requests, clickTrigger, isAccordionOpen, attributesOf, state } = await wireCancelFlow(paidAccount({ payment: payment }));

    assert.strictEqual(state().billing.buttons.cancel, true, `${what}: the subscription can still be cancelled`);
    assert.strictEqual(state().billing.winbackOffer.show, false, `${what}: but no offer stands in front of it`);

    const event = clickTrigger();

    assert.deepStrictEqual(opened, [], `${what}: no dialog opened`);
    assert.strictEqual(event.propagationStopped, false, `${what}: the declarative collapse handles the click`);
    assert.strictEqual(attributesOf('cancel-subscription-trigger-btn')['data-bs-toggle'], 'collapse', `${what}: the trigger keeps its Bootstrap toggle`);
    assert.strictEqual(isAccordionOpen(), true, `${what}: and the questionnaire opens on the first click`);
    assert.deepStrictEqual(requests, [], `${what}: nothing called the apply route`);
  }
});

test('#268: a refusal the account cannot answer retires the offer and lets the cancel through', async () => {
  // The same capability gate uncancel and plan-switch ride: the BACKEND answers
  // whether this account can take the offer at all, and a refusal must never
  // leave the customer stuck in a dialog with no way to cancel. Every dead-end
  // code is one branch, so each is proven through it — including the one a
  // PAST CLAIMANT hits when their account predates the persisted claim node
  // ([#325]): with nothing on the account, the client re-pitches and the order
  // doc's refusal is the catch ([#310]).
  //
  // The route now names EVERY refusal ([#311]), and all but the unconfirmed
  // request are dead ends for this account — the brand turned the offer off,
  // the subscription is not the state the offer is for, or it carries no
  // processor to discount through. None of them change on a retry.
  const deadEnds = [
    { code: 'not-supported-by-processor', message: 'Your payment provider cannot apply this offer.' },
    { code: 'offer-not-claimable', message: 'This offer is not available on your subscription.' },
    { code: 'offer-already-claimed', message: 'You have already claimed this offer' },
    { code: 'offer-disabled', message: 'This offer is not available' },
    { code: 'no-active-subscription', message: 'No active paid subscription found' },
    { code: 'trial-not-eligible', message: 'This offer is not available on a free trial' },
    { code: 'cancellation-pending', message: 'Your subscription is already scheduled to cancel' },
    { code: 'missing-payment-details', message: 'Subscription payment details not found' },
    { code: 'unknown-processor', message: 'Unknown processor: not-a-processor' },
  ];

  for (const { code, message } of deadEnds) {
    const refusal = Object.assign(new Error(message), { properties: { additional: { code: code } } });
    const { opened, notifications, clickTrigger, clickById, isAccordionOpen, state } = await wireCancelFlow(paidAccount(), { requestFails: refusal });

    clickTrigger();
    await clickById('cancel-winback-accept-btn');

    assert.strictEqual(state().billing.winbackOffer.show, false, `${code}: the offer is retired for the session`);
    assert.ok(opened.includes('modal-hide:cancel-winback-modal'), `${code}: the dialog closes`);
    assert.strictEqual(isAccordionOpen(), true, `${code}: and the questionnaire opens, so the cancel can still be made`);
    assert.strictEqual(notifications.at(-1).message, refusal.message, `${code}: the backend's own refusal is what the customer reads`);
  }
});

test('#268: a failed apply leaves the offer on screen to try again', async () => {
  const outage = new Error('We could not apply your discount right now. Please try again shortly.');
  const { opened, notifications, clickTrigger, clickById, isAccordionOpen } = await wireCancelFlow(paidAccount(), { requestFails: outage });

  clickTrigger();
  await clickById('cancel-winback-accept-btn');

  assert.ok(!opened.includes('modal-hide:cancel-winback-modal'), 'the dialog stays up');
  assert.strictEqual(isAccordionOpen(), false, 'and a failure is never read as a decline');
  assert.strictEqual(notifications.at(-1).message, outage.message);
});

test('#311: a refusal a retry CAN fix keeps the offer armed', async () => {
  // Being coded is not being a dead end. `confirmation-required` says the
  // request went out without its confirmation — the same button sending it
  // again is exactly the fix — so it must never retire the offer the way an
  // account-state refusal does.
  const unconfirmed = Object.assign(new Error('Accepting the offer must be confirmed'), {
    properties: { additional: { code: 'confirmation-required' } },
  });
  const { opened, clickTrigger, clickById, isAccordionOpen, state } = await wireCancelFlow(paidAccount(), { requestFails: unconfirmed });

  clickTrigger();
  await clickById('cancel-winback-accept-btn');

  assert.ok(!opened.includes('modal-hide:cancel-winback-modal'), 'the dialog stays up');
  assert.strictEqual(state().billing.winbackOffer.show, true, 'and the offer is still on the table');
  assert.strictEqual(isAccordionOpen(), false, 'a fixable failure is never read as a decline');
});

test('#268: a state that cannot cancel is never offered anything', async () => {
  const cases = [
    { what: 'a free account', account: { subscription: { status: 'active', product: { id: 'basic', name: 'Basic' } } } },
    { what: 'an already-ended subscription', account: paidAccount({ status: 'cancelled', cancellation: { pending: false } }) },
    { what: 'a subscription already scheduled to end', account: paidAccount({ cancellation: { pending: true, date: { timestampUNIX: MONTH_FROM_NOW } } }) },
  ];

  for (const { what, account } of cases) {
    const { state } = await wireCancelFlow(account);

    assert.strictEqual(state().billing.buttons.cancel, false, `${what}: offers no cancel button`);
    assert.strictEqual(state().billing.winbackOffer.show, false, `${what}: and no offer in front of it`);
  }
});

test('#268: the built account page carries the dialog the gate opens', async () => {
  // The gate stops the questionnaire and opens `#cancel-winback-modal` by id.
  // If the markup ever loses it, a paid cancel becomes a dead button.
  for (const name of ['window', 'document', 'bootstrap', 'gtag', 'fbq', 'ttq', '__omegaClient']) {
    delete globalThis[name];
  }

  const { buildWith, miniData } = require('./lib/build.js');
  const pages = await buildWith(miniData, {}, 'billing-winback-test');
  const page = pages.get('/dashboard/account');
  assert.ok(page, 'account page built');

  for (const id of ['cancel-winback-modal', 'cancel-winback-accept-btn', 'cancel-winback-decline-btn']) {
    assert.ok(page.includes(`id="${id}"`), `the JS hook survives the markup: ${id}`);
  }

  // The offer's number is the brand's, so the dialog renders it from state
  // rather than spelling one out in the template.
  const modalAt = page.indexOf('id="cancel-winback-modal"');
  const modal = page.slice(modalAt, page.indexOf('id="cancel-trial-warning-modal"'));
  assert.ok(modal.length > 0, 'the offer dialog sits before the trial warning');
  assert.ok(
    modal.includes('data-omega-bind="@text billing.winbackOffer.headline"'),
    'the offer copy is bound from the same state the gate reads',
  );
  assert.ok(!/\d+% off/.test(modal), 'no discount number is hardcoded in the markup');
});

test('#268: the build resolves the offer into the client config', async () => {
  // The 50% default has ONE home (@omega.js/config). The browser must never
  // apply it itself, so the build bakes the resolved offer into the client blob
  // — a brand that configured nothing still ships an explicit answer.
  for (const name of ['window', 'document', 'bootstrap', 'gtag', 'fbq', 'ttq', '__omegaClient']) {
    delete globalThis[name];
  }

  const { buildWith, miniData } = require('./lib/build.js');
  const pages = await buildWith(
    { ...miniData, payment: { currency: 'USD', products: PRODUCTS } },
    {},
    'billing-winback-config-test',
  );
  const page = pages.get('/dashboard/account');
  assert.ok(page, 'account page built');

  // The client blob foot.html emits: `"payment": { … }`, spread from site.client.
  const paymentAt = page.indexOf('"payment":');
  assert.ok(paymentAt > 0, 'the client blob carries the payment section at all');

  const emitted = page.slice(paymentAt, paymentAt + 4000);
  assert.match(emitted, /"winback":\{[^}]*"enabled":true/, 'the client blob carries the resolved offer');
  assert.match(emitted, /"percent":50/, 'with the framework default baked in');
});
