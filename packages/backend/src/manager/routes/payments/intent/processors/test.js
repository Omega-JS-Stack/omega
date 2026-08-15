const fetch = require('wonderful-fetch');
const powertools = require('node-powertools');
const discountCodes = require('../../../../libraries/payment/discount-codes.js');

// A declined subscription fires two events, and the second one reads what the
// first one wrote — how long it waits for that, and how often it looks
const ORDER_WAIT_ATTEMPTS = 40;
const ORDER_WAIT_INTERVAL = 500;

/**
 * Test intent processor
 * Creates fake Stripe-shaped checkout sessions and auto-fires webhooks
 * Only available in non-production environments
 */
module.exports = {
  /**
   * Create a test payment intent
   * Generates Stripe-shaped data and auto-fires a webhook to trigger the full pipeline
   *
   * @param {object} options
   * @param {string} options.uid - User's UID
   * @param {object} options.product - Full product object from config
   * @param {string} options.productId - Product ID from config
   * @param {string} options.frequency - 'monthly', 'annually', 'weekly', or 'daily' (subscriptions only)
   * @param {boolean} options.trial - Whether to include a trial period (subscriptions only)
   * @param {object} options.discount - Validated discount from discount-codes.validate(), or null
   * @param {string} options.simulate - Checkout outcome to simulate ('decline'), or null for success
   * @param {string} options.confirmationUrl - Success redirect URL
   * @param {string} options.cancelUrl - Cancel redirect URL
   * @param {object} options.ctx - Assistant instance
   * @returns {object} { id, url, raw }
   */
  async createIntent({ uid, orderId, product, productId, frequency, trial, discount, simulate, confirmationUrl, ctx }) {
    // Guard: test processor is not available in production
    if (ctx.isProduction()) {
      throw new Error('Test processor is not available in production');
    }

    const productType = product.type || 'subscription';
    const declined = simulate === 'decline';

    if (productType === 'subscription') {
      return createSubscriptionIntent({ uid, orderId, product, frequency, trial, discount, declined, confirmationUrl, ctx });
    }

    return createOneTimeIntent({ uid, orderId, product, productId, discount, declined, confirmationUrl, ctx });
  },
};

/**
 * Create a test subscription intent
 * Generates Stripe-shaped subscription + customer.subscription.created event
 *
 * A declined checkout mirrors what a real processor does: the subscription is
 * created in a dunning state (past_due → suspended) and its first invoice fails.
 */
