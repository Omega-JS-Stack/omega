// State management for checkout
// Minimal mutable state -- everything else is derived by buildBindingsState()

import { calculatePrices } from './pricing.js';
import webManager from 'web-manager';

// All supported billing frequencies
export const FREQUENCIES = ['daily', 'weekly', 'monthly', 'annually'];

// Minimal mutable state
export const state = {
  // From config (stored once, never transformed)
  product: null,
  processors: null,

  // User selections
  frequency: 'annually',
  discountCode: null,
  discountPercent: 0,
  trialEligible: false,

  // UI state
  discountUI: { loading: false, success: false, error: false, message: '' },
  error: { show: false, message: '' },
};

// Resolve which processor handles a payment method
export function resolveProcessor(paymentMethod) {
  if (paymentMethod === 'card') {
    // Dev override
    const urlParams = new URLSearchParams(window.location.search);
    const forced = urlParams.get('_dev_cardProcessor');
    if (forced) return forced;

    // Prefer Stripe, fall back to Chargebee
    if (state.processors?.stripe?.publishableKey) return 'stripe';
    if (state.processors?.chargebee?.site) return 'chargebee';
    return 'stripe';
  }

  const map = { paypal: 'paypal', crypto: 'coinbase' };
  return map[paymentMethod] || paymentMethod;
}

// Resolve price for a frequency (handles both `{ amount: N }` and plain `N` formats)
function resolvePrice(product, frequency) {
  const entry = product?.prices?.[frequency];
  if (entry == null) return 0;
  return typeof entry === 'object' ? (entry.amount || 0) : Number(entry) || 0;
}

// Determine which frequencies a product supports based on its prices object
export function getAvailableFrequencies(product) {
  if (!product?.prices) return [];
  return FREQUENCIES.filter(f => resolvePrice(product, f) > 0);
}

// Build the complete bindings state from minimal state
// Returns a fresh object every time -- no mutation of shared references
export function buildBindingsState() {
  const product = state.product;
  const user = webManager.auth().getUser();
  const prices = calculatePrices(state);

  const isSubscription = product?.type === 'subscription';
  const hasFreeTrial = isSubscription && state.trialEligible && (product?.trial?.days > 0);
  const cycle = state.frequency;

  // Determine which frequencies are available for this product
  const availableFrequencies = getAvailableFrequencies(product);

  // Resolve prices using helper (handles both `N` and `{ amount: N }` formats)
  const monthlyPrice = resolvePrice(product, 'monthly');
  const annualPrice = resolvePrice(product, 'annually');
  const weeklyPrice = resolvePrice(product, 'weekly');
  const dailyPrice = resolvePrice(product, 'daily');
  const cyclePrice = resolvePrice(product, cycle);

  // Savings calculation (compare monthly annualized vs annual price)
  const monthlyTotal = monthlyPrice * 12;
  const savingsPercent = monthlyTotal > 0
    ? Math.round(((monthlyTotal - annualPrice) / monthlyTotal) * 100)
    : 0;

  // Frequency display text map
  const frequencyLabels = { daily: 'daily', weekly: 'weekly', monthly: 'monthly', annually: 'annually' };

  return {
    checkout: {
      product: {
        name: product?.name || 'Loading...',
        description: product?.description || '',
        isSubscription,
      },
      // Which frequency options to show (driven by product.prices)
      frequencies: {
        daily: availableFrequencies.includes('daily'),
        weekly: availableFrequencies.includes('weekly'),
        monthly: availableFrequencies.includes('monthly'),
        annually: availableFrequencies.includes('annually'),
      },
      pricing: {
        dailyPrice: formatCurrency(dailyPrice || null),
        weeklyPrice: formatCurrency(weeklyPrice || null),
        monthlyPrice: formatCurrency(monthlyPrice || null),
        annualMonthlyRate: formatCurrency(annualPrice ? annualPrice / 12 : null),
        savingsBadge: savingsPercent > 0 ? `Save ${savingsPercent}%` : '',
        showSavingsBadge: savingsPercent > 0,
        frequencyPaymentText: `${formatCurrency(cyclePrice)} ${frequencyLabels[cycle] || cycle}`,
        subtotal: formatCurrency(prices.subtotal),
        total: formatCurrency(prices.total),
        totalDueText: `${formatCurrency(prices.total)} due today`,
        recurringAmount: formatCurrency(prices.recurring),
        recurringPeriod: frequencyLabels[cycle] || cycle,
        showTerms: isSubscription,
        termsText: buildTermsText(product, cycle, hasFreeTrial, prices, state.discountPercent > 0),
      },
      trial: {
        show: hasFreeTrial,
        hasFreeTrial: hasFreeTrial && prices.total === 0,
        message: hasFreeTrial ? `Start your ${product?.trial?.days || 7}-day free trial today!` : '',
        discountAmount: prices.trialDiscountAmount.toFixed(2),
      },
      discount: {
        hasDiscount: state.discountPercent > 0,
        percent: state.discountPercent > 0 ? `${state.discountPercent}%` : '',
        amount: prices.discountAmount.toFixed(2),
        loading: state.discountUI.loading,
        success: state.discountUI.success,
        error: state.discountUI.error,
        successMessage: state.discountUI.message || 'Discount applied',
        errorMessage: state.discountUI.message || 'Invalid discount code',
      },
      paymentMethods: {
        card: !!(state.processors?.stripe?.publishableKey || state.processors?.chargebee?.site),
        paypal: !!state.processors?.paypal?.clientId,
        applePay: false,
        googlePay: false,
        crypto: state.processors?.coinbase?.enabled === true,
      },
      error: {
        show: state.error.show,
        message: state.error.message,
      },
    },
    auth: {
      user: {
        email: user?.email || '',
      },
    },
  };
}

// Format a number as currency, or return placeholder
function formatCurrency(amount) {
  if (amount == null || isNaN(amount)) return '$--';
  return `$${Number(amount).toFixed(2)}`;
}

// Map frequency to renewal period in days
const FREQUENCY_DAYS = { daily: 1, weekly: 7, monthly: 30, annually: 365 };

// Build subscription terms text
function buildTermsText(product, cycle, hasFreeTrial, prices, hasDiscount) {
  if (!product || product.type !== 'subscription') return '';

  const periodAdjectiveMap = { daily: 'daily', weekly: 'weekly', monthly: 'monthly', annually: 'annual' };
  const periodText = periodAdjectiveMap[cycle] || cycle;
  const renewalDate = new Date();
  const daysToAdd = hasFreeTrial
    ? (product.trial?.days || 7)
    : (FREQUENCY_DAYS[cycle] || 30);
  renewalDate.setDate(renewalDate.getDate() + daysToAdd);

  const formatted = renewalDate.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const discountNote = hasDiscount ? ' Discount code applies to first payment only and is not available with PayPal.' : '';

  if (hasFreeTrial) {
    return `You won't be charged for your free trial. On ${formatted}, your ${periodText} subscription will start and you'll be charged ${formatCurrency(prices.recurring)} plus applicable tax. Cancel anytime before then.${discountNote}`;
  }

  return `Your ${periodText} subscription will start today and renew on ${formatted} for ${formatCurrency(prices.recurring)} plus applicable tax. Cancel anytime.${discountNote}`;
}
