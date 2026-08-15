/**
 * Billing Section JavaScript
 */

// Libraries
import { FormManager } from '@omega.js/client/modules/form-manager.js';
import omega from '@omega.js/client';
import { createLogger } from '__main_assets__/js/libs/logger.js';
import { getAvailableFrequencies } from '../../../payment/checkout/modules/state.js';

const logger = createLogger('account:billing');

let paymentConfig = null;
let cancelFormManager = null;
let currentAccount = null;

// Whether the account's processor can do these at all is the BACKEND's answer
// (the capability gate): we attempt the route and branch on the code that comes
// back, never on a processor map here. A refusal retires the button for the
// session — the billing portal is the path that works for that processor.
let uncancelSupported = true;
let planSwitchSupported = true;

// Cancellation reasons (will be shuffled on each render)
const CANCEL_REASONS = [
  'Too expensive',
  'Not using it enough',
  'Missing features I need',
  'Found a better alternative',
  'Technical issues or bugs',
  'Just testing or temporary need',
  'Other',
];

// Status display configuration (classy status pill: dot + label, never color alone)
const STATUS_CONFIG = {
  free:       { label: 'Free',      badgeClass: 'omega-status',                       dotClass: 'omega-dot omega-dot--muted' },
  active:     { label: 'Active',    badgeClass: 'omega-status omega-status--ok',     dotClass: 'omega-dot omega-dot--ok' },
  trialing:   { label: 'Active',    badgeClass: 'omega-status omega-status--ok',     dotClass: 'omega-dot omega-dot--ok' },
  cancelling: { label: 'Active',    badgeClass: 'omega-status omega-status--ok',     dotClass: 'omega-dot omega-dot--ok' },
  suspended:  { label: 'Suspended', badgeClass: 'omega-status omega-status--danger', dotClass: 'omega-dot omega-dot--danger' },
  cancelled:  { label: 'Cancelled', badgeClass: 'omega-status',                       dotClass: 'omega-dot omega-dot--muted' },
};

const FREQUENCY_LABELS = { daily: 'day', weekly: 'week', monthly: 'month', annually: 'year' };

// Initialize billing section
export async function init() {
  setupActionButtons();
  setupCancellationForm();
  setupUncancelConfirm();
  setupPlanSwitcher();
}

// Load billing data
export async function loadData(account, sharedPaymentConfig) {
  if (!account) {
    return;
  }

  paymentConfig = sharedPaymentConfig;
  currentAccount = account;

  updateUI(account);
}

// Called when section is shown
export function onShow() {
  // Nothing needed
}

// ─── UI Update ──────────────────────────────────────────────

/* @dev-only:start */
{
  window._billing = {
    test: (account) => updateUI(account),
    state: () => buildBillingState(currentAccount),
    restore: () => { if (currentAccount) updateUI(currentAccount); },
  };
}
/* @dev-only:end */

function updateUI(account) {
  omega.bindings().update(buildBillingState(account));
  updateUsageInfo(account);
}

