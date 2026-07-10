// ============================================
// PayPal Sandbox Account Auto-Filler
// ============================================

import { setInput, sleep, nativeSetter } from '../lib/helpers.js';
import { showPanel, addField, createDetailGrid, addOutcomePill } from '../lib/panel.js';

// ── Sandbox Account Presets ──────────────────────────────────────────────

const ACCOUNTS = {
  // Working accounts
  success: {
    email: 'ian.wiedenman+paypal-success@gmail.com',
    password: 'qweqweqwe',
    id: '5324810253770226274',
    outcome: 'Payment succeeds',
    category: 'success',
  },

  // Placeholder accounts — fill in credentials when created
  decline: {
    email: '',
    password: '',
    id: '',
    outcome: 'Payment declined',
    category: 'decline',
  },
  pending: {
    email: '',
    password: '',
    id: '',
    outcome: 'Payment pending',
    category: 'pending',
  },
  unverified: {
    email: '',
    password: '',
    id: '',
    outcome: 'Unverified account',
    category: 'special',
  },
};

const CATEGORY_META = {
  success: { label: 'Success',   color: '#4ade80' },
  decline: { label: 'Decline',   color: '#f87171' },
  pending: { label: 'Pending',   color: '#fbbf24' },
  special: { label: 'Special',   color: '#c084fc' },
};

const FAVORITE_PRESETS = ['success', 'decline', 'pending', 'unverified'];

// ── Fill Form ────────────────────────────────────────────────────────────

async function fillPayPal(preset = 'success') {
  const key = preset.toLowerCase().replace(/[\s-]/g, '_');
  const account = ACCOUNTS[key];

  if (!account) {
    console.error(`[paypal-filler] Unknown preset: "${preset}"`);
    return;
  }

  if (!account.email) {
    console.warn(`[paypal-filler] Preset "${key}" has no credentials configured yet`);
    show(account, key);
    return;
  }

  // Update visual panel FIRST
  show(account, key);

  console.log(`[paypal-filler] Filling: ${key} > ${account.email}`);

  // PayPal login can be a single page or a two-step flow (email first, then password)
  // Try to detect which state we're in

  // Look for email field
  const emailEl = document.querySelector('#email')
    || document.querySelector('input[name="login_email"]')
    || document.querySelector('input[type="email"]');

  if (emailEl) {
    fillInput(emailEl, account.email);
    await sleep(300);
  }

  // Look for password field (may not be visible yet on two-step login)
  const passwordEl = document.querySelector('#password')
    || document.querySelector('input[name="login_password"]')
    || document.querySelector('input[type="password"]');

  if (passwordEl) {
    fillInput(passwordEl, account.password);
    await sleep(200);
  }

  // If only email was visible, click Next/Continue to proceed to password step
  if (emailEl && !passwordEl) {
    const nextBtn = document.querySelector('#btnNext')
      || document.querySelector('button[name="btnNext"]')
      || document.querySelector('button[type="submit"]');

    if (nextBtn) {
      nextBtn.click();
      console.log(`[paypal-filler] Clicked next, waiting for password field...`);

      // Wait for password field to appear
      await waitForElement('input[type="password"], #password, input[name="login_password"]', 5000);
      await sleep(500);

      // Fill password after it appears
      const passwordElRetry = document.querySelector('#password')
        || document.querySelector('input[name="login_password"]')
        || document.querySelector('input[type="password"]');

      if (passwordElRetry) {
        fillInput(passwordElRetry, account.password);
        await sleep(200);
      }
    }
  }

  console.log(`[paypal-filler] Done!`);
}

// ── Helpers ──────────────────────────────────────────────────────────────

function fillInput(el, value) {
  if (!el) {
    return;
  }

  el.focus();

  // Clear existing value
  nativeSetter.call(el, '');
  el.dispatchEvent(new Event('input', { bubbles: true }));

  // Set new value
  nativeSetter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new Event('blur', { bubbles: true }));
}

function waitForElement(selector, timeout = 5000) {
  return new Promise((resolve) => {
    const el = document.querySelector(selector);
    if (el) {
      resolve(el);
      return;
    }

    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) {
        observer.disconnect();
        resolve(el);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeout);
  });
}

// ── Panel ────────────────────────────────────────────────────────────────

function show(account, presetName) {
  showPanel({
    panelId: 'omega-filler-panel',
    label: 'PAYPAL',
    activePreset: presetName,
    favoriteKeys: FAVORITE_PRESETS,
    onPresetClick: fillPayPal,
    renderDetails: account ? ($panel) => {
      if (!account.email) {
        addOutcomePill($panel, 'No credentials configured', '#f87171');
        return;
      }

      const $grid = createDetailGrid();
      addField($grid, 'EMAIL', account.email, true);
      addField($grid, 'PASSWORD', account.password, true);
      if (account.id) {
        addField($grid, 'ACCOUNT ID', account.id, true);
      }
      $panel.appendChild($grid);

      const meta = CATEGORY_META[account.category] || CATEGORY_META.special;
      addOutcomePill($panel, account.outcome, meta.color);
    } : null,
  });
}

// ── Export ────────────────────────────────────────────────────────────────

export function init(logger) {
  logger.log('PayPal Sandbox Filler loaded!');
  show(null, null);
}
