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

// #642: the crypto button is back, because the Coinbase Commerce provider it
// starts an intent on now exists. It renders like every other method, and shows
// only when payment.providers.coinbase.enabled says so.
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

test('#18: the page wears the classy language — panels, receipt card, brand-lockup head', async () => {
  const pages = await build();
  const checkout = pages.get('/payment/checkout');

  // The serif display voice used to lead the page; since #373 the header is a
  // brand lockup and the ERROR panel is the one place that voice still speaks.
  const error = checkout.slice(checkout.indexOf('id="checkout-error-container"'), checkout.indexOf('id="checkout-content"'));
  assert.ok(error.includes('omega-display omega-display--section'), 'the serif display headline leads the error state');
  const panels = checkout.match(/omega-checkout__panel(?![-_])/g) || [];
  assert.equal(panels.length, 2, 'plan and account sit on panels — the pay zone is bare by design (#374)');
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

test('#18: the mobile one-screen contract survives — every card folds, the summary opens', async () => {
  // Ian's ruling (2026-08-19, #370): the accordion STAYS, and it is now the
  // phone's whole vocabulary — Billing cycle, Account AND the Order summary
  // all fold to one-line rows that state what they hide. The summary is the
  // one that starts OPEN, and its row carries the total due today. NEITHER
  // payment zone carries a head to pay for any more (#374).
  const pages = await build();
  const checkout = pages.get('/payment/checkout');

  const toggles = checkout.match(/omega-checkout__rowtoggle d-lg-none/g) || [];
  assert.equal(toggles.length, 3, 'billing, account and the summary all fold to one-line rows on phones');
  const closed = checkout.match(/omega-checkout__rowtoggle d-lg-none collapsed/g) || [];
  assert.equal(closed.length, 2, 'billing and account start closed — the summary is the one that starts open');
  assert.ok(
    checkout.includes('id="collapse-billing"') && checkout.includes('id="collapse-account"') && checkout.includes('id="collapse-summary"'),
    'every row keeps its collapse target',
  );
  const summaryCollapse = checkout.indexOf('id="collapse-summary"');
  assert.ok(
    summaryCollapse !== -1 && checkout.indexOf('omega-receipt__panel') > summaryCollapse,
    'the price rows live inside the summary collapse now (open by default, so they still lead the phone view)',
  );

  const heads = checkout.match(/omega-panel-head omega-checkout__panel-head/g) || [];
  assert.equal(heads.length, 3, 'plan, account and the summary — both pay zones are headless now (#374)');
  assert.equal(
    (checkout.match(/omega-checkout__panel-title[^>]*>\s*<span class="omega-icon-chip[^]*?<\/span>\s*Payment/g) || []).length,
    0,
    'no stack is headed — "Payment / Encrypted" was air on both viewports (Ian 2026-08-19, #374)',
  );

  const scss = fs.readFileSync(
    path.join(PKG, 'themes', 'classy', 'css', 'pages', 'payment', 'checkout', 'index.scss'), 'utf8',
  );
  assert.ok(scss.includes('.omega-checkout__rowtoggle'), 'the folded-row rules back the markup');
  assert.ok(!scss.includes('.omega-checkout__section'), 'the dead section rules stay gone');
  assert.ok(scss.includes('max-height: 700px'), 'the short-phone rhythm is still tuned');
  // Declarations only — an issue reference in a comment (`#370`) is not a color.
  const declarations = scss.replace(/\/\/.*$/gm, '');
  assert.ok(!/#[0-9a-f]{3,6}/i.test(declarations.replace(/#fff\b|#3c4043|#f6f5f3|#ffc439|#eabc53|#e8ad2e|#333\b/g, '')), 'colors are tokens (only the sanctioned wallet-brand hexes remain)');
});

test('#370: the folded rows speak desktop\'s vocabulary, and the summary folds with them — open', async () => {
  // Ian's mobile QA: the phone had grown its own copy — a "Plan" row where
  // every other surface says "Billing cycle", a headless summary whose first
  // line read as its own title, and a "Switch account" link floating alone
  // over a gap once the account row expanded.
  const pages = await build();
  const checkout = pages.get('/payment/checkout');

  const planRow = checkout.match(/<button class="omega-checkout__rowtoggle[^]*?data-bs-target="#collapse-billing"[^]*?<\/button>/);
  assert.ok(planRow, 'the plan row still folds to one line');
  assert.match(planRow[0], /<span class="omega-micro">Billing cycle<\/span>/, 'and it is labeled the way desktop labels it');
  assert.ok(!/<span class="omega-micro">Plan<\/span>/.test(checkout), 'the phone-only word "Plan" is gone');
  assert.match(planRow[0], /@text checkout\.product\.name/, 'the row still states the selection it hides');
  assert.match(planRow[0], /omega-checkout__rowtoggle-chev/, 'and keeps its chevron');

  // The summary is the third row now (Ian 2026-08-19: parity across ALL
  // cards). It folds exactly like the two above it — same button, same label
  // voice, same chevron — with one difference: it starts OPEN, and its row
  // states the total the fold would otherwise take off the screen.
  const summaryCard = checkout.slice(checkout.indexOf('<div class="omega-checkout__summary"'));
  const summaryRow = summaryCard.match(/<button class="omega-checkout__rowtoggle[^]*?<\/button>/);
  assert.ok(summaryRow, 'the summary folds to a one-line row like the others');
  assert.match(summaryRow[0], /data-bs-target="#collapse-summary"/, 'and that row is the summary\'s own');
  assert.match(summaryRow[0], /<span class="omega-micro">Order summary<\/span>/, 'labeled the way the card is named, at every width');
  assert.match(summaryRow[0], /@text order\.total/, 'and the folded row carries the total due today (the `order` root, so it waits for eligibility — #637)');
  assert.match(summaryRow[0], /omega-checkout__rowtoggle-chev/, 'chevron and all');
  assert.match(summaryRow[0], /aria-expanded="true"/, 'it starts open, so it is marked expanded');
  assert.ok(!summaryRow[0].includes('collapsed'), 'and it never wears Bootstrap\'s closed-toggle class');

  const summaryCollapse = checkout.match(/<div id="collapse-summary" class="([^"]*)">/);
  assert.ok(summaryCollapse, 'its body is the collapse that row targets');
  for (const marker of ['collapse', 'show', 'd-lg-block']) {
    assert.ok(summaryCollapse[1].split(/\s+/).includes(marker), `the summary body opens by default on phones and is always open on desktop: ${marker}`);
  }

  // The icon-chip head moved INSIDE that collapse and is desktop's alone: on
  // phones the row IS the label, exactly like Billing cycle.
  const titled = checkout.indexOf('Order summary', summaryCollapse.index);
  assert.ok(titled !== -1, 'the summary is titled "Order summary"');
  const open = checkout.lastIndexOf('<div class="omega-panel-head', titled);
  const summaryHead = checkout.slice(open, checkout.indexOf('>', open) + 1);
  assert.match(summaryHead, /d-none d-lg-flex/, `and that head is desktop's alone now (${summaryHead})`);
  assert.equal((checkout.match(/omega-checkout__product-name/g) || []).length, 1, 'the product + price appear once, in the summary body');

  // Expanded, the account panel is ONE block: the switch link and the "Paying
  // as" line read together, never a lone link over a gap.
  const account = checkout.match(/id="collapse-account"[^]*?<\/p>/);
  assert.ok(account, 'the account row still expands to the account card');
  assert.match(account[0], /omega-checkout__account-block/, 'its expanded content is one block the phone can lay out');
  assert.ok(account[0].includes('id="switch-account"'), 'the switch link lives in that block');
  assert.ok(account[0].includes('omega-checkout__account'), 'and so does the "Paying as" line');

  const scss = fs.readFileSync(
    path.join(PKG, 'themes', 'classy', 'css', 'pages', 'payment', 'checkout', 'index.scss'), 'utf8',
  );
  const accountRule = scss.match(/\.omega-checkout__account \{([^}]*)\}/);
  assert.ok(accountRule, 'the account line still has its rule');
  assert.match(accountRule[1], /overflow-wrap: anywhere/, 'a long address breaks inside the panel instead of running out of it');
  assert.match(scss, /\.omega-checkout__account-block \{[^}]*order: 2/, 'and on phones the link is ordered under the line it belongs to');

  // The summary's expanded body pads under its row, like every other row.
  const phoneBlock = scss.slice(scss.indexOf('@media (max-width: 991.98px)'));
  assert.match(
    phoneBlock, /\.omega-checkout__summary:has\(> \.omega-checkout__rowtoggle\)/,
    'the summary row pads its expanded body the way the other rows do',
  );

  // The head is display-gated markup now, so the phone-only restyle of it
  // (chip hidden, title in the micro voice) is dead weight.
  assert.ok(
    !phoneBlock.includes('.omega-checkout__summary .omega-icon-chip'),
    'and the phone-only chip-hiding rule went with the old always-visible head',
  );
  assert.ok(
    !phoneBlock.includes('.omega-checkout__summary .omega-checkout__panel-title'),
    'as did the micro-voice mirror of the summary title',
  );
});

test('#370: every card wears the summary\'s padding, phone and desktop', async () => {
  // Ian's parity ruling (2026-08-19): the left panels sat looser than the
  // order summary, and the summary's tighter values are the ones that look
  // right — so both cards state the SAME padding at both widths. Each rule
  // says it twice: a base (phone) value and a desktop override.
  const scss = fs.readFileSync(
    path.join(PKG, 'themes', 'classy', 'css', 'pages', 'payment', 'checkout', 'index.scss'), 'utf8',
  );

  // The card's own top-level rule (column 0) — never a viewport block's copy.
  const cardPadding = (selector) => {
    const at = scss.indexOf(`\n${selector} {`);
    assert.ok(at !== -1, `${selector} still has its rule`);
    const block = scss.slice(at, scss.indexOf('\n}\n', at));
    const stated = block.match(/padding: [\d.]+rem/g) || [];
    assert.equal(stated.length, 2, `${selector} states a padding at both widths (${stated.join(' / ')})`);
    return stated;
  };

  assert.deepEqual(
    cardPadding('.omega-checkout__panel'),
    cardPadding('.omega-checkout__summary'),
    'the panels take the summary\'s padding — one card padding on the page',
  );

  // The phone block used to re-state the panel padding; the base value IS the
  // phone value now, so a second copy could only drift from it.
  const shortPhoneAt = scss.indexOf('@media (max-width: 991.98px) and (max-height: 700px)');
  const phoneBlock = scss.slice(scss.indexOf('@media (max-width: 991.98px)'), shortPhoneAt);
  assert.ok(!/\.omega-checkout__panel \{\s*padding:/.test(phoneBlock), 'and the phone block no longer keeps its own copy of it');

  // A short phone tightens the rhythm — it tightens EVERY card, so the parity
  // holds on an SE-class device too.
  assert.match(
    scss.slice(shortPhoneAt), /\.omega-checkout__panel,\s*\.omega-checkout__summary \{\s*padding:/,
    'the short-phone tightening applies to every card, not just the panels',
  );
});

test('#370: the plan tiles bottom-align their prices, badge or no badge', async () => {
  // The annual tile's SAVE chip wraps to a second line in a phone-width col-6,
  // which used to push its price a line below the monthly tile's. The tiles are
  // equal-height flex columns and the price is pinned to the bottom, so the two
  // prices sit on one line each, level with each other, at every width.
  const scss = fs.readFileSync(
    path.join(PKG, 'themes', 'classy', 'css', 'pages', 'payment', 'checkout', 'index.scss'), 'utf8',
  );

  const tile = scss.match(/\.omega-checkout__tile \{([^}]*)\}/);
  assert.ok(tile, 'the tile rule still exists');
  assert.match(tile[1], /display: flex/, 'the tile is a flex column');
  assert.match(tile[1], /flex-direction: column/, 'the tile is a flex column');

  const price = scss.match(/\.omega-checkout__tile-price \{([^}]*)\}/);
  assert.ok(price, 'the price rule still exists');
  assert.match(price[1], /margin-top: auto/, 'the price is pinned to the tile foot, so both tiles align it');
});

test('#370: every payment button is the same width and height, on every viewport', async () => {
  // Two defects in one contract. WIDTH: the phone paired wallets two-across, so
  // PayPal rendered at half the Credit/Debit button's width — both viewports now
  // stack one full-width column. HEIGHT: the PayPal and Google marks are IMAGES,
  // and a 24px image is a taller flex item than a glyph+label line box, so
  // PayPal measured 52px against Credit/Debit's 49 (44 vs 41 on phones). The
  // slab height is STATED, once per viewport, so no button can drift again.
  const pages = await build();
  const checkout = pages.get('/payment/checkout');
  const scss = fs.readFileSync(
    path.join(PKG, 'themes', 'classy', 'css', 'pages', 'payment', 'checkout', 'index.scss'), 'utf8',
  );

  const stacks = checkout.match(/class="d-grid gap-2 omega-binding-skeleton"/g) || [];
  assert.equal(stacks.length, 2, 'desktop and mobile stack the buttons identically');
  assert.ok(!checkout.includes('omega-checkout__paybuttons'), 'the two-across wallet grid is gone from the markup');
  assert.ok(!scss.includes('omega-checkout__paybuttons'), 'and from the sheet');
  assert.ok(!/grid-template-columns: 1fr 1fr/.test(scss), 'no half-width payment button survives');

  const rule = scss.match(/\n\.payment-button \{([^}]*)\}/);
  assert.ok(rule, 'the payment button rule still exists');
  assert.match(rule[1], /min-height: var\(--omega-payment-button-height\)/, 'every button measures the stated slab height, mark or label');
  assert.match(rule[1], /--omega-payment-button-height: [\d.]+rem/, 'and the desktop slab states its own value');

  const stated = scss.match(/--omega-payment-button-height: [\d.]+rem/g) || [];
  assert.equal(stated.length, 3, 'stated once per viewport: desktop, phone, short phone — and nowhere else');
});

test('#374: the pay buttons live OUTSIDE any card AND under no head, on both viewports', async () => {
  // Ian's call (2026-08-19): "the buttons for payments should NOT be in a card,
  // they should exist OUT of a card both desktop and mobile." Shopify-style —
  // the commitment moment is the one zone with no chrome around it. His second
  // pass took the head with it: a "Payment / Encrypted" label row over a
  // Credit/Debit and a PayPal mark labels nothing the buttons do not already
  // say, so BOTH zones are bare stacks now. The #370 harmony rides along: one
  // width, one stated height, the same d-grid stack, both viewports.
  const pages = await build();
  const checkout = pages.get('/payment/checkout');
  const scss = fs.readFileSync(
    path.join(PKG, 'themes', 'classy', 'css', 'pages', 'payment', 'checkout', 'index.scss'), 'utf8',
  );

  // Two pay zones, and NEITHER wrapper is a card.
  const wrappers = checkout.match(/<div class="omega-checkout__pay[^"]*"[^>]*>/g) || [];
  assert.equal(wrappers.length, 2, 'desktop and phone each render their stack in a bare pay zone');
  for (const wrapper of wrappers) {
    assert.ok(!/omega-checkout__panel/.test(wrapper), `the pay zone is not a panel (${wrapper})`);
  }
  assert.match(wrappers[0], /d-none d-lg-block/, 'the first zone is desktop\'s, inside the left column');
  assert.ok(!checkout.includes('omega-checkout__panel--mobile-pay'), 'and the phone\'s pay CARD is gone');

  // Every button stacks inside one of those zones — none is left in a card.
  const zones = checkout.split(/<div class="omega-checkout__pay/).slice(1)
    .map((zone) => zone.slice(0, zone.indexOf('omega-checkout__terms')));
  for (const zone of zones) {
    assert.equal((zone.match(/data-payment-method="/g) || []).length, PAYMENT_METHODS.length, 'all five methods stack inside the bare zone');
    assert.match(zone, /class="d-grid gap-2 omega-binding-skeleton"/, 'and they keep the one full-width stack (#370)');
  }

  // Neither zone is headed: nothing stands between the last panel and the
  // buttons but the grid that stacks them.
  for (const zone of zones) {
    assert.ok(
      !zone.slice(0, zone.indexOf('data-payment-method')).includes('omega-checkout__panel-head'),
      'the zone opens straight onto the button stack',
    );
  }
  const h2s = checkout.match(/<h2[^]*?<\/h2>/g) || [];
  assert.ok(h2s.length > 0, 'the page still has the heads it kept');
  assert.ok(!h2s.some((h2) => h2.includes('Payment')), 'no h2 names the pay zone any more');
  // Rendered MARKUP only — the design comments narrate the removal by name, and
  // an HTML comment is not a thing the page says to a buyer.
  const markup = checkout.replace(/<!--[^]*?-->/g, '');
  assert.ok(
    !markup.includes('Encrypted'),
    'and the "Encrypted" lock note went with it — the SSL chip under the buttons carries that meaning, with the same lock',
  );

  // The sheet: the zone is layout only — no border, no background, no card padding.
  const payRule = scss.match(/\n\.omega-checkout__pay \{([^}]*)\}/);
  assert.ok(payRule, 'the bare pay zone has its own rule');
  assert.ok(
    !/(^|[\s;])(border|background|padding)[-:]/m.test(payRule[1]),
    `the pay zone wears no card chrome (${payRule[1].trim()})`,
  );

  // #370's stated slabs must keep reaching the buttons in the new wrapper.
  assert.match(
    scss, /\.omega-checkout__pay \.payment-button \{\s*--omega-payment-button-height/,
    'the phone slab still reaches the buttons now that the card is gone',
  );
  assert.ok(!scss.includes('--mobile-pay'), 'and the dead mobile-pay modifier is gone from the sheet');
});

test('#374: the trust chips AND the help line close the pay stack, centered, on both viewports', async () => {
  // Ian's correction (2026-08-19): "i wanted the ssl, secure payments etc
  // centered within the payments buttons group and the need help needs to be
  // in there too. so basically put them RIGHT below the terms agreement
  // statement centered." So the capture is the WHOLE commitment block now —
  // buttons, terms, chips, help — every line centered, one copy per pay zone,
  // and the page foot below the form is EMPTY. No "Encrypted" chip joins the
  // row (manager's call): SSL encrypted already says it, with the same lock.
  const pages = await build();
  const checkout = pages.get('/payment/checkout');
  const scss = fs.readFileSync(
    path.join(PKG, 'themes', 'classy', 'css', 'pages', 'payment', 'checkout', 'index.scss'), 'utf8',
  );

  assert.equal(
    (checkout.match(/omega-checkout__trust/g) || []).length, 2,
    'the trust row rides the shared capture — one copy per pay zone',
  );
  assert.equal(
    (checkout.match(/id="checkout-help-button"/g) || []).length, 2,
    'and the help line rides it too — one copy per pay zone, never a page-foot single',
  );

  const zones = checkout.split(/<div class="omega-checkout__pay/).slice(1);
  assert.equal(zones.length, 2, 'both pay zones still render');
  for (const zone of zones) {
    const terms = zone.indexOf('omega-checkout__terms');
    const chips = zone.indexOf('omega-checkout__trust');
    const help = zone.indexOf('id="checkout-help-button"');
    assert.ok(terms !== -1, 'the zone still carries the terms line');
    assert.ok(chips !== -1, 'and the trust row with it');
    assert.ok(chips > terms, 'the chips sit right below the terms agreement statement');
    assert.ok(help > chips, 'and the help line closes the stack, under the chips');
    assert.equal(
      (zone.match(/id="checkout-help-button"/g) || []).length, 1,
      'exactly one help line per zone — none is left over below the form',
    );
  }

  // The chips carry the same facts. The fixture brand states no guarantee, so
  // the refund chip is correctly absent from the render — the GATE is what must
  // survive the move, and it is read from the layout (#273).
  const markup = checkout.replace(/<!--[^]*?-->/g, '');
  for (const chip of ['SSL encrypted', 'Secure payments']) {
    assert.equal((markup.match(new RegExp(chip, 'g')) || []).length, 2, `the ungated chip survives the move, once per zone: ${chip}`);
  }
  const layout = fs.readFileSync(
    path.join(PKG, 'themes', 'base', '_layouts', 'frontend', 'pages', 'payment', 'checkout.html'), 'utf8',
  );
  const captured = layout.slice(
    layout.indexOf('{% capture payment_buttons_content %}'), layout.indexOf('{% endcapture %}'),
  );
  assert.ok(captured.includes('omega-checkout__trust'), 'the trust row is written INSIDE the capture, not at the page foot');
  assert.match(
    captured, /\{% iftruthy resolved\.pricing\.guarantee %\}[^]*?Money-back guarantee/,
    'and the refund chip still rides the brand\'s guarantee gate in its new home (#273)',
  );
  assert.ok(captured.includes('id="checkout-help-button"'), 'the help link came WITH them into the capture');
  assert.ok(
    captured.indexOf('id="checkout-help-button"') > captured.indexOf('omega-checkout__trust'),
    'written after the trust block — the order the stack reads in',
  );
  assert.match(captured, /<i class="fa-solid fa-circle-question fa-sm me-1"><\/i>/, 'and it kept its glyph verbatim through the move');
  assert.ok(!/mt-3 mt-lg-4/.test(layout), 'the page-foot utility margins went with the foot');

  // The id renders twice now, so the page JS must bind EVERY copy — a
  // first-match getElementById would leave the phone's help line dead.
  const pageJs = fs.readFileSync(
    path.join(PKG, 'core', 'js', 'pages', 'payment', 'checkout', 'index.js'), 'utf8',
  );
  assert.ok(
    pageJs.includes("querySelectorAll('#checkout-help-button')"),
    'the checkout JS binds all help-button copies',
  );
  assert.ok(
    !pageJs.includes("getElementById('checkout-help-button')"),
    'no first-match lookup remains to strand the phone copy',
  );

  // Below the form there is nothing left at all.
  const formEnd = checkout.indexOf('</form>');
  const afterForm = checkout.slice(formEnd + '</form>'.length, checkout.indexOf('</section>', formEnd));
  assert.ok(!/<\w/.test(afterForm), `the form closes straight onto the section close (${afterForm.trim()})`);

  // The sheet: centered inside the pay stack, and both lines state their own
  // rhythm now that the mt-* utilities are gone from the markup.
  const trustRule = scss.match(/\n\.omega-checkout__trust \{([^}]*)\}/);
  assert.ok(trustRule, 'the trust row keeps its rule');
  assert.match(trustRule[1], /justify-content: center/, 'the chips are centered within the payments group, never flushed to its edge');
  assert.match(trustRule[1], /margin-top: [\d.]+rem/, 'and the rule owns the gap under the terms line');

  const helpRule = scss.match(/\n\.omega-checkout__help \{([^}]*)\}/);
  assert.ok(helpRule, 'the help line has a rule of its own now that it rides the capture');
  assert.match(helpRule[1], /text-align: center/, 'it is centered with everything else in the stack');
  assert.match(helpRule[1], /margin-top: [\d.]+rem/, 'and states the gap that keeps it part of the stack');
  assert.ok(scss.includes('.omega-checkout__quiet-link'), 'and it keeps the quiet-link look the sheet already owns');
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
  assert.match(title[1], /data-omega-fa="solid\/receipt"><svg/, 'and the glyph rides the one icon mechanism, inlined at build');

  const heads = checkout.match(/omega-panel-head omega-checkout__panel-head/g) || [];
  assert.equal(heads.length, 3, 'billing, account and order summary all wear the same head — the pay zones wear none (#374)');

  for (const gone of ['omega-checkout__summary-head', 'omega-checkout__mark']) {
    assert.ok(!checkout.includes(gone), `the odd-one-out head is gone: ${gone}`);
    assert.ok(!scss.includes(`.${gone}`), `and its rule with it: ${gone}`);
  }
});

test('#326: the pay stack reveals in as one — and nothing trails it below the form', async () => {
  // Ian's QA: the header, the panels and the summary all animate in and then
  // the last two lines were just THERE — the only static block on the page.
  // The answer is no longer a reveal on a foot block: since #374's correction
  // the terms, the chips AND the help line ride the buttons' capture, so they
  // animate in with the zone that carries them and the foot is gone entirely.
  const pages = await build();
  const checkout = pages.get('/payment/checkout');

  const desktopZone = checkout.match(/<div class="omega-checkout__pay d-none d-lg-block"[^>]*>/);
  assert.ok(desktopZone, 'the desktop pay zone still renders');
  assert.match(desktopZone[0], /data-omega-reveal/, 'and it is the zone that reveals the whole stack in');

  // Every line under the buttons is INSIDE that zone, so none of them carries
  // (or needs) a reveal of its own — a reveal inside a revealing zone is not a
  // block that animates twice.
  assert.ok(
    !/omega-checkout__trust[^"]*"[^>]*data-omega-reveal/.test(checkout),
    'the trust row dropped the standalone reveal it needed as a foot',
  );
  const at = checkout.indexOf('id="checkout-help-button"');
  assert.ok(at !== -1, 'the help line still renders');
  const open = checkout.lastIndexOf('<div', at);
  const tag = checkout.slice(open, checkout.indexOf('>', open) + 1);
  assert.ok(!tag.includes('data-omega-reveal'), `the help line reveals with its zone now, not on its own (${tag})`);

  // And the foot it used to live in left nothing behind.
  const formEnd = checkout.indexOf('</form>');
  const afterForm = checkout.slice(formEnd + '</form>'.length, checkout.indexOf('</section>', formEnd));
  assert.ok(!/data-omega-reveal/.test(afterForm), `no foot-block reveal survives below the form (${afterForm.trim()})`);

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

test('#373: the checkout header is ONE brand lockup — the page\'s h1, linking home', async () => {
  // Shopify's checkout leads with the store's mark and nothing else. Ours led
  // with a "Secure checkout" eyebrow, a serif "Complete your order" display
  // title, AND a second copy of the same mark on the right — three voices for
  // a page whose job is to be got through. One lockup now says it all.
  const pages = await build();
  const checkout = pages.get('/payment/checkout');

  assert.ok(!checkout.includes('Secure checkout'), 'the eyebrow is gone');
  assert.ok(!/Complete your <em>order<\/em>/.test(checkout), 'the display title is gone');

  const head = checkout.match(/<header class="omega-checkout__head"[^]*?<\/header>/);
  assert.ok(head, 'the header still renders');
  assert.match(head[0], /data-omega-reveal="fade"/, 'and still reveals in with the rest of the page');

  // The mark appears ONCE, and it is the heading.
  assert.equal((checkout.match(/omega-checkout__brand/g) || []).length, 1, 'no right-side duplicate of the mark');
  assert.match(head[0], /<h1[^>]*>\s*<a href="\/" class="omega-checkout__brand">/, 'the lockup is the page heading, and it links home');
  assert.ok(!head[0].includes('omega-display'), 'a header, not a hero — the heading never wears the serif display voice');

  // Brand facts are READ from config, never typed: the fixture brand is MiniCo.
  assert.match(head[0], /<img src="[^"]*" class="filter-adaptive" alt="MiniCo logo"/, 'the brandmark resolves from config and keeps its alt text');
  assert.match(head[0], />MiniCo</, 'and the wordmark is the configured brand name');
  assert.ok(!head[0].includes('d-sm-inline'), 'the name IS the heading — it cannot drop off at phone widths');

  // One h1 on the checkout section. (The error container's h1 is the other half
  // of an either/or pair — a sibling the bindings swap this whole section for.)
  const section = checkout.slice(checkout.indexOf('id="checkout-content"'));
  assert.equal((section.match(/<h1[\s>]/g) || []).length, 1, 'exactly one h1 on the page');

  const scss = fs.readFileSync(
    path.join(PKG, 'themes', 'classy', 'css', 'pages', 'payment', 'checkout', 'index.scss'), 'utf8',
  );
  assert.ok(scss.includes('.omega-checkout__brand'), 'the lockup keeps its rule');
  assert.ok(!scss.includes('.omega-checkout__head-title'), 'the dead title-block rule went with the title');
  assert.ok(!scss.includes('.omega-checkout .omega-display--section'), 'and so did the phone rule that sized it');
  // The head margins are what the phone rhythm tunes — both breakpoints keep theirs.
  assert.match(scss, /\.omega-checkout__head \{[^}]*margin-bottom/, 'the header still states its rhythm');
  assert.match(scss, /max-height: 700px\)[^]*?\.omega-checkout__head \{\s*margin-bottom/, 'and the short-phone block still tightens it');
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
  for (const param of ['product', 'frequency', '_dev_trialEligible', '_dev_cardProvider', '_dev_recaptcha']) {
    assert.ok(section.includes(`'${param}'`), `the palette section carries the "${param}" control`);
  }
});
