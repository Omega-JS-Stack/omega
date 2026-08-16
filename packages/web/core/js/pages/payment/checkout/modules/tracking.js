// Analytics tracking for checkout page
// All three platforms tracked together, each guarded on its own (#306)
import { trackGoogle, trackMeta, trackTikTok } from '__main_assets__/js/libs/analytics.js';

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

  trackGoogle('event', 'begin_checkout', {
    currency: 'USD',
    value: price,
    items: items,
  });

  trackMeta('track', 'InitiateCheckout', {
    content_ids: [state.product.id],
    content_name: state.product.name,
    content_type: 'product',
    currency: 'USD',
    value: price,
    num_items: 1,
  });

  trackTikTok('InitiateCheckout', {
    content_id: state.product.id,
    content_type: 'product',
    content_name: state.product.name,
    price: price,
    quantity: 1,
    currency: 'USD',
    value: price,
  });
}

export function trackAddPaymentInfo(state, paymentMethod) {
  const price = getBasePrice(state);
  const items = buildItems(state, price);

  trackGoogle('event', 'add_payment_info', {
    currency: 'USD',
    value: price,
    payment_type: paymentMethod,
    items: items,
  });

  trackMeta('track', 'AddPaymentInfo', {
    content_ids: [state.product.id],
    content_name: state.product.name,
    content_type: 'product',
    currency: 'USD',
    value: price,
  });

  trackTikTok('AddPaymentInfo', {
    content_id: state.product.id,
    content_type: 'product',
    content_name: state.product.name,
    price: price,
    quantity: 1,
    currency: 'USD',
    value: price,
  });
}
