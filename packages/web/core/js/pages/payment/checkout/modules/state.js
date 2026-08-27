// State management for checkout
// Minimal mutable state -- everything else is derived by buildBindingsState()

import { calculatePrices } from './pricing.js';
import omega from '@omega.js/client';

// All supported billing frequencies
export const FREQUENCIES = ['daily', 'weekly', 'monthly', 'annually'];

// Minimal mutable state
export const state = {
  // From config (stored once, never transformed)
  product: null,
  providers: null,

  // User selections
  frequency: 'annually',
  discountCode: null,
  // A code takes off a PERCENT of the price or a flat AMOUNT of money — the
  // server returns one shape or the other, so exactly one of these is ever
  // non-zero
  discountPercent: 0,
  discountAmount: 0,
  // How far the code reaches: 'once' (the first payment only, what every
  // configured code is) vs a duration that rides every renewal (#254)
  discountDuration: null,
  trialEligible: false,

  // UI state
  discountUI: { loading: false, success: false, error: false, message: '' },
  error: { show: false, message: '' },
};

// Resolve which provider handles a payment method
export function resolveProvider(paymentMethod) {
  if (paymentMethod === 'card') {
    /* @dev-only:start */
    {
      // The dev palette's card-provider override, a URL param like every
      // other checkout dev control. The read lives INSIDE the block, so
      // production never looks and the literal never reaches a real bundle
      // (#235) — a visitor can't point a real checkout at another provider.
      if (omega.isDevelopment()) {
        const forced = new URLSearchParams(window.location.search).get('_dev_cardProvider');
        if (forced) return forced;
      }
    }
    /* @dev-only:end */

    // Prefer Stripe, fall back to Chargebee
    if (state.providers?.stripe?.publishableKey) return 'stripe';
    if (state.providers?.chargebee?.site) return 'chargebee';
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
  const user = omega.auth().getUser();
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

  // A discount is in force in EITHER shape. Reading only the percent reported
  // no discount for a flat code, so the receipt showed full price while the
  // backend went on to charge the discounted one.
  const hasDiscount = state.discountPercent > 0 || state.discountAmount > 0;

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
        // `once` is not a cadence (#558, the checkout-side sibling of #282):
        // `cycle` is the URL default for EVERY product, so pricing a one-time
        // buy by cycle quoted "$0.00 annually" under a $49.99 product while
        // the rows beneath it said $49.99. calculatePrices() is the one place
        // that knows the `once` key, and its subtotal is the list price the
        // summary line names.
        frequencyPaymentText: isSubscription
          ? `${formatCurrency(cyclePrice)} ${frequencyLabels[cycle] || cycle}`
          : `${formatCurrency(prices.subtotal)} one-time`,
        subtotal: formatCurrency(prices.subtotal),
        total: formatCurrency(prices.total),
        totalDueText: `${formatCurrency(prices.total)} due today`,
        showTerms: isSubscription,
        termsText: buildTermsText(product, cycle, hasFreeTrial, prices, hasDiscount),
      },
      trial: {
        show: hasFreeTrial,
        hasFreeTrial: hasFreeTrial && prices.total === 0,
        // The length is the CATALOG's, never a framework constant (#273): a
        // trial the product doesn't sell fails `hasFreeTrial` and the sentence
        // never renders, so there is no number left to invent.
        message: hasFreeTrial ? `Start your ${product.trial.days}-day free trial today!` : '',
        discountAmount: prices.trialDiscountAmount.toFixed(2),
      },
      discount: {
        hasDiscount: hasDiscount,
        // What the receipt row's parenthetical says. A percent names itself;
        // a flat code names ITSELF, because "Discount ($10.00) −$10.00" says
        // the same number twice.
        label: state.discountPercent > 0 ? `${state.discountPercent}%` : (state.discountCode || ''),
        amount: prices.discountAmount.toFixed(2),
        loading: state.discountUI.loading,
        success: state.discountUI.success,
        error: state.discountUI.error,
        successMessage: state.discountUI.message || 'Discount applied',
        errorMessage: state.discountUI.message || 'Invalid discount code',
      },
      paymentMethods: {
        card: !!(state.providers?.stripe?.publishableKey || state.providers?.chargebee?.site),
        paypal: !!state.providers?.paypal?.clientId,
        applePay: false,
        googlePay: false,
        crypto: state.providers?.coinbase?.enabled === true,
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

// Format a number as currency, or return placeholder. Exported because it is
// the page's ONE money format: the discount module's success message speaks it
// too ("$10.00 off"), rather than growing a second one.
export function formatCurrency(amount) {
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
  // Same catalog number the trial message states (#273) — the date the first
  // charge lands on is the trial's own length, not a default one.
  const daysToAdd = hasFreeTrial
    ? product.trial.days
    : (FREQUENCY_DAYS[cycle] || 30);
  renewalDate.setDate(renewalDate.getDate() + daysToAdd);

  const formatted = renewalDate.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const discountNote = hasDiscount ? ' Discount code applies to first payment only and is not available with PayPal.' : '';

  if (hasFreeTrial) {
    // The charge that lands when the trial ends is the FIRST invoice, and a
    // first-payment code is attached to exactly that one (the intent route
    // sends the `once` coupon alongside the trial — intent/providers/
    // stripe.js). So the trial line prices the first charge DISCOUNTED and
    // names the renewal price separately; quoting list price here promised a
    // bigger first charge than the card will see (#254).
    const firstCharge = prices.subtotal - prices.discountAmount;
    const renewalNote = firstCharge !== prices.recurring
      ? ` It renews at ${formatCurrency(prices.recurring)} after that.`
      : '';

    return `You won't be charged for your free trial. On ${formatted}, your ${periodText} subscription will start and you'll be charged ${formatCurrency(firstCharge)} plus applicable tax.${renewalNote} Cancel anytime before then.${discountNote}`;
  }

  return `Your ${periodText} subscription will start today and renew on ${formatted} for ${formatCurrency(prices.recurring)} plus applicable tax. Cancel anytime.${discountNote}`;
}
