/**
 * Refund Section JavaScript
 */

// Libraries
import { FormManager } from '@omega.js/client/modules/form-manager.js';
import omega from '@omega.js/client';
import { trackGoogle, trackMeta, trackTikTok } from '__main_assets__/js/libs/analytics.js';

// Refund reasons (will be shuffled on each render)
const REFUND_REASONS = [
  'Charged by mistake',
  'Not satisfied with the service',
  'Too expensive',
  'Found a better alternative',
  'Technical issues or bugs',
  'Not using it enough',
  'Billing or payment issue',
  'Other',
];
let formManager = null;
let currentAccount = null;

// Initialize refund section
export async function init() {
  populateRefundReasons();
  setupRefundForm();
}

// Load refund section data
export async function loadData(account) {
  currentAccount = account;
  updateRefundEligibility(account);
}

// Called when section is shown
export function onShow() {
  if (currentAccount) {
    updateRefundEligibility(currentAccount);
  }
}

// ─── Eligibility ────────────────────────────────────────────

function updateRefundEligibility(account) {
  const subscription = account?.subscription || {};
  const resolved = omega.auth().resolveSubscription(account);
  const isPaid = subscription.product?.id !== 'basic' && !!subscription.product?.id;
  const isEligible = isPaid && (subscription.status === 'cancelled' || resolved.cancelling);

  const $eligible = document.getElementById('refund-eligible');
  const $ineligible = document.getElementById('refund-ineligible');

  if ($eligible) {
    $eligible.classList.toggle('d-none', !isEligible);
  }
  if ($ineligible) {
    $ineligible.classList.toggle('d-none', isEligible);
  }
}

// ─── Refund Form ────────────────────────────────────────────

function setupRefundForm() {
  const $form = document.getElementById('refund-form');
  if (!$form) {
    return;
  }

  formManager = new FormManager('#refund-form', {
    allowResubmit: false,
    warnOnUnsavedChanges: false,
    submittingText: 'Processing refund...',
    submittedText: 'Refund Processed',
  });

  formManager.on('submit', async ({ data }) => {
    // Get selected reason from radio buttons
    const $selectedReason = document.querySelector('input[name="refund_reason"]:checked');
    const reason = $selectedReason?.value || '';

    if (!reason) {
      throw new Error('Please select a reason for your refund request.');
    }

    trackRefund('submit');

    const response = await omega.request(`/omega/payments/refund`, {
      method: 'POST',
      timeout: 30000,
      body: {
        confirmed: true,
        reason: reason,
        feedback: data.feedback || '',
      },
    });

    if (response.error) {
      throw new Error(response.message || 'Failed to process refund.');
    }

    // Build success message with refund details
    const refund = response.refund || {};
    const amount = refund.amount
      ? new Intl.NumberFormat('en-US', { style: 'currency', currency: (refund.currency || 'usd').toUpperCase() }).format(refund.amount)
      : '';
    const typeLabel = refund.full ? 'full' : 'prorated';
    const message = amount
      ? `Your ${typeLabel} refund of ${amount} has been processed. Your subscription has been cancelled.`
      : 'Your refund has been processed. Your subscription has been cancelled.';

    formManager.showSuccess(message);
  });
}

// ─── Reasons ────────────────────────────────────────────────

function populateRefundReasons() {
  const $container = document.getElementById('refund-reasons-container');
  if (!$container) {
    return;
  }

  const reasons = [...REFUND_REASONS];
  const other = reasons.pop(); // Remove 'Other' from the end
  const shuffled = [...shuffleArray(reasons), other]; // Shuffle rest, append 'Other' last

  $container.innerHTML = shuffled.map((reason, i) => `
    <div class="form-check mb-2">
      <input class="form-check-input" type="radio" name="refund_reason" id="refund-reason-${i}" value="${omega.utilities().escapeHTML(reason)}" required>
      <label class="form-check-label" for="refund-reason-${i}">${omega.utilities().escapeHTML(reason)}</label>
    </div>
  `).join('');
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ─── Tracking ───────────────────────────────────────────────

function trackRefund(action) {
  trackGoogle('event', 'refund_action', {
    action: action,
  });
  trackMeta('trackCustom', 'RefundAction', {
    action: action,
  });
  trackTikTok('ViewContent', {
    content_id: `refund-${action}`,
    content_type: 'product',
    content_name: `Refund ${action}`,
  });
}