async function createSubscriptionIntent({ uid, orderId, product, frequency, trial, discount, declined, confirmationUrl, ctx }) {
  // Generate IDs
  const timestamp = Date.now();
  const sessionId = `_test-cs-${timestamp}`;
  const subscriptionId = `_test-sub-${timestamp}`;
  const eventId = `_test-evt-${timestamp}`;
  const invoiceId = `_test-in-${timestamp}`;

  // Map frequency to Stripe interval
  const FREQUENCY_TO_INTERVAL = { annually: 'year', monthly: 'month', weekly: 'week', daily: 'day' };
  const FREQUENCY_TO_PERIOD = { annually: 365 * 86400, monthly: 30 * 86400, weekly: 7 * 86400, daily: 1 * 86400 };
  const interval = FREQUENCY_TO_INTERVAL[frequency] || 'month';

  // Build timestamps
  const now = Math.floor(timestamp / 1000);
  const periodEnd = now + (FREQUENCY_TO_PERIOD[frequency] || 30 * 86400);

  // Build Stripe-shaped subscription object.
  // Prefer the real Stripe product ID if configured; otherwise use a sentinel of the
  // form "_test_<id>" that the Stripe resolver recognizes and maps back to product.id.
  // This lets the test processor work in brands that haven't wired up Stripe yet.
  const planProductId = product.stripe?.productId || `_test_${product.id}`;

  const subscription = {
    id: subscriptionId,
    object: 'subscription',
    status: declined ? 'past_due' : (trial && product.trial?.days ? 'trialing' : 'active'),
    metadata: { uid, orderId },
    plan: { product: planProductId, interval },
    current_period_end: periodEnd,
    current_period_start: now,
    start_date: now,
    cancel_at_period_end: false,
    cancel_at: null,
    canceled_at: null,
    trial_start: null,
    trial_end: null,
  };

  // Add trial dates if applicable (a declined checkout claims no trial — nothing cleared)
  if (!declined && trial && product.trial?.days) {
    subscription.trial_start = now;
    subscription.trial_end = now + (product.trial.days * 86400);
    subscription.current_period_end = subscription.trial_end;
  }

  // What the coupon leaves on the first invoice — Stripe reports that reduced
  // amount back on its own events, so the fabricated ones carry it too. The route
  // owns the confirmation URL's amount; this is the PAYLOAD's
  // ([#239](https://github.com/Omega-JS-Stack/omega/issues/239)). The renewal keeps
  // the full config price — a 'once' coupon only touches the first charge.
  const firstCharge = discountCodes.applyToAmount(product.prices?.[frequency] || 0, discount);

  if (discount) {
    subscription.discount = buildStripeDiscount(discount);
  }

  // Build Stripe-shaped event
  const event = {
    id: eventId,
    type: 'customer.subscription.created',
    data: { object: subscription },
  };

  ctx.log(`Test subscription intent: sessionId=${sessionId}, subscriptionId=${subscriptionId}, eventId=${eventId}, trial=${!!subscription.trial_start}, declined=${!!declined}, discount=${discount?.code || 'none'}, firstCharge=${firstCharge}`);

  // Auto-fire webhook
  if (declined) {
    // The failed invoice names the subscription, and the pipeline resolves that
    // subscription from the order the FIRST event wrote — so the two events go out
    // in order, not at once.
    fireWebhook({ event, ctx })
      .then(() => waitForOrder({ orderId, ctx }))
      .then(() => fireWebhook({
        event: buildFailedInvoiceEvent({
          uid,
          orderId,
          invoiceId,
          eventId: `${eventId}-invoice`,
          amountDue: Math.round(firstCharge * 100),
          billingReason: 'subscription_create',
          subscriptionId,
        }),
        ctx,
      }));
  } else {
    fireWebhook({ event, ctx });
  }

  return {
    id: sessionId,
    url: confirmationUrl,
    raw: { id: sessionId, object: 'checkout.session', subscription: subscriptionId },
  };
}

/**
 * Create a test one-time payment intent
 * Generates Stripe-shaped checkout session + checkout.session.completed event
 *
 * A declined checkout still creates the session — the payment is what fails, so
 * a failed manual invoice goes out in place of the completed session.
 */
async function createOneTimeIntent({ uid, orderId, product, productId, discount, declined, confirmationUrl, ctx }) {
  // Validate that a price exists
  if (!product.prices?.once) {
    throw new Error(`No one-time price configured for ${product.id}`);
  }

  // Generate IDs
  const timestamp = Date.now();
  const sessionId = `_test-cs-${timestamp}`;
  const invoiceId = `_test-in-${timestamp}`;
  const eventId = `_test-evt-${timestamp}`;

  // The single charge this purchase makes, after the coupon Stripe would have
  // applied at its own checkout ([#239](https://github.com/Omega-JS-Stack/omega/issues/239))
  const firstCharge = discountCodes.applyToAmount(product.prices.once || 0, discount);

  // Build Stripe-shaped checkout session object
  const session = {
    id: sessionId,
    object: 'checkout.session',
    mode: 'payment',
    status: 'complete',
    payment_status: 'paid',
    metadata: { uid, orderId, productId },
    amount_total: Math.round(firstCharge * 100),
    currency: 'usd',
  };

  // What Stripe's session reports about the money the coupon took off
  if (discount) {
    session.total_details = {
      amount_discount: Math.round(((product.prices.once || 0) - firstCharge) * 100),
    };
  }

  // Build Stripe-shaped event
  const event = declined
    ? buildFailedInvoiceEvent({
      uid,
      orderId,
      productId,
      invoiceId,
      eventId,
      amountDue: session.amount_total,
      billingReason: 'manual',
    })
    : {
      id: eventId,
      type: 'checkout.session.completed',
      data: { object: session },
    };

  ctx.log(`Test one-time intent: sessionId=${sessionId}, eventId=${eventId}, productId=${productId}, declined=${!!declined}, discount=${discount?.code || 'none'}, firstCharge=${firstCharge}`);

  // Auto-fire webhook
  fireWebhook({ event, ctx });

  return {
    id: sessionId,
    url: confirmationUrl,
    raw: { id: sessionId, object: 'checkout.session', mode: 'payment' },
  };
}

