/**
 * The change-plan MODAL (`core/js/pages/dashboard/account/sections/
 * billing.js`) — what the switcher renders and what it refuses to offer
 * ([#236](https://github.com/Omega-JS-Stack/omega/issues/236)).
 *
 * Round 2 is the redesign: ONE cadence toggle at the top, ONE card per plan,
 * the card's price following the toggle. The promises, all of them things a
 * user can be misled by:
 *  - the toggle opens on the cadence the account is actually billed at, and
 *    tags the annual side with the saving the catalog really offers;
 *  - flipping it re-prices every card (the card is the plan, not the plan ×
 *    cadence row the first cut shipped);
 *  - each card carries its headline features in the PRICING PAGE's own
 *    presentation — green check, the value from the catalog, the definition on
 *    hover — read from the SAME `payment.products` catalog (no second source
 *    of plan copy, no second idiom for showing it);
 *  - the plan the account is on renders greyed out and locked rather than
 *    disappearing, including when the subscription records no frequency — the
 *    case that let a Studio → Studio no-op through to the backend — while the
 *    same product at ANOTHER cadence stays selectable, because a cadence
 *    switch is a real switch;
 *  - a brand with nothing else to offer SAYS so, instead of leaving one greyed
 *    card standing on its own;
 *  - every radio is named by its own label and described by its bullets — the
 *    locked current plan included, and marked with text rather than colour.
 *
 * Same harness as billing-actions.test.js: the REAL module through esbuild
 * behind its two bundler aliases, over a document that answers only the ids the
 * plan switcher wires. The modal's `show.bs.modal` handler is invoked exactly as
 * Bootstrap would, and the assertion is the HTML it wrote.
 */
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');
const sass = require('sass');
const { resolveSubscription } = require('@omega.js/account');

const CORE_DIR = path.join(__dirname, '..', 'core');
const BILLING_ENTRY = path.join(CORE_DIR, 'js', 'pages', 'dashboard', 'account', 'sections', 'billing.js');
const ACCOUNT_STYLES = path.join(CORE_DIR, 'css', 'pages', 'dashboard', 'account', 'index.scss');

const BUNDLE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-billing-switcher-'));
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

// The FEATURES CATALOG (#647): every feature DEFINED once — name, icon,
// definition, and a `usage` block on the counted ones — in the order every
// surface renders it.
const FEATURE_CATALOG = {
  requests: { name: 'API requests', definition: 'Calls you can make to the API each month.', usage: {} },
  seats: { name: 'Team seats', usage: { pace: false } },
  support: { name: 'Priority support' },
  history: { name: 'History', usage: { pace: false } },
  exports: { name: 'Scheduled exports' },
  sso: { name: 'Single sign-on' },
  domain: { name: 'Custom domain' },
};

// A catalog shaped exactly like `payment.products`: each product names ONLY its
// value — a number on a counted feature (-1 unlimited), true/a string on a perk.
// Premium names FIVE features on purpose — the switcher shows four.
const PAYMENT_CONFIG = {
  currency: 'USD',
  products: [
    { id: 'basic', name: 'Basic', type: 'subscription', prices: {} },
    {
      id: 'premium',
      name: 'Premium',
      type: 'subscription',
      prices: { monthly: 10, annually: 100 },
      features: { requests: 1000, seats: 3, support: true, history: -1, exports: true },
    },
    {
      id: 'pro',
      name: 'Pro',
      type: 'subscription',
      prices: { monthly: 25, annually: 250 },
      features: { requests: -1 },
    },
    { id: 'credits', name: 'Credits', type: 'one-time', prices: { once: 5 } },
  ],
};

const HOUR_FROM_NOW = Math.floor(Date.now() / 1000) + 3600;

/** A paid subscription in whatever state the case needs. */
function paidAccount(subscription) {
  return {
    subscription: {
      product: { id: 'premium', name: 'Premium' },
      status: 'active',
      payment: { frequency: 'monthly', price: 10, provider: 'stripe' },
      expires: { timestampUNIX: HOUR_FROM_NOW },
      ...subscription,
    },
  };
}

/**
 * The one element shape the plan switcher touches. Writing innerHTML mints one
 * stand-in node per tooltip trigger in the markup just written, with a stable
 * identity — so the initialize and dispose passes see the SAME nodes a browser
 * would, and a leak across renders is countable. It also mints one stand-in
 * RADIO per input in that markup, which is what a programmatic pick (the
 * pricing page's preselect) reaches for through `querySelectorAll`.
 */
function makeElement() {
  let html = '';

  const element = {
    disabled: false,
    listeners: {},
    classes: new Set(),
    triggers: [],
    radios: [],
    get innerHTML() {
      return html;
    },
    set innerHTML(value) {
      html = value;
      element.triggers = (value.match(/data-bs-toggle="tooltip"/g) || []).map(() => ({}));
      element.radios = parseRadios(value, element);
      element.onWrite?.();
    },
    classList: {
      add: (name) => element.classes.add(name),
      remove: (name) => element.classes.delete(name),
      contains: (name) => element.classes.has(name),
    },
    addEventListener(event, handler) {
      (this.listeners[event] ||= []).push(handler);
    },
    querySelector: () => null,
    // The tooltip initializer scans the container it was handed; the preselect
    // scans it for radios.
    querySelectorAll: (selector) => {
      if (selector === '[data-bs-toggle="tooltip"]') return element.triggers;
      if (selector.includes('input')) return element.radios;
      return [];
    },
  };

  return element;
}