function buildBillingState(account) {
  const subscription = account?.subscription || {};
  const resolved = omega.auth().resolveSubscription(account);
  const rawStatus = subscription.status;
  const isPaid = subscription.product?.id !== 'basic' && !!subscription.product?.id;
  const displayName = getDisplayName(subscription);

  // Map raw + resolved state to UI config
  let configKey = 'free';
  if (isPaid) {
    if (rawStatus === 'suspended') configKey = 'suspended';
    else if (rawStatus === 'cancelled') configKey = 'cancelled';
    else if (resolved.active) configKey = 'active';
  }
  const config = STATUS_CONFIG[configKey] || STATUS_CONFIG.free;

  // Pre-format alert dates
  const cancelTimestamp = subscription.cancellation?.date?.timestampUNIX;
  const cancelDate = (cancelTimestamp && cancelTimestamp > 0)
    ? new Date(cancelTimestamp * 1000).toLocaleDateString()
    : 'the end of your billing period';

  const trialEndUnix = subscription.trial?.expires?.timestampUNIX;
  const trialEndDate = (trialEndUnix && trialEndUnix > 0)
    ? new Date(trialEndUnix * 1000).toLocaleDateString()
    : null;

  // Pre-format billing details
  const nextBillingUnix = subscription.expires?.timestampUNIX;
  const amount = subscription.payment?.price;
  const currency = paymentConfig?.currency || 'USD';
  const frequency = subscription.payment?.frequency;
  const hasValidBilling = nextBillingUnix && nextBillingUnix > 0 && amount;

  return {
    billing: {
      plan: {
        name: displayName,
      },
      status: {
        label: config.label,
        badgeClass: config.badgeClass,
        dotClass: config.dotClass,
      },
      description: {
        free: !isPaid,
        active: resolved.active,
        suspended: rawStatus === 'suspended',
        cancelled: rawStatus === 'cancelled',
      },
      alerts: {
        suspended: rawStatus === 'suspended',
        cancelling: resolved.cancelling,
        trialing: resolved.trialing,
        cancelDate: cancelDate,
        trialEndDate: trialEndDate || '',
        trialHasEndDate: !!trialEndDate,
      },
      details: {
        visible: resolved.active && !!hasValidBilling,
        nextDate: hasValidBilling ? new Date(nextBillingUnix * 1000).toLocaleDateString() : '',
        amount: hasValidBilling ? `${formatCurrency(amount, currency)} / ${FREQUENCY_LABELS[frequency] || 'month'}` : '',
      },
      buttons: {
        upgrade: !isPaid || rawStatus === 'cancelled',
        change: planSwitchSupported && resolved.active,
        manage: isPaid && rawStatus !== 'cancelled',
        cancel: isPaid && rawStatus !== 'cancelled' && !resolved.cancelling,
        uncancel: uncancelSupported && isPaid && rawStatus === 'active' && resolved.cancelling,
      },
    },
  };
}

// ─── Action Buttons ──────────────────────────────────────────

function setupActionButtons() {
  const $upgradeBtn = document.getElementById('upgrade-plan-btn');
  const $changeBtn = document.getElementById('change-plan-btn');
  const $manageBtn = document.getElementById('manage-billing-btn');

  if ($upgradeBtn) {
    $upgradeBtn.addEventListener('click', () => {
      trackBilling('upgrade_click');
      window.location.href = '/pricing';
    });
  }

  // The plan switcher modal itself opens declaratively (data-bs-toggle), the
  // same way the signin link modal does — this only records the intent
  if ($changeBtn) {
    $changeBtn.addEventListener('click', () => {
      trackBilling('change_plan_click');
    });
  }

  if ($manageBtn) {
    $manageBtn.addEventListener('click', () => {
      trackBilling('manage_billing_click');
      openBillingPortal();
    });
  }
}

// ─── Billing Portal ─────────────────────────────────────────

async function openBillingPortal() {
  const $manageBtn = document.getElementById('manage-billing-btn');
  const $btnText = $manageBtn?.querySelector('.button-text');
  const originalText = $btnText?.textContent;

  try {
    // Show loading state
    if ($manageBtn) $manageBtn.disabled = true;
    if ($btnText) $btnText.textContent = 'Opening...';

    const response = await omega.request(`/omega/payments/portal`, {
      method: 'POST',
      timeout: 15000,
      body: {
        returnUrl: window.location.href,
      },
    });

    if (response.url) {
      window.open(response.url, '_blank');
    } else {
      throw new Error('No portal URL returned');
    }
  } catch (error) {
    console.error('Failed to open billing portal:', error);
    omega.utilities().showNotification(error.message || 'Failed to open billing portal. Please try again later.', 'danger');
  } finally {
    if ($manageBtn) $manageBtn.disabled = false;
    if ($btnText) $btnText.textContent = originalText;
  }
}

// ─── Undo Cancellation ──────────────────────────────────────

