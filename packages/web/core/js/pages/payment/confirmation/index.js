// Payment Confirmation Page
import { state, buildBindingsState } from './modules/state.js';
import { trackPurchaseIfNeeded } from './modules/tracking.js';
import { triggerCelebration } from './modules/celebration.js';
import { verifyPurchase, initialStatus } from './modules/verify.js';
import omega from '@omega.js/client';
import { createLogger } from '__main_assets__/js/libs/logger.js';

const logger = createLogger('confirmation');

/* Test URL
  https://localhost:3000/payment/confirmation?orderId=ORD-TRIAL-123&productId=pro&productName=Pro%20Plan&amount=0&currency=USD&frequency=annually&paymentMethod=stripe&trial=true&track=true
*/

// Module export
export default () => {
  return new Promise(async function (resolve) {
    await omega.dom().ready();
    await initializeConfirmation();
    return resolve();
  });
};

// Update UI via bindings (single source of truth)
function updateUI() {
  omega.bindings().update(buildBindingsState());
}

// Initialize confirmation page
async function initializeConfirmation() {
  // Parse URL params into state
  parseUrlParams();

  // Update UI with loaded data
  updateUI();

  // The browser half of the purchase (if the track=true param is present) —
  // Meta's and TikTok's retargeting signal, deduped against the webhook's own
  // fire (#386). The revenue TRUTH is the webhook's, always.
  trackPurchaseIfNeeded(state);

  // Subscribe to push notifications on CTA click (requires user gesture).
  // Wired before the verification wait so the CTAs are live immediately.
  document.querySelectorAll('.btn').forEach(($btn) => {
    $btn.addEventListener('click', () => {
      omega.notifications().subscribe().catch((e) => {
        logger.warn('Notification subscribe failed:', e.message);
      });
    }, { once: true });
  });

  // The redirect is the processor's CLAIM; entitlement is granted by the
  // webhook, which lands after the browser does — or never (#232). Hold the
  // page in `processing` until the account itself carries the purchase. A
  // purchase that opened already answered has no poll to wait on and nothing to
  // wait for auth for — it rendered its receipt in the update above.
  if (state.status === 'processing') {
    await new Promise((resolve) => omega.auth().listen({ once: true }, resolve));

    // ONE reveal: the update that answers the page is the update that brings
    // the order details with it, and the celebration rides that same flip —
    // numbers arriving seconds before the confetti read as broken (Ian's QA).
    state.status = await verifyPurchase(state);
    updateUI();

    if (state.status !== 'confirmed') {
      logger.warn(`Purchase not confirmed against the account state: orderId=${state.orderId}, product=${state.productId}`);
      return;
    }
  }

  // Trigger celebration animation — only for a purchase that really landed
  await triggerCelebration();
}

// Parse URL parameters into minimal state
function parseUrlParams() {
  const urlParams = new URLSearchParams(window.location.search);

  state.orderId = urlParams.get('orderId') || '';
  state.productId = urlParams.get('productId') || '';
  state.productName = urlParams.get('productName') || '';
  state.amount = parseFloat(urlParams.get('amount') || 0);
  state.currency = urlParams.get('currency') || 'USD';
  state.frequency = urlParams.get('frequency') || '';
  state.paymentMethod = urlParams.get('paymentMethod') || '';
  state.hasFreeTrial = urlParams.get('trial') === 'true';
  state.status = initialStatus(state);
  state.loaded = true;
}
