// Purchase analytics tracking for confirmation page
// All three platforms tracked together, no conditional checks
import webManager from 'web-manager';

// Build common item array for tracking
function buildItems(state) {
  return [{
    item_id: state.productId,
    item_name: state.productName || state.productId,
    item_category: state.frequency ? 'subscription' : 'one-time',
    item_variant: state.frequency,
    price: state.amount,
    quantity: 1,
  }];
}

// Track purchase event to all analytics providers
function trackPurchase(state) {
  const items = buildItems(state);

  // Google Analytics 4
  gtag('event', 'purchase', {
    transaction_id: state.orderId,
    value: state.amount,
    currency: state.currency,
    items: items,
  });

  // Facebook Pixel
  fbq('track', 'Purchase', {
    content_ids: [state.productId],
    content_name: state.productName || state.productId,
    content_type: 'product',
    currency: state.currency,
    value: state.amount,
    num_items: 1,
  });

  // TikTok Pixel
  ttq.track('CompletePayment', {
    content_id: state.productId,
    content_type: 'product',
    content_name: state.productName || state.productId,
    price: state.amount,
    quantity: 1,
    currency: state.currency,
    value: state.amount,
  });
}

// Track purchase only if the track=true URL param is present
// Removes the param after tracking to prevent duplicates on refresh
// Also stores orderId in webManager storage as a backup guard
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
  const trackedOrders = webManager.storage().get('trackedPurchases', []);
  if (!trackedOrders.includes(state.orderId)) {
    trackedOrders.push(state.orderId);

    // Keep only last 50 orders
    if (trackedOrders.length > 50) {
      trackedOrders.shift();
    }

    webManager.storage().set('trackedPurchases', trackedOrders);
  }
}
