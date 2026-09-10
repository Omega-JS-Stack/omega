/**
 * Orders Section JavaScript
 *
 * The account's purchase history. A one-time purchase writes nothing to the
 * user doc, so before this section the only trace of one a customer could reach
 * was the receipt email — while the confirmation copy told them to find it in
 * their account ([#672](https://github.com/Omega-JS-Stack/omega/issues/672)).
 */

// Libraries
import omega from '@omega.js/client';
import { fetchOrders, requestRefundFor } from '../modules/orders.js';

// Status pill config — the billing card's own vocabulary (dot + label, never
// colour alone), so one purchase reads the same on both surfaces
const STATUS_CONFIG = {
  completed: { label: 'Paid', badgeClass: 'omega-status omega-status--ok', dotClass: 'omega-dot omega-dot--ok' },
  active: { label: 'Active', badgeClass: 'omega-status omega-status--ok', dotClass: 'omega-dot omega-dot--ok' },
  refunded: { label: 'Refunded', badgeClass: 'omega-status', dotClass: 'omega-dot omega-dot--muted' },
  cancelled: { label: 'Cancelled', badgeClass: 'omega-status', dotClass: 'omega-dot omega-dot--muted' },
  suspended: { label: 'Failed', badgeClass: 'omega-status omega-status--danger', dotClass: 'omega-dot omega-dot--danger' },
  failed: { label: 'Failed', badgeClass: 'omega-status omega-status--danger', dotClass: 'omega-dot omega-dot--danger' },
  // A purchase that never completed keeps the provider's own word for why
  // (the backend passes it through), and each of those words is a real state a
  // customer can read — without an entry they all rendered as "Unknown"
  open: { label: 'Unpaid', badgeClass: 'omega-status', dotClass: 'omega-dot omega-dot--muted' },
  payment_due: { label: 'Unpaid', badgeClass: 'omega-status', dotClass: 'omega-dot omega-dot--muted' },
  not_paid: { label: 'Failed', badgeClass: 'omega-status omega-status--danger', dotClass: 'omega-dot omega-dot--danger' },
  uncollectible: { label: 'Failed', badgeClass: 'omega-status omega-status--danger', dotClass: 'omega-dot omega-dot--danger' },
  unknown: { label: 'Unknown', badgeClass: 'omega-status', dotClass: 'omega-dot omega-dot--muted' },
};

// Initialize orders section
export function init() {
  setupRefundButtons();
}

// Load the purchase history
export async function loadData() {
  const $list = document.getElementById('orders-list');

  if (!$list) {
    return;
  }

  try {
    render(await fetchOrders());
  } catch (error) {
    console.error('Failed to load orders:', error);
    $list.innerHTML = message('We could not load your purchases right now. Please refresh the page to try again.');
  }
}

// ─── Rendering ──────────────────────────────────────────────

function render(orders) {
  const $list = document.getElementById('orders-list');
  const $badge = document.getElementById('orders-badge');

  if ($badge) {
    $badge.textContent = String(orders.length);
  }

  if (!$list) {
    return;
  }

  if (orders.length === 0) {
    $list.innerHTML = message('You have not made any purchases yet.');
    return;
  }

  $list.innerHTML = orders.map(row).join('');
}

function row(order) {
  const status = STATUS_CONFIG[order.status] || STATUS_CONFIG.unknown;
  const escape = (value) => omega.utilities().escapeHTML(String(value ?? ''));

  // A refunded purchase says so in its pill; only an order the BACKEND calls
  // refundable is offered the button, so a button here is a refund the route
  // takes (`refundable` comes from the refund policy both sides read).
  const refund = order.refundable
    ? `<button type="button" class="btn btn-sm btn-outline-adaptive" data-action="request-refund" data-order-id="${escape(order.id)}">Request a refund</button>`
    : '';

  return `
    <div class="list-group-item px-0">
      <div class="d-flex justify-content-between align-items-center gap-3">
        <div>
          <strong>${escape(order.productName || order.productId || 'Purchase')}</strong>
          <div class="text-muted small">
            <span class="font-monospace">#${escape(order.id)}</span>
            <span class="ms-2">${escape(formatDate(order.date?.timestampUNIX))}</span>
          </div>
        </div>
        <div class="text-end">
          <div>${escape(formatCurrency(order.amount, order.currency))}</div>
          <span class="${status.badgeClass}"><span class="${status.dotClass}"></span>${escape(status.label)}</span>
        </div>
      </div>
      ${refund ? `<div class="mt-2 text-end">${refund}</div>` : ''}
    </div>
  `;
}

function message(text) {
  return `<div class="text-center text-muted py-3">${omega.utilities().escapeHTML(text)}</div>`;
}

// ─── Refund handoff ─────────────────────────────────────────

// The button hands the pick to the shared module and switches to the Refund
// section, which reads it when it comes on screen. Delegated, because the rows
// are rendered after init() runs.
function setupRefundButtons() {
  const $list = document.getElementById('orders-list');

  if (!$list) {
    return;
  }

  $list.addEventListener('click', (event) => {
    const $button = event.target.closest('[data-action="request-refund"]');

    if (!$button) {
      return;
    }

    requestRefundFor($button.dataset.orderId);
    window.location.hash = '#refund';
  });
}

// ─── Formatting ─────────────────────────────────────────────

function formatDate(timestampUNIX) {
  if (!timestampUNIX) {
    return 'Unknown date';
  }

  return new Date(timestampUNIX * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatCurrency(amount, currency) {
  if (typeof amount !== 'number') {
    return '';
  }

  return new Intl.NumberFormat('en-US', { style: 'currency', currency: (currency || 'USD').toUpperCase() }).format(amount);
}
