// State management for confirmation page
// Minimal mutable state -- everything else is derived by buildBindingsState()

import { FREQUENCIES, ONE_TIME_FREQUENCY } from '../../checkout/modules/state.js';

// Minimal mutable state
export const state = {
  // Raw values from URL params (never formatted)
  orderId: '',
  productId: '',
  productName: '',
  amount: 0,
  currency: 'USD',
  // What was bought, straight off the redirect the intent route builds
  // ('subscription' | 'one-time'): the one thing here that does not have to be
  // inferred from the cadence beside it (#668)
  type: '',
  frequency: '',
  paymentMethod: '',
  hasFreeTrial: false,

  // Whether the purchase has actually landed in the account yet (#232). The
  // page opens UNSURE — the redirect is the provider's claim, and the webhook
  // that grants entitlement arrives after the browser does.
  // 'processing' | 'confirmed' | 'timeout'
  status: 'processing',

  // UI state
  loaded: false,
};

// Build the complete bindings state from minimal state
// Returns a fresh object every time -- no mutation of shared references
export function buildBindingsState() {
  // Only the cadences checkout SELLS renew (#282). A one-time buy arrives as
  // `frequency=once`, which reading `!!state.frequency` called a subscription:
  // every one-time receipt got the subscription sentence with its cycle slots
  // empty, because `once` is not a cadence and the map below has no row for it.
  // The same list decides what verify.js can poll the account for (#232).
  const isSubscription = FREQUENCIES.includes(state.frequency);
  const isOneTime = state.frequency === ONE_TIME_FREQUENCY;

  const FREQUENCY_MAP = {
    // `cycle` is the adverb ("charged annually"); `adjective` is the noun
    // modifier ("annual subscription") — "annually subscription" was the tell.
    daily: { cycle: 'daily', adjective: 'daily', period: 'day' },
    weekly: { cycle: 'weekly', adjective: 'weekly', period: 'week' },
    monthly: { cycle: 'monthly', adjective: 'monthly', period: 'month' },
    annually: { cycle: 'annually', adjective: 'annual', period: 'year' },
  };
  const freq = FREQUENCY_MAP[state.frequency] || { cycle: '', adjective: '', period: '' };
  const billingCycleText = freq.cycle;
  const billingAdjectiveText = freq.adjective;
  const billingPeriodText = freq.period;

  // Build subscription info text
  let subscriptionInfoText = '';
  if (isSubscription) {
    if (state.hasFreeTrial) {
      subscriptionInfoText = `Free Trial Active! Your trial period has begun. You'll be charged ${billingCycleText} after the trial ends.`;
    } else {
      subscriptionInfoText = `Your ${billingAdjectiveText} subscription is now active. You'll be charged automatically each ${billingPeriodText}.`;
    }
  }

  // The one-time buy's own note: what it needs to hear is that nothing else is
  // coming, which is the opposite of everything the subscription copy says.
  const purchaseInfoText = isOneTime
    ? 'This is a one-time purchase. There is nothing to renew and nothing to cancel.'
    : '';

  return {
    confirmation: {
      order: {
        id: state.orderId || 'Loading...',
        // "Plan" is subscription language on a one-time buy (#282)
        itemLabel: isOneTime ? 'Item' : 'Plan',
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
      purchase: {
        // The same gate the subscription note sits behind: a note about what
        // was bought waits until the purchase is known to have landed (#232)
        show: isOneTime && state.status === 'confirmed',
        infoText: purchaseInfoText,
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