/**
 * Build the Stripe-shaped discount a coupon leaves on the resource
 *
 * Stripe attaches the coupon it applied to the subscription, so a reader of the
 * webhook can see WHICH code moved the amount. `amount` is dollars on our side and
 * cents on Stripe's, the same as `percent` → `percent_off`.
 *
 * @param {object} discount - Validated discount from discount-codes.validate()
 * @returns {object} Stripe-shaped discount object
 */
function buildStripeDiscount(discount) {
  return {
    id: `_test-di-${discount.code}`,
    object: 'discount',
    coupon: {
      id: `_test-coupon-${discount.code}`,
      object: 'coupon',
      name: discount.code,
      percent_off: discount.percent || null,
      amount_off: discount.amount ? Math.round(discount.amount * 100) : null,
      duration: discount.duration || 'once',
    },
  };
}

/**
 * Build a Stripe-shaped invoice.payment_failed event
 *
 * `billingReason` is what the webhook parser reads to route the event: a
 * 'subscription*' reason (with a subscription) resolves to the subscription,
 * anything else ('manual') to the one-time invoice itself.
 */
function buildFailedInvoiceEvent({ uid, orderId, productId, invoiceId, eventId, amountDue, billingReason, subscriptionId }) {
  const invoice = {
    id: invoiceId,
    object: 'invoice',
    billing_reason: billingReason,
    amount_due: amountDue,
    amount_paid: 0,
    status: 'open',
    metadata: { uid, orderId },
  };

  // Only the one-time side carries a product on the invoice — the subscription
  // side resolves its product from the subscription
  if (productId) {
    invoice.metadata.productId = productId;
  }

  if (subscriptionId) {
    invoice.parent = {
      type: 'subscription_details',
      subscription_details: {
        subscription: subscriptionId,
        metadata: { uid, orderId },
      },
    };
  }

  return {
    id: eventId,
    type: 'invoice.payment_failed',
    data: { object: invoice },
  };
}

/**
 * Wait for the order the first webhook writes
 *
 * Only the declined subscription path needs this: the pipeline answers the failed
 * invoice's subscription lookup out of payments-orders, so the invoice event that
 * arrives before the order exists resolves against nothing.
 */
async function waitForOrder({ orderId, ctx }) {
  const ref = ctx.Manager.libraries.admin.firestore().doc(`payments-orders/${orderId}`);

  for (let attempt = 0; attempt < ORDER_WAIT_ATTEMPTS; attempt++) {
    const doc = await ref.get();

    if (doc.exists) {
      return true;
    }

    await powertools.wait(ORDER_WAIT_INTERVAL);
  }

  ctx.warn(`Test processor: payments-orders/${orderId} never landed after ${(ORDER_WAIT_ATTEMPTS * ORDER_WAIT_INTERVAL) / 1000}s — firing the failed invoice anyway, it will resolve against whatever state exists`);
  return false;
}

/**
 * Fire-and-forget webhook to trigger the full pipeline
 * Returns the request so a caller that must order two events can chain them
 */
function fireWebhook({ event, ctx }) {
  const webhookUrl = `${ctx.Manager.getApiUrl()}/omega/payments/webhook?processor=test&key=${process.env.OMEGA_WEBHOOK_KEY}`;
  return fetch(webhookUrl, {
    method: 'POST',
    response: 'json',
    body: event,
    timeout: 60000,
  }).catch((e) => {
    ctx.log(`Test processor auto-webhook failed: ${e.message}`);
  });
}
