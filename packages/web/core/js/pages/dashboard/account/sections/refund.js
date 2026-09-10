/**
 * Refund Section JavaScript
 */

// Libraries
import { FormManager } from '@omega.js/client/modules/form-manager.js';
import omega from '@omega.js/client';
import { event } from '__main_assets__/js/libs/analytics.js';
import { fetchOrders, refundableOrders, takeRefundRequest } from '../modules/orders.js';

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

// The one-time purchases the backend's refund lane would accept, as its own
// route answered ([#672](https://github.com/Omega-JS-Stack/omega/issues/672)).
// A one-time purchase touches no subscription state at all, so gating this
// section on `account.subscription` alone left the backend's complete one-time
// refund lane unreachable from the product.
let refundable = [];

// Initialize refund section
export async function init() {
  populateRefundReasons();
  setupRefundForm();
}

// Load refund section data
export async function loadData(account) {
  currentAccount = account;
  updateRefundEligibility(account);

  // The history decides half the eligibility, so the section re-reads itself
  // once it lands. A failed fetch leaves the subscription half exactly as it was.
  try {
    refundable = refundableOrders(await fetchOrders());
  } catch (error) {
    console.error('Failed to load refundable purchases:', error);
    return;
  }

  updateRefundEligibility(currentAccount);
}

// Called when section is shown
export function onShow() {
  if (currentAccount) {
    updateRefundEligibility(currentAccount);
  }

  // The order the customer pressed "Request a refund" on in the Orders list.
  // Read here rather than there: a section cannot write into a control that is
  // still hidden, and neither section learns the other's DOM.
  selectSubject(takeRefundRequest());
}

// ─── Eligibility ────────────────────────────────────────────

// Is the SUBSCRIPTION refundable? Its own rule, unchanged: the backend requires
// a cancelled or cancelling subscription before it will reverse its last charge.
function subscriptionEligible(account) {
  const subscription = account?.subscription || {};
  const resolved = omega.auth().resolveSubscription(account);
  const isPaid = subscription.product?.id !== 'basic' && !!subscription.product?.id;

  return isPaid && (subscription.status === 'cancelled' || resolved.cancelling);
}

function updateRefundEligibility(account) {
  const isEligible = subscriptionEligible(account) || refundable.length > 0;

  const $eligible = document.getElementById('refund-eligible');
  const $ineligible = document.getElementById('refund-ineligible');

  if ($eligible) {
    $eligible.classList.toggle('d-none', !isEligible);
  }
  if ($ineligible) {
    $ineligible.classList.toggle('d-none', isEligible);
  }

  populateSubjects(account);
}

// What this refund is ABOUT: the subscription, or one named purchase. The
// picker only appears when there is a choice to make — a subscription-only
// account sees the form it always saw.
function populateSubjects(account) {
  const $picker = document.getElementById('refund-subject-picker');
  const $subject = document.getElementById('refund-subject');

  if (!$subject) {
    return;
  }

  const options = [
    ...(subscriptionEligible(account) ? [{ value: '', label: `My subscription${account?.subscription?.product?.name ? ` (${account.subscription.product.name})` : ''}` }] : []),
    ...refundable.map((order) => ({
      value: order.id,
      label: `${order.productName || order.productId || 'Purchase'} — ${formatDate(order.date?.timestampUNIX)}${formatAmount(order)}`,
    })),
  ];

  $subject.innerHTML = options
    .map((option) => `<option value="${omega.utilities().escapeHTML(option.value)}">${omega.utilities().escapeHTML(option.label)}</option>`)
    .join('');

  if ($picker) {
    $picker.classList.toggle('d-none', options.length < 2);
  }
}

// Point the picker at one order, when the customer already said which.
function selectSubject(orderId) {
  const $subject = document.getElementById('refund-subject');

  if (!$subject || !orderId) {
    return;
  }

  $subject.value = orderId;
}

function formatDate(timestampUNIX) {
  if (!timestampUNIX) {
    return 'Unknown date';
  }

  return new Date(timestampUNIX * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatAmount(order) {
  if (typeof order.amount !== 'number') {
    return '';
  }

  return ` — ${new Intl.NumberFormat('en-US', { style: 'currency', currency: (order.currency || 'USD').toUpperCase() }).format(order.amount)}`;
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

    // An empty subject is the SUBSCRIPTION, which is what the route reads a
    // missing orderId as — one endpoint, two subjects (payments/refund/post.js).
    const orderId = document.getElementById('refund-subject')?.value || '';

    const response = await omega.request(`/omega/payments/refund`, {
      method: 'POST',
      timeout: 30000,
      body: {
        confirmed: true,
        reason: reason,
        feedback: data.feedback || '',
        ...(orderId ? { orderId: orderId } : {}),
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

    // A one-time refund cancels NOTHING — the purchase is simply reversed. Only
    // a subscription refund ends a subscription, and saying otherwise on a
    // one-time order tells the customer their plan just went away.
    const message = orderId
      ? `Your refund${amount ? ` of ${amount}` : ''} has been processed. It will appear on your statement within 5–10 business days.`
      : `Your ${refund.full ? 'full' : 'prorated'} refund${amount ? ` of ${amount}` : ''} has been processed. Your subscription has been cancelled.`;

    formManager.showSuccess(message);

    // The purchase is refunded now, so it is no longer refundable: re-read the
    // history rather than leaving a button that the route would refuse.
    if (orderId) {
      refundable = refundableOrders(await fetchOrders({ refresh: true }).catch(() => []));
      updateRefundEligibility(currentAccount);
    }
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
  event('user_refund_request', {
    action: action,
  });
}