/**
 * The radios of one just-rendered container, as the DOM would hand them back:
 * checked-ness, disabled-ness and the cadence each one submits, and a
 * dispatchEvent that reaches the container's own listeners the way a bubbled
 * change does.
 *
 * @param {string} html - the markup just written
 * @param {object} element - the container that wrote it
 * @returns {Array<object>} one stand-in per input
 */
function parseRadios(html, element) {
  return html.split('<input').slice(1).map((block) => {
    let checked = /^[^>]*\schecked/.test(block);

    const radio = {
      value: /value="([^"]+)"/.exec(block)?.[1],
      dataset: { frequency: /data-frequency="([^"]+)"/.exec(block)?.[1] },
      disabled: /^[^>]*\sdisabled/.test(block),
      get checked() {
        return checked;
      },
      // A radio GROUP is exclusive: checking one clears the rest, which is how
      // the picked cadence is readable at all after a programmatic pick.
      set checked(value) {
        checked = value;
        if (!value) return;
        (element.radios || []).forEach((other) => {
          if (other !== radio) other.checked = false;
        });
      },
      dispatchEvent: () => {
        element.onRadioChange?.(radio);
        (element.listeners.change || []).forEach((handler) => handler({ target: radio }));
      },
    };

    return radio;
  });
}

/**
 * Bootstrap's tooltip and modal, as far as this module uses them: one live
 * tooltip instance per element retired by dispose() (`live` is the leak
 * counter), and a modal whose show() fires `show.bs.modal` first — the event
 * that renders the picker — exactly as Bootstrap's own does.
 * @returns {{ Tooltip: Function, Modal: Function, live: Map, shown: Array }}
 */
function makeBootstrapStub() {
  const live = new Map();
  const shown = [];

  class Tooltip {
    constructor($el) {
      this.$el = $el;
      live.set($el, this);
    }

    static getInstance($el) {
      return live.get($el) || null;
    }

    dispose() {
      live.delete(this.$el);
    }
  }

  class Modal {
    constructor($el) {
      this.$el = $el;
    }

    static getOrCreateInstance($el) {
      return new Modal($el);
    }

    static getInstance($el) {
      return new Modal($el);
    }

    show() {
      shown.push(this.$el);
      (this.$el.listeners['show.bs.modal'] || []).forEach((handler) => handler());
    }

    hide() {}
  }

  return { Tooltip, Modal, live, shown };
}

/** The minimum client the section reaches for, plus the motion scans it asks for. */
function makeClient() {
  const motionScans = [];

  return {
    motionScans,
    // The features catalog rides the client config, beside payment (#647)
    config: { features: FEATURE_CATALOG },
    // The web layer's programmatic hook into the shared motion engine
    // (`core/js/core/motion.js` registers it) — the modal hands it the freshly
    // rendered toggle so the gliding thumb is adopted.
    library: () => ({ motion: { scan: ($el) => motionScans.push($el) } }),
    auth: () => ({ resolveSubscription: (account) => resolveSubscription(account) }),
    bindings: () => ({ update: () => {} }),
    utilities: () => ({
      showNotification: () => {},
      escapeHTML: (value) => value,
    }),
    request: async () => ({}),
  };
}

/** The catalog of a brand that sells exactly one plan at exactly one cadence. */
const SINGLE_PLAN_CONFIG = {
  currency: 'USD',
  products: [
    { id: 'basic', name: 'Basic', type: 'subscription', prices: {} },
    { id: 'premium', name: 'Premium', type: 'subscription', prices: { monthly: 10 } },
  ],
};

/**
 * A click landing on one part of a card, delivered the way the browser
 * delivers it: the target knows its ancestors, and the card's radio is the
 * card's previous sibling.
 *
 * @param {object} card - the parsed card being clicked
 * @param {string} area - head | features | tooltip | padding
 * @param {object} radio - the stand-in radio for that card
 * @returns {object} the event target
 */
function clickTarget(card, area, radio) {
  const $card = { selectors: ['.omega-plan-card'], previousElementSibling: radio, parentElement: null };
  const $head = { selectors: ['label', '.omega-plan-card__head'], parentElement: $card };
  const $list = { selectors: ['ul', '.omega-plan-card__features'], parentElement: $card };
  const $item = { selectors: ['li'], parentElement: $list };
  const $tip = { selectors: ['[data-bs-toggle="tooltip"]', 'span'], parentElement: $item };

  const closest = (node, selector) => {
    for (let $node = node; $node; $node = $node.parentElement) {
      if ($node.selectors.includes(selector)) return $node;
    }
    return null;
  };

  const target = { head: $head, features: $item, tooltip: $tip, padding: $card }[area];
  for (const $node of [$card, $head, $list, $item, $tip]) {
    $node.closest = (selector) => closest($node, selector);
  }

  return target;
}

/**
 * The billing page's own window: the URL it was opened at, and the history
 * entry the section may rewrite over it.
 *
 * @param {string} search - the query string the page was loaded with
 * @returns {object} the window stand-in, with `replaced` recording replaceState
 */
function makeWindow(search) {
  const window = {
    replaced: null,
    location: { pathname: '/dashboard/account', search: search, hash: '#billing' },
    history: {
      replaceState: (state, title, url) => {
        window.replaced = url;
        const [pathname, query] = url.split('?');
        window.location.pathname = pathname.split('#')[0];
        window.location.search = query ? `?${query.split('#')[0]}` : '';
      },
    },
  };

  return window;
}

