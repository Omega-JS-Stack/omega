// The confirmation page's conversion PIXEL — the browser half of the checkout
// ([#386](https://github.com/Omega-JS-Stack/omega/issues/386)).
//
// The backend's payment webhook is the TRUTH: it sees what the provider actually
// charged. What only a browser can give is the RETARGETING signal — Meta's and
// TikTok's pixels tie the conversion to the ad click sitting in this page's
// cookies — and, for GA4, the session, the campaign and the client id a webhook
// has none of.
//
// TWO THINGS THIS HALF GETS RIGHT, both found on 2026-08-27:
//
//  1. A TRIAL CHECKOUT IS NOT A PURCHASE
//     ([#654](https://github.com/Omega-JS-Stack/omega/issues/654)). The intent
//     route sets `?track=true` for EVERY checkout, trials included, so a $0 trial
//     used to fire a browser `purchase` while the webhook fired `trial_start`.
//     The AMOUNT was never the defect — the intent route already puts `amount=0`
//     on a trial confirmation URL (`routes/payments/intent/post.js`) — the NAME
//     was: two different event names never deduplicate, so each platform counted
//     the browser half as a second conversion beside the server's trial. A trial
//     order fires `trial_start` with value 0; everything else fires `purchase`.
//  2. GA4 BELONGS ON THE PURCHASE HALF
//     ([#656](https://github.com/Omega-JS-Stack/omega/issues/656)). GA4
//     deduplicates `purchase` on `transaction_id`
//     (https://support.google.com/analytics/answer/12313109), and both halves
//     send the ORDER id — so the browser adds its attribution and GA4 still
//     counts one purchase. `trial_start` is a GA4 CUSTOM event with no such
//     dedupe, so its browser half names the ad platforms only and the server
//     keeps GA4 to itself.
//
// Both halves carry the SAME dedupe id, or each platform counts two conversions:
//
//   THE DEDUPE ID IS `<canonical>.<order id>`
//
// which is the ORDER-ID branch of the backend's own derivation
// (`events/firestore/payments-webhooks/analytics.js` resolveEventId keys the two
// browser-twinned events, `purchase` and `trial_start`, on the order — the only
// id a browser can compute).
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
//
// `price` is the conversion's own amount, passed in rather than read off the
// state: the intent route already sends `amount=0` on a trial checkout, so this
// default and the trial's explicit 0 agree today. DEFENSIVE — the conversion's
// value has ONE source in this file, so a confirmation URL that ever carried the
// plan's price on a trial could not put it on the item either ([#654]).
export function buildItems(state, price = state.amount) {
  return [{
    item_id: state.productId,
    item_name: state.productName || state.productId,
    item_category: FREQUENCIES.includes(state.frequency) ? 'subscription' : 'one-time',
    item_variant: state.frequency,
    price: price,
    quantity: 1,
  }];
}

// Fire the canonical conversion for this order — see the header for which.
function trackPurchase(state) {
  const canonical = state.hasFreeTrial ? 'trial_start' : 'purchase';
  // A trial charges nothing. The intent route already sends `amount=0` for one,
  // so this is DEFENSIVE: the value a trial reports is 0 here whatever the
  // confirmation URL says ([#654]).
  const value = state.hasFreeTrial ? 0 : state.amount;

  event(canonical, {
    // The same id the webhook sends, and the key GA4 collapses the two halves on.
    transaction_id: state.orderId,
    value: value,
    currency: state.currency,
    items: buildItems(state, value),
    payment_provider: state.paymentMethod,
    payment_frequency: state.frequency,
    is_trial: state.hasFreeTrial,
  }, {
    // GA4 rides the purchase half (it dedupes on transaction_id) but never the
    // trial half, where its event is custom and the server owns it outright.
    providers: state.hasFreeTrial ? ['meta', 'tiktok'] : ['ga4', 'meta', 'tiktok'],
    eventId: `${canonical}.${state.orderId}`,
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
