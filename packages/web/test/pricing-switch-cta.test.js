/**
 * The PRICING page's plan buttons for a signed-in subscriber
 * (`core/js/pages/pricing/index.js`) — where a click actually goes
 * ([#236](https://github.com/Omega-JS-Stack/omega/issues/236) QA round 3).
 *
 * The page already relabelled those buttons "Switch to This Plan" and left
 * them wired to CHECKOUT: a second purchase flow for a move that is a
 * proration, on an account that already has a card on file. The switch belongs
 * to the billing page's change-plan modal, so the button now carries the
 * account page's own URL — the billing tab, naming the plan and the cadence
 * the toggle is on — and the billing section opens that modal on arrival (the
 * other half, pinned in billing-plan-switcher.test.js).
 *
 * Everything else about those buttons is untouched, and this suite says so:
 * the plan in force stays the disabled "Current Plan", and a visitor with no
 * live subscription still goes to checkout.
 *
 * Same harness convention as the billing suites: the REAL module through
 * esbuild behind its bundler aliases, over a document that answers only the
 * selectors the page reads, with @omega.js/account resolving the subscription
 * exactly as the client does.
 */
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');
const { resolveSubscription } = require('@omega.js/account');

const CORE_DIR = path.join(__dirname, '..', 'core');
const PRICING_ENTRY = path.join(CORE_DIR, 'js', 'pages', 'pricing', 'index.js');

const BUNDLE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-pricing-cta-'));
const BUNDLE = path.join(BUNDLE_DIR, 'pricing.cjs');

let building = null;

function bundleOnce() {
  building ||= esbuild.build({
    entryPoints: [PRICING_ENTRY],
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
        // The price TWEEN is the motion module's job and nothing this suite
        // touches renders a price.
        build.onResolve({ filter: /^@omega\.js\/client\/modules\/motion\.js$/ }, () => {
          return { path: 'motion', namespace: 'omega-motion-stub' };
        });
        build.onLoad({ filter: /.*/, namespace: 'omega-motion-stub' }, () => {
          return { contents: 'export function parseCountTarget() { return null; } export function formatCount() { return \'\'; }' };
        });
      },
    }],
  });

  return building;
}

const HOUR_FROM_NOW = Math.floor(Date.now() / 1000) + 3600;

/** An account on the premium plan, live. */
const SUBSCRIBER = {
  subscription: {
    product: { id: 'premium', name: 'Premium' },
    status: 'active',
    payment: { frequency: 'monthly', price: 10, processor: 'stripe' },
    expires: { timestampUNIX: HOUR_FROM_NOW },
  },
};

/** An account that never subscribed. */
const VISITOR = { subscription: { product: { id: 'basic', name: 'Basic' }, status: 'active' } };

/** A live subscription with a cancellation already scheduled. */
const CANCELLING = {
  subscription: {
    ...SUBSCRIBER.subscription,
    cancellation: { pending: true, date: { timestampUNIX: HOUR_FROM_NOW } },
  },
};

/** One plan button, as much of it as the page reads and writes. */
function makeButton(planId, planType) {
  return {
    dataset: { planId: planId, planType: planType },
    disabled: false,
    textContent: 'Get started',
    click: null,
    classList: {
      add: () => {},
      remove: () => {},
    },
    addEventListener(event, handler) {
      if (event === 'click') this.click = handler;
    },
    closest: () => null,
  };
}

/** One segment of the page's billing toggle. */
function makeCadence(frequency, checked) {
  return {
    id: frequency,
    dataset: { billing: frequency },
    checked: checked,
    change: null,
    addEventListener(event, handler) {
      if (event === 'change') this.change = handler;
    },
    closest: () => null,
  };
}

/**
 * Load the REAL pricing page against one account and hand back its buttons plus
 * the URL a click navigates to.
 *
 * @param {object} account - the signed-in account (or null when signed out)
 * @returns {Promise<object>} { button(id), navigate(id), cadence(frequency) }
 */
