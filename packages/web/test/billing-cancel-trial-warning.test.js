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
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');
const { User } = require('@omega.js/account');

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
        build.onResolve({ filter: /^@omega\.js\/web\/runtime$/ }, () => {
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
  return new User({
    subscription: {
      product: { id: 'premium', name: 'Premium' },
      status: 'active',
      payment: { frequency: 'monthly', price: 10, provider: 'stripe' },
      expires: { timestampUNIX: WEEK_FROM_NOW },
      trial: { claimed: true, expires: { timestampUNIX: WEEK_FROM_NOW } },
      ...subscription,
    },
  }, { uid: 'u1' });
}

/** A paid subscription — the half of the ruling that must not change. */
function paidAccount(subscription) {
  return new User({
    subscription: {
      product: { id: 'premium', name: 'Premium' },
      status: 'active',
      payment: { frequency: 'monthly', price: 10, provider: 'stripe' },
      expires: { timestampUNIX: MONTH_FROM_NOW },
      ...subscription,
    },
  }, { uid: 'u1' });
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
    bindings: { update: (state) => updates.push(state) },
    utilities: {
      showNotification: () => {},
      escapeHTML: (value) => value,
    },
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
    bindings: { update: () => {} },
    utilities: { showNotification: () => {}, escapeHTML: (v) => v },
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

module.exports = defineCases({
  type: 'group',
  description: 'billing-cancel-trial-warning',
  tests: [
    {
      name: '#267: the trial gate stops the questionnaire and opens the warning instead',
      run: async (ctx) => {
        const { opened, clickTrigger } = await wireCancelFlow(trialingAccount());

        const event = clickTrigger();

        // The declarative collapse toggle lives on `document`; only stopping the
        // event there keeps the questionnaire shut.
        ctx.expect(event.propagationStopped, 'the declarative collapse never gets the click').toBe(true);
        ctx.expect(event.defaultPrevented, 'and the default action is cancelled').toBe(true);
        ctx.expect(opened, 'the warning is what opened').toEqual(['modal:cancel-trial-warning-modal']);
      },
    },

    {
      name: '#267: the questionnaire does not move while the warning is up',
      run: async (ctx) => {
        // The live fail: the dialog appeared and the accordion slid open BEHIND it.
        // Bootstrap's collapse data-api is a CAPTURE-phase delegate on `document`, so
        // it toggles on the way down to the button — stopping the event at the button
        // is too late, and only taking `data-bs-toggle` off it holds the
        // questionnaire shut.
        const { opened, clickTrigger, isAccordionOpen, attributesOf } = await wireCancelFlow(trialingAccount());

        clickTrigger();

        ctx.expect(opened, 'the warning is what opened').toEqual(['modal:cancel-trial-warning-modal']);
        ctx.expect(isAccordionOpen(), 'and the questionnaire never moved').toBe(false);
        ctx.expect(attributesOf('cancel-subscription-trigger-btn')['data-bs-toggle'], 'a gated trigger is not a Bootstrap toggle at all').toBe(undefined);
      },
    },

    {
      name: '#267: an open questionnaire closes on the next click, with no second warning',
      run: async (ctx) => {
        // The other half of the live fail: with the accordion open, the click that
        // should just CLOSE it re-opened the dialog — the gate never asked whether
        // the thing it guards was already open.
        const { opened, clickTrigger, clickById, isAccordionOpen, attributesOf } = await wireCancelFlow(trialingAccount());

        clickTrigger();
        clickById('cancel-trial-continue-btn');

        ctx.expect(isAccordionOpen(), 'confirming opened the questionnaire').toBe(true);

        clickTrigger();

        ctx.expect(isAccordionOpen(), 'the next click closes it').toBe(false);
        ctx.expect(opened.filter((entry) => entry === 'modal:cancel-trial-warning-modal').length, 'closing never re-opens the warning').toBe(1);

        // Bootstrap tracks `aria-expanded` for the triggers it owns; a gated trigger
        // is not one of them any more, so the page owes the state itself.
        ctx.expect(attributesOf('cancel-subscription-trigger-btn')['aria-expanded'], 'and the trigger reports itself closed').toBe('false');
      },
    },

    {
      name: '#267: a paid cancel still opens the questionnaire declaratively',
      run: async (ctx) => {
        // The gate works by taking the declarative toggle OFF a trial's trigger, so
        // the paid trigger keeping it — and Bootstrap alone opening the accordion —
        // is what "unchanged" means here.
        const { opened, clickTrigger, isAccordionOpen, attributesOf } = await wireCancelFlow(paidAccount());

        clickTrigger();

        ctx.expect(attributesOf('cancel-subscription-trigger-btn')['data-bs-toggle'], 'the paid trigger is still a Bootstrap toggle').toBe('collapse');
        ctx.expect(isAccordionOpen(), 'and Bootstrap opened the questionnaire on its own').toBe(true);
        ctx.expect(opened, 'with nothing asked of Bootstrap by the page').toEqual([]);
      },
    },

    {
      name: '#267: the gate is registered in the CAPTURE phase',
      run: async (ctx) => {
        // Bootstrap delegates from `document`, so a bubble-phase listener on the
        // button would fire too late to stop it in some orderings. This is the one
        // detail the interception depends on.
        const { handlersFor } = await wireCancelFlow(trialingAccount());
        const click = handlersFor('cancel-subscription-trigger-btn').find((h) => h.type === 'click');

        ctx.expect(click.capture, 'the gate listens in the capture phase').toBe(true);
      },
    },

    {
      name: '#267: confirming proceeds to the questionnaire, keeping the trial does not',
      run: async (ctx) => {
        const { opened, clickTrigger, clickById } = await wireCancelFlow(trialingAccount());

        clickTrigger();
        clickById('cancel-trial-continue-btn');

        ctx.expect(opened.includes('collapse:cancel-subscription-accordion'), 'confirming opens the questionnaire').toBeTruthy();
        ctx.expect(opened.includes('modal-hide:cancel-trial-warning-modal'), 'and closes the warning behind it').toBeTruthy();

        // Backing out opens nothing at all — the trial simply stays.
        const back = await wireCancelFlow(trialingAccount());
        back.clickTrigger();
        back.clickById('cancel-trial-keep-btn');

        ctx.expect(back.opened, 'keeping the trial opens no questionnaire').toEqual(['modal:cancel-trial-warning-modal']);
      },
    },

    {
      name: '#267: blocked analytics cannot leave the cancel button doing nothing',
      run: async (ctx) => {
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

        ctx.expect(opened, 'the warning opened before anything was counted').toEqual(['modal:cancel-trial-warning-modal']);
      },
    },

    {
      name: '#267: a paid cancel is never intercepted — the flow is untouched',
      run: async (ctx) => {
        const { opened, clickTrigger } = await wireCancelFlow(paidAccount());

        const event = clickTrigger();

        ctx.expect(event.propagationStopped, 'the declarative collapse handles it, exactly as before').toBe(false);
        ctx.expect(event.defaultPrevented, 'nothing is cancelled').toBe(false);
        ctx.expect(opened, 'and no warning dialog is opened').toEqual([]);
      },
    },

    {
      name: '#267: the built account page carries the dialog the gate opens',
      run: async (ctx) => {
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
        ctx.expect(page, 'account page built').toBeTruthy();

        for (const id of ['cancel-subscription-trigger-btn', 'cancel-trial-warning-modal', 'cancel-trial-continue-btn', 'cancel-trial-keep-btn']) {
          ctx.expect(page.includes(`id="${id}"`), `the JS hook survives the markup: ${id}`).toBeTruthy();
        }

        // The trigger still opens the questionnaire declaratively — that is what the
        // paid flow rides on, and what the trial gate intercepts.
        const triggerAt = page.indexOf('id="cancel-subscription-trigger-btn"');
        const trigger = page.slice(page.lastIndexOf('<button', triggerAt), page.indexOf('>', triggerAt) + 1);
        ctx.expect(trigger, 'the paid path stays declarative').toMatch(/data-bs-toggle="collapse"/);
        ctx.expect(trigger, 'and still targets the questionnaire').toMatch(/data-bs-target="#cancel-subscription-accordion"/);

        // The dialog states the consequence, and offers the way back out.
        const modalAt = page.indexOf('id="cancel-trial-warning-modal"');
        const modal = page.slice(modalAt, page.indexOf('id="change-plan-modal"'));
        ctx.expect(modal, 'the dialog says the trial ends immediately').toMatch(/immediately/i);
        ctx.expect(modal, 'and offers the way back').toMatch(/Keep my trial/);
        ctx.expect(modal.includes('data-omega-bind="@text billing.cancelWarning.trialEndDate"'), 'the trial end date is bound from the same state the card renders').toBeTruthy();
      },
    },

    {
      name: '#267: a trial cancel is gated behind a warning, a paid cancel is not',
      run: async (ctx) => {
        const trialing = await billingStateFor(trialingAccount());

        ctx.expect(trialing.buttons.cancel, 'a trialing subscription can still be cancelled').toBe(true);
        ctx.expect(trialing.cancelWarning.show, 'and it owes the customer a warning first').toBe(true);

        const paid = await billingStateFor(paidAccount());

        ctx.expect(paid.buttons.cancel, 'a paid subscription can be cancelled').toBe(true);
        ctx.expect(paid.cancelWarning.show, 'and goes straight to the questionnaire, exactly as before').toBe(false);
      },
    },

    {
      name: '#267: the warning names the date the trial would otherwise run to',
      run: async (ctx) => {
        // "You would keep it until X" is the whole decision — a warning that cannot
        // say when the trial ends is not worth showing a date slot for.
        const trialing = await billingStateFor(trialingAccount());

        ctx.expect(trialing.cancelWarning.hasTrialEndDate, 'the trial end date is known').toBe(true);
        ctx.expect(trialing.cancelWarning.trialEndDate, 'and rendered').toBeTruthy();
        ctx.expect(trialing.cancelWarning.trialEndDate, 'and it is the SAME date the billing card already shows — one formatting, one answer').toBe(trialing.alerts.trialEndDate);
      },
    },

    {
      name: '#267: the questionnaire behind the warning tells a trial the same story',
      run: async (ctx) => {
        // The dialog says "immediately" and then hands the customer a form whose own
        // copy promised access "until the end of your current billing period", with a
        // REQUIRED checkbox attesting to it. One flag decides both, so the form can
        // never contradict the warning that opened it.
        const trialing = await billingStateFor(trialingAccount());
        const paid = await billingStateFor(paidAccount());

        ctx.expect(trialing.cancelForm.trial, 'a trial cancel gets the immediate-end copy').toBe(true);
        ctx.expect(trialing.cancelForm.trial, 'and it is the SAME answer the warning gate reads — one rule, not two').toBe(trialing.cancelWarning.show);

        ctx.expect(paid.cancelForm.trial, 'a paid cancel keeps the period-end copy it always had').toBe(false);
      },
    },

    {
      name: '#267: the built questionnaire carries both the trial and the paid wording',
      run: async (ctx) => {
        for (const name of ['window', 'document', 'bootstrap', 'gtag', 'fbq', 'ttq', '__omegaClient']) {
          delete globalThis[name];
        }

        const { buildWith, miniData } = require('./lib/build.js');
        const pages = await buildWith(miniData, {}, 'billing-trial-questionnaire-test');
        const page = pages.get('/dashboard/account');
        ctx.expect(page, 'account page built').toBeTruthy();

        // The questionnaire is everything from the accordion to the dialog that gates it.
        const formAt = page.indexOf('id="cancel-subscription-accordion"');
        const form = page.slice(formAt, page.indexOf('id="cancel-trial-warning-modal"'));
        ctx.expect(form.length > 0, 'the questionnaire markup was found').toBeTruthy();

        // Both variants are rendered, each gated on the one flag.
        ctx.expect(form, 'the trial copy is shown for a trial cancel').toMatch(/@show billing\.cancelForm\.trial/);
        ctx.expect(form, 'and the paid copy is hidden for one').toMatch(/@hide billing\.cancelForm\.trial/);

        // The trial half says the thing the warning said.
        const trialBlocks = [...form.matchAll(/@show billing\.cancelForm\.trial"[^>]*>([\s\S]*?)<\/(?:p|span)>/g)].map((m) => m[1]);
        ctx.expect(trialBlocks.length >= 2, 'both the explanation and the confirmation label have a trial variant').toBeTruthy();

        for (const block of trialBlocks) {
          ctx.expect(block, 'a trial variant states that access ends immediately').toMatch(/immediately/i);
          ctx.expect(!/end of (your|the) current billing period/i.test(block), 'and never promises the period out').toBeTruthy();
        }

        // The paid half is untouched — same sentence, same attestation.
        const paidBlocks = [...form.matchAll(/@hide billing\.cancelForm\.trial"[^>]*>([\s\S]*?)<\/(?:p|span)>/g)].map((m) => m[1]);
        ctx.expect(paidBlocks.length >= 2, 'the paid copy keeps both of its halves').toBeTruthy();

        for (const block of paidBlocks) {
          ctx.expect(block, 'a paid variant still promises the period out').toMatch(/end of (your|the) current billing period/i);
        }

        // The attestation is still ONE required checkbox — only its wording varies.
        ctx.expect((form.match(/id="cancel-confirm-checkbox"/g) || []).length, 'one confirmation checkbox').toBe(1);
        ctx.expect(form.slice(form.indexOf('id="cancel-confirm-checkbox"') - 200, form.indexOf('id="cancel-confirm-checkbox"') + 200), 'still required').toMatch(/required/);
      },
    },

    {
      name: '#267: a state that cannot cancel is never gated',
      run: async (ctx) => {
        // The warning is a gate in FRONT of the cancel button. Where there is no
        // button there is nothing to gate, and a stray warning flag would be a dialog
        // that can never be dismissed by completing the flow.
        const cases = [
          { what: 'a free account', account: new User({ subscription: { status: 'active', product: { id: 'basic', name: 'Basic' } } }, { uid: 'u1' }) },
          { what: 'an already-ended subscription', account: paidAccount({ status: 'cancelled', cancellation: { pending: false } }) },
          { what: 'a paid subscription already scheduled to end', account: paidAccount({ cancellation: { pending: true, date: { timestampUNIX: MONTH_FROM_NOW } } }) },
        ];

        for (const { what, account } of cases) {
          const state = await billingStateFor(account);

          ctx.expect(state.buttons.cancel, `${what}: offers no cancel button`).toBe(false);
          ctx.expect(state.cancelWarning.show, `${what}: and no warning gate`).toBe(false);
        }
      },
    },

    {
      name: '#267: the gate never disagrees with the button it guards',
      run: async (ctx) => {
        // A TRIALING subscription carrying a scheduled cancellation still offers the
        // cancel button: the `cancelling` getter is `pending && !trialing`, and the
        // provider's own portal can schedule one (#226). Cancelling from there still
        // ends the trial immediately, so the warning has to ride along with it.
        const account = trialingAccount({ cancellation: { pending: true, date: { timestampUNIX: WEEK_FROM_NOW } } });
        const state = await billingStateFor(account);

        ctx.expect(state.buttons.cancel, 'the cancel button is still offered here').toBe(true);
        ctx.expect(state.cancelWarning.show, 'so the warning is still owed').toBe(true);
      },
    },
  ],
});
