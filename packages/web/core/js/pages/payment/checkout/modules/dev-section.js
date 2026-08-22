// The checkout's dev palette section (#234) — everything the page's own gear
// dropdown used to offer, now registered into the palette so the checkout page
// carries no dev chrome of its own.
//
// DEVELOPMENT ONLY. Nothing but the `@dev-only` block in ../index.js imports
// this file, so a production build strips the import and this module never
// enters the bundle.
//
// Every control is a URL param, because that is the only way the page reads
// them — each is consumed ONCE at page init, before any of these controls
// exist:
//   product, frequency        → ../index.js (initializeCheckout)
//   _dev_preDelay             → ../index.js (artificial pre-delay)
//   _dev_trialEligible        → ../index.js (trial override)
//   _dev_cardProvider        → ./state.js  (resolveProvider)
//   _dev_recaptcha            → ../../../../libs/recaptcha.js
//   _dev_decline              → ./api.js    (the intent POST's simulate)
// So "apply" navigates with the params set rather than pretending it can
// change a decision the page already made. Session storage would not help:
// resolveProvider reads the URL, and only the URL.

import { getProducts } from '__main_assets__/js/libs/payment-config.js';

const CHECKOUT_PATH = '/payment/checkout';

// The param the checkout's intent call turns into `simulate: 'decline'`
// (./api.js). Presence is the arm, so it is applied as `=true` or not at all.
const DECLINE_PARAM = '_dev_decline';

// The fixed-option controls, in the order the gear dropdown showed them. An
// empty first value means "leave it to the page" and applies no param at all.
const CONTROLS = [
  {
    param: 'frequency',
    label: 'Frequency',
    options: [['annually', 'Annually'], ['monthly', 'Monthly'], ['weekly', 'Weekly'], ['daily', 'Daily']],
  },
  {
    // The slow-boot rehearsal (#342): the page sleeps this long before it
    // resolves the frequency, so the loading state is something you can look at
    // rather than a frame that flashes past.
    param: '_dev_preDelay',
    label: 'Pre-delay',
    options: [['', '(none)'], ['3000', '3s'], ['5000', '5s'], ['10000', '10s']],
  },
  {
    param: '_dev_trialEligible',
    label: 'Trial eligible',
    options: [['', '(use API)'], ['true', 'Force true'], ['false', 'Force false']],
  },
  {
    param: '_dev_cardProvider',
    label: 'Card provider',
    options: [['', '(auto)'], ['test', 'Test'], ['stripe', 'Stripe'], ['chargebee', 'Chargebee']],
  },
  {
    param: '_dev_recaptcha',
    label: 'reCAPTCHA',
    options: [['', '(normal)'], ['invalid', 'Send invalid token'], ['empty', 'Send empty token']],
  },
];

/**
 * The product control's options come from the brand's own payment config, so
 * the list is whatever this brand actually sells.
 * @returns {Array<[string, string]>}
 */
function productOptions() {
  return getProducts().map((product) => [product.id, `${product.name} (${product.type})`]);
}

/**
 * One labelled select. The label WRAPS the select, so the control is named
 * without needing an id to point at.
 */
function field(doc, { param, label, options }, value) {
  const wrap = doc.createElement('label');
  wrap.className = 'omega-devbar__field';

  const text = doc.createElement('span');
  text.className = 'omega-devbar__field-label';
  text.textContent = label;

  const select = doc.createElement('select');
  select.className = 'omega-devbar__select';
  select.setAttribute('data-dev-param', param);
  options.forEach(([optionValue, optionLabel]) => {
    const option = doc.createElement('option');
    option.value = optionValue;
    option.textContent = optionLabel;
    select.appendChild(option);
  });

  // Seeded explicitly rather than left to the browser's "first option" default,
  // so the panel always shows the value the page was actually built with.
  select.value = value;

  wrap.append(text, select);

  return { wrap, select };
}

/**
 * Arm the checkout to be declined by the provider, so the failure path is one
 * click away instead of a card number to remember. A checkbox rather than a
 * select because it is the one two-state control, but it applies with the rest:
 * checked writes the param, unchecked drops it, and the arm lasts until it is
 * applied away. It lived in the palette's built-ins until it followed the rest
 * of the checkout's controls onto the page it belongs to.
 */
function declineToggle(doc, armed) {
  const wrap = doc.createElement('label');
  wrap.className = 'omega-devbar__toggle';
  wrap.setAttribute('for', 'omega-devbar-decline');

  const input = doc.createElement('input');
  input.type = 'checkbox';
  input.id = 'omega-devbar-decline';
  input.checked = armed;

  const text = doc.createElement('span');
  text.textContent = 'Decline next checkout';

  wrap.append(input, text);

  return { wrap, input };
}

export const checkoutDevSection = {
  title: 'Checkout',

  appliesTo: () => window.location.pathname.startsWith(CHECKOUT_PATH),

  buildNode: (doc) => {
    const params = new URLSearchParams(window.location.search);
    const controls = [{ param: 'product', label: 'Product', options: productOptions() }, ...CONTROLS];

    const wrap = doc.createElement('div');
    wrap.className = 'omega-devbar__fields';

    const fields = controls.map((control) => {
      const seeded = params.get(control.param) ?? (control.options[0]?.[0] || '');
      const built = field(doc, control, seeded);
      wrap.appendChild(built.wrap);
      return { param: control.param, select: built.select };
    });

    const decline = declineToggle(doc, params.has(DECLINE_PARAM));
    wrap.appendChild(decline.wrap);

    const apply = doc.createElement('button');
    apply.type = 'button';
    apply.className = 'omega-devbar__btn';
    apply.textContent = 'Apply & reload';
    apply.addEventListener('click', () => {
      // A fresh query string of exactly the dev controls — the gear's behaviour
      // verbatim: an unset control applies no param.
      const next = new URLSearchParams();
      fields.forEach(({ param, select }) => {
        const value = (select.value || '').trim();
        if (value) {
          next.set(param, value);
        }
      });
      if (decline.input.checked) {
        next.set(DECLINE_PARAM, 'true');
      }
      window.location.search = next.toString();
    });

    wrap.appendChild(apply);

    return wrap;
  },
};
