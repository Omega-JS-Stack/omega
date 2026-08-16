// Pure pricing calculation -- no side effects, no state mutation

// Resolve price for a frequency (handles both `{ amount: N }` and plain `N` formats)
function resolvePrice(prices, key) {
  const entry = prices?.[key];
  if (entry == null) return 0;
  return typeof entry === 'object' ? (entry.amount || 0) : Number(entry) || 0;
}

// A discount code comes in one of TWO shapes, and the server returns exactly
// one of them: `discountPercent` (a share of the price) or `discountAmount` (a
// flat sum, `flatDiscount` here — the RETURNED `discountAmount` is the money
// that actually came off, which is what the receipt row prices against).
export function calculatePrices({ product, frequency, discountPercent, discountAmount: flatDiscount, discountDuration, trialEligible }) {
  if (!product) {
    return { subtotal: 0, discountAmount: 0, trialDiscountAmount: 0, total: 0, recurring: 0 };
  }

  const isSubscription = product.type === 'subscription';
  const hasFreeTrial = isSubscription && trialEligible && (product.trial?.days > 0);

  // Base price directly from API product
  let basePrice;
  if (isSubscription) {
    basePrice = resolvePrice(product.prices, frequency);
  } else {
    // One-time: `once` is the catalog key; `amount`/`monthly` are legacy shapes
    basePrice = resolvePrice(product.prices, 'once')
      || resolvePrice(product.prices, 'amount')
      || resolvePrice(product.prices, 'monthly')
      || 0;
  }

  const subtotal = basePrice;

  // Both shapes are ONE subtraction from the same subtotal: a percent of it,
  // or a flat sum off it. Clamped to [0, subtotal] so $10 off a $4.99 product
  // is free rather than four cents owed back the other way.
  const raw = discountPercent > 0
    ? (subtotal * discountPercent) / 100
    : (flatDiscount || 0);
  const discountAmount = Math.min(Math.max(raw, 0), subtotal);
  const afterDiscount = subtotal - discountAmount;

  let trialDiscountAmount = 0;
  let total;

  if (hasFreeTrial) {
    // Free trial = $0 due today, but recurring stays
    trialDiscountAmount = afterDiscount;
    total = 0;
  } else {
    total = afterDiscount;
  }

  // The code's `duration` decides how far the discount reaches (#254). Every
  // configured code is `duration: 'once'` and the backend prices the renewal at
  // full list (discount-codes.js `applyToAmount()` — the FIRST charge only, via a
  // Stripe `once` coupon), so reducing the recurring line promised a renewal
  // price we never honor. An absent duration reads as 'once': the conservative
  // side of a promise. Anything else is a code that really does ride every cycle.
  const discountRecurs = !!discountDuration && discountDuration !== 'once';

  return {
    subtotal,
    discountAmount,
    trialDiscountAmount,
    total,
    recurring: discountRecurs ? afterDiscount : subtotal,
  };
}
