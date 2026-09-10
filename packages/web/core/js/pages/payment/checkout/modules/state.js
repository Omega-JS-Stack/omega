// State management for checkout
// Minimal mutable state -- everything else is derived by buildBindingsState()

import { calculatePrices } from './pricing.js';
import omega from '@omega.js/client';

// All supported billing frequencies
export const FREQUENCIES = ['daily', 'weekly', 'monthly', 'annually'];

// What a one-time buy bills on, which is nothing: `once` is not a cadence and
// is deliberately not in FREQUENCIES. It is still the word every reader
// downstream keys on — the intent payload, the intent doc, the confirmation
// URL, the receipt copy, the purchase pixel's `item_category` — so it is
// spelled here once ([#668](https://github.com/Omega-JS-Stack/omega/issues/668)).
export const ONE_TIME_FREQUENCY = 'once';

// The third answer a trial-eligibility check can produce, and it is NOT the
// same as "not eligible": the check timed out or failed, so nobody knows. The
// DISPLAY reads it conservatively (no trial quoted, the full amount due today
// — rule 3 never quotes a price the server has not confirmed), while the
// intent payload still ASKS for the trial, because the route re-checks and
// silently downgrades a buyer who does not qualify. Losing a trial to a slow
// network would cost a qualifying buyer their offer for nothing
// (Ian 2026-08-27, [#637](https://github.com/Omega-JS-Stack/omega/issues/637)).
export const TRIAL_ELIGIBILITY_UNKNOWN = 'unknown';

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
  // The server's answer: true, false, or TRIAL_ELIGIBILITY_UNKNOWN
  trialEligibility: TRIAL_ELIGIBILITY_UNKNOWN,
  // What the page DISPLAYS, which is only ever a confirmed yes
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

// Resolve price for a frequency. A catalog price is a bare number and nothing
// else — the config validator refuses the object shape, so this page and the
// backend can never read one entry differently
// ([#674](https://github.com/Omega-JS-Stack/omega/issues/674)).
function resolvePrice(product, frequency) {
  return Number(product?.prices?.[frequency]) || 0;
}

// Determine which frequencies a product supports based on its prices object
export function getAvailableFrequencies(product) {
  if (!product?.prices) return [];
  return FREQUENCIES.filter(f => resolvePrice(product, f) > 0);
}

/**
 * What this checkout bills on — the ONE place the answer is decided, for the
 * product being bought and for every product it is ever switched to.
 *
 * A one-time buy has no cadence to choose, so it is `once` OUTRIGHT: the URL
 * param and the price list only ever decide a SUBSCRIPTION's term. Falling
 * through to the cadence lane sent `frequency=annually` on a one-time checkout
 * — a product with no annual price, so the fallback picked the default — and
 * that word rode the intent payload all the way to the confirmation URL, where
 * the page polled the account for a plan a one-time purchase never writes and
 * sat on "still processing" until it timed out
 * ([#668](https://github.com/Omega-JS-Stack/omega/issues/668)).
 *
 * @param {object|null} product - the catalog product being bought
 * @param {string|null} frequencyParam - the URL's `frequency`, if any
 * @returns {string} the frequency this checkout runs on
 */
