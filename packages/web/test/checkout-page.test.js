/**
 * /payment/checkout — the classy redesign (round 18) restyles AROUND an
 * untouchable functional contract: the page JS
 * (core/js/pages/payment/checkout/) binds by id, name, and data attribute, so
 * the regression that matters is that every one of those hooks survives the
 * markup. The first test checks a hand-kept hook list (update it with the
 * JS); the second genuinely derives the binding inventory from the rendered
 * page and checks it against the state module, so a dropped binding fails.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const { buildWith, miniData, PKG } = require('./lib/build.js');

const build = () => buildWith(miniData, {}, 'checkout-page-test');

// Everything the checkout JS reaches for by selector (index.js + FormManager).
const JS_HOOKS = [
  'id="checkout-form"',
  'id="checkout-error-container"',
  'id="checkout-content"',
  'id="discount-code"',
  'id="apply-discount"',
  'data-action="apply-discount"',
  'id="switch-account"',
  'id="checkout-help-button"',
  'name="discount"',
  'data-form-state="initializing"',
];

const PAYMENT_METHODS = ['card', 'paypal', 'apple-pay', 'google-pay', 'crypto'];
const FREQUENCIES = ['annually', 'monthly', 'weekly', 'daily'];

test('contract: every JS selector the checkout page binds survives the redesign', async () => {
  const pages = await build();
  const checkout = pages.get('/payment/checkout');
  assert.ok(checkout, 'checkout page built');

  for (const hook of JS_HOOKS) {
    assert.ok(checkout.includes(hook), `JS hook present: ${hook}`);
  }

  for (const method of PAYMENT_METHODS) {
    assert.ok(checkout.includes(`data-payment-method="${method}"`), `payment button: ${method}`);
    assert.ok(checkout.includes(`data-action="pay-${method}"`), `payment action: ${method}`);
  }

  // The submit fallback (`#checkout-form button[data-payment-method]`) only
  // finds buttons that submit the form and start hidden.
  const buttons = checkout.match(/<button type="submit"[^>]*data-payment-method/g) || [];
  assert.equal(buttons.length, PAYMENT_METHODS.length * 2, 'desktop + mobile stacks both render every method as a submit button');

  for (const frequency of FREQUENCIES) {
    assert.ok(
      checkout.includes(`<input type="radio" class="btn-check" name="frequency" id="${frequency}" value="${frequency}">`),
      `frequency radio intact: ${frequency}`,
    );
  }
});

test('contract: every binding path the page reads is one the state module builds', async () => {
  const pages = await build();
  const checkout = pages.get('/payment/checkout');
  const state = fs.readFileSync(
    path.join(PKG, 'core', 'js', 'pages', 'payment', 'checkout', 'modules', 'state.js'), 'utf8',
  );

  const bound = new Set();
  for (const match of checkout.matchAll(/data-omega-bind="([^"]+)"/g)) {
    for (const expression of match[1].split(',')) {
      const [, path_] = expression.trim().split(/\s+/);
      if (path_) {
        bound.add(path_.replace(/^!/, ''));
      }
    }
  }

  assert.ok(bound.size >= 25, `the page still drives its UI from bindings (${bound.size} paths)`);

  // Every leaf key must exist in buildBindingsState() — a renamed or dropped
  // key would render a permanently blank/hidden element.
  for (const path_ of bound) {
    const leaf = path_.split('.').pop();
    if (['checkout', 'auth'].includes(leaf)) {
      continue;
    }
    // `key: value` or the shorthand `key,` — both are how the state object
    // publishes a binding path.
    assert.ok(new RegExp(`\\b${leaf}\\b\\s*[:,]`).test(state), `bindings state builds "${leaf}" (from ${path_})`);
  }

  // The fatal-error pair is the one that decides which half of the page shows
  assert.ok(checkout.includes('@show checkout.error.show'), 'error container shows on error');
  assert.ok(checkout.includes('@hide checkout.error.show'), 'checkout content hides on error');
});

test('#18: the page wears the classy language — panels, receipt card, serif head', async () => {
  const pages = await build();
  const checkout = pages.get('/payment/checkout');

  assert.ok(checkout.includes('omega-display omega-display--section'), 'the serif display headline leads');
  const panels = checkout.match(/omega-checkout__panel(?![-_])/g) || [];
  assert.equal(panels.length, 4, 'plan, account, desktop payment, mobile payment all sit on panels');
  assert.ok(checkout.includes('omega-checkout__summary'), 'the order summary is a surface card');
  assert.ok(checkout.includes('omega-receipt__panel'), 'the money rows keep the shared receipt vocabulary');
  assert.ok(checkout.includes('omega-checkout__product-name'), 'the summary names the product');
  assert.ok(checkout.includes('data-omega-reveal-stagger'), 'the zones reveal in on load');
  assert.ok(checkout.includes('omega-quiet'), 'metadata speaks in the quiet voice');

  // The pre-redesign chrome is gone
  assert.ok(!checkout.includes('omega-checkout__section'), 'the bare hairline sections are gone');
  for (const legacy of ['text-success', 'text-danger', 'card-body p-4']) {
    assert.ok(!checkout.includes(legacy), `Bootstrap-era chrome gone: ${legacy}`);
  }
});

test('#18: the mobile one-screen contract survives — folds, but never the numbers', async () => {
  const pages = await build();
  const checkout = pages.get('/payment/checkout');

  const toggles = checkout.match(/omega-checkout__rowtoggle d-lg-none collapsed/g) || [];
  assert.equal(toggles.length, 2, 'plan and account fold to one-line rows on phones');
  assert.ok(checkout.includes('id="collapse-billing"') && checkout.includes('id="collapse-account"'), 'both collapses keep their targets');
  assert.ok(!/omega-receipt__panel[^>]*collapse/.test(checkout), 'the price rows are never inside a collapse');
  assert.ok(checkout.includes('omega-checkout__paybuttons'), 'the mobile wallet grid still renders');

  const scss = fs.readFileSync(
    path.join(PKG, 'themes', 'classy', 'css', 'pages', 'payment', 'checkout', 'index.scss'), 'utf8',
  );
  assert.ok(!scss.includes('.omega-checkout__section'), 'the dead section rules went with the markup');
  assert.ok(scss.includes('max-height: 700px'), 'the short-phone rhythm is still tuned');
  assert.ok(!/#[0-9a-f]{3,6}/i.test(scss.replace(/#fff\b|#3c4043|#f6f5f3|#ffc439|#eabc53|#e8ad2e|#333\b/g, '')), 'colors are tokens (only the sanctioned wallet-brand hexes remain)');
});

test('#233: the discount label sits outside the input-group so the field keeps its rounded left corners', async () => {
  const pages = await build();
  const checkout = pages.get('/payment/checkout');

  // Bootstrap (and both themes' own input-group rules) round a group by CHILD
  // POSITION: `> :not(:first-child)` squares the left corners. A label as the
  // group's first child therefore squared the input it labels — so the label
  // is a SIBLING of the group, not a child of it. This is a structural
  // contract, not a style preference; putting it back re-breaks the corners.
  const group = checkout.match(/<div class="input-group omega-checkout__discount"[^>]*>\s*([\s\S]*?)<\/div>/);
  assert.ok(group, 'the discount input-group still renders');
  assert.ok(!group[1].includes('<label'), 'no label inside the group — the input must be its first child');
  assert.ok(/<input[^>]+id="discount-code"/.test(group[1]), 'and the input is what opens it');

  // The label is still a real one, still pointing at the field, and still
  // hides and shows with the group it labels.
  assert.ok(
    /<label for="discount-code" class="visually-hidden"[^>]*data-omega-bind="@show checkout"[^>]*hidden>/.test(checkout),
    'the field keeps a real label, bound to the same show condition as the group',
  );
});

test('#233: the billing cadence line is centered under the plan tiles', async () => {
  const pages = await build();
  const checkout = pages.get('/payment/checkout');

  const cadence = checkout.match(/<div class="([^"]*omega-checkout__cadence[^"]*)"/);
  assert.ok(cadence, 'the cadence line still renders');
  assert.ok(cadence[1].includes('text-center'), 'it centers under the pair of plan cards, in every theme');
});

test('#326: the summary reads like every other card, and the recurring row is gone', async () => {
  const pages = await build();
  const checkout = pages.get('/payment/checkout');
  const scss = fs.readFileSync(
    path.join(PKG, 'themes', 'classy', 'css', 'pages', 'payment', 'checkout', 'index.scss'), 'utf8',
  );

  // The recurring cost is already stated in the terms paragraph under the
  // numbers, so the row under Total said it twice.
  assert.ok(!checkout.includes('checkout.pricing.recurringAmount'), 'no recurring amount row');
  assert.ok(!checkout.includes('checkout.pricing.recurringPeriod'), 'no recurring period row');
  assert.ok(!checkout.includes('omega-checkout__recurring'), 'and its markup hook went with it');
  assert.ok(!scss.includes('.omega-checkout__recurring'), 'and so did its style');
  assert.ok(checkout.includes('omega-checkout__fineprint'), 'the terms paragraph — the one place recurring cost is stated — stays');

  // The summary head was the page's odd one out: a logo on the right and a
  // rule under it, where every other card leads with an icon chip and a title.
  const title = checkout.match(/<h2 class="omega-checkout__panel-title[^"]*"[^>]*>\s*<span class="omega-icon-chip omega-icon-chip--neutral">([^]*?)<\/span>\s*Order summary/);
  assert.ok(title, 'the Order summary title is built exactly like the other card titles: icon chip on the LEFT, then the words');
  assert.match(title[1], /data-icon="receipt"/, 'and the glyph rides the one icon mechanism, inlined at build');

  const heads = checkout.match(/omega-panel-head omega-checkout__panel-head/g) || [];
  assert.equal(heads.length, 4, 'billing, account, payment and order summary all wear the same head');

  for (const gone of ['omega-checkout__summary-head', 'omega-checkout__mark']) {
    assert.ok(!checkout.includes(gone), `the odd-one-out head is gone: ${gone}`);
    assert.ok(!scss.includes(`.${gone}`), `and its rule with it: ${gone}`);
  }
});

test('#326: the trust foot reveals in with the rest of the page', async () => {
  // Ian's QA: the header, the panels and the summary all animate in and then
  // the last two lines were just THERE — the only static block on the page.
  const pages = await build();
  const checkout = pages.get('/payment/checkout');

  for (const block of ['omega-checkout__trust', 'checkout-help-button']) {
    const at = checkout.indexOf(block);
    assert.ok(at !== -1, `${block} still renders`);
    // The block's own wrapper tag — the reveal rides the container, so the
    // whole line animates as one, exactly like the panels above it.
    const open = checkout.lastIndexOf('<div', at);
    const tag = checkout.slice(open, checkout.indexOf('>', open) + 1);
    assert.match(tag, /data-omega-reveal/, `${block} rides the shared reveal, like every other zone (${tag})`);
  }

  // It is the ATTRIBUTE that carries it, never a page-local animation: the
  // reduced-motion final state and the no-JS visible state live in the motion
  // library's gating, and only apply to markup that uses the idiom.
  const motion = fs.readFileSync(path.join(PKG, 'core', 'css', 'motion', '_index.scss'), 'utf8');
  assert.match(
    motion,
    /@media \(prefers-reduced-motion: no-preference\) \{\s*html\[data-omega-motion\] \[data-omega-reveal\] \{/,
    'a reveal hides only when motion is welcome AND the boot stamp says JS is running — reduced motion and no-JS both render the final state',
  );

  const scss = fs.readFileSync(
    path.join(PKG, 'themes', 'classy', 'css', 'pages', 'payment', 'checkout', 'index.scss'), 'utf8',
  );
  assert.ok(!/\.omega-checkout__trust[^{]*\{[^}]*animation:/.test(scss), 'the trust foot animates through the library, not a page-local keyframe');
});

test('#234: the page carries no dev chrome of its own — the palette owns it', async () => {
  const pages = await build();
  const checkout = pages.get('/payment/checkout');

  for (const gone of ['checkout-dev-panel', 'checkout-dev-toggle', 'checkout-dev-apply', 'data-dev-param', 'omega-checkout__dev-toggle']) {
    assert.ok(!checkout.includes(gone), `the gear dropdown is gone: ${gone}`);
  }

  const scss = fs.readFileSync(
    path.join(PKG, 'themes', 'classy', 'css', 'pages', 'payment', 'checkout', 'index.scss'), 'utf8',
  );
  assert.ok(!scss.includes('omega-checkout__dev-toggle'), 'and its style went with it');

  // The controls did not vanish — they moved to the palette's section module.
  const section = fs.readFileSync(
    path.join(PKG, 'core', 'js', 'pages', 'payment', 'checkout', 'modules', 'dev-section.js'), 'utf8',
  );
  for (const param of ['product', 'frequency', '_dev_trialEligible', '_dev_cardProcessor', '_dev_recaptcha']) {
    assert.ok(section.includes(`'${param}'`), `the palette section carries the "${param}" control`);
  }
});
