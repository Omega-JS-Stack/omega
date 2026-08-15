/**
 * Stripe intent processor
 * Creates Stripe Checkout Sessions for subscription and one-time purchases
 */
module.exports = {
  /**
   * Create a Stripe Checkout Session
   *
   * @param {object} options
   * @param {string} options.uid - User's UID
   * @param {object} options.product - Full product object from config
   * @param {string} options.productId - Product ID from config (e.g., 'premium')
   * @param {string} options.frequency - 'monthly' or 'annually' (subscriptions only)
   * @param {boolean} options.trial - Whether to include a trial period (subscriptions only)
   * @param {string} options.confirmationUrl - Success redirect URL
   * @param {string} options.cancelUrl - Cancel redirect URL
   * @returns {object} { id, url, raw }
   */
  async createIntent({ uid, orderId, product, productId, frequency, trial, discount, confirmationUrl, cancelUrl, ctx }) {
    // Initialize Stripe SDK
    const StripeLib = require('../../../../libraries/payment/processors/stripe.js');
    const stripe = StripeLib.init();

    const productType = product.type || 'subscription';

    // Resolve the Stripe price ID at runtime (fetches active prices from Stripe product)
    const priceId = await StripeLib.resolvePriceId(product, productType, frequency);

    // Resolve or create Stripe customer (keyed by uid in metadata)
    const email = ctx?.getUser()?.auth?.email || null;
    const customer = await StripeLib.resolveCustomer(uid, email, ctx);

    // Resolve Stripe coupon if discount is present
    let stripeCouponId = null;
    if (discount) {
      stripeCouponId = await resolveStripeCoupon(stripe, discount, ctx);
    }

    ctx.log(`Stripe checkout: type=${productType}, priceId=${priceId}, uid=${uid}, customerId=${customer.id}, trial=${trial}, trialDays=${product.trial?.days || 'none'}, discount=${discount?.code || 'none'}`);

    // Build session params based on product type
    let sessionParams;

    if (productType === 'subscription') {
      sessionParams = buildSubscriptionSession({ priceId, customer, uid, orderId, productId, frequency, trial, product, stripeCouponId, confirmationUrl, cancelUrl });
    } else {
      sessionParams = buildOneTimeSession({ priceId, customer, uid, orderId, productId, product, stripeCouponId, confirmationUrl, cancelUrl });
    }

    // Create the checkout session
    const session = await stripe.checkout.sessions.create(sessionParams);

    ctx.log(`Stripe session created: sessionId=${session.id}, mode=${sessionParams.mode}, url=${session.url}`);

    return {
      id: session.id,
      url: session.url,
      raw: session,
    };
  },
};

/**
 * Build Stripe Checkout Session params for a subscription
 */
function buildSubscriptionSession({ priceId, customer, uid, orderId, productId, frequency, trial, product, stripeCouponId, confirmationUrl, cancelUrl }) {
  const sessionParams = {
    mode: 'subscription',
    customer: customer.id,
    line_items: [{
      price: priceId,
      quantity: 1,
    }],
    subscription_data: {
      metadata: {
        uid: uid,
        orderId: orderId,
      },
    },
    success_url: confirmationUrl,
    cancel_url: cancelUrl,
    metadata: {
      uid: uid,
      orderId: orderId,
      productId: productId,
      frequency: frequency,
    },
  };

  // Add trial period if requested
  if (trial && product.trial?.days) {
    sessionParams.subscription_data.trial_period_days = product.trial.days;
  }

  // Apply discount coupon (first payment only)
  if (stripeCouponId) {
    sessionParams.discounts = [{ coupon: stripeCouponId }];
  }

  return sessionParams;
}

/**
 * Build Stripe Checkout Session params for a one-time payment
 */
function buildOneTimeSession({ priceId, customer, uid, orderId, productId, stripeCouponId, confirmationUrl, cancelUrl }) {
  const sessionParams = {
    mode: 'payment',
    customer: customer.id,
    line_items: [{
      price: priceId,
      quantity: 1,
    }],
    // The charge Stripe creates behind the session inherits THIS metadata, not the
    // session's — without the product on it, the charge a refund arrives as cannot
    // say what was bought ([#212](https://github.com/Omega-JS-Stack/omega/issues/212))
    payment_intent_data: {
      metadata: {
        uid: uid,
        orderId: orderId,
        productId: productId,
      },
    },
    success_url: confirmationUrl,
    cancel_url: cancelUrl,
    metadata: {
      uid: uid,
      orderId: orderId,
      productId: productId,
    },
  };

  // Apply discount coupon
  if (stripeCouponId) {
    sessionParams.discounts = [{ coupon: stripeCouponId }];
  }

  return sessionParams;
}

/**
 * Resolve or create a Stripe coupon for a discount code
 * Uses a deterministic ID so the same code always maps to the same coupon
 *
 * Stripe coupons come in two shapes and a code is one or the other: `percent_off`,
 * or `amount_off` in the currency's MINOR unit (cents) with a `currency` beside it
 * — Stripe rejects an amount coupon without one. The two shapes carry different
 * ids so a code can never collide with the other form, and the percent id is
 * byte-identical to what it has always been, so coupons already live in a brand's
 * account keep resolving instead of duplicating under a new id
 * ([#239](https://github.com/Omega-JS-Stack/omega/issues/239)).
 *
 * Verified against the params the SDK is asked to create, not against Stripe:
 * live-provider verification is a Stage 3 item, the same trust level as the rest
 * of this processor ([#212](https://github.com/Omega-JS-Stack/omega/issues/212)).
 */
async function resolveStripeCoupon(stripe, discount, ctx) {
  const isAmount = discount.amount > 0;
  const currency = ctx.Manager?.config?.payment?.currency || 'USD';
  const couponId = isAmount
    ? `BEM_${discount.code}_${discount.amount}AMTOFF_ONCE`
    : `BEM_${discount.code}_${discount.percent}OFF_ONCE`;

  try {
    // Check if coupon already exists
    await stripe.coupons.retrieve(couponId);
    ctx.log(`Stripe coupon exists: ${couponId}`);
    return couponId;
  } catch (e) {
    if (e.code !== 'resource_missing') {
      throw e;
    }
  }

  // Create the coupon
  // Idempotency key uses the deterministic couponId so concurrent requests for
  // the same discount code don't race each other into a duplicate-create error.
  // Stripe returns the cached response for 24 hours.
  await stripe.coupons.create({
    id: couponId,
    duration: 'once',
    ...(isAmount
      ? {
        amount_off: Math.round(discount.amount * 100),
        currency: currency.toLowerCase(),
        name: `${discount.code} (${discount.amount.toFixed(2)} ${currency.toUpperCase()} off first payment)`,
      }
      : {
        percent_off: discount.percent,
        name: `${discount.code} (${discount.percent}% off first payment)`,
      }),
  }, {
    idempotencyKey: `backend-coupon-${couponId}`,
  });

  ctx.log(`Stripe coupon created: ${couponId}`);
  return couponId;
}

