/**
 * /payment/checkout — the classy redesign (round 18) restyles AROUND an
 * untouchable functional contract: the page JS
 * (core/js/pages/payment/checkout/) binds by id, name, and data attribute, so
 * the regression that matters is that every one of those hooks survives the
 * markup. The first test checks a hand-kept hook list (update it with the
 * JS); the second genuinely derives the binding inventory from the rendered
 * page and checks it against the state module, so a dropped binding fails.
 */
const fs = require('node:fs');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');

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

module.exports = defineCases({
  type: 'group',
  description: 'checkout-page',
  tests: [
    {
      name: 'contract: every JS selector the checkout page binds survives the redesign',
      run: async (ctx) => {
        const pages = await build();
        const checkout = pages.get('/payment/checkout');
        ctx.expect(checkout, 'checkout page built').toBeTruthy();

        for (const hook of JS_HOOKS) {
          ctx.expect(checkout.includes(hook), `JS hook present: ${hook}`).toBeTruthy();
        }

        for (const method of PAYMENT_METHODS) {
          ctx.expect(checkout.includes(`data-payment-method="${method}"`), `payment button: ${method}`).toBeTruthy();
          ctx.expect(checkout.includes(`data-action="pay-${method}"`), `payment action: ${method}`).toBeTruthy();
        }

        // The submit fallback (`#checkout-form button[data-payment-method]`) only
        // finds buttons that submit the form and start hidden.
        const buttons = checkout.match(/<button type="submit"[^>]*data-payment-method/g) || [];
        ctx.expect(buttons.length, 'desktop + mobile stacks both render every method as a submit button').toBe(PAYMENT_METHODS.length * 2);

        for (const frequency of FREQUENCIES) {
          ctx.expect(checkout.includes(`<input type="radio" class="btn-check" name="frequency" id="${frequency}" value="${frequency}">`), `frequency radio intact: ${frequency}`).toBeTruthy();
        }
      },
    },

    {
      name: 'contract: every binding path the page reads is one the state module builds',
      run: async (ctx) => {
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

        ctx.expect(bound.size >= 25, `the page still drives its UI from bindings (${bound.size} paths)`).toBeTruthy();

        // `auth.user.*` resolves on the live User the state module hands through,
        // never on a key it builds
        ctx.expect(state, 'the bindings carry the live User under auth.user').toMatch(/user: omega\.auth\.user,/);

        // Every leaf key must exist in buildBindingsState() — a renamed or dropped
        // key would render a permanently blank/hidden element.
        for (const path_ of bound) {
          const leaf = path_.split('.').pop();
          if (['checkout', 'auth'].includes(leaf) || path_.startsWith('auth.user.')) {
            continue;
          }
          // `key: value` or the shorthand `key,` — both are how the state object
          // publishes a binding path.
          ctx.expect(new RegExp(`\\b${leaf}\\b\\s*[:,]`).test(state), `bindings state builds "${leaf}" (from ${path_})`).toBeTruthy();
        }

        // The fatal-error pair is the one that decides which half of the page shows
        ctx.expect(checkout.includes('@show checkout.error.show'), 'error container shows on error').toBeTruthy();
        ctx.expect(checkout.includes('@hide checkout.error.show'), 'checkout content hides on error').toBeTruthy();
      },
    },

    {
      name: '#18: the page wears the classy language — panels, receipt card, brand-lockup head',
      run: async (ctx) => {
        const pages = await build();
        const checkout = pages.get('/payment/checkout');

        // The serif display voice used to lead the page; since #373 the header is a
        // brand lockup and the ERROR panel is the one place that voice still speaks.
        const error = checkout.slice(checkout.indexOf('id="checkout-error-container"'), checkout.indexOf('id="checkout-content"'));
        ctx.expect(error.includes('omega-display omega-display--section'), 'the serif display headline leads the error state').toBeTruthy();
        const panels = checkout.match(/omega-checkout__panel(?![-_])/g) || [];
        ctx.expect(panels.length, 'plan and account sit on panels — the pay zone is bare by design (#374)').toBe(2);
        ctx.expect(checkout.includes('omega-checkout__summary'), 'the order summary is a surface card').toBeTruthy();
        ctx.expect(checkout.includes('omega-receipt__panel'), 'the money rows keep the shared receipt vocabulary').toBeTruthy();
        ctx.expect(checkout.includes('omega-checkout__product-name'), 'the summary names the product').toBeTruthy();
        ctx.expect(checkout.includes('data-omega-reveal-stagger'), 'the zones reveal in on load').toBeTruthy();
        ctx.expect(checkout.includes('omega-quiet'), 'metadata speaks in the quiet voice').toBeTruthy();

        // The pre-redesign chrome is gone
        ctx.expect(!checkout.includes('omega-checkout__section'), 'the bare hairline sections are gone').toBeTruthy();
        for (const legacy of ['text-success', 'text-danger', 'card-body p-4']) {
          ctx.expect(!checkout.includes(legacy), `Bootstrap-era chrome gone: ${legacy}`).toBeTruthy();
        }
      },
    },

    {
      name: '#18: the mobile one-screen contract survives — every card folds, the summary opens',
      run: async (ctx) => {
        // Ian's ruling (2026-08-19, #370): the accordion STAYS, and it is now the
        // phone's whole vocabulary — Billing cycle, Account AND the Order summary
        // all fold to one-line rows that state what they hide. The summary is the
        // one that starts OPEN, and its row carries the total due today. NEITHER
        // payment zone carries a head to pay for any more (#374).
        const pages = await build();
        const checkout = pages.get('/payment/checkout');

        const toggles = checkout.match(/omega-checkout__rowtoggle d-lg-none/g) || [];
        ctx.expect(toggles.length, 'billing, account and the summary all fold to one-line rows on phones').toBe(3);
        const closed = checkout.match(/omega-checkout__rowtoggle d-lg-none collapsed/g) || [];
        ctx.expect(closed.length, 'billing and account start closed — the summary is the one that starts open').toBe(2);
        ctx.expect(checkout.includes('id="collapse-billing"') && checkout.includes('id="collapse-account"') && checkout.includes('id="collapse-summary"'), 'every row keeps its collapse target').toBeTruthy();
        const summaryCollapse = checkout.indexOf('id="collapse-summary"');
        ctx.expect(summaryCollapse !== -1 && checkout.indexOf('omega-receipt__panel') > summaryCollapse, 'the price rows live inside the summary collapse now (open by default, so they still lead the phone view)').toBeTruthy();

        const heads = checkout.match(/omega-panel-head omega-checkout__panel-head/g) || [];
        ctx.expect(heads.length, 'plan, account and the summary — both pay zones are headless now (#374)').toBe(3);
        ctx.expect((checkout.match(/omega-checkout__panel-title[^>]*>\s*<span class="omega-icon-chip[^]*?<\/span>\s*Payment/g) || []).length, 'no stack is headed — "Payment / Encrypted" was air on both viewports (Ian 2026-08-19, #374)').toBe(0);

        const scss = fs.readFileSync(
          path.join(PKG, 'themes', 'classy', 'css', 'pages', 'payment', 'checkout', 'index.scss'), 'utf8',
        );
        ctx.expect(scss.includes('.omega-checkout__rowtoggle'), 'the folded-row rules back the markup').toBeTruthy();
        ctx.expect(!scss.includes('.omega-checkout__section'), 'the dead section rules stay gone').toBeTruthy();
        ctx.expect(scss.includes('max-height: 700px'), 'the short-phone rhythm is still tuned').toBeTruthy();
        // Declarations only — an issue reference in a comment (`#370`) is not a color.
        const declarations = scss.replace(/\/\/.*$/gm, '');
        ctx.expect(!/#[0-9a-f]{3,6}/i.test(declarations.replace(/#fff\b|#3c4043|#f6f5f3|#ffc439|#eabc53|#e8ad2e|#333\b/g, '')), 'colors are tokens (only the sanctioned wallet-brand hexes remain)').toBeTruthy();
      },
    },

    {
      name: '#370: the folded rows speak desktop\'s vocabulary, and the summary folds with them — open',
      run: async (ctx) => {
        // Ian's mobile QA: the phone had grown its own copy — a "Plan" row where
        // every other surface says "Billing cycle", a headless summary whose first
        // line read as its own title, and a "Switch account" link floating alone
        // over a gap once the account row expanded.
        const pages = await build();
        const checkout = pages.get('/payment/checkout');

        const planRow = checkout.match(/<button class="omega-checkout__rowtoggle[^]*?data-bs-target="#collapse-billing"[^]*?<\/button>/);
        ctx.expect(planRow, 'the plan row still folds to one line').toBeTruthy();
        ctx.expect(planRow[0], 'and it is labeled the way desktop labels it').toMatch(/<span class="omega-micro">Billing cycle<\/span>/);
        ctx.expect(!/<span class="omega-micro">Plan<\/span>/.test(checkout), 'the phone-only word "Plan" is gone').toBeTruthy();
        ctx.expect(planRow[0], 'the row still states the selection it hides').toMatch(/@text checkout\.product\.name/);
        ctx.expect(planRow[0], 'and keeps its chevron').toMatch(/omega-checkout__rowtoggle-chev/);

        // The summary is the third row now (Ian 2026-08-19: parity across ALL
        // cards). It folds exactly like the two above it — same button, same label
        // voice, same chevron — with one difference: it starts OPEN, and its row
        // states the total the fold would otherwise take off the screen.
        const summaryCard = checkout.slice(checkout.indexOf('<div class="omega-checkout__summary"'));
        const summaryRow = summaryCard.match(/<button class="omega-checkout__rowtoggle[^]*?<\/button>/);
        ctx.expect(summaryRow, 'the summary folds to a one-line row like the others').toBeTruthy();
        ctx.expect(summaryRow[0], 'and that row is the summary\'s own').toMatch(/data-bs-target="#collapse-summary"/);
        ctx.expect(summaryRow[0], 'labeled the way the card is named, at every width').toMatch(/<span class="omega-micro">Order summary<\/span>/);
        ctx.expect(summaryRow[0], 'and the folded row carries the total due today (the `order` root, so it waits for eligibility — #637)').toMatch(/@text order\.total/);
        ctx.expect(summaryRow[0], 'chevron and all').toMatch(/omega-checkout__rowtoggle-chev/);
        ctx.expect(summaryRow[0], 'it starts open, so it is marked expanded').toMatch(/aria-expanded="true"/);
        ctx.expect(!summaryRow[0].includes('collapsed'), 'and it never wears Bootstrap\'s closed-toggle class').toBeTruthy();

        const summaryCollapse = checkout.match(/<div id="collapse-summary" class="([^"]*)">/);
        ctx.expect(summaryCollapse, 'its body is the collapse that row targets').toBeTruthy();
        for (const marker of ['collapse', 'show', 'd-lg-block']) {
          ctx.expect(summaryCollapse[1].split(/\s+/).includes(marker), `the summary body opens by default on phones and is always open on desktop: ${marker}`).toBeTruthy();
        }

        // The icon-chip head moved INSIDE that collapse and is desktop's alone: on
        // phones the row IS the label, exactly like Billing cycle.
        const titled = checkout.indexOf('Order summary', summaryCollapse.index);
        ctx.expect(titled !== -1, 'the summary is titled "Order summary"').toBeTruthy();
        const open = checkout.lastIndexOf('<div class="omega-panel-head', titled);
        const summaryHead = checkout.slice(open, checkout.indexOf('>', open) + 1);
        ctx.expect(summaryHead, `and that head is desktop's alone now (${summaryHead})`).toMatch(/d-none d-lg-flex/);
        ctx.expect((checkout.match(/omega-checkout__product-name/g) || []).length, 'the product + price appear once, in the summary body').toBe(1);

        // Expanded, the account panel is ONE block: the switch link and the "Paying
        // as" line read together, never a lone link over a gap.
        const account = checkout.match(/id="collapse-account"[^]*?<\/p>/);
        ctx.expect(account, 'the account row still expands to the account card').toBeTruthy();
        ctx.expect(account[0], 'its expanded content is one block the phone can lay out').toMatch(/omega-checkout__account-block/);
        ctx.expect(account[0].includes('id="switch-account"'), 'the switch link lives in that block').toBeTruthy();
        ctx.expect(account[0].includes('omega-checkout__account'), 'and so does the "Paying as" line').toBeTruthy();

        const scss = fs.readFileSync(
          path.join(PKG, 'themes', 'classy', 'css', 'pages', 'payment', 'checkout', 'index.scss'), 'utf8',
        );
        const accountRule = scss.match(/\.omega-checkout__account \{([^}]*)\}/);
        ctx.expect(accountRule, 'the account line still has its rule').toBeTruthy();
        ctx.expect(accountRule[1], 'a long address breaks inside the panel instead of running out of it').toMatch(/overflow-wrap: anywhere/);
        ctx.expect(scss, 'and on phones the link is ordered under the line it belongs to').toMatch(/\.omega-checkout__account-block \{[^}]*order: 2/);

        // The summary's expanded body pads under its row, like every other row.
        const phoneBlock = scss.slice(scss.indexOf('@media (max-width: 991.98px)'));
        ctx.expect(phoneBlock, 'the summary row pads its expanded body the way the other rows do').toMatch(/\.omega-checkout__summary:has\(> \.omega-checkout__rowtoggle\)/);

        // The head is display-gated markup now, so the phone-only restyle of it
        // (chip hidden, title in the micro voice) is dead weight.
        ctx.expect(!phoneBlock.includes('.omega-checkout__summary .omega-icon-chip'), 'and the phone-only chip-hiding rule went with the old always-visible head').toBeTruthy();
        ctx.expect(!phoneBlock.includes('.omega-checkout__summary .omega-checkout__panel-title'), 'as did the micro-voice mirror of the summary title').toBeTruthy();
      },
    },

    {
      name: '#370: every card wears the summary\'s padding, phone and desktop',
      run: async (ctx) => {
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
          ctx.expect(at !== -1, `${selector} still has its rule`).toBeTruthy();
          const block = scss.slice(at, scss.indexOf('\n}\n', at));
          const stated = block.match(/padding: [\d.]+rem/g) || [];
          ctx.expect(stated.length, `${selector} states a padding at both widths (${stated.join(' / ')})`).toBe(2);
          return stated;
        };

        ctx.expect(cardPadding('.omega-checkout__panel'), 'the panels take the summary\'s padding — one card padding on the page').toEqual(cardPadding('.omega-checkout__summary'));

        // The phone block used to re-state the panel padding; the base value IS the
        // phone value now, so a second copy could only drift from it.
        const shortPhoneAt = scss.indexOf('@media (max-width: 991.98px) and (max-height: 700px)');
        const phoneBlock = scss.slice(scss.indexOf('@media (max-width: 991.98px)'), shortPhoneAt);
        ctx.expect(!/\.omega-checkout__panel \{\s*padding:/.test(phoneBlock), 'and the phone block no longer keeps its own copy of it').toBeTruthy();

        // A short phone tightens the rhythm — it tightens EVERY card, so the parity
        // holds on an SE-class device too.
        ctx.expect(scss.slice(shortPhoneAt), 'the short-phone tightening applies to every card, not just the panels').toMatch(/\.omega-checkout__panel,\s*\.omega-checkout__summary \{\s*padding:/);
      },
    },

    {
      name: '#370: the plan tiles bottom-align their prices, badge or no badge',
      run: async (ctx) => {
        // The annual tile's SAVE chip wraps to a second line in a phone-width col-6,
        // which used to push its price a line below the monthly tile's. The tiles are
        // equal-height flex columns and the price is pinned to the bottom, so the two
        // prices sit on one line each, level with each other, at every width.
        const scss = fs.readFileSync(
          path.join(PKG, 'themes', 'classy', 'css', 'pages', 'payment', 'checkout', 'index.scss'), 'utf8',
        );

        const tile = scss.match(/\.omega-checkout__tile \{([^}]*)\}/);
        ctx.expect(tile, 'the tile rule still exists').toBeTruthy();
        ctx.expect(tile[1], 'the tile is a flex column').toMatch(/display: flex/);
        ctx.expect(tile[1], 'the tile is a flex column').toMatch(/flex-direction: column/);

        const price = scss.match(/\.omega-checkout__tile-price \{([^}]*)\}/);
        ctx.expect(price, 'the price rule still exists').toBeTruthy();
        ctx.expect(price[1], 'the price is pinned to the tile foot, so both tiles align it').toMatch(/margin-top: auto/);
      },
    },

    {
      name: '#370: every payment button is the same width and height, on every viewport',
      run: async (ctx) => {
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
        ctx.expect(stacks.length, 'desktop and mobile stack the buttons identically').toBe(2);
        ctx.expect(!checkout.includes('omega-checkout__paybuttons'), 'the two-across wallet grid is gone from the markup').toBeTruthy();
        ctx.expect(!scss.includes('omega-checkout__paybuttons'), 'and from the sheet').toBeTruthy();
        ctx.expect(!/grid-template-columns: 1fr 1fr/.test(scss), 'no half-width payment button survives').toBeTruthy();

        const rule = scss.match(/\n\.payment-button \{([^}]*)\}/);
        ctx.expect(rule, 'the payment button rule still exists').toBeTruthy();
        ctx.expect(rule[1], 'every button measures the stated slab height, mark or label').toMatch(/min-height: var\(--omega-payment-button-height\)/);
        ctx.expect(rule[1], 'and the desktop slab states its own value').toMatch(/--omega-payment-button-height: [\d.]+rem/);

        const stated = scss.match(/--omega-payment-button-height: [\d.]+rem/g) || [];
        ctx.expect(stated.length, 'stated once per viewport: desktop, phone, short phone — and nowhere else').toBe(3);
      },
    },

    {
      name: '#374: the pay buttons live OUTSIDE any card AND under no head, on both viewports',
      run: async (ctx) => {
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
        ctx.expect(wrappers.length, 'desktop and phone each render their stack in a bare pay zone').toBe(2);
        for (const wrapper of wrappers) {
          ctx.expect(!/omega-checkout__panel/.test(wrapper), `the pay zone is not a panel (${wrapper})`).toBeTruthy();
        }
        ctx.expect(wrappers[0], 'the first zone is desktop\'s, inside the left column').toMatch(/d-none d-lg-block/);
        ctx.expect(!checkout.includes('omega-checkout__panel--mobile-pay'), 'and the phone\'s pay CARD is gone').toBeTruthy();

        // Every button stacks inside one of those zones — none is left in a card.
        const zones = checkout.split(/<div class="omega-checkout__pay/).slice(1)
          .map((zone) => zone.slice(0, zone.indexOf('omega-checkout__terms')));
        for (const zone of zones) {
          ctx.expect((zone.match(/data-payment-method="/g) || []).length, 'all five methods stack inside the bare zone').toBe(PAYMENT_METHODS.length);
          ctx.expect(zone, 'and they keep the one full-width stack (#370)').toMatch(/class="d-grid gap-2 omega-binding-skeleton"/);
        }

        // Neither zone is headed: nothing stands between the last panel and the
        // buttons but the grid that stacks them.
        for (const zone of zones) {
          ctx.expect(!zone.slice(0, zone.indexOf('data-payment-method')).includes('omega-checkout__panel-head'), 'the zone opens straight onto the button stack').toBeTruthy();
        }
        const h2s = checkout.match(/<h2[^]*?<\/h2>/g) || [];
        ctx.expect(h2s.length > 0, 'the page still has the heads it kept').toBeTruthy();
        ctx.expect(!h2s.some((h2) => h2.includes('Payment')), 'no h2 names the pay zone any more').toBeTruthy();
        // Rendered MARKUP only — the design comments narrate the removal by name, and
        // an HTML comment is not a thing the page says to a buyer.
        const markup = checkout.replace(/<!--[^]*?-->/g, '');
        ctx.expect(!markup.includes('Encrypted'), 'and the "Encrypted" lock note went with it — the SSL chip under the buttons carries that meaning, with the same lock').toBeTruthy();

        // The sheet: the zone is layout only — no border, no background, no card padding.
        const payRule = scss.match(/\n\.omega-checkout__pay \{([^}]*)\}/);
        ctx.expect(payRule, 'the bare pay zone has its own rule').toBeTruthy();
        ctx.expect(!/(^|[\s;])(border|background|padding)[-:]/m.test(payRule[1]), `the pay zone wears no card chrome (${payRule[1].trim()})`).toBeTruthy();

        // #370's stated slabs must keep reaching the buttons in the new wrapper.
        ctx.expect(scss, 'the phone slab still reaches the buttons now that the card is gone').toMatch(/\.omega-checkout__pay \.payment-button \{\s*--omega-payment-button-height/);
        ctx.expect(!scss.includes('--mobile-pay'), 'and the dead mobile-pay modifier is gone from the sheet').toBeTruthy();
      },
    },

    {
      name: '#374: the trust chips AND the help line close the pay stack, centered, on both viewports',
      run: async (ctx) => {
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

        ctx.expect((checkout.match(/omega-checkout__trust/g) || []).length, 'the trust row rides the shared capture — one copy per pay zone').toBe(2);
        ctx.expect((checkout.match(/id="checkout-help-button"/g) || []).length, 'and the help line rides it too — one copy per pay zone, never a page-foot single').toBe(2);

        const zones = checkout.split(/<div class="omega-checkout__pay/).slice(1);
        ctx.expect(zones.length, 'both pay zones still render').toBe(2);
        for (const zone of zones) {
          const terms = zone.indexOf('omega-checkout__terms');
          const chips = zone.indexOf('omega-checkout__trust');
          const help = zone.indexOf('id="checkout-help-button"');
          ctx.expect(terms !== -1, 'the zone still carries the terms line').toBeTruthy();
          ctx.expect(chips !== -1, 'and the trust row with it').toBeTruthy();
          ctx.expect(chips > terms, 'the chips sit right below the terms agreement statement').toBeTruthy();
          ctx.expect(help > chips, 'and the help line closes the stack, under the chips').toBeTruthy();
          ctx.expect((zone.match(/id="checkout-help-button"/g) || []).length, 'exactly one help line per zone — none is left over below the form').toBe(1);
        }

        // The chips carry the same facts. The fixture brand states no guarantee, so
        // the refund chip is correctly absent from the render — the GATE is what must
        // survive the move, and it is read from the layout (#273).
        const markup = checkout.replace(/<!--[^]*?-->/g, '');
        for (const chip of ['SSL encrypted', 'Secure payments']) {
          ctx.expect((markup.match(new RegExp(chip, 'g')) || []).length, `the ungated chip survives the move, once per zone: ${chip}`).toBe(2);
        }
        const layout = fs.readFileSync(
          path.join(PKG, 'themes', 'base', '_layouts', 'frontend', 'pages', 'payment', 'checkout.html'), 'utf8',
        );
        const captured = layout.slice(
          layout.indexOf('{% capture payment_buttons_content %}'), layout.indexOf('{% endcapture %}'),
        );
        ctx.expect(captured.includes('omega-checkout__trust'), 'the trust row is written INSIDE the capture, not at the page foot').toBeTruthy();
        ctx.expect(captured, 'and the refund chip still rides the brand\'s guarantee gate in its new home (#273)').toMatch(/\{% iftruthy resolved\.pricing\.guarantee %\}[^]*?Money-back guarantee/);
        ctx.expect(captured.includes('id="checkout-help-button"'), 'the help link came WITH them into the capture').toBeTruthy();
        ctx.expect(captured.indexOf('id="checkout-help-button"') > captured.indexOf('omega-checkout__trust'), 'written after the trust block — the order the stack reads in').toBeTruthy();
        ctx.expect(captured, 'and it kept its glyph verbatim through the move').toMatch(/<i class="fa-solid fa-circle-question fa-sm me-1"><\/i>/);
        ctx.expect(!/mt-3 mt-lg-4/.test(layout), 'the page-foot utility margins went with the foot').toBeTruthy();

        // The id renders twice now, so the page JS must bind EVERY copy — a
        // first-match getElementById would leave the phone's help line dead.
        const pageJs = fs.readFileSync(
          path.join(PKG, 'core', 'js', 'pages', 'payment', 'checkout', 'index.js'), 'utf8',
        );
        ctx.expect(pageJs.includes("querySelectorAll('#checkout-help-button')"), 'the checkout JS binds all help-button copies').toBeTruthy();
        ctx.expect(!pageJs.includes("getElementById('checkout-help-button')"), 'no first-match lookup remains to strand the phone copy').toBeTruthy();

        // Below the form there is nothing left at all.
        const formEnd = checkout.indexOf('</form>');
        const afterForm = checkout.slice(formEnd + '</form>'.length, checkout.indexOf('</section>', formEnd));
        ctx.expect(!/<\w/.test(afterForm), `the form closes straight onto the section close (${afterForm.trim()})`).toBeTruthy();

        // The sheet: centered inside the pay stack, and both lines state their own
        // rhythm now that the mt-* utilities are gone from the markup.
        const trustRule = scss.match(/\n\.omega-checkout__trust \{([^}]*)\}/);
        ctx.expect(trustRule, 'the trust row keeps its rule').toBeTruthy();
        ctx.expect(trustRule[1], 'the chips are centered within the payments group, never flushed to its edge').toMatch(/justify-content: center/);
        ctx.expect(trustRule[1], 'and the rule owns the gap under the terms line').toMatch(/margin-top: [\d.]+rem/);

        const helpRule = scss.match(/\n\.omega-checkout__help \{([^}]*)\}/);
        ctx.expect(helpRule, 'the help line has a rule of its own now that it rides the capture').toBeTruthy();
        ctx.expect(helpRule[1], 'it is centered with everything else in the stack').toMatch(/text-align: center/);
        ctx.expect(helpRule[1], 'and states the gap that keeps it part of the stack').toMatch(/margin-top: [\d.]+rem/);
        ctx.expect(scss.includes('.omega-checkout__quiet-link'), 'and it keeps the quiet-link look the sheet already owns').toBeTruthy();
      },
    },

    {
      name: '#233: the discount label sits outside the input-group so the field keeps its rounded left corners',
      run: async (ctx) => {
        const pages = await build();
        const checkout = pages.get('/payment/checkout');

        // Bootstrap (and both themes' own input-group rules) round a group by CHILD
        // POSITION: `> :not(:first-child)` squares the left corners. A label as the
        // group's first child therefore squared the input it labels — so the label
        // is a SIBLING of the group, not a child of it. This is a structural
        // contract, not a style preference; putting it back re-breaks the corners.
        const group = checkout.match(/<div class="input-group omega-checkout__discount"[^>]*>\s*([\s\S]*?)<\/div>/);
        ctx.expect(group, 'the discount input-group still renders').toBeTruthy();
        ctx.expect(!group[1].includes('<label'), 'no label inside the group — the input must be its first child').toBeTruthy();
        ctx.expect(/<input[^>]+id="discount-code"/.test(group[1]), 'and the input is what opens it').toBeTruthy();

        // The label is still a real one, still pointing at the field, and still
        // hides and shows with the group it labels.
        ctx.expect(/<label for="discount-code" class="visually-hidden"[^>]*data-omega-bind="@show checkout"[^>]*hidden>/.test(checkout), 'the field keeps a real label, bound to the same show condition as the group').toBeTruthy();
      },
    },

    {
      name: '#233: the billing cadence line is centered under the plan tiles',
      run: async (ctx) => {
        const pages = await build();
        const checkout = pages.get('/payment/checkout');

        const cadence = checkout.match(/<div class="([^"]*omega-checkout__cadence[^"]*)"/);
        ctx.expect(cadence, 'the cadence line still renders').toBeTruthy();
        ctx.expect(cadence[1].includes('text-center'), 'it centers under the pair of plan cards, in every theme').toBeTruthy();
      },
    },

    {
      name: '#326: the summary reads like every other card, and the recurring row is gone',
      run: async (ctx) => {
        const pages = await build();
        const checkout = pages.get('/payment/checkout');
        const scss = fs.readFileSync(
          path.join(PKG, 'themes', 'classy', 'css', 'pages', 'payment', 'checkout', 'index.scss'), 'utf8',
        );

        // The recurring cost is already stated in the terms paragraph under the
        // numbers, so the row under Total said it twice.
        ctx.expect(!checkout.includes('checkout.pricing.recurringAmount'), 'no recurring amount row').toBeTruthy();
        ctx.expect(!checkout.includes('checkout.pricing.recurringPeriod'), 'no recurring period row').toBeTruthy();
        ctx.expect(!checkout.includes('omega-checkout__recurring'), 'and its markup hook went with it').toBeTruthy();
        ctx.expect(!scss.includes('.omega-checkout__recurring'), 'and so did its style').toBeTruthy();
        ctx.expect(checkout.includes('omega-checkout__fineprint'), 'the terms paragraph — the one place recurring cost is stated — stays').toBeTruthy();

        // The summary head was the page's odd one out: a logo on the right and a
        // rule under it, where every other card leads with an icon chip and a title.
        const title = checkout.match(/<h2 class="omega-checkout__panel-title[^"]*"[^>]*>\s*<span class="omega-icon-chip omega-icon-chip--neutral">([^]*?)<\/span>\s*Order summary/);
        ctx.expect(title, 'the Order summary title is built exactly like the other card titles: icon chip on the LEFT, then the words').toBeTruthy();
        ctx.expect(title[1], 'and the glyph rides the one icon mechanism, inlined at build').toMatch(/data-omega-fa="solid\/receipt"><svg/);

        const heads = checkout.match(/omega-panel-head omega-checkout__panel-head/g) || [];
        ctx.expect(heads.length, 'billing, account and order summary all wear the same head — the pay zones wear none (#374)').toBe(3);

        for (const gone of ['omega-checkout__summary-head', 'omega-checkout__mark']) {
          ctx.expect(!checkout.includes(gone), `the odd-one-out head is gone: ${gone}`).toBeTruthy();
          ctx.expect(!scss.includes(`.${gone}`), `and its rule with it: ${gone}`).toBeTruthy();
        }
      },
    },

    {
      name: '#326: the pay stack reveals in as one — and nothing trails it below the form',
      run: async (ctx) => {
        // Ian's QA: the header, the panels and the summary all animate in and then
        // the last two lines were just THERE — the only static block on the page.
        // The answer is no longer a reveal on a foot block: since #374's correction
        // the terms, the chips AND the help line ride the buttons' capture, so they
        // animate in with the zone that carries them and the foot is gone entirely.
        const pages = await build();
        const checkout = pages.get('/payment/checkout');

        const desktopZone = checkout.match(/<div class="omega-checkout__pay d-none d-lg-block"[^>]*>/);
        ctx.expect(desktopZone, 'the desktop pay zone still renders').toBeTruthy();
        ctx.expect(desktopZone[0], 'and it is the zone that reveals the whole stack in').toMatch(/data-omega-reveal/);

        // Every line under the buttons is INSIDE that zone, so none of them carries
        // (or needs) a reveal of its own — a reveal inside a revealing zone is not a
        // block that animates twice.
        ctx.expect(!/omega-checkout__trust[^"]*"[^>]*data-omega-reveal/.test(checkout), 'the trust row dropped the standalone reveal it needed as a foot').toBeTruthy();
        const at = checkout.indexOf('id="checkout-help-button"');
        ctx.expect(at !== -1, 'the help line still renders').toBeTruthy();
        const open = checkout.lastIndexOf('<div', at);
        const tag = checkout.slice(open, checkout.indexOf('>', open) + 1);
        ctx.expect(!tag.includes('data-omega-reveal'), `the help line reveals with its zone now, not on its own (${tag})`).toBeTruthy();

        // And the foot it used to live in left nothing behind.
        const formEnd = checkout.indexOf('</form>');
        const afterForm = checkout.slice(formEnd + '</form>'.length, checkout.indexOf('</section>', formEnd));
        ctx.expect(!/data-omega-reveal/.test(afterForm), `no foot-block reveal survives below the form (${afterForm.trim()})`).toBeTruthy();

        // It is the ATTRIBUTE that carries it, never a page-local animation: the
        // reduced-motion final state and the no-JS visible state live in the motion
        // library's gating, and only apply to markup that uses the idiom.
        const motion = fs.readFileSync(path.join(PKG, 'core', 'css', 'motion', '_index.scss'), 'utf8');
        ctx.expect(motion, 'a reveal hides only when motion is welcome AND the boot stamp says JS is running — reduced motion and no-JS both render the final state').toMatch(/@media \(prefers-reduced-motion: no-preference\) \{\s*html\[data-omega-motion\] \[data-omega-reveal\] \{/);

        const scss = fs.readFileSync(
          path.join(PKG, 'themes', 'classy', 'css', 'pages', 'payment', 'checkout', 'index.scss'), 'utf8',
        );
        ctx.expect(!/\.omega-checkout__trust[^{]*\{[^}]*animation:/.test(scss), 'the trust foot animates through the library, not a page-local keyframe').toBeTruthy();
      },
    },

    {
      name: '#373: the checkout header is ONE brand lockup — the page\'s h1, linking home',
      run: async (ctx) => {
        // Shopify's checkout leads with the store's mark and nothing else. Ours led
        // with a "Secure checkout" eyebrow, a serif "Complete your order" display
        // title, AND a second copy of the same mark on the right — three voices for
        // a page whose job is to be got through. One lockup now says it all.
        const pages = await build();
        const checkout = pages.get('/payment/checkout');

        ctx.expect(!checkout.includes('Secure checkout'), 'the eyebrow is gone').toBeTruthy();
        ctx.expect(!/Complete your <em>order<\/em>/.test(checkout), 'the display title is gone').toBeTruthy();

        const head = checkout.match(/<header class="omega-checkout__head"[^]*?<\/header>/);
        ctx.expect(head, 'the header still renders').toBeTruthy();
        ctx.expect(head[0], 'and still reveals in with the rest of the page').toMatch(/data-omega-reveal="fade"/);

        // The mark appears ONCE, and it is the heading.
        ctx.expect((checkout.match(/omega-checkout__brand/g) || []).length, 'no right-side duplicate of the mark').toBe(1);
        ctx.expect(head[0], 'the lockup is the page heading, and it links home').toMatch(/<h1[^>]*>\s*<a href="\/" class="omega-checkout__brand">/);
        ctx.expect(!head[0].includes('omega-display'), 'a header, not a hero — the heading never wears the serif display voice').toBeTruthy();

        // Brand facts are READ from config, never typed: the fixture brand is MiniCo.
        ctx.expect(head[0], 'the brandmark resolves from config and keeps its alt text').toMatch(/<img src="[^"]*" class="filter-adaptive" alt="MiniCo logo"/);
        ctx.expect(head[0], 'and the wordmark is the configured brand name').toMatch(/>MiniCo</);
        ctx.expect(!head[0].includes('d-sm-inline'), 'the name IS the heading — it cannot drop off at phone widths').toBeTruthy();

        // One h1 on the checkout section. (The error container's h1 is the other half
        // of an either/or pair — a sibling the bindings swap this whole section for.)
        const section = checkout.slice(checkout.indexOf('id="checkout-content"'));
        ctx.expect((section.match(/<h1[\s>]/g) || []).length, 'exactly one h1 on the page').toBe(1);

        const scss = fs.readFileSync(
          path.join(PKG, 'themes', 'classy', 'css', 'pages', 'payment', 'checkout', 'index.scss'), 'utf8',
        );
        ctx.expect(scss.includes('.omega-checkout__brand'), 'the lockup keeps its rule').toBeTruthy();
        ctx.expect(!scss.includes('.omega-checkout__head-title'), 'the dead title-block rule went with the title').toBeTruthy();
        ctx.expect(!scss.includes('.omega-checkout .omega-display--section'), 'and so did the phone rule that sized it').toBeTruthy();
        // The head margins are what the phone rhythm tunes — both breakpoints keep theirs.
        ctx.expect(scss, 'the header still states its rhythm').toMatch(/\.omega-checkout__head \{[^}]*margin-bottom/);
        ctx.expect(scss, 'and the short-phone block still tightens it').toMatch(/max-height: 700px\)[^]*?\.omega-checkout__head \{\s*margin-bottom/);
      },
    },

    {
      name: '#234: the page carries no dev chrome of its own — the palette owns it',
      run: async (ctx) => {
        const pages = await build();
        const checkout = pages.get('/payment/checkout');

        for (const gone of ['checkout-dev-panel', 'checkout-dev-toggle', 'checkout-dev-apply', 'data-dev-param', 'omega-checkout__dev-toggle']) {
          ctx.expect(!checkout.includes(gone), `the gear dropdown is gone: ${gone}`).toBeTruthy();
        }

        const scss = fs.readFileSync(
          path.join(PKG, 'themes', 'classy', 'css', 'pages', 'payment', 'checkout', 'index.scss'), 'utf8',
        );
        ctx.expect(!scss.includes('omega-checkout__dev-toggle'), 'and its style went with it').toBeTruthy();

        // The controls did not vanish — they moved to the palette's section module.
        const section = fs.readFileSync(
          path.join(PKG, 'core', 'js', 'pages', 'payment', 'checkout', 'modules', 'dev-section.js'), 'utf8',
        );
        for (const param of ['product', 'frequency', '_dev_trialEligible', '_dev_cardProvider', '_dev_recaptcha']) {
          ctx.expect(section.includes(`'${param}'`), `the palette section carries the "${param}" control`).toBeTruthy();
        }
      },
    },
  ],
});
