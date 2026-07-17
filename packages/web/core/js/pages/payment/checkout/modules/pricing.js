// Pure pricing calculation -- no side effects, no state mutation

// Resolve price for a frequency (handles both `{ amount: N }` and plain `N` formats)
function resolvePrice(prices, key) {
  const entry = prices?.[key];
  if (entry == null) return 0;
  return typeof entry === 'object' ? (entry.amount || 0) : Number(entry) || 0;
}

export function calculatePrices({ product, frequency, discountPercent, trialEligible }) {
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
  const discountAmount = (subtotal * discountPercent) / 100;
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

  return {
    subtotal,
    discountAmount,
    trialDiscountAmount,
    total,
    recurring: afterDiscount,
  };
}
