/**
 * The checkout's dev palette section (`core/js/pages/payment/checkout/modules/
 * dev-section.js`, #234) — what the page's gear dropdown used to offer, now a
 * page-scoped section the palette renders under its own "Checkout" heading in
 * the panel's extras (no built-in Checkout section exists any more).
 *
 * The controls that matter are the ones the page actually reads at init:
 * `product` + `frequency` + `_dev_trialEligible` (index.js), `_dev_recaptcha`
 * (libs/recaptcha.js) and — the one the gear never really offered — the
 * `_dev_cardProvider` override that modules/state.js resolves a card payment
 * through. The sixth is the decline toggle (#226), which moved here from the
 * palette's built-ins because arming a checkout only means anything on the
 * checkout page, and now rides `_dev_decline` like the rest. All six are read
 * from window.location.search, so "apply" navigates with the params set; this
 * test drives that for real.
 *
 * Same harness convention as dev-palette.test.js: the REAL module through
 * esbuild with the client stubbed, over a hand-rolled document that is only
 * what the section builds with.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');

const CORE_DIR = path.join(__dirname, '..', 'core');
const SECTION_ENTRY = path.join(CORE_DIR, 'js', 'pages', 'payment', 'checkout', 'modules', 'dev-section.js');

const BUNDLE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-checkout-dev-section-'));
const BUNDLE = path.join(BUNDLE_DIR, 'dev-section.cjs');

const PRODUCTS = [
  { id: 'premium', name: 'Premium', type: 'subscription' },
  { id: 'lifetime', name: 'Lifetime', type: 'one-time' },
];

let building = null;

function bundleOnce() {
  building ||= esbuild.build({
    entryPoints: [SECTION_ENTRY],
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
      },
    }],
  });

  return building;
}

/** The minimum element the section builds with. */
function makeElement(tagName) {
  const element = {
    tagName,
    children: [],
    className: '',
    textContent: '',
    hidden: false,
    value: '',
    dataset: {},
    style: {},
    attributes: {},
    listeners: {},
    append: (...nodes) => element.children.push(...nodes),
    appendChild: (node) => { element.children.push(node); return node; },
    setAttribute: (name, value) => { element.attributes[name] = value; },
    getAttribute: (name) => (name in element.attributes ? element.attributes[name] : null),
    addEventListener: (type, handler) => { (element.listeners[type] ||= []).push(handler); },
    click: () => Promise.all((element.listeners.click || []).map((handler) => handler())),
    change: () => Promise.all((element.listeners.change || []).map((handler) => handler())),
  };

  return element;
}

/** Every element in the tree, depth-first. */
function flatten(node) {
  return (node.children || []).flatMap((child) => [child, ...flatten(child)]);
}

/** Build the REAL section against one stubbed page URL; hand back its seams. */
async function build({ search = '?product=premium' } = {}) {
  await bundleOnce();

  const doc = { createElement: (tagName) => makeElement(tagName) };
  const navigations = [];

  const location = {
    pathname: '/payment/checkout',
    search,
  };
  // Assigning location.search is a navigation — capture it instead.
  const windowStub = {
    location: {
      get pathname() { return location.pathname; },
      get search() { return location.search; },
      set search(value) { navigations.push(value); },
    },
  };

  globalThis.window = windowStub;
  globalThis.document = doc;
  globalThis.__omegaClient = {
    config: { payment: { products: PRODUCTS } },
  };

  // require.resolve, not BUNDLE: the cache is keyed by the REAL path, and
  // macOS's tmpdir is a symlink (/var → /private/var).
  delete require.cache[require.resolve(BUNDLE)];
  const { checkoutDevSection } = require(BUNDLE);

  const node = checkoutDevSection.buildNode(doc);
  const elements = [node, ...flatten(node)];

  return {
    section: checkoutDevSection,
    navigations,
    node,
    elements,
    select: (param) => elements.find((element) => element.attributes['data-dev-param'] === param),
    button: (label) => elements.find((element) => element.tagName === 'button' && element.textContent === label),
    checkbox: (id) => elements.find((element) => element.tagName === 'input' && element.id === id),
    setPath: (value) => { location.pathname = value; },
  };
}

