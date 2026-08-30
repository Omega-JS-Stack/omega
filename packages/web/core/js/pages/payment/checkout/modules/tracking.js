// Analytics tracking for the checkout page — one canonical fire per step; the
// catalog decides which provider hears it, under which name, in which dialect
// (#328), and the transport under it is guarded per provider (#306)
import { event } from '__main_assets__/js/libs/analytics.js';
import { calculatePrices } from './pricing.js';

// What the funnel reports this checkout is worth: the LIST price of what is
// being bought, before any code comes off it.
//
// calculatePrices() is the one place that knows every price shape a catalog can
// carry — the cadence keys, the one-time `once` key, and the legacy
// `amount`/`monthly` fallbacks — and its `subtotal` IS that list price. The
// hand-rolled read this replaced never looked at `once`, so a product priced
// `{ once: 49.99 }` sent `begin_checkout` and `add_payment_info` a value of 0
// while `purchase` reported $49.99
// ([#668](https://github.com/Omega-JS-Stack/omega/issues/668)).
function getBasePrice(state) {
  return calculatePrices(state).subtotal;
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
