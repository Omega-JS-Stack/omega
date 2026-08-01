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

  assert.ok(checkout.includes('classy-display classy-display--section'), 'the serif display headline leads');
  const panels = checkout.match(/classy-checkout__panel(?![-_])/g) || [];
  assert.equal(panels.length, 4, 'plan, account, desktop payment, mobile payment all sit on panels');
  assert.ok(checkout.includes('classy-checkout__summary'), 'the order summary is a surface card');
  assert.ok(checkout.includes('classy-receipt__panel'), 'the money rows keep the shared receipt vocabulary');
  assert.ok(checkout.includes('classy-checkout__product-name'), 'the summary names the product');
  assert.ok(checkout.includes('data-omega-reveal-stagger'), 'the zones reveal in on load');
  assert.ok(checkout.includes('classy-quiet'), 'metadata speaks in the quiet voice');

  // The pre-redesign chrome is gone
  assert.ok(!checkout.includes('classy-checkout__section'), 'the bare hairline sections are gone');
  for (const legacy of ['text-success', 'text-danger', 'card-body p-4']) {
    assert.ok(!checkout.includes(legacy), `Bootstrap-era chrome gone: ${legacy}`);
  }
});

test('#18: the mobile one-screen contract survives — folds, but never the numbers', async () => {
  const pages = await build();
  const checkout = pages.get('/payment/checkout');

  const toggles = checkout.match(/classy-checkout__rowtoggle d-lg-none collapsed/g) || [];
  assert.equal(toggles.length, 2, 'plan and account fold to one-line rows on phones');
  assert.ok(checkout.includes('id="collapse-billing"') && checkout.includes('id="collapse-account"'), 'both collapses keep their targets');
  assert.ok(!/classy-receipt__panel[^>]*collapse/.test(checkout), 'the price rows are never inside a collapse');
  assert.ok(checkout.includes('classy-checkout__paybuttons'), 'the mobile wallet grid still renders');

  const scss = fs.readFileSync(
    path.join(PKG, 'themes', 'classy', 'css', 'pages', 'payment', 'checkout', 'index.scss'), 'utf8',
  );
  assert.ok(!scss.includes('.classy-checkout__section'), 'the dead section rules went with the markup');
  assert.ok(scss.includes('max-height: 700px'), 'the short-phone rhythm is still tuned');
  assert.ok(!/#[0-9a-f]{3,6}/i.test(scss.replace(/#fff\b|#3c4043|#f6f5f3|#ffc439|#eabc53|#e8ad2e|#333\b/g, '')), 'colors are tokens (only the sanctioned wallet-brand hexes remain)');
});
