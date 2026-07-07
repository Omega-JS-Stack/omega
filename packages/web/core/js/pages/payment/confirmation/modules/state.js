// State management for confirmation page
// Minimal mutable state -- everything else is derived by buildBindingsState()

// Minimal mutable state
export const state = {
  // Raw values from URL params (never formatted)
  orderId: '',
  productId: '',
  productName: '',
  amount: 0,
  currency: 'USD',
  frequency: '',
  paymentMethod: '',
  hasFreeTrial: false,

  // UI state
  loaded: false,
};

// Build the complete bindings state from minimal state
// Returns a fresh object every time -- no mutation of shared references
export function buildBindingsState() {
  const isSubscription = !!state.frequency;

  const FREQUENCY_MAP = {
    daily: { cycle: 'daily', period: 'day' },
    weekly: { cycle: 'weekly', period: 'week' },
    monthly: { cycle: 'monthly', period: 'month' },
    annually: { cycle: 'annually', period: 'year' },
  };
  const freq = FREQUENCY_MAP[state.frequency] || { cycle: '', period: '' };
  const billingCycleText = freq.cycle;
  const billingPeriodText = freq.period;

  // Build subscription info text
  let subscriptionInfoText = '';
  if (isSubscription) {
    if (state.hasFreeTrial) {
      subscriptionInfoText = `Free Trial Active! Your trial period has begun. You'll be charged ${billingCycleText} after the trial ends.`;
    } else {
      subscriptionInfoText = `Your ${billingCycleText} subscription is now active. You'll be charged automatically each ${billingPeriodText}.`;
    }
  }

  return {
    confirmation: {
      order: {
        id: state.orderId || 'Loading...',
        productName: state.productName || state.productId || 'Product',
        total: formatCurrency(state.amount),
        currency: state.currency,
      },
      subscription: {
        show: isSubscription,
        hasFreeTrial: state.hasFreeTrial,
        billingCycle: billingCycleText,
        infoText: subscriptionInfoText,
      },
      loaded: state.loaded,
    },
  };
}

// Format a number as currency, or return placeholder
function formatCurrency(amount) {
  if (amount == null || isNaN(amount)) return '$--';
  return `$${Number(amount).toFixed(2)}`;
}
