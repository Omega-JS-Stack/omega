const path = require('path');
const loadProcessor = require('../../../libraries/load-processor.js');

/**
 * POST /payments/portal
 * Creates a Stripe Billing Portal session for the authenticated user.
 * The portal allows managing payment methods and viewing invoices,
 * but does NOT allow cancellation (users must use POST /payments/cancel).
 * Requires authentication.
 */
module.exports = async ({ ctx, user, settings }) => {
  // Require authentication
  if (!user.authenticated) {
    return ctx.respond('Authentication required', { code: 401 });
  }

  const uid = user.auth.uid;
  const returnUrl = settings.returnUrl;
  const subscription = user.subscription;

  // Require a paid subscription (any status — suspended users can still manage billing)
  if (!subscription || subscription.product?.id === 'basic') {
    ctx.log(`Portal rejected: uid=${uid}, product=${subscription?.product?.id}`);
    return ctx.respond('No paid subscription found', { code: 400 });
  }

  const processor = subscription.payment?.processor;

  if (!processor) {
    ctx.log(`Portal rejected: uid=${uid}, no processor set`);
    return ctx.respond('Subscription payment processor not found', { code: 400 });
  }

  // Load the processor module
  let processorModule;
  try {
    processorModule = loadProcessor(path.join(__dirname, 'processors'), processor);
  } catch (e) {
    return ctx.respond(`Unknown processor: ${processor}`, { code: 400 });
  }

  // Create the portal session via the processor
  const email = user.auth?.email || null;
  let result;
  try {
    result = await processorModule.createPortalSession({ uid, email, returnUrl, ctx });
  } catch (e) {
    ctx.log(`Failed to create ${processor} portal session: ${e.message}`);
    return ctx.respond(`Failed to create portal session: ${e.message}`, { code: 500 });
  }

  ctx.log(`Portal session created: uid=${uid}, processor=${processor}`);

  return ctx.respond({ url: result.url });
};
