/**
 * The billing card's TRIAL-CANCEL WARNING (`core/js/pages/dashboard/account/
 * sections/billing.js`) — cancelling a free trial ends access IMMEDIATELY
 * (Ian's ruling, 2026-08-15: we do not keep serving a trial we know will not
 * convert), so the customer is told that BEFORE the questionnaire, not after
 * the fact ([#267](https://github.com/Omega-JS-Stack/omega/issues/267)).
 *
 * The flow used to open the cancellation questionnaire straight from the
 * "Cancel subscription" link, with the consequence spelled out nowhere: the
 * accordion's own copy promises "your subscription will remain active until the
 * end of your current billing period", which is the PAID story and the exact
 * opposite of what a trial cancel does.
 *
 * Two things have to hold, and this suite pins both:
 *  - a TRIALING subscription is gated: `billing.cancelWarning.show` is what the
 *    page reads to know a warning is owed before the questionnaire;
 *  - a PAID subscription is not gated at all — its behavior is unchanged.
 *
 * The module is browser code behind two bundler aliases, so the harness drives
 * the REAL file through esbuild over a document that answers nothing — the
 * convention billing-actions.test.js sets. Subscription resolution is NOT
 * stubbed: the stub client delegates to @omega.js/account, the same resolver the
 * real client calls, so "trialing" here means what it means in production.
 */
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');
const { resolveSubscription } = require('@omega.js/account');

const CORE_DIR = path.join(__dirname, '..', 'core');
const BILLING_ENTRY = path.join(CORE_DIR, 'js', 'pages', 'dashboard', 'account', 'sections', 'billing.js');

const BUNDLE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-billing-trial-warning-'));
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
        // Same reason billing-actions.test.js keeps it a name: the published
        // FormManager build's `module.exports =` tail clobbers the harness
        // bundle's own exports, and init() never runs here anyway.
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

const PAYMENT_CONFIG = {
  currency: 'USD',
  products: [
    { id: 'basic', name: 'Basic', type: 'subscription', prices: {} },
    { id: 'premium', name: 'Premium', type: 'subscription', prices: { monthly: 10, annually: 100 } },
  ],
};

const WEEK_FROM_NOW = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60);
const MONTH_FROM_NOW = Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60);

/** A live trial: the subscription runs exactly as far as the trial does. */
function trialingAccount(subscription) {
  return {
    subscription: {
      product: { id: 'premium', name: 'Premium' },
      status: 'active',
      payment: { frequency: 'monthly', price: 10, provider: 'stripe' },
      expires: { timestampUNIX: WEEK_FROM_NOW },
      trial: { claimed: true, expires: { timestampUNIX: WEEK_FROM_NOW } },
      ...subscription,
    },
  };
}

/** A paid subscription — the half of the ruling that must not change. */
function paidAccount(subscription) {
  return {
    subscription: {
      product: { id: 'premium', name: 'Premium' },
      status: 'active',
      payment: { frequency: 'monthly', price: 10, provider: 'stripe' },
      expires: { timestampUNIX: MONTH_FROM_NOW },
      ...subscription,
    },
  };
}

async function billingStateFor(account) {
  await bundleOnce();

  const updates = [];

  globalThis.document = {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
  };
  globalThis.window = {
    location: { pathname: '/dashboard/account', search: '', hash: '#billing' },
    history: { replaceState: () => {} },
  };
  globalThis.__omegaClient = {
    auth: () => ({ resolveSubscription: (a) => resolveSubscription(a) }),
    bindings: () => ({ update: (state) => updates.push(state) }),
    utilities: () => ({
      showNotification: () => {},
      escapeHTML: (value) => value,
    }),
    request: async () => ({}),
  };

  // require.resolve, not BUNDLE: the cache is keyed by the REAL path, and
  // macOS's tmpdir is a symlink (/var → /private/var).
  delete require.cache[require.resolve(BUNDLE)];
  const billing = require(BUNDLE);

  await billing.loadData(account, PAYMENT_CONFIG);

  return updates.at(-1).billing;
}