function setupUncancelConfirm() {
  const $confirmBtn = document.getElementById('uncancel-confirm-btn');
  if (!$confirmBtn) {
    return;
  }

  $confirmBtn.addEventListener('click', () => uncancelSubscription($confirmBtn));
}

// Withdraw the scheduled cancellation so the subscription just keeps renewing.
// Nothing is charged today — the processor resumes the existing term.
async function uncancelSubscription($confirmBtn) {
  const $btnText = $confirmBtn.querySelector('.button-text');
  const originalText = $btnText?.textContent;

  trackBilling('uncancel_submit');

  try {
    // Show loading state
    $confirmBtn.disabled = true;
    if ($btnText) $btnText.textContent = 'Resuming...';

    await omega.request(`/omega/payments/uncancel`, {
      method: 'POST',
      timeout: 30000,
      body: {
        confirmed: true,
      },
    });

    logger.log('Cancellation withdrawn:', { productId: currentAccount?.subscription?.product?.id });

    // The webhook pipeline writes the real state — patch locally so the card
    // stops saying "cancellation scheduled" the moment the route succeeds
    const currentSub = currentAccount?.subscription;
    if (currentSub) {
      currentSub.cancellation = { pending: false };
      updateUI(currentAccount);
    }

    collapseUncancelConfirm();

    omega.utilities().showNotification('Your subscription will continue as normal. You were not charged today.', 'success');
  } catch (error) {
    logger.error('Failed to withdraw cancellation:', error);

    // The processor cannot resume a subscription AT ALL (the backend's
    // capability gate). The button is a dead end for this account, so retire it
    // for the session — the message already points at the billing portal, which
    // is the "Manage billing" button right beside it.
    if (error.properties?.additional?.code === 'not-supported-by-processor') {
      uncancelSupported = false;
      updateUI(currentAccount);
      collapseUncancelConfirm();
      omega.utilities().showNotification(error.message, { type: 'warning', timeout: 8000 });
    } else {
      omega.utilities().showNotification(error.message || 'Failed to resume your subscription. Please try again later.', 'danger');
    }
  } finally {
    $confirmBtn.disabled = false;
    if ($btnText) $btnText.textContent = originalText;
  }
}

function collapseUncancelConfirm() {
  const $confirm = document.getElementById('uncancel-subscription-confirm');
  if (!$confirm) {
    return;
  }

  const bsCollapse = bootstrap.Collapse.getInstance($confirm);
  if (bsCollapse) bsCollapse.hide();
}

// ─── Plan Switcher ──────────────────────────────────────────

function setupPlanSwitcher() {
  const $modal = document.getElementById('change-plan-modal');
  if (!$modal) {
    return;
  }

  const $options = document.getElementById('change-plan-options');
  const $confirmBtn = document.getElementById('change-plan-confirm-btn');

  // Rebuild the picker every time it opens — the plan it must exclude is
  // whatever the account is on right now
  $modal.addEventListener('show.bs.modal', () => {
    populatePlanOptions($options);
    $confirmBtn.disabled = true;
  });

  // Nothing to confirm until a plan is picked
  $options.addEventListener('change', () => {
    $confirmBtn.disabled = !getSelectedPlan();
  });

  $confirmBtn.addEventListener('click', () => changePlan($confirmBtn, $modal));
}