/**
 * Open the modal on `account` and hand back what it rendered, plus the handles
 * that flip the cadence toggle and click a card the way a user does.
 *
 * With `options.search`, the modal is NOT opened by hand: the page is loaded at
 * that URL and the section is shown, which is the pricing page's arrival path
 * ([#236] QA round 3) — whether a modal opened at all is then part of the
 * answer.
 *
 * @param {object} account - the signed-in account
 * @param {object} [config] - the payment catalog to render from
 * @param {object} [options] - { search } to arrive from a pricing-page link
 * @returns {Promise<object>} { cadence, cards, html, confirmDisabled, selection,
 *   liveTooltips, cadenceHidden, modalsShown, url, flip(), clickCard() }
 */
async function openSwitcher(account, config, options = {}) {
  await bundleOnce();

  const elements = {
    'change-plan-modal': makeElement(),
    'change-plan-cadence': makeElement(),
    'change-plan-options': makeElement(),
    'change-plan-confirm-btn': makeElement(),
  };

  // The one radio the document reports as checked — the section reads the
  // pick back through `input[name="change_plan_option"]:checked`.
  let $checked = null;

  // A re-render replaces every radio, so the browser's `:checked` query finds
  // nothing until the next pick — the enabled Confirm goes with them.
  elements['change-plan-options'].onWrite = () => { $checked = null; };
  elements['change-plan-options'].onRadioChange = (radio) => { $checked = radio.checked ? radio : $checked; };

  globalThis.document = {
    getElementById: (id) => elements[id] || null,
    querySelector: (selector) => (selector.includes(':checked') ? $checked : null),
    querySelectorAll: () => [],
    addEventListener: () => {},
  };
  const window = makeWindow(options.search || '');
  globalThis.window = window;
  const client = makeClient();
  globalThis.__omegaClient = client;
  const bootstrapStub = makeBootstrapStub();
  globalThis.bootstrap = bootstrapStub;

  // require.resolve, not BUNDLE: the cache is keyed by the REAL path, and
  // macOS's tmpdir is a symlink (/var → /private/var).
  delete require.cache[require.resolve(BUNDLE)];
  const billing = require(BUNDLE);

  await billing.init();
  await billing.loadData(account, config || PAYMENT_CONFIG);

  if ('search' in options) {
    // The account page hands the billing tab its onShow the moment the section
    // stops being `d-none` — the only moment a modal can open at all.
    billing.onShow();
  } else {
    // What Bootstrap does when the Change button opens the modal
    elements['change-plan-modal'].listeners['show.bs.modal'].forEach((handler) => handler());
  }

  // One stand-in radio per rendered card, keyed the way a render keys them:
  // a cadence flip re-prices every card, so it mints a fresh set.
  const radios = new Map();

  /** The stand-in radio of one card: what the click handler checks and fires. */
  function makeRadio(card) {
    const key = `${card.productId}/${card.frequency}`;
    if (radios.has(key)) {
      return radios.get(key);
    }

    const radio = {
      disabled: card.disabled,
      value: card.productId,
      dataset: { frequency: card.frequency },
      checked: false,
      dispatchEvent: () => {
        if (radio.checked) $checked = radio;
        (elements['change-plan-options'].listeners.change || []).forEach((handler) => handler());
      },
    };

    radios.set(key, radio);
    return radio;
  }

  const view = {
    /** Pick a cadence segment, exactly as a click on it fires. */
    flip(frequency) {
      // The cards are rebuilt, so the radio that held the pick is gone with
      // them — a browser's `:checked` query finds nothing after this.
      $checked = null;
      elements['change-plan-cadence'].listeners.change.forEach((handler) => handler({ target: { value: frequency } }));
      return read();
    },

    /** Click one part of one plan's card. */
    clickCard(productId, area) {
      const card = find(view.cards, productId);
      const target = clickTarget(card, area, makeRadio(card));
      elements['change-plan-options'].listeners.click.forEach((handler) => handler({ target: target }));
      return read();
    },
  };

  function read() {
    view.cadenceHtml = elements['change-plan-cadence'].innerHTML;
    view.cadence = parseCadence(view.cadenceHtml);
    view.cadenceHidden = elements['change-plan-cadence'].classList.contains('d-none');
    view.html = elements['change-plan-options'].innerHTML;
    view.cards = parseCards(view.html);
    view.confirmDisabled = elements['change-plan-confirm-btn'].disabled;
    view.selection = $checked ? { productId: $checked.value, frequency: $checked.dataset.frequency } : null;
    view.liveTooltips = bootstrapStub.live.size;
    // The segment actually checked right now — a programmatic pick moves the
    // PROPERTY, and the toggle's markup (written once per open) keeps saying
    // whatever it was rendered with.
    view.cadencePicked = elements['change-plan-cadence'].radios.find((radio) => radio.checked)?.value || null;
    view.modalsShown = bootstrapStub.shown.length;
    view.segmentedScans = client.motionScans.map(($el) => $el.innerHTML);
    view.url = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    return view;
  }

  return read();
}

/** Visible text of a markup fragment (the one entity the section writes). */
function text(html) {
  return (html || '').replace(/<[^>]*>/g, ' ').replace(/&mdash;/g, '—').replace(/\s+/g, ' ').trim();
}

/** Read the rendered cadence toggle back as data. */
function parseCadence(html) {
  return {
    present: html.includes('omega-billing-toggle'),
    groupLabel: /aria-label="([^"]+)"/.exec(html)?.[1] || null,
    segments: html.split('<input').slice(1).map((block) => ({
      frequency: /value="([^"]+)"/.exec(block)?.[1],
      checked: /^[^>]*\schecked/.test(block),
      inputId: /id="([^"]+)"/.exec(block)?.[1],
      labelFor: /<label[^>]*\sfor="([^"]+)"/.exec(block)?.[1],
      label: text(/<label[^>]*>([\s\S]*?)<\/label>/.exec(block)?.[1]),
    })),
  };
}