/**
 * Drive the REAL init() over a document built from ids, and hand back the wired
 * controls plus what Bootstrap was asked to open.
 *
 * Bootstrap is a browser global with nothing to run against in node, so it is
 * the one stub here — and the assertions are about OUR gate (was the click
 * stopped, and what opened), never about Bootstrap's own behavior.
 *
 * The ONE piece of Bootstrap the gate has to survive is modelled faithfully,
 * because the gate exists to beat it: the collapse data-api
 * (`themes/bootstrap/js/src/collapse.js:280`) is a delegate registered on
 * `document`, and `EventHandler` passes `isDelegated` straight through as
 * `useCapture` (`themes/bootstrap/js/src/dom/event-handler.js:184`) — so it
 * runs in the CAPTURE phase, descending `document` → button, AHEAD of every
 * listener on the button itself.
 */
async function wireCancelFlow(account, { analyticsBlocked = false } = {}) {
  await bundleOnce();

  const opened = [];
  const elements = new Map();
  const handlersFor = (id) => elements.get(id).handlers;

  const makeEl = (id, attributes = {}) => {
    const classes = new Set();

    return {
      id,
      handlers: [],
      attributes: { ...attributes },
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
      // Bootstrap's lifecycle events are plain DOM events on the element.
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
    'cancel-subscription-accordion',
  ]) {
    elements.set(id, makeEl(id));
  }

  // The trigger carries the attributes the built markup carries — the same ones
  // the build test below pins.
  elements.set('cancel-subscription-trigger-btn', makeEl('cancel-subscription-trigger-btn', {
    'data-bs-toggle': 'collapse',
    'data-bs-target': '#cancel-subscription-accordion',
    'aria-expanded': 'false',
  }));

  // What Bootstrap does to a collapse element, which the page reads back.
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
  // toggles `[data-bs-toggle="collapse"]`'s target. It re-reads the attribute
  // on every click, which is the only thing the gate can take away from it.
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
    bindings: () => ({ update: () => {} }),
    utilities: () => ({ showNotification: () => {}, escapeHTML: (v) => v }),
    request: async () => ({}),
  };

  // The page's analytics snippets, which trackBilling() calls as bare globals.
  // `analyticsBlocked` is what an ad blocker leaves behind: the names never get
  // defined, so every call throws.
  for (const name of ['gtag', 'fbq', 'ttq']) {
    delete globalThis[name];
  }
  if (!analyticsBlocked) {
    globalThis.gtag = () => {};
    globalThis.fbq = () => {};
    globalThis.ttq = { track: () => {} };
  }

  delete require.cache[require.resolve(BUNDLE)];
  const billing = require(BUNDLE);

  await billing.init();
  await billing.loadData(account, PAYMENT_CONFIG);

  // The click the customer makes on "Cancel subscription".
  const clickTrigger = () => {
    const $trigger = elements.get('cancel-subscription-trigger-btn');
    const event = { target: $trigger, defaultPrevented: false, propagationStopped: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.propagationStopped = true; } };

    // Capture descends `document` → button, so Bootstrap's delegate acts first.
    collapseDataApi(event);

    for (const { type, handler } of handlersFor('cancel-subscription-trigger-btn')) {
      if (type === 'click') handler(event);
    }

    return event;
  };

  const clickById = (id) => {
    for (const { type, handler } of handlersFor(id)) {
      if (type === 'click') handler({ preventDefault() {}, stopPropagation() {} });
    }
  };

  const isAccordionOpen = () => elements.get('cancel-subscription-accordion').classList.contains('show');
  const attributesOf = (id) => elements.get(id).attributes;

  return { opened, clickTrigger, clickById, handlersFor, isAccordionOpen, attributesOf };
}

test('#267: the trial gate stops the questionnaire and opens the warning instead', async () => {
  const { opened, clickTrigger } = await wireCancelFlow(trialingAccount());

  const event = clickTrigger();

  // The declarative collapse toggle lives on `document`; only stopping the
  // event there keeps the questionnaire shut.
  assert.strictEqual(event.propagationStopped, true, 'the declarative collapse never gets the click');
  assert.strictEqual(event.defaultPrevented, true, 'and the default action is cancelled');
  assert.deepStrictEqual(opened, ['modal:cancel-trial-warning-modal'], 'the warning is what opened');
});

test('#267: the questionnaire does not move while the warning is up', async () => {
  // The live fail: the dialog appeared and the accordion slid open BEHIND it.
  // Bootstrap's collapse data-api is a CAPTURE-phase delegate on `document`, so
  // it toggles on the way down to the button — stopping the event at the button
  // is too late, and only taking `data-bs-toggle` off it holds the
  // questionnaire shut.
  const { opened, clickTrigger, isAccordionOpen, attributesOf } = await wireCancelFlow(trialingAccount());

  clickTrigger();

  assert.deepStrictEqual(opened, ['modal:cancel-trial-warning-modal'], 'the warning is what opened');
  assert.strictEqual(isAccordionOpen(), false, 'and the questionnaire never moved');
  assert.strictEqual(attributesOf('cancel-subscription-trigger-btn')['data-bs-toggle'], undefined, 'a gated trigger is not a Bootstrap toggle at all');
});

