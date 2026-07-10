// ============================================
// Stripe Checkout Test Card Auto-Filler
// ============================================

import { setInput, setSelect, typeInto, sleep } from '../lib/helpers.js';
import { showPanel, addField, createDetailGrid, addOutcomePill } from '../lib/panel.js';

// ── Test Card Presets ──────────────────────────────────────────────────────

const CARDS = {
  // Success
  visa:             { number: '4242424242424242', brand: 'Visa',             cvc: '123',  exp: '1234', outcome: 'Payment succeeds',              icon: 'check', category: 'success' },
  mastercard:       { number: '5555555555554444', brand: 'Mastercard',       cvc: '123',  exp: '1234', outcome: 'Payment succeeds',              icon: 'check', category: 'success' },
  amex:             { number: '378282246310005',  brand: 'American Express', cvc: '1234', exp: '1234', outcome: 'Payment succeeds',              icon: 'check', category: 'success' },
  discover:         { number: '6011111111111117', brand: 'Discover',         cvc: '123',  exp: '1234', outcome: 'Payment succeeds',              icon: 'check', category: 'success' },
  visa_debit:       { number: '4000056655665556', brand: 'Visa Debit',       cvc: '123',  exp: '1234', outcome: 'Payment succeeds',              icon: 'check', category: 'success' },

  // Declines
  decline:          { number: '4000000000000002', brand: 'Visa', cvc: '123', exp: '1234', outcome: 'Generic decline',                           icon: 'x',     category: 'decline' },
  insufficient:     { number: '4000000000009995', brand: 'Visa', cvc: '123', exp: '1234', outcome: 'Insufficient funds',                        icon: 'x',     category: 'decline' },
  lost:             { number: '4000000000009987', brand: 'Visa', cvc: '123', exp: '1234', outcome: 'Lost card',                                 icon: 'x',     category: 'decline' },
  stolen:           { number: '4000000000009979', brand: 'Visa', cvc: '123', exp: '1234', outcome: 'Stolen card',                               icon: 'x',     category: 'decline' },
  expired:          { number: '4000000000000069', brand: 'Visa', cvc: '123', exp: '1234', outcome: 'Expired card',                              icon: 'x',     category: 'decline' },
  cvc_fail:         { number: '4000000000000127', brand: 'Visa', cvc: '123', exp: '1234', outcome: 'Incorrect CVC',                             icon: 'x',     category: 'decline' },
  processing_error: { number: '4000000000000119', brand: 'Visa', cvc: '123', exp: '1234', outcome: 'Processing error',                         icon: 'x',     category: 'decline' },

  // Fraud / Risk
  fraud:            { number: '4100000000000019', brand: 'Visa', cvc: '123', exp: '1234', outcome: 'Always blocked (highest risk)',              icon: 'shield', category: 'fraud' },
  risk_highest:     { number: '4000000000004954', brand: 'Visa', cvc: '123', exp: '1234', outcome: 'Highest risk level',                        icon: 'shield', category: 'fraud' },
  risk_elevated:    { number: '4000000000009235', brand: 'Visa', cvc: '123', exp: '1234', outcome: 'Elevated risk level',                       icon: 'shield', category: 'fraud' },

  // 3D Secure
  '3ds_required':   { number: '4000002760003184', brand: 'Visa', cvc: '123', exp: '1234', outcome: '3DS required (will prompt)',                 icon: 'lock',   category: '3ds' },
  '3ds_optional':   { number: '4000000000003220', brand: 'Visa', cvc: '123', exp: '1234', outcome: '3DS supported (optional)',                  icon: 'lock',   category: '3ds' },

  // Special
  attach_fail:      { number: '4000000000000341', brand: 'Visa', cvc: '123', exp: '1234', outcome: 'Attaches OK, charge fails',                 icon: 'refresh', category: 'special' },
  dispute:          { number: '4000000000000259', brand: 'Visa', cvc: '123', exp: '1234', outcome: 'Triggers a dispute after payment',          icon: 'refresh', category: 'special' },
};