/** Read the rendered plan cards back as data. */
function parseCards(html) {
  return html.split('<div class="omega-plan-option"').slice(1).map((block) => ({
    productId: /value="([^"]+)"/.exec(block)?.[1],
    frequency: /data-frequency="([^"]+)"/.exec(block)?.[1],
    disabled: /<input[^>]*\sdisabled/.test(block),
    badged: block.includes('Current plan'),
    greyed: block.includes('omega-plan-card--current'),
    labelFor: /<label[^>]*\sfor="([^"]+)"/.exec(block)?.[1],
    inputId: /<input[^>]*\sid="([^"]+)"/.exec(block)?.[1],
    describedBy: /aria-describedby="([^"]+)"/.exec(block)?.[1] || null,
    featuresListId: /<ul[^>]*\sid="([^"]+)"/.exec(block)?.[1] || null,
    price: text(/omega-plan-card__price">([\s\S]*?)<\/label>/.exec(block)?.[1]),
    checks: (block.match(/fa-check/g) || []).length,
    // The bullet's own words, with the screen-reader copy of the definition
    // lifted out (it is asserted on its own below)
    features: [...block.matchAll(/<li>([\s\S]*?)<\/li>/g)]
      .map((match) => text(match[1].replace(/<span class="visually-hidden">[\s\S]*?<\/span>/g, ''))),
    // [name, definition] for every feature carrying a hover explanation
    hovers: [...block.matchAll(/data-bs-title="([^"]*)"[^>]*>([^<]+)<\/span>/g)]
      .map((match) => [match[2], match[1]]),
    // The same explanations, spelled out for assistive tech
    spokenDefinitions: [...block.matchAll(/<span class="visually-hidden">([\s\S]*?)<\/span>/g)]
      .map((match) => text(match[1])),
  }));
}

function find(cards, productId) {
  return cards.find((card) => card.productId === productId);
}

test('plan switcher: one card per plan, priced at the cadence the toggle is on', async () => {
  const view = await openSwitcher(paidAccount({}));

  assert.deepStrictEqual(
    view.cards.map((card) => card.productId),
    ['premium', 'pro'],
    'One card per subscription plan — the one-time product and basic are not switch targets',
  );

  assert.equal(find(view.cards, 'premium').price, '$10.00 / month', 'The card is priced at the toggled cadence');
  assert.equal(find(view.cards, 'pro').price, '$25.00 / month');

  // Flipping the toggle re-prices every card in place — the plan × cadence
  // rows the first cut shipped are gone.
  const annual = view.flip('annually');

  assert.deepStrictEqual(annual.cards.map((card) => card.productId), ['premium', 'pro'], 'Still one card per plan');
  assert.equal(find(annual.cards, 'premium').price, '$100.00 / year', 'Premium re-prices to its annual price');
  assert.equal(find(annual.cards, 'pro').price, '$250.00 / year', 'Pro re-prices to its annual price');
  assert.equal(find(annual.cards, 'premium').frequency, 'annually', 'The card submits the toggled cadence');
  assert.equal(annual.confirmDisabled, true, 'Re-pricing clears the pick, so there is nothing to confirm');
});

test('plan switcher: the toggle opens on the account\'s own cadence and tags the real annual saving', async () => {
  const monthly = await openSwitcher(paidAccount({}));

  assert.equal(monthly.cadence.present, true, 'A brand selling both cadences gets the toggle');
  assert.equal(monthly.cadenceHidden, false, 'and its container is shown');
  assert.deepStrictEqual(
    monthly.cadence.segments.map((segment) => segment.frequency),
    ['monthly', 'annually'],
    'Monthly then Annually, the cadences the catalog actually sells',
  );
  assert.deepStrictEqual(
    monthly.cadence.segments.map((segment) => segment.checked),
    [true, false],
    'A monthly subscriber opens on Monthly',
  );

  // $100/yr against 12 × $10 is a real 17% — computed from the catalog, never
  // a decorative number.
  assert.equal(monthly.cadence.segments[1].label, 'Annually Save 17%', 'The annual segment carries the saving it really offers');

  const annualAccount = await openSwitcher(paidAccount({ payment: { frequency: 'annually', price: 100 } }));
  assert.deepStrictEqual(
    annualAccount.cadence.segments.map((segment) => segment.checked),
    [false, true],
    'An annual subscriber opens on Annually',
  );

  // Annual pricing that does not beat twelve months of monthly earns no tag.
  const noDiscount = await openSwitcher(paidAccount({}), {
    currency: 'USD',
    products: [{ id: 'premium', name: 'Premium', type: 'subscription', prices: { monthly: 10, annually: 120 } }],
  });
  assert.equal(noDiscount.cadence.segments[1].label, 'Annually', 'No real saving, no Save tag');
});

test('plan switcher: the current plan is greyed out and locked at its own cadence, selectable at the other', async () => {
  const view = await openSwitcher(paidAccount({}));

  const current = find(view.cards, 'premium');
  assert.equal(current.disabled, true, 'The plan the account is on must not be selectable');
  assert.equal(current.badged, true, 'The current plan carries the "Current plan" badge');
  assert.equal(current.greyed, true, 'and carries the modifier that greys it out, not just another row');

  assert.equal(find(view.cards, 'pro').disabled, false, 'Another product stays selectable');

  // Cadence switching is a supported move — the guard keys on product AND
  // frequency, exactly like the backend's.
  const annual = view.flip('annually');
  assert.equal(find(annual.cards, 'premium').disabled, false, 'The same product at another cadence stays selectable');
  assert.equal(find(annual.cards, 'premium').badged, false, 'and is not the plan in force');
});

