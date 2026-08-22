/**
 * The cancel flow's THIRD dialog: the data-retention warning
 * ([#341](https://github.com/Omega-JS-Stack/omega/issues/341)).
 *
 * Ian's QA (2026-08-17): the flow shows the save offer to a paid cancel (#268)
 * and the trial warning to a trial (#267), and a cancel that is neither walked
 * straight into the questionnaire with nothing said at all. A subscription an
 * offer cannot reach, a brand that turned the offer off, a customer who already
 * claimed it, and every one of them is a real cancel meeting silence. The fallback
 * dialog is the word that flow owed them: the account's data, settings and
 * progress MAY be removed after cancelling.
 *
 * What this suite pins is the ORDERING, because three gates now read the same
 * click: the save offer first, the trial warning next, the retention warning
 * only when neither of them will show. Exactly one dialog opens per cancel
 * click, never two.
 *
 * The harness is #267's and #268's, for the same reasons: the REAL module
 * through esbuild over a document that answers nothing, real subscription
 * resolution via @omega.js/account, and Bootstrap's collapse data-api modelled
 * faithfully because the gates exist to beat it. The document here carries ALL
 * THREE dialogs, because this is the ordering suite and it reads the whole page.
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

const BUNDLE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-billing-retention-'));
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

/** The payment config the BUILD hands the browser, offer already resolved. */
function paymentConfig(winback) {
  const payment = { currency: 'USD', products: PRODUCTS, ...(winback === undefined ? {} : { winback: winback }) };

  return { ...payment, winback: resolveWinbackOffer(payment) };
}

const WEEK_FROM_NOW = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60);
const MONTH_FROM_NOW = Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60);

/** A paying subscriber the save offer can reach: the offer owns this click. */
function paidAccount(subscription) {
  return {
    subscription: {
      product: { id: 'premium', name: 'Premium' },
      status: 'active',
      payment: { frequency: 'monthly', price: 10, provider: 'stripe', resourceId: 'sub_live_premium' },
      expires: { timestampUNIX: MONTH_FROM_NOW },
      ...subscription,
    },
  };
}

/** A live trial: #267's warning owns this click. */
function trialingAccount() {
  return {
    subscription: {
      product: { id: 'premium', name: 'Premium' },
      status: 'active',
      payment: { frequency: 'monthly', price: 10, provider: 'stripe', resourceId: 'sub_live_premium' },
      expires: { timestampUNIX: WEEK_FROM_NOW },
      trial: { claimed: true, expires: { timestampUNIX: WEEK_FROM_NOW } },
    },
  };
}

/**
 * A paid cancel the save offer cannot be made to: no provider details for the
 * apply route to reach ([#311]). Paid, active, cancellable, and the state the
 * flow used to say nothing at all to.
 */
function unreachableAccount() {
  return paidAccount({ payment: { frequency: 'monthly', price: 10 } });
}

/**
 * Drive the REAL init() over a document carrying all three dialogs, and hand
 * back the wired controls, what Bootstrap was asked to open, and the state the
 * bindings render.
 */