test('#267: an open questionnaire closes on the next click, with no second warning', async () => {
  // The other half of the live fail: with the accordion open, the click that
  // should just CLOSE it re-opened the dialog — the gate never asked whether
  // the thing it guards was already open.
  const { opened, clickTrigger, clickById, isAccordionOpen, attributesOf } = await wireCancelFlow(trialingAccount());

  clickTrigger();
  clickById('cancel-trial-continue-btn');

  assert.strictEqual(isAccordionOpen(), true, 'confirming opened the questionnaire');

  clickTrigger();

  assert.strictEqual(isAccordionOpen(), false, 'the next click closes it');
  assert.strictEqual(
    opened.filter((entry) => entry === 'modal:cancel-trial-warning-modal').length,
    1,
    'closing never re-opens the warning',
  );

  // Bootstrap tracks `aria-expanded` for the triggers it owns; a gated trigger
  // is not one of them any more, so the page owes the state itself.
  assert.strictEqual(attributesOf('cancel-subscription-trigger-btn')['aria-expanded'], 'false', 'and the trigger reports itself closed');
});

test('#267: a paid cancel still opens the questionnaire declaratively', async () => {
  // The gate works by taking the declarative toggle OFF a trial's trigger, so
  // the paid trigger keeping it — and Bootstrap alone opening the accordion —
  // is what "unchanged" means here.
  const { opened, clickTrigger, isAccordionOpen, attributesOf } = await wireCancelFlow(paidAccount());

  clickTrigger();

  assert.strictEqual(attributesOf('cancel-subscription-trigger-btn')['data-bs-toggle'], 'collapse', 'the paid trigger is still a Bootstrap toggle');
  assert.strictEqual(isAccordionOpen(), true, 'and Bootstrap opened the questionnaire on its own');
  assert.deepStrictEqual(opened, [], 'with nothing asked of Bootstrap by the page');
});

test('#267: the gate is registered in the CAPTURE phase', async () => {
  // Bootstrap delegates from `document`, so a bubble-phase listener on the
  // button would fire too late to stop it in some orderings. This is the one
  // detail the interception depends on.
  const { handlersFor } = await wireCancelFlow(trialingAccount());
  const click = handlersFor('cancel-subscription-trigger-btn').find((h) => h.type === 'click');

  assert.strictEqual(click.capture, true, 'the gate listens in the capture phase');
});

test('#267: confirming proceeds to the questionnaire, keeping the trial does not', async () => {
  const { opened, clickTrigger, clickById } = await wireCancelFlow(trialingAccount());

  clickTrigger();
  clickById('cancel-trial-continue-btn');

  assert.ok(opened.includes('collapse:cancel-subscription-accordion'), 'confirming opens the questionnaire');
  assert.ok(opened.includes('modal-hide:cancel-trial-warning-modal'), 'and closes the warning behind it');

  // Backing out opens nothing at all — the trial simply stays.
  const back = await wireCancelFlow(trialingAccount());
  back.clickTrigger();
  back.clickById('cancel-trial-keep-btn');

  assert.deepStrictEqual(back.opened, ['modal:cancel-trial-warning-modal'], 'keeping the trial opens no questionnaire');
});

test('#267: blocked analytics cannot leave the cancel button doing nothing', async () => {
  // The gate stops the declarative collapse before it opens anything, so if the
  // warning failed to open the customer would be left with a dead button and no
  // way to cancel. trackBilling() reaches for `gtag`/`fbq`/`ttq` as bare
  // globals, which an ad blocker simply never defines.
  const { opened, clickTrigger } = await wireCancelFlow(trialingAccount(), { analyticsBlocked: true });

  try {
    clickTrigger();
  } catch (e) {
    // The counting may fail; the dialog must already be up regardless.
  }

  assert.deepStrictEqual(opened, ['modal:cancel-trial-warning-modal'], 'the warning opened before anything was counted');
});

