// Analytics tracking for the checkout page — one canonical fire per step; the
// catalog decides which provider hears it, under which name, in which dialect
// (#328), and the transport under it is guarded per provider (#306)
import { event } from '__main_assets__/js/libs/analytics.js';

// Get base price from state for tracking
function getBasePrice(state) {
  const product = state.product;
  if (!product) return 0;

  if (product.type === 'subscription') {
    const entry = product.prices?.[state.frequency];
    return (typeof entry === 'object' ? entry?.amount : entry) || 0;
  }

  return product.prices?.amount
    || product.prices?.monthly?.amount
    || 0;
}

// Build common item array for tracking
function buildItems(state, price) {
  return [{
    item_id: state.product.id,
    item_name: state.product.name,
    item_category: state.product.type === 'subscription' ? 'subscription' : 'one-time',
    item_variant: state.frequency,
    price: price,
    quantity: 1,
  }];
}

export function trackBeginCheckout(state) {
  const price = getBasePrice(state);
  const items = buildItems(state, price);

  event('begin_checkout', {
    currency: 'USD',
    value: price,
    items: items,
  });
}

export function trackAddPaymentInfo(state, paymentMethod) {
  const price = getBasePrice(state);
  const items = buildItems(state, price);

  event('add_payment_info', {
    currency: 'USD',
    value: price,
    payment_type: paymentMethod,
    items: items,
  });
}