const CATEGORY_META = {
  success: { label: 'Success',       color: '#4ade80' },
  decline: { label: 'Decline',       color: '#f87171' },
  fraud:   { label: 'Fraud / Risk',  color: '#fbbf24' },
  '3ds':   { label: '3D Secure',     color: '#60a5fa' },
  special: { label: 'Special',       color: '#c084fc' },
};

const FAVORITE_PRESETS = ['visa', 'decline', 'insufficient', 'stolen', 'expired', 'fraud', '3ds_required', 'dispute'];

// ── Helpers ──────────────────────────────────────────────────────────────

function fmtCard(num) {
  if (num.length === 15) {
    return `${num.slice(0, 4)} ${num.slice(4, 10)} ${num.slice(10)}`;
  }

  return num.replace(/(.{4})/g, '$1 ').trim();
}

// ── Fill Form ────────────────────────────────────────────────────────────

async function fillStripe(preset = 'visa') {
  const key = preset.toLowerCase().replace(/[\s-]/g, '_');
  const card = CARDS[key];

  if (!card) {
    console.error(`[stripe-filler] Unknown preset: "${preset}"`);
    return;
  }

  // Update visual panel FIRST (before filling)
  show(card, key);

  console.log(`[stripe-filler] Filling: ${key} > ${fmtCard(card.number)}  ${card.outcome}`);

  // 1. Click the Card accordion to make sure it's selected
  const cardBtn = document.querySelector('[data-testid="card-accordion-item-button"]');
  const cardRadio = document.querySelector('#payment-method-accordion-item-title-card');
  if (cardRadio && !cardRadio.checked) {
    if (cardBtn) cardBtn.click();
    else cardRadio.click();
    await sleep(300);
  }

  // 2. Card number (type char-by-char so Stripe's formatter kicks in)
  const cardNumEl = document.querySelector('#cardNumber');
  if (cardNumEl) {
    await typeInto(cardNumEl, card.number, 20);
  }

  await sleep(100);

  // 3. Expiry
  const expEl = document.querySelector('#cardExpiry');
  if (expEl) {
    await typeInto(expEl, card.exp, 20);
  }

  await sleep(100);

  // 4. CVC
  const cvcEl = document.querySelector('#cardCvc');
  if (cvcEl) {
    await typeInto(cvcEl, card.cvc, 20);
  }

  await sleep(100);

  // 5. Billing name
  const nameEl = document.querySelector('#billingName');
  if (nameEl) {
    setInput(nameEl, 'Test User');
  }

  // 6. Country
  const countryEl = document.querySelector('#billingCountry');
  if (countryEl) {
    setSelect(countryEl, 'US');
  }

  await sleep(200);

  // 7. ZIP
  const zipEl = document.querySelector('#billingPostalCode');
  if (zipEl) {
    setInput(zipEl, '94107');
  }

  // 8. Phone (if visible)
  const phoneEl = document.querySelector('#phoneNumber');
  if (phoneEl) {
    setInput(phoneEl, '5555555555');
  }

  // 9. Uncheck "Save my info" (Link)
  const linkCheckbox = document.querySelector('#enableStripePass');
  if (linkCheckbox && linkCheckbox.checked) {
    linkCheckbox.click();
  }

  console.log(`[stripe-filler] Done! ${card.outcome}`);
}

// ── Panel ────────────────────────────────────────────────────────────────

function show(card, presetName) {
  showPanel({
    panelId: 'omega-filler-panel',
    label: 'STRIPE',
    activePreset: presetName,
    favoriteKeys: FAVORITE_PRESETS,
    onPresetClick: fillStripe,
    renderDetails: card ? ($panel) => {
      const formatted = fmtCard(card.number);
      const expDisplay = card.exp.slice(0, 2) + ' / ' + card.exp.slice(2);

      const $grid = createDetailGrid();
      addField($grid, 'NUMBER', formatted, true);
      addField($grid, 'EXP', expDisplay, false);
      addField($grid, 'CVC', card.cvc, false);
      $panel.appendChild($grid);

      const meta = CATEGORY_META[card.category] || CATEGORY_META.special;
      addOutcomePill($panel, card.outcome, meta.color);
    } : null,
  });
}

// ── Export ────────────────────────────────────────────────────────────────

export function init(logger) {
  logger.log('Stripe Test Filler loaded!');
  show(null, null);
}
