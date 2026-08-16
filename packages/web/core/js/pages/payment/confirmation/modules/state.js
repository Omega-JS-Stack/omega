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

  // Whether the purchase has actually landed in the account yet (#232). The
  // page opens UNSURE — the redirect is the processor's claim, and the webhook
  // that grants entitlement arrives after the browser does.
  // 'processing' | 'confirmed' | 'timeout'
  status: 'processing',

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
        // "Your subscription is now active" is a claim about the account, so it
        // waits for the account to say so (#232)
        show: isSubscription && state.status === 'confirmed',
        hasFreeTrial: state.hasFreeTrial,
        billingCycle: billingCycleText,
        infoText: subscriptionInfoText,
      },
      // Which of the three moments the page is rendering (#232). Only
      // `confirmed` may say the words "payment received".
      verification: {
        processing: state.status === 'processing',
        confirmed: state.status === 'confirmed',
        timedOut: state.status === 'timeout',
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