test('plan switcher: an unrecorded frequency locks the current product at BOTH cadences', async () => {
  // The repro: a subscription whose `payment.frequency` never got recorded made
  // the old exact-pair filter miss, and the modal offered Studio → Studio. With
  // nothing to match on, the product id alone decides.
  const view = await openSwitcher(paidAccount({ payment: { price: 10, provider: 'test' } }));

  assert.equal(view.cadence.segments[0].checked, true, 'With no cadence on record the toggle opens on Monthly');
  assert.equal(find(view.cards, 'premium').disabled, true, 'No recorded frequency: the monthly card is conservative');
  assert.equal(find(view.cards, 'premium').badged, true, 'and reads as the current plan');
  assert.equal(find(view.cards, 'pro').disabled, false, 'Another product is unaffected');

  const annual = view.flip('annually');
  assert.equal(find(annual.cards, 'premium').disabled, true, 'No recorded frequency: the annual card is conservative too');
  assert.equal(find(annual.cards, 'premium').badged, true, 'Both cadences of the current product read as the current plan');
  assert.equal(find(annual.cards, 'pro').disabled, false, 'Another product is unaffected at either cadence');
});

test('plan switcher: features render the pricing page\'s way — green check, catalog value, hover explanation', async () => {
  const view = await openSwitcher(paidAccount({}));

  const premium = find(view.cards, 'premium');

  // The catalog is the only home of this copy: values resolve from the feature
  // itself or the product's limits, -1 renders as unlimited, and the list stops
  // at four bullets even though Premium declares five.
  assert.deepStrictEqual(
    premium.features,
    ['1,000 API requests', '3 Team seats', 'Priority support', 'Unlimited History'],
    'Premium shows its first four features, values resolved',
  );
  assert.equal(premium.checks, premium.features.length, 'Every bullet carries the pricing card\'s green check');

  // The pricing page's mechanism, not a second one: the feature NAME is the
  // dotted-underlined hover target and the definition is its tooltip title.
  assert.deepStrictEqual(
    premium.hovers,
    [['API requests', 'Calls you can make to the API each month.']],
    'The feature with a definition is hoverable; the ones without stay plain text',
  );
  assert.match(view.html, /text-decoration-underline text-decoration-dotted cursor-help/, 'The hover target is the pricing page\'s dotted-underline affordance');

  // Hover text is hover text — a screen reader gets it in words too.
  assert.deepStrictEqual(
    premium.spokenDefinitions,
    ['— Calls you can make to the API each month.'],
    'The explanation is programmatically associated, not hover-only',
  );

  // A definition authored on ONE product's copy of a feature explains every
  // other copy, exactly as the pricing composer backfills them.
  const pro = find(view.cards, 'pro');
  assert.deepStrictEqual(pro.features, ['Unlimited API requests'], 'Pro reads its unlimited request limit off the catalog');
  assert.deepStrictEqual(
    pro.hovers,
    [['API requests', 'Calls you can make to the API each month.']],
    'Pro\'s copy of the feature inherits the definition authored on Premium',
  );
});

test('plan switcher: the whole card picks it — minus the parts that own their own clicks', async () => {
  // The card head is a thin strip; the feature list and the padding around it
  // are most of the card, and clicking them did nothing at all (worst on
  // touch, where the head is the hardest part to hit).
  const view = await openSwitcher(paidAccount({}));

  // A feature's hover explanation belongs to the tooltip — a click there is
  // someone reading, not choosing.
  let after = view.clickCard('pro', 'tooltip');
  assert.equal(after.selection, null, 'Clicking a feature explanation must not pick the card');
  assert.equal(after.confirmDisabled, true, 'and must not arm Confirm');

  // The label is the browser's own job; picking it up again would fire a
  // second change event for one click.
  after = view.clickCard('pro', 'head');
  assert.equal(after.selection, null, 'The label click stays the browser\'s');

  after = view.clickCard('pro', 'features');
  assert.deepStrictEqual(after.selection, { productId: 'pro', frequency: 'monthly' }, 'Clicking the feature list picks the card');
  assert.equal(after.confirmDisabled, false, 'and arms Confirm, exactly as the radio would');

  // The plan in force is locked — its card is not a target either.
  const locked = view.clickCard('premium', 'features');
  assert.deepStrictEqual(locked.selection, { productId: 'pro', frequency: 'monthly' }, 'The locked current plan cannot steal the pick');
});

test('plan switcher: a feature value only prints when it says something', async () => {
  // `true` means "included" — which the check already says — and `''` says
  // nothing either; both used to print themselves ("false Priority support").
  // `false` is not a promise at all now (#647): the tier omits the row.
  const view = await openSwitcher(paidAccount({}), {
    currency: 'USD',
    products: [
      { id: 'basic', name: 'Basic', type: 'subscription', prices: {} },
      {
        id: 'premium',
        name: 'Premium',
        type: 'subscription',
        prices: { monthly: 10, annually: 100 },
        features: { seats: 0, support: true, sso: false, domain: '' },
      },
    ],
  });

  assert.deepStrictEqual(
    find(view.cards, 'premium').features,
    ['0 Team seats', 'Priority support', 'Custom domain'],
    'a number prints (zero included), true/empty print nothing of themselves, false omits the row entirely',
  );
});

test('plan switcher: reopening and re-pricing retire the tooltips they replace', async () => {
  // Bootstrap keeps one instance per element and never learns the element is
  // gone: without a dispose pass, every cadence flip left a full set of
  // tooltips bound to nodes that no longer exist.
  const view = await openSwitcher(paidAccount({}));
  const opened = view.liveTooltips;

  assert.ok(opened > 0, 'the bullets really do carry tooltips');
  assert.equal(view.flip('annually').liveTooltips, opened, 'a cadence flip replaces the set, it does not add one');
  assert.equal(view.flip('monthly').liveTooltips, opened, 'and again');
});

