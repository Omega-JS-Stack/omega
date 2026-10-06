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
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');
const { User } = require('@omega.js/account');
const { WAKEUP_ROUTE } = require('@omega.js/client/modules/request.js');

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
        build.onResolve({ filter: /^@omega\.js\/web\/runtime$/ }, () => {
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
    payment: { frequency: 'monthly', price: 10, provider: 'stripe' },
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

  // Every omega.request the page makes — today that is the wakeup ping alone
  const requests = [];

  globalThis.__omegaClient = {
    config: { analytics: { providers: {} } },
    dom: { ready: async () => {} },
    request: async (url, options = {}) => { requests.push({ url, options }); },
    auth: {
      listen: (options, handler) => handler({ user: new User(account, { uid: 'u1' }), denied: false }),
    },
    sentry: { captureException: () => {} },
    // A visitor who consented: what this suite is about is WHICH clicks count,
    // not whether the visitor allowed counting (#383's gate is its own suite).
    storage: {
      get: (key, fallback) => (key === 'trackingConsent'
        ? { analytics: true, marketing: true, region: 'opt-out', version: 1 }
        : fallback),
      set: () => {},
    },
  };

  // Every analytics call the page makes, as `<network>:<event>` — a switch is
  // not a purchase and must reach none of them with a cart event.
  const tracked = [];
  // The GA4 payloads beside the names, because an event can fire to all three
  // and still describe the wrong thing (#668).
  const payloads = [];
  globalThis.gtag = (kind, event, params) => { tracked.push(`gtag:${event}`); payloads.push({ event, params }); };
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
    payloads,
    requests,
    button: (planId) => buttons.find((button) => button.dataset.planId === planId),
    /** Click one plan's button and report where the browser was sent. */
    navigate(planId) {
      tracked.length = 0;
      payloads.length = 0;
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

module.exports = defineCases({
  type: 'group',
  description: 'pricing-switch-cta',
  tests: [
    {
      name: 'pricing CTA: a subscriber\'s switch button goes to the billing tab, naming the plan and cadence',
      run: async (ctx) => {
        const page = await loadPricingPage(SUBSCRIBER);

        ctx.expect(page.button('pro').textContent, 'the other plan reads as a switch, as it already did').toBe('Switch to This Plan');
        ctx.expect(page.navigate('pro'), 'and the click lands on the billing tab with the plan it meant — not in checkout, which would sell a second subscription').toBe('https://brand.test/dashboard/account?product=pro&frequency=monthly#billing');

        // The cadence travels with it: whatever the pricing toggle is showing is the
        // cadence the modal opens on.
        page.cadence('annually');
        ctx.expect(page.navigate('pro'), 'the toggle\'s cadence rides along').toBe('https://brand.test/dashboard/account?product=pro&frequency=annually#billing');
      },
    },

    {
      name: 'pricing CTA: a plan switch is not a purchase — nothing is added to any cart',
      run: async (ctx) => {
        // The switch used to fall through to the add-to-cart pair on its way out:
        // gtag/fbq/ttq each got a cart event for a move that never reaches a
        // checkout, so every switch click inflated the funnel with a conversion
        // that cannot convert.
        const page = await loadPricingPage(SUBSCRIBER);

        page.navigate('pro');
        ctx.expect(page.tracked, 'a switch click emits no cart event at all').toEqual([]);

        // A real purchase still reports itself to all three.
        page.navigate('credits');
        ctx.expect(page.tracked, 'a genuine checkout still fires add-to-cart everywhere it did').toEqual(['gtag:add_to_cart', 'fbq:AddToCart', 'ttq:AddToCart']);
      },
    },

    {
      name: '#668: a one-time product is added to the cart as `once`, not as a cadence',
      run: async (ctx) => {
        // `item_variant` was the billing toggle's cadence for EVERY product, so the
        // funnel's first event called a one-time buy monthly while begin_checkout,
        // add_payment_info and purchase all say `once` — the same product counted
        // two different ways across one funnel.
        const page = await loadPricingPage(VISITOR);

        page.navigate('credits');
        const [cart] = page.payloads;
        ctx.expect(cart.event, 'the click is a cart event').toBe('add_to_cart');
        ctx.expect(cart.params.items[0].item_category, 'categorized by what it is').toBe('one-time');
        ctx.expect(cart.params.items[0].item_variant, 'and it names no cadence it will never be billed on').toBe('once');

        // The toggle still names a plan's term.
        page.navigate('pro');
        ctx.expect(page.payloads[0].params.items[0].item_variant, 'a subscription still carries the cadence the toggle is on').toBe('monthly');
      },
    },

    {
      name: 'pricing CTA: a cancelling subscriber is offered no switch it cannot make',
      run: async (ctx) => {
        // While a cancellation is scheduled the backend refuses a plan change and
        // the billing page hides its Change button — so "Switch to This Plan" was a
        // promise ending in a modal that (correctly) refuses to open. The buttons
        // keep the CTA they were authored with.
        const page = await loadPricingPage(CANCELLING);

        ctx.expect(page.button('pro').textContent, 'no switch is advertised in the one state that cannot switch').toBe('Get started');
        ctx.expect(page.button('pro').dataset.planAction, 'and nothing re-routes the click to a modal that will not open').toBe(undefined);
        ctx.expect(page.button('premium').textContent, 'the plan they are on still names itself').toBe('Current Plan');
        ctx.expect(page.button('premium').disabled, 'and is still not a button').toBe(true);
      },
    },

    {
      name: 'pricing CTA: the plan in force is still the locked "Current Plan"',
      run: async (ctx) => {
        const page = await loadPricingPage(SUBSCRIBER);
        const current = page.button('premium');

        ctx.expect(current.textContent, 'the plan you are on names itself').toBe('Current Plan');
        ctx.expect(current.disabled, 'and is not a button at all').toBe(true);
        ctx.expect(current.dataset.planAction, 'so nothing re-routes it').toBe(undefined);
      },
    },

    {
      name: 'pricing CTA: a one-time product and a visitor with no subscription still check out',
      run: async (ctx) => {
        const subscriber = await loadPricingPage(SUBSCRIBER);

        ctx.expect(subscriber.button('credits').textContent, 'a one-time product is a purchase, not a switch').toBe('Get started');
        ctx.expect(subscriber.navigate('credits'), 'so it goes to checkout, with no cadence to carry').toBe('https://brand.test/payment/checkout?product=credits');

        const visitor = await loadPricingPage(VISITOR);

        ctx.expect(visitor.button('pro').textContent, 'nobody without a live subscription is switching anything').toBe('Get started');
        ctx.expect(visitor.navigate('pro'), 'and the checkout path is exactly what it was').toBe('https://brand.test/payment/checkout?product=pro&frequency=monthly');
      },
    },

    {
      name: '#637: the pricing page warms the backend on load',
      run: async (ctx) => {
        // Every plan button on this page leads to checkout, whose first call is a
        // backend POST — so the wakeup goes out now rather than at the click.
        const { requests } = await loadPricingPage(VISITOR);

        const wakeup = requests.find((request) => request.options.wakeup);
        ctx.expect(wakeup, 'the page fires the shared client wakeup helper').toBeTruthy();
        ctx.expect(wakeup.url, 'aimed at the one route every wakeup names').toBe(WAKEUP_ROUTE);
      },
    },
  ],
});
