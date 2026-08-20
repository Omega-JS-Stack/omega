// The confirmation page's purchase PIXEL — the browser half of a `purchase`
// ([#386](https://github.com/Omega-JS-Stack/omega/issues/386)).
//
// The backend's payment webhook is the TRUTH: it sees what the processor
// actually charged, and it owns GA4 outright, because GA4 has no cross-source
// event deduplication. What only a browser can give is the RETARGETING signal —
// Meta's and TikTok's pixels tie the conversion to the ad click that is sitting
// in this page's cookies — so this half fires those two, and no more.
//
// Both halves carry the SAME dedupe id, or each platform counts two purchases:
//
//   THE DEDUPE ID IS `purchase.<order id>`
//
// which is the ORDER-ID branch of the backend's own derivation
// (`events/firestore/payments-webhooks/analytics.js` resolveEventId keys a
// payment event on the webhook delivery, `<canonical>.<webhook event id>`,
// falling back to the order id — the only half of that a browser holds).
import omega from '@omega.js/client';
import { event } from '__main_assets__/js/libs/analytics.js';
import { FREQUENCIES } from '../../checkout/modules/state.js';

// Build the canonical items array for the purchase.
//
// The category comes from WHAT WAS BOUGHT, never from the truthiness of the
// frequency string: checkout sends `frequency=once` for a one-time purchase, so
// `state.frequency ? 'subscription' : 'one-time'` called every one of them a
// subscription (#282 is the same bug in the receipt copy). FREQUENCIES is the
// list of cadences checkout actually SELLS — the same list the bindings and the
// verification poll read, and the confirmation page's stand-in for checkout's
// `state.product.type === 'subscription'`, which the redirect never carries.
export function buildItems(state) {
  return [{
    item_id: state.productId,
    item_name: state.productName || state.productId,
    item_category: FREQUENCIES.includes(state.frequency) ? 'subscription' : 'one-time',
    item_variant: state.frequency,
    price: state.amount,
    quantity: 1,
  }];
}

// Fire the canonical purchase for the two platforms that deduplicate on it.
function trackPurchase(state) {
  event('purchase', {
    transaction_id: state.orderId,
    value: state.amount,
    currency: state.currency,
    items: buildItems(state),
    payment_processor: state.paymentMethod,
    payment_frequency: state.frequency,
    is_trial: state.hasFreeTrial,
  }, {
    // GA4 is the webhook's (see the header) — naming the two here is what keeps
    // this half from double-counting revenue in the property.
    providers: ['meta', 'tiktok'],
    eventId: `purchase.${state.orderId}`,
  });
}

// Track purchase only if the track=true URL param is present
// Removes the param after tracking to prevent duplicates on refresh
// Also stores orderId in omega storage as a backup guard
export function trackPurchaseIfNeeded(state) {
  const urlParams = new URLSearchParams(window.location.search);
  const shouldTrack = urlParams.get('track') === 'true';

  if (!shouldTrack) {
    return;
  }

  // Track the purchase
  trackPurchase(state);

  // Remove 'track' param from URL to prevent re-tracking on refresh
  urlParams.delete('track');
  const newUrl = urlParams.toString()
    ? `${window.location.pathname}?${urlParams.toString()}`
    : window.location.pathname;
  window.history.replaceState({}, document.title, newUrl);

  // Backup: store orderId in storage
  const trackedOrders = omega.storage().get('trackedPurchases', []);
  if (!trackedOrders.includes(state.orderId)) {
    trackedOrders.push(state.orderId);

    // Keep only last 50 orders
    if (trackedOrders.length > 50) {
      trackedOrders.shift();
    }

    omega.storage().set('trackedPurchases', trackedOrders);
  }
}