test('#267: a paid cancel is never intercepted — the flow is untouched', async () => {
  const { opened, clickTrigger } = await wireCancelFlow(paidAccount());

  const event = clickTrigger();

  assert.strictEqual(event.propagationStopped, false, 'the declarative collapse handles it, exactly as before');
  assert.strictEqual(event.defaultPrevented, false, 'nothing is cancelled');
  assert.deepStrictEqual(opened, [], 'and no warning dialog is opened');
});

test('#267: the built account page carries the dialog the gate opens', async () => {
  // The gate stops the questionnaire and opens `#cancel-trial-warning-modal` by
  // id. If the markup ever loses it, the trial cancel becomes a dead button —
  // so the ids the JS reaches for are pinned against the real build.
  // The browser globals the harness above installs are FAKES, and the build
  // toolchain reads the real ones at require time (sass probes `window`). Hand
  // the build back a node environment.
  for (const name of ['window', 'document', 'bootstrap', 'gtag', 'fbq', 'ttq', '__omegaClient']) {
    delete globalThis[name];
  }

  const { buildWith, miniData } = require('./lib/build.js');
  const pages = await buildWith(miniData, {}, 'billing-trial-warning-test');
  const page = pages.get('/dashboard/account');
  assert.ok(page, 'account page built');

  for (const id of ['cancel-subscription-trigger-btn', 'cancel-trial-warning-modal', 'cancel-trial-continue-btn', 'cancel-trial-keep-btn']) {
    assert.ok(page.includes(`id="${id}"`), `the JS hook survives the markup: ${id}`);
  }

  // The trigger still opens the questionnaire declaratively — that is what the
  // paid flow rides on, and what the trial gate intercepts.
  const triggerAt = page.indexOf('id="cancel-subscription-trigger-btn"');
  const trigger = page.slice(page.lastIndexOf('<button', triggerAt), page.indexOf('>', triggerAt) + 1);
  assert.match(trigger, /data-bs-toggle="collapse"/, 'the paid path stays declarative');
  assert.match(trigger, /data-bs-target="#cancel-subscription-accordion"/, 'and still targets the questionnaire');

  // The dialog states the consequence, and offers the way back out.
  const modalAt = page.indexOf('id="cancel-trial-warning-modal"');
  const modal = page.slice(modalAt, page.indexOf('id="change-plan-modal"'));
  assert.match(modal, /immediately/i, 'the dialog says the trial ends immediately');
  assert.match(modal, /Keep my trial/, 'and offers the way back');
  assert.ok(
    modal.includes('data-omega-bind="@text billing.cancelWarning.trialEndDate"'),
    'the trial end date is bound from the same state the card renders',
  );
});

test('#267: a trial cancel is gated behind a warning, a paid cancel is not', async () => {
  const trialing = await billingStateFor(trialingAccount());

  assert.strictEqual(trialing.buttons.cancel, true, 'a trialing subscription can still be cancelled');
  assert.strictEqual(trialing.cancelWarning.show, true, 'and it owes the customer a warning first');

  const paid = await billingStateFor(paidAccount());

  assert.strictEqual(paid.buttons.cancel, true, 'a paid subscription can be cancelled');
  assert.strictEqual(paid.cancelWarning.show, false, 'and goes straight to the questionnaire, exactly as before');
});

test('#267: the warning names the date the trial would otherwise run to', async () => {
  // "You would keep it until X" is the whole decision — a warning that cannot
  // say when the trial ends is not worth showing a date slot for.
  const trialing = await billingStateFor(trialingAccount());

  assert.strictEqual(trialing.cancelWarning.hasTrialEndDate, true, 'the trial end date is known');
  assert.ok(trialing.cancelWarning.trialEndDate, 'and rendered');
  assert.strictEqual(
    trialing.cancelWarning.trialEndDate,
    trialing.alerts.trialEndDate,
    'and it is the SAME date the billing card already shows — one formatting, one answer',
  );
});

test('#267: the questionnaire behind the warning tells a trial the same story', async () => {
  // The dialog says "immediately" and then hands the customer a form whose own
  // copy promised access "until the end of your current billing period", with a
  // REQUIRED checkbox attesting to it. One flag decides both, so the form can
  // never contradict the warning that opened it.
  const trialing = await billingStateFor(trialingAccount());
  const paid = await billingStateFor(paidAccount());

  assert.strictEqual(trialing.cancelForm.trial, true, 'a trial cancel gets the immediate-end copy');
  assert.strictEqual(
    trialing.cancelForm.trial,
    trialing.cancelWarning.show,
    'and it is the SAME answer the warning gate reads — one rule, not two',
  );

  assert.strictEqual(paid.cancelForm.trial, false, 'a paid cancel keeps the period-end copy it always had');
});

