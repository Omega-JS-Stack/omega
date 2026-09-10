/**
 * PayPal intent provider
 * Creates PayPal subscriptions (Billing API) and one-time orders (Orders API v2)
 */
const { chargeableAmount } = require('../../../../libraries/payment/discount-codes.js');

module.exports = {
  /**
   * Create a PayPal payment intent (subscription or one-time order)
   *
   * @param {object} options
   * @param {string} options.uid - User's UID
   * @param {string} options.orderId - Internal order ID
   * @param {object} options.product - Full product object from config
   * @param {string} options.productId - Product ID from config (e.g., 'premium')
   * @param {string} options.frequency - 'monthly' or 'annually' (subscriptions only)
   * @param {boolean} options.trial - Whether to include a trial period
   * @param {object} options.discount - Validated discount result, or null (comes off the first charge on both paths)
   * @param {string} options.confirmationUrl - Success redirect URL
   * @param {string} options.cancelUrl - Cancel redirect URL
   * @param {object} options.ctx - Assistant instance for logging
   * @returns {object} { id, url, raw }
   */
  async createIntent({ uid, orderId, product, productId, frequency, trial, discount, confirmationUrl, cancelUrl, ctx }) {
    const PayPalLib = require('../../../../libraries/payment/providers/paypal.js');

    const productType = product.type || 'subscription';

    if (productType === 'subscription') {
      return createSubscriptionIntent({ uid, orderId, product, productId, frequency, trial, discount, confirmationUrl, cancelUrl, ctx, PayPalLib });
    }

    return createOneTimeIntent({ uid, orderId, product, productId, discount, confirmationUrl, cancelUrl, ctx, PayPalLib });
  },
};

/**
 * Create a PayPal subscription via the Billing Subscriptions API
 */
async function createSubscriptionIntent({ uid, orderId, product, productId, frequency, trial, discount, confirmationUrl, cancelUrl, ctx, PayPalLib }) {
  // Whether this buyer is actually granted the trial, by the same rule the
  // confirmation URL quotes the total with in routes/payments/intent/post.js
  const takingTrial = !!(trial && product.trial?.days);

  // What the customer is charged TODAY: a free trial charges nothing (the plan's
  // own trial cycle does that, and no setup fee rides beside it), otherwise a
  // validated code comes off the first cycle — and a code that covers the whole
  // period is refused there rather than sent as a $0.00 setup fee PayPal will
  // not take ([#786](https://github.com/Omega-JS-Stack/omega/issues/786)) —
  // computed FIRST, so that refusal lands before PayPal is called at all.
  const listPrice = product.prices?.[frequency];
  const firstCharge = takingTrial
    ? 0
    : chargeableAmount(listPrice, discount, { provider: 'PayPal' });

  // Resolve the PayPal plan ID at runtime (fetches this product's plans and
  // matches by interval + amount + trial-cycle presence). A trial is a property
  // of the PLAN on PayPal, so which TWIN this resolves to is what grants or
  // withholds the free cycle ([#761](https://github.com/Omega-JS-Stack/omega/issues/761)).
  const planId = await PayPalLib.resolvePlanId(product, frequency, takingTrial);

  ctx.log(`PayPal subscription: planId=${planId}, uid=${uid}, trial=${takingTrial}, trialDays=${product.trial?.days || 'none'}`);

  // Build subscription request
  const subscriptionParams = {
    plan_id: planId,
    custom_id: PayPalLib.buildCustomId(uid, orderId),
    application_context: {
      brand_name: product.name || productId,
      return_url: confirmationUrl,
      cancel_url: cancelUrl,
      user_action: 'SUBSCRIBE_NOW',
      shipping_preference: 'NO_SHIPPING',
    },
  };

  // When billing starts, and what starts it: a discounted first period, or the
  // plan's own trial cycle (trials live on the plan, not on this call). Neither
  // arm firing means no `start_time` at all, which is PayPal's own "start now".
  //
  // A trial-configured product is no longer carved out of the discount, and
  // nothing nudges `start_time` to "skip" a trial any more: the plan resolved
  // above is the TWIN matching what this buyer was granted, so a returning buyer
  // skipping the trial is on a plan with no free cycle on it, and deferring its
  // start defers a PAID period. The old nudge skipped nothing — the free cycle
  // was on the plan either way, which is the whole of
  // [#761](https://github.com/Omega-JS-Stack/omega/issues/761).
  if (!takingTrial && firstCharge < listPrice) {
    // PayPal's Subscriptions API has no coupon object, and the plan the manager
    // created carries ONE infinite REGULAR cycle (the trial twin carries a TRIAL
    // cycle ahead of it, but a discounted checkout is never on that twin), so
    // neither shape the create call offers can discount only the first payment:
    // `plan.billing_cycles`
    // overrides a cycle by `sequence` (it carries no tenure_type or frequency,
    // so it cannot ADD a cheaper first one) and re-pricing that single cycle
    // would ride every renewal with it, while pricing a TRIAL cycle at the
    // discount would make a PAYING subscriber read as trialing everywhere the
    // backend asks — `resolveTrial()` in libraries/payment/providers/paypal.js
    // calls any TRIAL cycle a claimed trial, which revokes access the moment
    // they cancel and makes the winback offer refuse them.
    //
    // So the discounted first period is charged at approval as the plan
    // override's SETUP FEE, and the plan's own cycles are told to start one
    // period later: the customer pays the discounted amount today, PayPal bills
    // the plan's list price from the next period on, and the renewal price the
    // account carries stays the config price — the `duration: 'once'` semantics
    // every other provider gives ([#759](https://github.com/Omega-JS-Stack/omega/issues/759)).
    subscriptionParams.start_time = nextPeriodStart(frequency).toISOString();
    subscriptionParams.plan = {
      payment_preferences: {
        setup_fee: {
          currency_code: 'USD',
          value: firstCharge.toFixed(2),
        },
        // The plan's own dunning settings, repeated so a partial override can
        // never leave a discounted subscriber with different retry behavior
        // (createPlan in the manager sets these same two on every plan)
        auto_bill_outstanding: true,
        payment_failure_threshold: 3,
      },
    };

    ctx.log(`PayPal subscription discount: code=${discount.code}, today=${firstCharge.toFixed(2)}, renewals=${listPrice}, billingStarts=${subscriptionParams.start_time}`);
  } else if (takingTrial) {
    // Let the plan's trial cycle handle it
    // PayPal trials are configured on the plan, not at subscription creation
    ctx.log('PayPal trial: using plan trial cycle');
  }

  // Create the subscription
  const subscription = await PayPalLib.request('/v1/billing/subscriptions', {
    method: 'POST',
    body: JSON.stringify(subscriptionParams),
  });

  // Extract approval URL
  const approvalLink = subscription.links?.find(l => l.rel === 'approve');

  if (!approvalLink) {
    throw new Error('PayPal subscription created but no approval URL returned');
  }

  ctx.log(`PayPal subscription created: id=${subscription.id}, url=${approvalLink.href}`);

  return {
    id: subscription.id,
    url: approvalLink.href,
    raw: subscription,
  };
}