// Every subscription plan the brand sells, at every frequency it sells it at,
// minus the one the account is already on
function populatePlanOptions($container) {
  const subscription = currentAccount?.subscription || {};
  const currentProductId = subscription.product?.id;
  const currentFrequency = subscription.payment?.frequency;
  const currency = paymentConfig?.currency || 'USD';

  const options = (paymentConfig?.products || [])
    .filter(product => (product.type || 'subscription') === 'subscription' && product.id !== 'basic')
    .flatMap(product => getAvailableFrequencies(product).map(frequency => ({ product, frequency })))
    .filter(({ product, frequency }) => !(product.id === currentProductId && frequency === currentFrequency));

  if (options.length === 0) {
    $container.innerHTML = '<div class="text-muted small">There are no other plans to switch to right now.</div>';
    return;
  }

  $container.innerHTML = options.map(({ product, frequency }, i) => `
    <div class="form-check mb-2">
      <input class="form-check-input" type="radio" name="change_plan_option" id="change-plan-option-${i}" value="${omega.utilities().escapeHTML(product.id)}" data-frequency="${omega.utilities().escapeHTML(frequency)}">
      <label class="form-check-label" for="change-plan-option-${i}">
        <strong>${omega.utilities().escapeHTML(product.name || product.id)}</strong>
        <span class="text-muted">&mdash; ${omega.utilities().escapeHTML(formatCurrency(resolvePlanPrice(product, frequency), currency))} / ${FREQUENCY_LABELS[frequency] || frequency}</span>
      </label>
    </div>
  `).join('');
}

function getSelectedPlan() {
  const $selected = document.querySelector('input[name="change_plan_option"]:checked');
  if (!$selected) {
    return null;
  }

  return { productId: $selected.value, frequency: $selected.dataset.frequency };
}

// Move the live subscription onto another plan. The processor prorates the
// difference — no cancel-and-resubscribe, no second checkout.
async function changePlan($confirmBtn, $modal) {
  const selection = getSelectedPlan();
  if (!selection) {
    return;
  }

  const $btnText = $confirmBtn.querySelector('.button-text');
  const originalText = $btnText?.textContent;

  trackBilling('change_plan_submit');

  try {
    // Show loading state
    $confirmBtn.disabled = true;
    if ($btnText) $btnText.textContent = 'Changing...';

    await omega.request(`/omega/payments/plan`, {
      method: 'POST',
      timeout: 30000,
      body: {
        productId: selection.productId,
        frequency: selection.frequency,
        confirmed: true,
      },
    });

    logger.log('Plan change requested:', selection);

    // The webhook pipeline writes the real state — patch locally so the card
    // shows the plan they just picked
    const currentSub = currentAccount?.subscription;
    const product = paymentConfig?.products?.find(candidate => candidate.id === selection.productId);
    if (currentSub && product) {
      currentSub.product = { id: product.id, name: product.name };
      currentSub.payment = {
        ...currentSub.payment,
        frequency: selection.frequency,
        price: resolvePlanPrice(product, selection.frequency),
      };

      updateUI(currentAccount);
    }

    hidePlanSwitcher($modal);

    omega.utilities().showNotification(`You're now on the ${product?.name || selection.productId} plan. Your next invoice reflects the change.`, 'success');
  } catch (error) {
    logger.error('Failed to change plan:', error);

    // Same capability gate as uncancel: the processor cannot move a live
    // subscription at all, so retire the button for the session and let the
    // message send them to the billing portal
    if (error.properties?.additional?.code === 'not-supported-by-processor') {
      planSwitchSupported = false;
      updateUI(currentAccount);
      hidePlanSwitcher($modal);
      omega.utilities().showNotification(error.message, { type: 'warning', timeout: 8000 });
    } else {
      omega.utilities().showNotification(error.message || 'Failed to change your plan. Please try again later.', 'danger');
    }
  } finally {
    $confirmBtn.disabled = false;
    if ($btnText) $btnText.textContent = originalText;
  }
}

function hidePlanSwitcher($modal) {
  const bsModal = bootstrap.Modal.getInstance($modal);
  if (bsModal) bsModal.hide();
}

// ─── Cancellation Form ──────────────────────────────────────