test('#267: the built questionnaire carries both the trial and the paid wording', async () => {
  for (const name of ['window', 'document', 'bootstrap', 'gtag', 'fbq', 'ttq', '__omegaClient']) {
    delete globalThis[name];
  }

  const { buildWith, miniData } = require('./lib/build.js');
  const pages = await buildWith(miniData, {}, 'billing-trial-questionnaire-test');
  const page = pages.get('/dashboard/account');
  assert.ok(page, 'account page built');

  // The questionnaire is everything from the accordion to the dialog that gates it.
  const formAt = page.indexOf('id="cancel-subscription-accordion"');
  const form = page.slice(formAt, page.indexOf('id="cancel-trial-warning-modal"'));
  assert.ok(form.length > 0, 'the questionnaire markup was found');

  // Both variants are rendered, each gated on the one flag.
  assert.match(form, /@show billing\.cancelForm\.trial/, 'the trial copy is shown for a trial cancel');
  assert.match(form, /@hide billing\.cancelForm\.trial/, 'and the paid copy is hidden for one');

  // The trial half says the thing the warning said.
  const trialBlocks = [...form.matchAll(/@show billing\.cancelForm\.trial"[^>]*>([\s\S]*?)<\/(?:p|span)>/g)].map((m) => m[1]);
  assert.ok(trialBlocks.length >= 2, 'both the explanation and the confirmation label have a trial variant');

  for (const block of trialBlocks) {
    assert.match(block, /immediately/i, 'a trial variant states that access ends immediately');
    assert.ok(!/end of (your|the) current billing period/i.test(block), 'and never promises the period out');
  }

  // The paid half is untouched — same sentence, same attestation.
  const paidBlocks = [...form.matchAll(/@hide billing\.cancelForm\.trial"[^>]*>([\s\S]*?)<\/(?:p|span)>/g)].map((m) => m[1]);
  assert.ok(paidBlocks.length >= 2, 'the paid copy keeps both of its halves');

  for (const block of paidBlocks) {
    assert.match(block, /end of (your|the) current billing period/i, 'a paid variant still promises the period out');
  }

  // The attestation is still ONE required checkbox — only its wording varies.
  assert.strictEqual((form.match(/id="cancel-confirm-checkbox"/g) || []).length, 1, 'one confirmation checkbox');
  assert.match(form.slice(form.indexOf('id="cancel-confirm-checkbox"') - 200, form.indexOf('id="cancel-confirm-checkbox"') + 200), /required/, 'still required');
});

test('#267: a state that cannot cancel is never gated', async () => {
  // The warning is a gate in FRONT of the cancel button. Where there is no
  // button there is nothing to gate, and a stray warning flag would be a dialog
  // that can never be dismissed by completing the flow.
  const cases = [
    { what: 'a free account', account: { subscription: { status: 'active', product: { id: 'basic', name: 'Basic' } } } },
    { what: 'an already-ended subscription', account: paidAccount({ status: 'cancelled', cancellation: { pending: false } }) },
    { what: 'a paid subscription already scheduled to end', account: paidAccount({ cancellation: { pending: true, date: { timestampUNIX: MONTH_FROM_NOW } } }) },
  ];

  for (const { what, account } of cases) {
    const state = await billingStateFor(account);

    assert.strictEqual(state.buttons.cancel, false, `${what}: offers no cancel button`);
    assert.strictEqual(state.cancelWarning.show, false, `${what}: and no warning gate`);
  }
});

test('#267: the gate never disagrees with the button it guards', async () => {
  // A TRIALING subscription carrying a scheduled cancellation still offers the
  // cancel button — `resolved.cancelling` is `pending && !trialing`, and the
  // provider's own portal can schedule one (#226). Cancelling from there still
  // ends the trial immediately, so the warning has to ride along with it.
  const account = trialingAccount({ cancellation: { pending: true, date: { timestampUNIX: WEEK_FROM_NOW } } });
  const state = await billingStateFor(account);

  assert.strictEqual(state.buttons.cancel, true, 'the cancel button is still offered here');
  assert.strictEqual(state.cancelWarning.show, true, 'so the warning is still owed');
});