test('plan switcher: a one-plan brand says why nothing is pickable, and has no cadence to toggle', async () => {
  // A brand selling a single plan at a single cadence renders one locked card.
  // Alone, that is a mystery — the sentence is the explanation, and a toggle
  // with one side is not a toggle.
  const view = await openSwitcher(paidAccount({}), SINGLE_PLAN_CONFIG);

  assert.equal(view.cards.length, 1, 'The one plan the brand sells still renders');
  assert.equal(view.cards[0].disabled, true, 'It is the current plan, so it is not selectable');
  assert.match(view.html, /no other plans to switch to/i, 'The list carries the sentence that explains the dead end');
  assert.equal(view.cadence.present, false, 'One cadence on sale: no toggle');
  assert.equal(view.cadenceHidden, true, 'and the empty container is hidden, so it holds no gap either');
});

test('plan switcher: every card is named and described, the locked one included', async () => {
  // Accessibility floor: the radio's name comes from its own label (the current
  // plan's included), and the feature bullets — which sit outside the label,
  // because a list is not phrasing content — are wired with aria-describedby.
  const view = await openSwitcher(paidAccount({}));

  for (const card of view.cards) {
    assert.equal(card.labelFor, card.inputId, `${card.productId}: the label must name its own radio`);
    assert.equal(card.describedBy, card.featuresListId, `${card.productId}: the radio must point at its feature list`);
    assert.ok(card.features.length > 0, `${card.productId}: the description has content`);
  }

  const current = find(view.cards, 'premium');
  assert.equal(current.disabled, true, 'The named-and-described rule covers the locked current plan too');
  assert.equal(current.badged, true, 'The current plan is marked with TEXT, never colour alone');

  // The toggle is a labelled group of real radios, each named by its own label.
  assert.equal(view.cadence.groupLabel, 'Billing cadence', 'The cadence control names itself');
  for (const segment of view.cadence.segments) {
    assert.equal(segment.labelFor, segment.inputId, `${segment.frequency}: the segment's label names its own radio`);
  }
});

test('plan switcher: the cadence toggle is the pricing page\'s GLIDING control, adopted the moment it is rendered', async () => {
  // "Use the pricing page's toggle" includes the part that makes it feel made:
  // the thumb that glides between segments. That is the shared motion engine,
  // driven by `data-omega-segmented` — which the modal's markup omitted, so it
  // rendered a static control wearing a thumb-ready skin. The engine's own
  // MutationObserver would find an injected node eventually; the modal renders
  // and opens in the same tick, so the section hands it the container.
  const view = await openSwitcher(paidAccount({}));

  assert.match(view.cadenceHtml, /data-omega-segmented/, 'the toggle declares itself to the motion engine');
  assert.equal(view.segmentedScans.length, 1, 'and the section asks the engine to adopt it, once per render');
  assert.match(view.segmentedScans[0], /omega-billing-toggle/, 'the node handed over is the freshly rendered toggle');

  // A brand with one cadence renders no toggle at all — and asks for nothing.
  const single = await openSwitcher(paidAccount({}), SINGLE_PLAN_CONFIG);
  assert.equal(single.segmentedScans.length, 0, 'no toggle, no adoption');
});

test('plan switcher: a pricing-page link opens the modal on the plan it named, armed to confirm', async () => {
  // The pricing page's "Switch to this plan" button used to send a subscriber
  // through CHECKOUT — a second purchase for a move that is a proration. It
  // now lands here naming the plan, and the trip ends where it started: this
  // modal, on that plan, at that cadence, one Confirm away.
  const view = await openSwitcher(paidAccount({}), PAYMENT_CONFIG, { search: '?product=pro&frequency=annually' });

  assert.equal(view.modalsShown, 1, 'the modal opens on arrival — no hunting for the Change button');
  assert.equal(view.cadencePicked, 'annually', 'the toggle is set to the cadence the link asked for, not the account\'s own');
  assert.equal(find(view.cards, 'pro').price, '$250.00 / year', 'so every card is priced at that cadence');
  assert.deepStrictEqual(
    view.selection,
    { productId: 'pro', frequency: 'annually' },
    'and the plan the link named is picked, by the same mechanism a card click uses',
  );
  assert.equal(view.confirmDisabled, false, 'so Confirm is armed the moment the modal appears');
});

test('plan switcher: the plan-switch params are consumed once — a refresh reopens nothing', async () => {
  // Params that survive the visit reopen the modal on every refresh and on
  // every back — over a plan the user may have just declined.
  const view = await openSwitcher(paidAccount({}), PAYMENT_CONFIG, { search: '?product=pro&frequency=annually' });

  assert.equal(view.url, '/dashboard/account#billing', 'the request is struck from the URL, the billing tab is not');
  assert.equal(window.replaced, '/dashboard/account#billing', 'and it went through history.replaceState — no second navigation');

  // Anything else in the query belongs to somebody else and stays put.
  const shared = await openSwitcher(paidAccount({}), PAYMENT_CONFIG, { search: '?ref=email&product=pro&frequency=annually' });
  assert.equal(shared.url, '/dashboard/account?ref=email#billing', 'only the two params it consumed are removed');
});

test('plan switcher: no params, no modal — the billing page opens as itself', async () => {
  const view = await openSwitcher(paidAccount({}), PAYMENT_CONFIG, { search: '' });

  assert.equal(view.modalsShown, 0, 'a plain visit to the billing tab opens no modal');
  assert.equal(view.html, '', 'and renders no picker behind it');
  assert.equal(view.url, '/dashboard/account#billing', 'the URL is left alone');
});

