/**
 * The dev-only console helper on the billing card
 * ([#309](https://github.com/Omega-JS-Stack/omega/issues/309)).
 *
 * `window._billing.test(account)` renders a made-up account into the card so a
 * state can be looked at without owning one, and `window._billing.restore()`
 * puts the real one back. The render used to go through `updateUI()` alone,
 * which left `currentAccount` pointing at the REAL account — and the card's
 * behavior does not all come from the render: the trial-cancel gate
 * (`needsTrialCancelWarning`) re-reads `currentAccount` on every click, while
 * the render has already taken `data-bs-toggle` off the trigger. Test a
 * trialing account onto a paid one and the cancel button did nothing at all:
 * the declarative collapse was gone and the gate said no warning was owed.
 *
 * So the helper stashes the real account, sets `currentAccount` to the
 * synthetic one for the length of the test render, and restores the stash —
 * never a bare assignment that loses the real account. Production never sees
 * any of it: the whole block is stripped at build time (`@dev-only`), which
 * strip-dev-blocks.test.js pins.
 *
 * The module is browser code behind two bundler aliases, so the harness drives
 * the REAL file through esbuild over a document built from ids — the convention
 * billing-cancel-trial-warning.test.js sets, including its faithful model of
 * Bootstrap's capture-phase collapse data-api.
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

const BUNDLE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-billing-dev-helper-'));
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
        // bundle's own exports, and no form is submitted here.
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

/** The account the customer really has: paid, no warning owed. */
function paidAccount() {
  return {
    subscription: {
      product: { id: 'premium', name: 'Premium' },
      status: 'active',
      payment: { frequency: 'monthly', price: 10, processor: 'stripe' },
      expires: { timestampUNIX: MONTH_FROM_NOW },
    },
  };
}

/** The state being looked at from the console: a live trial. */
function syntheticTrial() {
  return {
    subscription: {
      product: { id: 'premium', name: 'Synthetic Trial' },
      status: 'active',
      payment: { frequency: 'monthly', price: 10, processor: 'stripe' },
      expires: { timestampUNIX: WEEK_FROM_NOW },
      trial: { claimed: true, expires: { timestampUNIX: WEEK_FROM_NOW } },
    },
  };
}

/** A second synthetic render, to prove the stash is the REAL account. */
function syntheticFree() {
  return {
    subscription: {
      product: { id: 'basic', name: 'Synthetic Free' },
      status: 'active',
    },
  };
}

/**
 * Drive the REAL init() over a document built from ids, then hand back the
 * console helper the dev block installs plus the controls it affects.
 */
async function wireBilling(account) {
  await bundleOnce();

  const opened = [];
  const elements = new Map();

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

  // Bootstrap's collapse data-api: a document-level CAPTURE delegate that
  // re-reads `data-bs-toggle` on every click. Taking the attribute away is the
  // only thing that holds the questionnaire shut, which is why a render and the
  // gate must always be talking about the same account.
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
  globalThis.gtag = () => {};
  globalThis.fbq = () => {};
  globalThis.ttq = { track: () => {} };
  globalThis.__omegaClient = {
    auth: () => ({ resolveSubscription: (a) => resolveSubscription(a) }),
    bindings: () => ({ update: () => {} }),
    utilities: () => ({ showNotification: () => {}, escapeHTML: (v) => v }),
    request: async () => ({}),
  };

  // require.resolve, not BUNDLE: the cache is keyed by the REAL path, and
  // macOS's tmpdir is a symlink (/var → /private/var).
  delete require.cache[require.resolve(BUNDLE)];
  const billing = require(BUNDLE);

  await billing.init();
  await billing.loadData(account, PAYMENT_CONFIG);

  const clickTrigger = () => {
    const $trigger = elements.get('cancel-subscription-trigger-btn');
    const event = { target: $trigger, defaultPrevented: false, propagationStopped: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.propagationStopped = true; } };

    collapseDataApi(event);

    for (const { type, handler } of $trigger.handlers) {
      if (type === 'click') handler(event);
    }

    return event;
  };

  return {
    helper: globalThis.window._billing,
    opened,
    clickTrigger,
    isAccordionOpen: () => elements.get('cancel-subscription-accordion').classList.contains('show'),
    attributesOf: (id) => elements.get(id).attributes,
  };
}

test('#309: a tested account is the one the card behaves as', async () => {
  // The live fail: the render said "trial" (and stripped the declarative
  // toggle) while the gate still read the real paid account, so the click
  // opened nothing at all — a dead cancel button in the dev palette.
  const { helper, opened, clickTrigger, isAccordionOpen, attributesOf } = await wireBilling(paidAccount());

  helper.test(syntheticTrial());

  assert.strictEqual(
    attributesOf('cancel-subscription-trigger-btn')['data-bs-toggle'],
    undefined,
    'the synthetic trial render gated the trigger',
  );

  clickTrigger();

  assert.deepStrictEqual(opened, ['modal:cancel-trial-warning-modal'], 'and the warning is what the click opens');
  assert.strictEqual(isAccordionOpen(), false, 'with the questionnaire held shut behind it');
});

test('#309: the tested state is what state() reports', async () => {
  const { helper } = await wireBilling(paidAccount());

  assert.strictEqual(helper.state().billing.plan.name, 'Premium', 'the real account is on screen to begin with');

  helper.test(syntheticTrial());

  assert.strictEqual(helper.state().billing.plan.name, 'Synthetic Trial', 'the synthetic account is what the card is showing');
  assert.strictEqual(helper.state().billing.cancelWarning.show, true, 'and the gate agrees a warning is owed');
});

test('#309: restore puts the real account back, gate and all', async () => {
  const { helper, opened, clickTrigger, isAccordionOpen, attributesOf } = await wireBilling(paidAccount());

  helper.test(syntheticTrial());
  helper.restore();

  assert.strictEqual(helper.state().billing.plan.name, 'Premium', 'the real account is back');
  assert.strictEqual(
    attributesOf('cancel-subscription-trigger-btn')['data-bs-toggle'],
    'collapse',
    'and its trigger is a Bootstrap toggle again',
  );

  clickTrigger();

  assert.strictEqual(isAccordionOpen(), true, 'so a paid cancel opens the questionnaire declaratively, as it always did');
  assert.deepStrictEqual(opened, [], 'with no warning dialog anywhere in it');
});

test('#309: a second test render never becomes the thing restore restores', async () => {
  // The stash is the REAL account, taken once. A bare assignment on every
  // render would hand `restore()` the previous SYNTHETIC account and lose the
  // customer's own for the rest of the session.
  const { helper } = await wireBilling(paidAccount());

  helper.test(syntheticTrial());
  helper.test(syntheticFree());

  assert.strictEqual(helper.state().billing.plan.name, 'Synthetic Free', 'the second synthetic account is on screen');

  helper.restore();

  assert.strictEqual(helper.state().billing.plan.name, 'Premium', 'and restore still comes back to the real account');
});

test('#309: restore with nothing tested leaves the real account alone', async () => {
  const { helper, clickTrigger, isAccordionOpen } = await wireBilling(paidAccount());

  helper.restore();

  assert.strictEqual(helper.state().billing.plan.name, 'Premium', 'the account on screen is unchanged');

  clickTrigger();

  assert.strictEqual(isAccordionOpen(), true, 'and the card still behaves as the paid account it is');
});