function setupCancellationForm() {
  const $form = document.getElementById('cancel-subscription-form');
  if (!$form) {
    return;
  }

  // Populate randomized reasons
  populateCancelReasons();

  cancelFormManager = new FormManager('#cancel-subscription-form', {
    allowResubmit: false,
    warnOnUnsavedChanges: false,
    submittingText: 'Cancelling...',
    submittedText: 'Subscription Cancelled',
  });

  cancelFormManager.on('submit', async ({ data }) => {
    // Get selected reason
    const $selectedReason = document.querySelector('input[name="cancel_reason"]:checked');
    const reason = $selectedReason?.value || '';

    // Capture state BEFORE the API call — the auth listener may update currentAccount
    // with Firestore data (cancellation.pending=true) before we reach the post-cancel code
    const resolvedBeforeCancel = omega.auth().resolveSubscription(currentAccount);
    const isTrialCancel = resolvedBeforeCancel.trialing;

    logger.log('Cancelling:', { plan: resolvedBeforeCancel.plan, isTrialCancel });

    trackBilling('cancel_submit');

    const response = await omega.request(`/omega/payments/cancel`, {
      method: 'POST',
      timeout: 30000,
      body: {
        reason: reason,
        feedback: data.feedback || '',
        confirmed: true,
      },
    });

    if (response.error) {
      throw new Error(response.message || 'Failed to cancel subscription. Please try again.');
    }

    logger.log('Cancel complete:', { isTrialCancel, productId: currentAccount?.subscription?.product?.id });

    if (isTrialCancel) {
      cancelFormManager.showSuccess('Your trial has been cancelled. You\'ve been moved to the free plan. You can subscribe again anytime.');
    } else {
      cancelFormManager.showSuccess('Your subscription has been cancelled. You\'ll continue to have access until the end of your current billing period.');
    }

    // Collapse the cancel form after a short delay
    setTimeout(() => {
      const $accordion = document.getElementById('cancel-subscription-accordion');
      if ($accordion) {
        const bsCollapse = bootstrap.Collapse.getInstance($accordion);
        if (bsCollapse) bsCollapse.hide();
      }
    }, 1000);

    // Update the UI to reflect cancellation
    // Re-read currentAccount.subscription since the auth listener may have replaced it
    const currentSub = currentAccount?.subscription;
    if (currentSub) {
      if (isTrialCancel) {
        // Trial cancellations are immediate — downgrade to basic
        currentSub.status = 'cancelled';
        currentSub.product = { id: 'basic', name: 'Basic' };
        currentSub.cancellation = {
          pending: false,
          date: {
            timestamp: new Date().toISOString(),
            timestampUNIX: Math.floor(Date.now() / 1000),
          },
        };
      } else {
        // Non-trial cancellations are pending until end of billing period
        const expiresUnix = currentSub.expires?.timestampUNIX || 0;
        currentSub.cancellation = {
          pending: true,
          date: {
            timestamp: new Date(expiresUnix * 1000).toISOString(),
            timestampUNIX: expiresUnix,
          },
        };
      }

      logger.log('UI update after cancel:', { status: currentSub.status, productId: currentSub.product?.id, cancellationPending: currentSub.cancellation?.pending });

      updateUI(currentAccount);
    }
  });
}

function populateCancelReasons() {
  const $container = document.getElementById('cancel-reasons-container');
  if (!$container) {
    return;
  }

  const reasons = [...CANCEL_REASONS];
  const other = reasons.pop(); // Remove 'Other' from the end
  const shuffled = [...shuffleArray(reasons), other]; // Shuffle rest, append 'Other' last

  $container.innerHTML = shuffled.map((reason, i) => `
    <div class="form-check mb-2">
      <input class="form-check-input" type="radio" name="cancel_reason" id="cancel-reason-${i}" value="${omega.utilities().escapeHTML(reason)}">
      <label class="form-check-label" for="cancel-reason-${i}">${omega.utilities().escapeHTML(reason)}</label>
    </div>
  `).join('');
}

// ─── Usage Metrics ───────────────────────────────────────────