test('plan switcher: a cancelling account lands on the billing tab plainly', async () => {
  // Change is hidden while a cancellation is scheduled — the backend refuses
  // the switch outright (`cancellation-pending`) — so a link that opened the
  // modal anyway would offer a move that cannot happen. Undo cancellation is
  // the button that state owns.
  const cancelling = paidAccount({ cancellation: { pending: true, date: { timestampUNIX: HOUR_FROM_NOW } } });
  const view = await openSwitcher(cancelling, PAYMENT_CONFIG, { search: '?product=pro&frequency=annually' });

  assert.equal(view.modalsShown, 0, 'the modal stays shut in the one state that cannot switch');
  assert.equal(view.url, '/dashboard/account#billing', 'and the request is still consumed, so a refresh changes nothing');
});

/** Every compiled rule whose selector mentions `needle`, as { selector, body }. */
function rulesFor(css, needle) {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((match) => ({ selector: match[1].trim(), body: match[2] }))
    .filter((rule) => rule.selector.includes(needle));
}

test('plan switcher: the current card reads DISABLED — a muted well, never the accent highlight', () => {
  // The accent said SELECTED, which is the one thing the plan in force is not:
  // it is the single card a click cannot reach. So it paints the neutral
  // tokens and fades its own content, and the accent stays with the cards that
  // still answer.
  const css = sass.compile(ACCOUNT_STYLES, { logger: { warn: () => {}, debug: () => {} } }).css;
  const rules = rulesFor(css, '.omega-plan-card--current');
  const card = rules.find((rule) => rule.selector.endsWith('.omega-plan-card--current'));

  assert.ok(card, 'the current card still has styles of its own');
  assert.match(card.body, /background:\s*var\(--omega-surface-2\)/, 'it sits in the muted well');
  assert.match(card.body, /border-color:\s*var\(--omega-line-strong\)/, 'edged by the neutral line, not the accent');
  assert.ok(
    rules.every((rule) => !rule.body.includes('--omega-accent')),
    'nothing accent-coloured survives on the card that cannot be picked',
  );

  // The fade is the second half of the disabled reading — and it stops short
  // of the badge, the one thing on the card that must stay crisp.
  const faded = rules.filter((rule) => /opacity:\s*0\./.test(rule.body));
  assert.ok(faded.length > 0, 'the current card dims its content');
  assert.ok(
    faded.every((rule) => !rule.selector.includes('__badge') && !rule.selector.includes('__head')),
    'the "Current plan" badge is excluded from the fade',
  );

  // The other cards are untouched: picked still rides ink, focus still rings
  // the accent.
  const checked = rulesFor(css, '.btn-check:checked + .omega-plan-card')[0];
  const focused = rulesFor(css, '.btn-check:focus-visible + .omega-plan-card')[0];

  assert.match(checked.body, /border-color:\s*var\(--omega-ink\)/, 'the card you picked still reads as picked');
  assert.match(focused.body, /outline:\s*2px solid var\(--omega-accent\)/, 'and the focus ring is still the accent');
});

test('plan switcher: the whole card is the pointer — except the one that cannot be picked', () => {
  // The click handler makes the WHOLE card selectable, but only the head
  // (a <label>) said so: the cursor stayed an arrow over the features and the
  // padding, which is most of the card's area. The pointer now covers the card
  // itself, and the current plan — the one card a click cannot reach — keeps
  // the default arrow.
  const css = sass.compile(ACCOUNT_STYLES, { logger: { warn: () => {}, debug: () => {} } }).css;

  const card = rulesFor(css, '.omega-plan-card').find((rule) => rule.selector.endsWith('.omega-plan-card'));
  assert.match(card.body, /cursor:\s*pointer/, 'the whole selectable card affords the click');

  const current = rulesFor(css, '.omega-plan-card--current').find((rule) => rule.selector.endsWith('.omega-plan-card--current'));
  assert.match(current.body, /cursor:\s*default/, 'the locked current plan is not a click target, and does not pretend to be');

  // A feature's hover explanation owns its own click, and its own cursor: the
  // bullets wear `cursor-help` (the pricing page's utility, universal to every
  // theme), which the card's pointer cannot take from them.
  const utilities = sass.compile(
    path.join(__dirname, '..', 'themes', 'bootstrap', 'overrides', '_cursor-utilities.scss'),
    { logger: { warn: () => {}, debug: () => {} } },
  ).css;
  assert.match(rulesFor(utilities, '.cursor-help')[0].body, /cursor:\s*help\s*!important/, 'the tooltip trigger keeps the help cursor');

  // `cursor` INHERITS, so the pointer covers the card's whole surface unless a
  // rule takes it back from a child. Nothing in this sheet may — the affordance
  // has to be gapless, and the one legitimate exception (the tooltip trigger)
  // lives in the shared utility above, not here.
  const takesTheCursorBack = rulesFor(css, 'cursor')
    .concat(rulesFor(css, '.omega-plan-card'))
    .filter((rule) => /cursor\s*:/.test(rule.body))
    .filter((rule) => !/\.omega-plan-card(--current)?$/.test(rule.selector));

  assert.deepStrictEqual(
    takesTheCursorBack.map((rule) => rule.selector),
    [],
    'no child of the plan card sets a cursor of its own — the card and its --current modifier are the only two rules',
  );
});

