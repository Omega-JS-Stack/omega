/**
 * Chargebee intent provider
 * Creates Chargebee Hosted Page sessions for subscription and one-time purchases
 */
module.exports = {
  /**
   * Create a Chargebee Hosted Page checkout session
   *
   * @param {object} options
   * @param {string} options.uid - User's UID
   * @param {string} options.orderId - @omega.js/backend order ID (XXXX-XXXX-XXXX)
   * @param {object} options.product - Full product object from config
   * @param {string} options.productId - Product ID from config (e.g., 'premium')
   * @param {string} options.frequency - 'monthly' or 'annually' (subscriptions only)
   * @param {boolean} options.trial - Whether to include a trial period
   * @param {string} options.confirmationUrl - Success redirect URL
   * @param {string} options.cancelUrl - Cancel redirect URL
   * @param {object} options.ctx - Assistant instance for logging
   * @returns {object} { id, url, raw }
   */
  async createIntent({ uid, orderId, product, productId, frequency, trial, discount, confirmationUrl, cancelUrl, ctx }) {
    const ChargebeeLib = require('../../../../libraries/payment/providers/chargebee.js');
    ChargebeeLib.init();

    const productType = product.type || 'subscription';
    const metaData = ChargebeeLib.buildMetaData(uid, orderId, productType === 'one-time' ? productId : undefined);

    // Resolve Chargebee coupon if discount is present
    let chargebeeCouponId = null;
    if (discount) {
      chargebeeCouponId = await resolveChargebeeCoupon(ChargebeeLib, discount, ctx);
    }

    let hostedPage;

    if (productType === 'subscription') {
      hostedPage = await createSubscriptionCheckout({ ChargebeeLib, uid, orderId, product, productId, frequency, trial, metaData, chargebeeCouponId, confirmationUrl, cancelUrl, ctx });
    } else {
      hostedPage = await createOneTimeCheckout({ ChargebeeLib, uid, orderId, product, productId, metaData, chargebeeCouponId, confirmationUrl, cancelUrl, ctx });
    }

    ctx.log(`Chargebee hosted page created: id=${hostedPage.id}, type=${productType}, url=${hostedPage.url}`);

    return {
      id: hostedPage.id,
      url: hostedPage.url,
      raw: hostedPage,
    };
  },
};

/**
 * Create a Chargebee Hosted Page for a new subscription
 */
async function createSubscriptionCheckout({ ChargebeeLib, uid, orderId, product, productId, frequency, trial, metaData, chargebeeCouponId, confirmationUrl, cancelUrl, ctx }) {
  const chargebeeItemId = product.chargebee?.itemId;

  if (!chargebeeItemId) {
    throw new Error(`No Chargebee item ID configured for product ${productId}`);
  }

  // Deterministic item price ID: {itemId}-{frequency}
  const itemPriceId = `${chargebeeItemId}-${frequency}`;

  // NOTE: subscription[meta_data] is NOT supported by Chargebee's hosted page checkout.
  // We use pass_thru_content to carry our UID/orderId through the checkout flow,
  // then backfill meta_data on the subscription after the webhook resolves the UID.
  const params = {
    subscription_items: {
      item_price_id: [itemPriceId],
      quantity: [1],
    },
    redirect_url: confirmationUrl,
    cancel_url: cancelUrl,
    pass_thru_content: metaData,
  };

  // Handle trial: if trial requested but product has no trial config in Chargebee,
  // set trial_end explicitly. Otherwise let the item price's trial config handle it.
  if (trial === false && product.trial?.days) {
    // Explicitly skip trial by setting trial_end to 0
    params.subscription = { trial_end: 0 };
  }

  // Apply discount coupon (first payment only)
  if (chargebeeCouponId) {
    params.coupon_ids = [chargebeeCouponId];
  }

  ctx.log(`Chargebee subscription checkout: itemPriceId=${itemPriceId}, uid=${uid}, trial=${trial}, coupon=${chargebeeCouponId || 'none'}`);

  const result = await ChargebeeLib.request('/hosted_pages/checkout_new_for_items', {
    method: 'POST',
    body: params,
  });

  return result.hosted_page;
}

/**
 * Create a Chargebee Hosted Page for a one-time charge
 */
async function createOneTimeCheckout({ ChargebeeLib, uid, orderId, product, productId, metaData, chargebeeCouponId, confirmationUrl, cancelUrl, ctx }) {
  const price = product.prices?.once;

  if (!price) {
    throw new Error(`No one-time price configured for product ${productId}`);
  }

  // Amount in cents
  const amountCents = Math.round(price * 100);

  const params = {
    charges: {
      amount: [amountCents],
      description: [product.name || productId],
    },
    redirect_url: confirmationUrl,
    cancel_url: cancelUrl,
    pass_thru_content: metaData,
  };

  // Apply discount coupon
  if (chargebeeCouponId) {
    params.coupon_ids = [chargebeeCouponId];
  }

  ctx.log(`Chargebee one-time checkout: amount=${amountCents}, productId=${productId}, uid=${uid}, coupon=${chargebeeCouponId || 'none'}`);

  const result = await ChargebeeLib.request('/hosted_pages/checkout_one_time_for_items', {
    method: 'POST',
    body: params,
  });

  return result.hosted_page;
}

/**
 * Resolve or create a Chargebee coupon for a discount code
 * Uses a deterministic ID so the same code always maps to the same coupon
 *
 * A code is percent-based or amount-based, and Chargebee spells the second one
 * `discount_type: 'fixed_amount'` with `discount_amount` in the currency's MINOR
 * unit (cents — the same unit this file's one-time `charges.amount` uses) plus the
 * `currency_code` it applies in. The two shapes carry different ids so a code can
 * never collide with the other form, and the percent id is byte-identical to what
 * it has always been, so coupons already live in a brand's site keep resolving
 * ([#239](https://github.com/Omega-JS-Stack/omega/issues/239)).
 *
 * Verified against the params the API is asked to create, not against Chargebee:
 * live-provider verification is a Stage 3 item, the same trust level as the rest
 * of this provider ([#212](https://github.com/Omega-JS-Stack/omega/issues/212)).
 */
async function resolveChargebeeCoupon(ChargebeeLib, discount, ctx) {
  const isAmount = discount.amount > 0;
  const currency = (ctx.Manager?.config?.payment?.currency || 'USD').toUpperCase();
  const couponId = isAmount
    ? `BEM_${discount.code}_${discount.amount}AMTOFF_ONCE`
    : `BEM_${discount.code}_${discount.percent}OFF_ONCE`;

  try {
    // Check if coupon already exists
    await ChargebeeLib.request(`/coupons/${couponId}`, { method: 'GET' });
    ctx.log(`Chargebee coupon exists: ${couponId}`);
    return couponId;
  } catch (e) {
    // Chargebee returns 404 for missing resources
    if (e.status !== 404 && e.statusCode !== 404) {
      throw e;
    }
  }

  // Create the coupon
  await ChargebeeLib.request('/coupons', {
    method: 'POST',
    body: {
      id: couponId,
      duration_type: 'one_time',
      apply_on: 'invoice_amount',
      ...(isAmount
        ? {
          name: `${discount.code} (${discount.amount.toFixed(2)} ${currency} off first payment)`,
          discount_type: 'fixed_amount',
          discount_amount: Math.round(discount.amount * 100),
          currency_code: currency,
        }
        : {
          name: `${discount.code} (${discount.percent}% off first payment)`,
          discount_type: 'percentage',
          discount_percentage: discount.percent,
        }),
    },
  });

  ctx.log(`Chargebee coupon created: ${couponId}`);
  return couponId;
}