function updateUsageInfo(account) {
  const subscription = account.subscription || {};
  const $container = document.getElementById('usage-metrics-container');

  if (!$container) {
    return;
  }

  // Use the effective plan for usage limits (basic if cancelled/suspended)
  const resolved = omega.auth().resolveSubscription(account);
  const product = paymentConfig?.products?.find(p => p.id === resolved.plan);
  const limits = product?.limits || {};

  // Clear container
  $container.innerHTML = '';

  // Get product limits from app data
  if (!product || !limits || Object.keys(limits).length === 0) {
    $container.innerHTML = '<div class="text-muted">Usage tracking not available for this plan.</div>';
    return;
  }

  // Get actual usage from account
  const usage = account.usage || {};

  // Create a usage bar for each metric in limits
  Object.entries(limits).forEach(([metricId, limit]) => {
    const metricUsage = usage[metricId] || {};
    const used = metricUsage.period || 0;

    const isUnlimited = limit === -1;
    const usagePercent = isUnlimited ? 0 : Math.min(100, Math.round((used / limit) * 100));

    let progressClass = 'bg-success';
    if (!isUnlimited && usagePercent >= 80) {
      progressClass = 'bg-danger';
    } else if (!isUnlimited && usagePercent >= 50) {
      progressClass = 'bg-warning';
    }

    const metricName = formatMetricName(metricId);
    const formattedUsed = formatMetricValue(metricId, used);
    const formattedLimit = isUnlimited ? '∞' : formatMetricValue(metricId, limit);

    $container.innerHTML += `
      <div class="mb-3">
        <div class="d-flex justify-content-between align-items-center mb-1">
          <small class="text-muted fw-semibold">${omega.utilities().escapeHTML(metricName)}</small>
          <small class="text-muted">${omega.utilities().escapeHTML(formattedUsed)} / ${omega.utilities().escapeHTML(formattedLimit)}</small>
        </div>
        <div class="progress" style="height: 20px;">
          <div class="progress-bar ${progressClass}" role="progressbar"
               style="width: ${usagePercent}%"
               aria-valuenow="${usagePercent}"
               aria-valuemin="0"
               aria-valuemax="100">
            ${usagePercent}%
          </div>
        </div>
      </div>
    `;
  });

  if ($container.innerHTML === '') {
    $container.innerHTML = '<div class="text-muted">No usage data available.</div>';
  }
}

// ─── Helpers ─────────────────────────────────────────────────

function getDisplayName(subscription) {
  // Use backend-provided product name first
  if (subscription.product?.name && subscription.product.name !== 'Basic') {
    return subscription.product.name;
  }

  // Fall back to config product name
  const productId = subscription.product?.id || 'basic';
  const product = paymentConfig?.products?.find(p => p.id === productId);
  return product?.name || 'Free';
}

// A plan's price at one frequency (a price entry is either `{ amount: N }` or
// a plain `N`, the same two shapes checkout resolves)
function resolvePlanPrice(product, frequency) {
  const entry = product.prices?.[frequency];
  if (entry == null) {
    return 0;
  }

  return typeof entry === 'object' ? (entry.amount || 0) : Number(entry) || 0;
}

function formatCurrency(amount, currency) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: (currency || 'USD').toUpperCase(),
  }).format(amount); // amount is already in display dollars
}

function formatMetricName(metricId) {
  const names = {
    requests: 'API Requests',
    tokens: 'Tokens',
    storage: 'Storage',
    bandwidth: 'Bandwidth',
    users: 'Users',
    projects: 'Projects',
  };
  return names[metricId] || metricId.charAt(0).toUpperCase() + metricId.slice(1);
}

function formatMetricValue(metricId, value) {
  if (metricId === 'storage' || metricId === 'bandwidth') {
    return formatBytes(value);
  }
  return value.toLocaleString();
}

function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) {
    return '0 Bytes';
  }

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ─── Tracking ────────────────────────────────────────────────

function trackBilling(action) {
  gtag('event', 'billing_action', {
    action: action,
  });
  fbq('trackCustom', 'BillingAction', {
    action: action,
  });
  ttq.track('ViewContent', {
    content_id: `billing-${action}`,
    content_type: 'product',
    content_name: `Billing ${action}`,
  });
}