export function resolveFrequency(product, frequencyParam) {
  if (product?.type !== 'subscription') {
    return ONE_TIME_FREQUENCY;
  }

  const available = getAvailableFrequencies(product);

  if (frequencyParam && FREQUENCIES.includes(frequencyParam) && available.includes(frequencyParam)) {
    return frequencyParam;
  }

  // Longest term (last in FREQUENCIES order: daily < weekly < monthly < annually)
  return available[available.length - 1] || 'annually';
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

  // A price is a bare number on the product, and a frequency it has no price for
  // reads 0 — which is exactly what getAvailableFrequencies() filters on
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

  // A code that covers the WHOLE price leaves nothing to charge, and the two
  // providers this framework computes the amount for cannot take a $0.00
  // payment — the backend refuses that checkout before it reaches them
  // ([#786](https://github.com/Omega-JS-Stack/omega/issues/786)), so the buttons
  // that could only end there are not offered.
  //
  // A free TRIAL is never this case, and the backend agrees: nothing is charged
  // today (the provider's own trial cycle does that, and PayPal's setup-fee
  // discount is skipped outright on a trial), and the code comes off the first
  // PAID period later — so both buttons stay. It is read off the trial and the
  // DISCOUNT, never off `prices.total`, which a trial zeroes on its own.
  const fullyDiscounted = hasDiscount && !hasFreeTrial && prices.subtotal > 0 && prices.subtotal - prices.discountAmount <= 0;

  // What this checkout can still be paid with — built before the bindings
  // because the page has to know when the set is EMPTY.
  const paymentMethods = {
    card: !!(state.providers?.stripe?.publishableKey || state.providers?.chargebee?.site),
    paypal: !!state.providers?.paypal?.clientId && !fullyDiscounted,
    applePay: false,
    googlePay: false,
    // Crypto is the one method with a PRODUCT condition as well as a
    // provider one: Coinbase Commerce sells a single hosted charge and has
    // no recurring anything, so the backend's intent provider refuses a
    // subscription outright. A button offered there could only ever end in
    // the checkout's generic failure sentence
    // ([#642](https://github.com/Omega-JS-Stack/omega/issues/642)).
    // One-time ONLY, spelled positively: a product with no `type` is a
    // subscription to the backend intent route, so the button must not show.
    crypto: product?.type === 'one-time' && state.providers?.coinbase?.enabled === true && !fullyDiscounted,
  };

  // A brand selling through PayPal (and crypto) alone has NO method left once a
  // code covers the price, and the page's only "no payment methods" sentence is
  // an init-time read of the provider CONFIG — so the grid just emptied and the
  // page said nothing (#786). The sentence goes where the remedy is: the
  // discount field's own error line, which keeps the code removable. The
  // page-level error surface is not reusable here — it HIDES the whole checkout
  // (`@hide checkout.error.show`), taking the discount field with it.
  const noMethodsLeft = fullyDiscounted && !Object.values(paymentMethods).some(Boolean);
  const blockedMessage = noMethodsLeft
    ? `Discount code ${state.discountCode} covers the full price, and no payment method here can take a $0.00 charge. Remove the code to continue.`
    : '';

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
      },
      discount: {
        hasDiscount: hasDiscount,
        // What the receipt row's parenthetical says. A percent names itself;
        // a flat code names ITSELF, because "Discount ($10.00) −$10.00" says
        // the same number twice.
        label: state.discountPercent > 0 ? `${state.discountPercent}%` : (state.discountCode || ''),
        amount: prices.discountAmount.toFixed(2),
        loading: state.discountUI.loading,
        // A code the server accepted, that this brand can then charge nobody
        // with, is not a success the buyer can act on — it reads as the
        // refusal it is, on the one line beside the field it was typed in
        success: state.discountUI.success && !noMethodsLeft,
        error: state.discountUI.error || noMethodsLeft,
        successMessage: state.discountUI.message || 'Discount applied',
        errorMessage: noMethodsLeft ? blockedMessage : (state.discountUI.message || 'Invalid discount code'),
      },
      paymentMethods: paymentMethods,
      error: {
        show: state.error.show,
        message: state.error.message,
      },
    },
    // The half the SERVER decides (#637). Its own bindings root because a root
    // key is this system's unit of deferral: the page's build-config paint
    // publishes `checkout` alone, which leaves every spot below still wearing
    // its skeleton until trial eligibility has answered. Everything here reads
    // differently depending on that one answer, so it is written exactly once.
    order: {
      total: formatCurrency(prices.total),
      totalDueText: `${formatCurrency(prices.total)} due today`,
      showTerms: isSubscription,
      termsText: buildTermsText(product, cycle, hasFreeTrial, prices, hasDiscount),
      trial: {
        show: hasFreeTrial,
        hasFreeTrial: hasFreeTrial && prices.total === 0,
        // The length is the CATALOG's, never a framework constant (#273): a
        // trial the product doesn't sell fails `hasFreeTrial` and the sentence
        // never renders, so there is no number left to invent.
        message: hasFreeTrial ? `Start your ${product.trial.days}-day free trial today!` : '',
        discountAmount: prices.trialDiscountAmount.toFixed(2),
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

  // PayPal takes a code too since [#759](https://github.com/Omega-JS-Stack/omega/issues/759)
  // (a discounted first period, charged as the plan's setup fee), so the note
  // says the one thing that is still true of every code: it comes off once.
  const discountNote = hasDiscount ? ' Discount code applies to first payment only.' : '';

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