/**
 * One full billing period from now — when a discounted subscription's own
 * cycles start, since the period before them is the one the setup fee bought.
 *
 * @param {string} frequency - 'monthly', 'annually', 'weekly' or 'daily'
 * @returns {Date}
 */
function nextPeriodStart(frequency) {
  const start = new Date();

  if (frequency === 'annually') {
    start.setFullYear(start.getFullYear() + 1);
  } else if (frequency === 'weekly') {
    start.setDate(start.getDate() + 7);
  } else if (frequency === 'daily') {
    start.setDate(start.getDate() + 1);
  } else {
    // Monthly is the fallback the plan lookup uses for an unknown cadence too
    start.setMonth(start.getMonth() + 1);
  }

  return start;
}

/**
 * Create a PayPal one-time order via the Orders API v2
 */
async function createOneTimeIntent({ uid, orderId, product, productId, discount, confirmationUrl, cancelUrl, ctx, PayPalLib }) {
  if (product.archived) {
    throw new Error(`Product ${product.id} is archived`);
  }

  const listPrice = product.prices?.once;

  if (!listPrice) {
    throw new Error(`No one-time price configured for ${product.id}`);
  }

  // A v2 Order is a price WE compute: PayPal has no coupon object on it, and
  // nothing on its hosted page to apply one, so a code the route validated has
  // to come off here. Leaving it out charged the full price while the
  // confirmation page, which discounts the same way in
  // routes/payments/intent/post.js, quoted the discounted one
  // ([#758](https://github.com/Omega-JS-Stack/omega/issues/758)). A code that
  // covers the whole price is refused before the order is created: a v2 Order
  // has no zero amount ([#786](https://github.com/Omega-JS-Stack/omega/issues/786)).
  const amount = chargeableAmount(listPrice, discount, { provider: 'PayPal' });

  const brandName = ctx.Manager?.config?.brand?.name || product.name || productId;

  const orderParams = {
    intent: 'CAPTURE',
    purchase_units: [{
      amount: {
        currency_code: 'USD',
        value: amount.toFixed(2),
      },
      description: product.name || productId,
      custom_id: PayPalLib.buildCustomId(uid, orderId, productId),
    }],
    payment_source: {
      paypal: {
        experience_context: {
          brand_name: brandName,
          return_url: confirmationUrl,
          cancel_url: cancelUrl,
          user_action: 'PAY_NOW',
          shipping_preference: 'NO_SHIPPING',
        },
      },
    },
  };

  const order = await PayPalLib.request('/v2/checkout/orders', {
    method: 'POST',
    body: JSON.stringify(orderParams),
  });

  // Extract approval URL
  const approvalLink = order.links?.find(l => l.rel === 'payer-action' || l.rel === 'approve');

  if (!approvalLink) {
    throw new Error('PayPal order created but no approval URL returned');
  }

  ctx.log(`PayPal order created: id=${order.id}, url=${approvalLink.href}`);

  return {
    id: order.id,
    url: approvalLink.href,
    raw: order,
  };
}