async function wireCancelFlow(account, { winback, without = [] } = {}) {
  await bundleOnce();

  const opened = [];
  const requests = [];
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
    'cancel-retention-modal',
    'cancel-retention-continue-btn',
    'cancel-retention-keep-btn',
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
  // only thing that stops it, which is what every gate here does.
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
    utilities: () => ({ showNotification: () => {}, escapeHTML: (v) => v }),
    request: async (url, options) => {
      requests.push({ url, options });

      return { success: true };
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

  const clickById = async (id) => {
    for (const { type, handler } of handlersFor(id)) {
      if (type === 'click') await handler({ preventDefault() {}, stopPropagation() {} });
    }
  };

  const isAccordionOpen = () => elements.get('cancel-subscription-accordion').classList.contains('show');
  const attributesOf = (id) => elements.get(id).attributes;
  const state = () => updates.at(-1);

  return { opened, requests, clickTrigger, clickById, isAccordionOpen, attributesOf, state };
}

// Which of the three dialogs the state says is owed. The gates are mutually
// exclusive by construction, so this reads as a list and every assertion below
// spells out the WHOLE list, because a second entry is the stacking bug.
function dialogsOwed(state) {
  const billing = state.billing;

  return [
    ...(billing.winbackOffer.show ? ['winback'] : []),
    ...(billing.cancelWarning.show ? ['trial'] : []),
    ...(billing.cancelRetention.show ? ['retention'] : []),
  ];
}

test('#341: a paid cancel with a save offer is pitched the offer, and only the offer', async () => {
  const { opened, clickTrigger, state } = await wireCancelFlow(paidAccount());

  clickTrigger();

  assert.deepStrictEqual(dialogsOwed(state()), ['winback'], 'the offer outranks both warnings');
  assert.deepStrictEqual(opened, ['modal:cancel-winback-modal'], 'and it is the one dialog that opened');
});

test('#341: a trial cancel is warned about the trial, and only about the trial', async () => {
  const { opened, clickTrigger, state } = await wireCancelFlow(trialingAccount());

  clickTrigger();

  assert.deepStrictEqual(dialogsOwed(state()), ['trial'], 'the trial warning outranks the retention warning');
  assert.deepStrictEqual(opened, ['modal:cancel-trial-warning-modal'], 'and it is the one dialog that opened');
});

test('#341: a cancel neither of them speaks to gets the retention warning', async () => {
  // The two states that used to walk into the questionnaire in silence: a brand
  // that turned the offer off, and a subscription the apply route cannot reach.
  const disabled = await wireCancelFlow(paidAccount(), { winback: { enabled: false } });

  const event = disabled.clickTrigger();

  assert.deepStrictEqual(dialogsOwed(disabled.state()), ['retention'], 'the fallback is what is owed');
  assert.deepStrictEqual(disabled.opened, ['modal:cancel-retention-modal'], 'and it is the one dialog that opened');
  assert.strictEqual(event.propagationStopped, true, 'the declarative collapse never gets the click');
  assert.strictEqual(event.defaultPrevented, true, 'and the default action is cancelled');
  assert.strictEqual(disabled.isAccordionOpen(), false, 'the questionnaire waits behind it');
  assert.strictEqual(disabled.attributesOf('cancel-subscription-trigger-btn')['data-bs-toggle'], undefined, 'a gated trigger is not a Bootstrap toggle at all');

  const unreachable = await wireCancelFlow(unreachableAccount());

  unreachable.clickTrigger();

  assert.deepStrictEqual(dialogsOwed(unreachable.state()), ['retention'], 'an unreachable subscription is owed it too');
  assert.deepStrictEqual(unreachable.opened, ['modal:cancel-retention-modal'], 'and gets exactly the one dialog');
});

test('#341: "Cancel anyway" carries on to the questionnaire', async () => {
  const { opened, clickTrigger, clickById, isAccordionOpen } = await wireCancelFlow(paidAccount(), { winback: { enabled: false } });

  clickTrigger();
  await clickById('cancel-retention-continue-btn');

  assert.ok(opened.includes('modal-hide:cancel-retention-modal'), 'the warning closes behind the answer');
  assert.ok(opened.includes('collapse:cancel-subscription-accordion'), 'and the questionnaire opens');
  assert.strictEqual(isAccordionOpen(), true, 'the cancel flow carries on exactly as it did before the dialog existed');
});

test('#341: an open questionnaire closes on the next click, with no second warning', async () => {
  // The half of a toggle every gate here owes ([#267], [#268]): the gate holds
  // the trigger's clicks for good, so with the questionnaire already open the
  // next click must simply SHUT it. A gate that never asks whether the thing it
  // guards is open re-opens its dialog on the way down instead.
  const { opened, clickTrigger, clickById, isAccordionOpen } = await wireCancelFlow(paidAccount(), { winback: { enabled: false } });

  clickTrigger();
  await clickById('cancel-retention-continue-btn');

  assert.strictEqual(isAccordionOpen(), true, 'carrying on opened the questionnaire');

  clickTrigger();

  assert.strictEqual(isAccordionOpen(), false, 'the next click closes it');
  assert.strictEqual(
    opened.filter((entry) => entry === 'modal:cancel-retention-modal').length,
    1,
    'closing never re-opens the warning',
  );
});

test('#341: "Keep my account" cancels nothing', async () => {
  const { opened, requests, clickTrigger, clickById, isAccordionOpen } = await wireCancelFlow(paidAccount(), { winback: { enabled: false } });

  clickTrigger();
  await clickById('cancel-retention-keep-btn');

  assert.deepStrictEqual(requests, [], 'keeping the account calls no route at all');
  assert.ok(!opened.some((entry) => entry.startsWith('collapse:')), 'nothing asked the questionnaire to open');
  assert.strictEqual(isAccordionOpen(), false, 'the questionnaire never opened');
});

test('#341: a page missing the fallback dialog falls back to the questionnaire, never to a dead button', async () => {
  // Same guard the other two carry ([#324]): the gate works by taking the
  // trigger's declarative toggle away, so a layout that dropped this dialog (a
  // consumer override, a trimmed template) must still be able to cancel.
  const { opened, clickTrigger, isAccordionOpen, attributesOf } = await wireCancelFlow(paidAccount(), {
    winback: { enabled: false },
    without: ['cancel-retention-modal'],
  });

  const event = clickTrigger();

  assert.deepStrictEqual(opened, [], 'no dialog opened, there is none to open');
  assert.strictEqual(event.propagationStopped, false, 'so the declarative collapse keeps the click');
  assert.strictEqual(attributesOf('cancel-subscription-trigger-btn')['data-bs-toggle'], 'collapse', 'the trigger stays a Bootstrap toggle');
  assert.strictEqual(isAccordionOpen(), true, 'and the questionnaire opens on the first click');
});

test('#341: a state that cannot cancel is never warned about anything', async () => {
  const free = await wireCancelFlow({ subscription: { product: { id: 'basic' }, status: 'active' } });

  assert.deepStrictEqual(dialogsOwed(free.state()), [], 'a free account has no cancel to warn about');

  const cancelling = await wireCancelFlow(paidAccount({ cancellation: { pending: true, date: { timestampUNIX: MONTH_FROM_NOW } } }));

  assert.deepStrictEqual(dialogsOwed(cancelling.state()), [], 'and neither has one already scheduled to end');
});