async function loadPricingPage(account) {
  await bundleOnce();

  const buttons = [makeButton('premium', 'subscription'), makeButton('pro', 'subscription'), makeButton('credits', 'one-time')];
  const cadences = [makeCadence('monthly', true), makeCadence('annually', false)];

  globalThis.document = {
    getElementById: () => null,
    querySelector: (selector) => {
      if (selector.includes(':checked')) return cadences.find((cadence) => cadence.checked) || null;
      const planId = /data-plan-id="([^"]+)"/.exec(selector)?.[1];
      return planId ? buttons.find((button) => button.dataset.planId === planId) || null : null;
    },
    querySelectorAll: (selector) => {
      if (selector.includes('input[name="billing"]')) return cadences;
      if (selector.includes('button[data-plan-id]')) return buttons;
      return [];
    },
    addEventListener: () => {},
  };

  globalThis.window = {
    location: { origin: 'https://brand.test', href: 'https://brand.test/pricing' },
    matchMedia: () => ({ matches: false }),
  };

  globalThis.__omegaClient = {
    config: { analytics: { providers: {} } },
    dom: () => ({ ready: async () => {} }),
    auth: () => ({
      listen: (options, handler) => handler({ account: account }),
      resolveSubscription: (candidate) => resolveSubscription(candidate),
    }),
    sentry: () => ({ captureException: () => {} }),
    // A visitor who consented: what this suite is about is WHICH clicks count,
    // not whether the visitor allowed counting (#383's gate is its own suite).
    storage: () => ({
      get: (key, fallback) => (key === 'trackingConsent'
        ? { analytics: true, marketing: true, region: 'opt-out', version: 1 }
        : fallback),
      set: () => {},
    }),
  };

  // Every analytics call the page makes, as `<network>:<event>` — a switch is
  // not a purchase and must reach none of them with a cart event.
  const tracked = [];
  globalThis.gtag = (kind, event) => tracked.push(`gtag:${event}`);
  globalThis.fbq = (kind, event) => tracked.push(`fbq:${event}`);
  globalThis.ttq = { track: (event) => tracked.push(`ttq:${event}`) };

  // The promo countdown's poll would outlive the test by a second and prove
  // nothing — the page schedules it unconditionally.
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = () => 0;

  try {
    delete require.cache[require.resolve(BUNDLE)];
    await require(BUNDLE).default();
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }

  return {
    tracked,
    button: (planId) => buttons.find((button) => button.dataset.planId === planId),
    /** Click one plan's button and report where the browser was sent. */
    navigate(planId) {
      tracked.length = 0;
      buttons.find((button) => button.dataset.planId === planId).click();
      return globalThis.window.location.href;
    },
    /** Move the page's billing toggle, exactly as a click on it fires. */
    cadence(frequency) {
      cadences.forEach((segment) => { segment.checked = segment.dataset.billing === frequency; });
      cadences.find((segment) => segment.dataset.billing === frequency).change.call(cadences.find((segment) => segment.dataset.billing === frequency));
    },
  };
}

test('pricing CTA: a subscriber\'s switch button goes to the billing tab, naming the plan and cadence', async () => {
  const page = await loadPricingPage(SUBSCRIBER);

  assert.equal(page.button('pro').textContent, 'Switch to This Plan', 'the other plan reads as a switch, as it already did');
  assert.equal(
    page.navigate('pro'),
    'https://brand.test/dashboard/account?product=pro&frequency=monthly#billing',
    'and the click lands on the billing tab with the plan it meant — not in checkout, which would sell a second subscription',
  );

  // The cadence travels with it: whatever the pricing toggle is showing is the
  // cadence the modal opens on.
  page.cadence('annually');
  assert.equal(
    page.navigate('pro'),
    'https://brand.test/dashboard/account?product=pro&frequency=annually#billing',
    'the toggle\'s cadence rides along',
  );
});

test('pricing CTA: a plan switch is not a purchase — nothing is added to any cart', async () => {
  // The switch used to fall through to the add-to-cart pair on its way out:
  // gtag/fbq/ttq each got a cart event for a move that never reaches a
  // checkout, so every switch click inflated the funnel with a conversion
  // that cannot convert.
  const page = await loadPricingPage(SUBSCRIBER);

  page.navigate('pro');
  assert.deepStrictEqual(page.tracked, [], 'a switch click emits no cart event at all');

  // A real purchase still reports itself to all three.
  page.navigate('credits');
  assert.deepStrictEqual(
    page.tracked,
    ['gtag:add_to_cart', 'fbq:AddToCart', 'ttq:AddToCart'],
    'a genuine checkout still fires add-to-cart everywhere it did',
  );
});

test('pricing CTA: a cancelling subscriber is offered no switch it cannot make', async () => {
  // While a cancellation is scheduled the backend refuses a plan change and
  // the billing page hides its Change button — so "Switch to This Plan" was a
  // promise ending in a modal that (correctly) refuses to open. The buttons
  // keep the CTA they were authored with.
  const page = await loadPricingPage(CANCELLING);

  assert.equal(page.button('pro').textContent, 'Get started', 'no switch is advertised in the one state that cannot switch');
  assert.equal(page.button('pro').dataset.planAction, undefined, 'and nothing re-routes the click to a modal that will not open');
  assert.equal(page.button('premium').textContent, 'Current Plan', 'the plan they are on still names itself');
  assert.equal(page.button('premium').disabled, true, 'and is still not a button');
});

test('pricing CTA: the plan in force is still the locked "Current Plan"', async () => {
  const page = await loadPricingPage(SUBSCRIBER);
  const current = page.button('premium');

  assert.equal(current.textContent, 'Current Plan', 'the plan you are on names itself');
  assert.equal(current.disabled, true, 'and is not a button at all');
  assert.equal(current.dataset.planAction, undefined, 'so nothing re-routes it');
});

test('pricing CTA: a one-time product and a visitor with no subscription still check out', async () => {
  const subscriber = await loadPricingPage(SUBSCRIBER);

  assert.equal(subscriber.button('credits').textContent, 'Get started', 'a one-time product is a purchase, not a switch');
  assert.equal(
    subscriber.navigate('credits'),
    'https://brand.test/payment/checkout?product=credits',
    'so it goes to checkout, with no cadence to carry',
  );

  const visitor = await loadPricingPage(VISITOR);

  assert.equal(visitor.button('pro').textContent, 'Get started', 'nobody without a live subscription is switching anything');
  assert.equal(
    visitor.navigate('pro'),
    'https://brand.test/payment/checkout?product=pro&frequency=monthly',
    'and the checkout path is exactly what it was',
  );
});