module.exports = defineCases({
  type: 'group',
  description: 'checkout-dev-section',
  tests: [
    {
      name: '#234: the checkout section is scoped to the checkout page',
      run: async (ctx) => {
        const { section, setPath } = await build();

        ctx.expect(section.title, 'it supplies the heading the palette renders it under').toBe('Checkout');
        ctx.expect(section.appliesTo(), 'on the checkout page it applies').toBe(true);

        setPath('/pricing');
        ctx.expect(section.appliesTo(), 'anywhere else it does not').toBe(false);
      },
    },

    {
      name: '#234: the section carries every control the gear dropdown offered',
      run: async (ctx) => {
        const { select } = await build();

        for (const param of ['product', 'frequency', '_dev_trialEligible', '_dev_cardProvider', '_dev_recaptcha']) {
          ctx.expect(select(param), `the ported control for "${param}" is present`).toBeTruthy();
        }

        // The product list is the brand's own, not a hardcoded one.
        const products = select('product').children.map((option) => option.value);
        ctx.expect(products, 'products come from the payment config').toEqual(['premium', 'lifetime']);

        // The provider override is the reason this section exists as more than the
        // decline toggle — state.js resolves a card payment through exactly this.
        const providers = select('_dev_cardProvider').children.map((option) => option.value);
        ctx.expect(providers, 'auto plus every provider state.js can force').toEqual(['', 'test', 'stripe', 'chargebee']);
      },
    },

    {
      name: '#234: the provider override applies by navigating with the param set',
      run: async (ctx) => {
        const { select, button, navigations } = await build();

        select('_dev_cardProvider').value = 'chargebee';
        await button('Apply & reload').click();

        ctx.expect(navigations.length, 'applying navigates once').toBe(1);

        const applied = new URLSearchParams(navigations[0]);
        ctx.expect(applied.get('_dev_cardProvider'), 'the override rides the URL — that is the only place modules/state.js reads it').toBe('chargebee');
        ctx.expect(applied.get('product'), 'and the product the page is on is carried over').toBe('premium');
      },
    },

    {
      name: '#234: the controls open showing what the page actually used',
      run: async (ctx) => {
        const { select } = await build({ search: '?product=lifetime&frequency=monthly&_dev_cardProvider=stripe' });

        ctx.expect(select('product').value, 'the product from the URL').toBe('lifetime');
        ctx.expect(select('frequency').value, 'the frequency from the URL').toBe('monthly');
        ctx.expect(select('_dev_cardProvider').value, 'the forced provider from the URL').toBe('stripe');
        ctx.expect(select('_dev_trialEligible').value, 'an unset param shows its default option').toBe('');
      },
    },

    {
      name: '#226: the decline toggle rides with the section, and applies as `_dev_decline`',
      run: async (ctx) => {
        const { checkbox, button, navigations } = await build();

        const decline = checkbox('omega-devbar-decline');
        ctx.expect(decline, 'the toggle is part of the checkout section now, not a palette built-in').toBeTruthy();
        ctx.expect(decline.checked, 'nothing is armed until you ask for it').toBe(false);

        decline.checked = true;
        await button('Apply & reload').click();

        const applied = new URLSearchParams(navigations[0]);
        ctx.expect(applied.get('_dev_decline'), 'the arm rides the URL, like every other checkout control').toBe('true');
        ctx.expect(applied.get('product'), 'and the rest of the panel applies alongside it').toBe('premium');
      },
    },

    {
      name: '#226: the toggle opens showing the arm the page is actually running with',
      run: async (ctx) => {
        const { checkbox } = await build({ search: '?product=premium&_dev_decline=true' });

        ctx.expect(checkbox('omega-devbar-decline').checked, 'the param the intent POST reads shows as armed').toBe(true);
      },
    },

    {
      name: '#226: an unarmed toggle applies no param at all',
      run: async (ctx) => {
        // The arm persists until it is applied away, so an unchecked box has to
        // REMOVE the param — never write `_dev_decline=false`, which the intent POST
        // would read as an arm anyway.
        const { checkbox, button, navigations } = await build({ search: '?product=premium&_dev_decline=true' });

        checkbox('omega-devbar-decline').checked = false;
        await button('Apply & reload').click();

        const applied = new URLSearchParams(navigations[0]);
        ctx.expect(applied.has('_dev_decline'), 'unchecking disarms by dropping the param').toBe(false);
      },
    },

    {
      name: '#234: an unset control is left out of the applied URL entirely',
      run: async (ctx) => {
        const { button, navigations } = await build({ search: '?product=premium' });

        await button('Apply & reload').click();

        const applied = new URLSearchParams(navigations[0]);
        ctx.expect(applied.has('_dev_cardProvider'), 'auto means no param, not an empty one').toBe(false);
        ctx.expect(applied.has('_dev_trialEligible'), 'and the API answer is left alone').toBe(false);
        ctx.expect(applied.get('frequency'), 'the frequency select has no empty option — it always applies').toBe('annually');
      },
    },
  ],
});