test('plan switcher: nothing floats over the card and eats the affordance', () => {
  // QA round 4 (Ian): a horizontal DEAD STRIP between the card head and the
  // feature list — pointer everywhere else, arrow there. Nothing in the account
  // sheet explains it (the test above pins that), because the culprit is not a
  // descendant at all: Bootstrap appends a shown tooltip to `document.body`
  // (tooltip.js — `container: false` resolves to the body), so it floats over
  // the card, inherits none of its cursor, and is fully hit-testable. Default
  // placement is `top`, which puts it exactly above the hovered feature bullet:
  // the strip. The same overlay swallowed the click that should have picked the
  // plan.
  //
  // A hover/focus tooltip is decoration and can hold nothing interactive, so it
  // is inert framework-wide — one home, every surface (the pricing page's cards
  // carry the same triggers).
  const css = sass.compile(
    path.join(__dirname, '..', 'core', 'css', 'core', '_utilities.scss'),
    { logger: { warn: () => {}, debug: () => {} } },
  ).css;

  const tooltip = rulesFor(css, '.tooltip').find((rule) => rule.selector === '.tooltip');

  assert.ok(tooltip, 'the framework says something about tooltips at all');
  assert.match(tooltip.body, /pointer-events:\s*none/, 'a tooltip is never a surface: it takes no pointer, so the card keeps its own');

  // Popovers CAN hold interactive content — the rule must not have reached them.
  assert.deepStrictEqual(rulesFor(css, '.popover').map((rule) => rule.selector), [], 'popovers keep their events');
});

// The packaged themes, all three, as the vocabulary guard names them.
const THEMES = ['classy', 'newsflash', 'neobrutalism'];

// One declaration only that theme's own toggle dressing carries — the classy
// FLOOR ships in every main bundle, so "a rule exists" proves nothing.
const TOGGLE_SKIN = {
  classy: /background:\s*var\(--omega-surface\)/,
  newsflash: /border:\s*var\(--nf-border\)/,
  neobrutalism: /background:\s*var\(--nb-surface\)/,
};

// Bootstrap's own segment neutraliser: it resets a `.btn-check`-paired label to
// its RESTING colours on hover, and every theme page sheet re-emits it after
// the main bundle. Any hover a theme paints on the toggle has to out-specify it.
const BOOTSTRAP_HOVER = '.btn-check + .btn:hover';

/**
 * The class-column of a selector's specificity — classes, attributes and
 * pseudo-classes. Enough for this comparison: every selector involved is plain
 * (no ids, no `:not()`, no elements).
 *
 * @param {string} selector - a compiled selector
 * @returns {number} how many class-column tokens it carries
 */
function classWeight(selector) {
  return (selector.match(/\.[\w-]+|\[[^\]]+\]|(?<!:):[\w-]+/g) || []).length;
}

test('plan switcher: the cadence toggle is skinned in the MAIN bundle — the modal wears what the pricing page wears', () => {
  // The modal builds the pricing page's own `omega-billing-toggle` markup, so
  // the two are the same control — but newsflash and neobrutalism dressed it
  // in their PRICING PAGE sheet, which the account page never loads, and the
  // modal rendered the undressed classy floor ([#236] QA round 3). The skin
  // belongs to the component, so it belongs to the main bundle: every surface
  // that renders the toggle loads that.
  for (const theme of THEMES) {
    const themeRoot = path.join(__dirname, '..', 'themes', theme);
    const compile = (entry) => sass.compile(entry, {
      loadPaths: [themeRoot],
      quietDeps: true,
      silenceDeprecations: ['import', 'global-builtin', 'color-functions', 'legacy-js-api'],
      logger: { warn: () => {}, debug: () => {} },
    }).css;

    const mainCss = compile(path.join(themeRoot, '_theme.scss'));
    const main = rulesFor(mainCss, '.omega-billing-toggle');
    const base = main.find((rule) => rule.selector.endsWith('.omega-billing-toggle'));

    assert.ok(base, `${theme}: the main bundle carries the toggle`);
    assert.match(
      main.filter((rule) => rule.selector.endsWith('.omega-billing-toggle')).at(-1).body,
      TOGGLE_SKIN[theme],
      `${theme}: the theme's OWN dressing lands in the main bundle, last — after the classy floor`,
    );

    // The hover tint has to survive the move. A page sheet re-emits Bootstrap
    // AFTER the main bundle, so the neutraliser below lands later than every
    // rule here: a toggle hover that only TIES it (the plain
    // `.omega-billing-toggle .btn:hover` this dressing shipped as) loses on
    // /pricing and the segments go dead under the pointer, while the account
    // modal — whose themes ship no page sheet — keeps the tint. Out-specifying
    // it is what makes the two surfaces behave the same.
    assert.ok(
      rulesFor(mainCss, BOOTSTRAP_HOVER).some((rule) => rule.selector === BOOTSTRAP_HOVER),
      `${theme}: Bootstrap's segment neutraliser is in the bundle — it is the rule to beat`,
    );

    for (const rule of main.filter((candidate) => candidate.selector.endsWith(':hover'))) {
      assert.ok(
        classWeight(rule.selector) > classWeight(BOOTSTRAP_HOVER),
        `${theme}: "${rule.selector}" must out-specify "${BOOTSTRAP_HOVER}", which loads after it on every page sheet`,
      );
    }

    // And nothing of it is left behind on the pricing page, where only that
    // page would have got it.
    const pageSheet = path.join(themeRoot, 'css', 'pages', 'pricing', 'index.scss');
    if (fs.existsSync(pageSheet)) {
      assert.deepStrictEqual(
        rulesFor(compile(pageSheet), '.omega-billing-toggle').map((rule) => rule.selector),
        [],
        `${theme}: no toggle rule may be page-scoped — the account page never loads that sheet`,
      );
    }
  }
});
