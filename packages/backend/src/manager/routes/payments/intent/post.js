const path = require('path');
const loadProcessor = require('../../../libraries/load-processor.js');
const powertools = require('node-powertools');
const OrderId = require('../../../libraries/payment/order-id.js');
const recaptcha = require('../../../libraries/recaptcha.js');
const discountCodes = require('../../../libraries/payment/discount-codes.js');
const { hasAuthUser } = require('../../../libraries/auth-user.js');

/**
 * POST /payments/intent
 * Creates a payment intent (e.g., Stripe Checkout Session) for subscription or one-time purchase
 * Requires authentication
 */
module.exports = async ({ ctx, Manager, user, settings, libraries }) => {
  const { admin } = libraries;

  // Require authentication
  if (!user.authenticated) {
    return ctx.respond('Authentication required', { code: 401 });
  }

  // A purchaser has to BE a user of this project: an auth user AND the user doc a
  // signup creates behind it. The pair only ever comes apart for a uid that lives
  // in ANOTHER project (a local QA checkout run against the emulator) or an
  // account deleted mid-session — and a checkout begun without it ends as a
  // webhook with nowhere to write, which the pipeline then refuses on its own
  // ([#399](https://github.com/Omega-JS-Stack/omega/issues/399)). Refusing HERE
  // means no processor session, no intent doc, and no half-written account.
  //
  // The DOC half is defense in depth on the token lane — authenticate() only calls
  // a JWT caller authenticated once it has read their user doc — and the live gate
  // on the omega-admin-key lane, which authenticates carrying no user at all.
  const missing = await findMissingPurchaser(admin, user.auth.uid);

  if (missing) {
    ctx.warn(`Checkout refused: uid=${user.auth.uid} has ${missing} in this project — a purchase requires both an auth user and a user doc`);
    return ctx.respond('Your account could not be verified. Please sign out, sign back in, and try again.', { code: 403 });
  }

  // Verify reCAPTCHA (skip during automated tests). verify() owns the whole
  // decision: no RECAPTCHA_SECRET_KEY configured → pass (unkeyed brands are a
  // sanctioned population; cp257: keys are optional and per-brand); secret +
  // missing/bad token → fail. No pre-check here: an empty-token 403 before
  // verify() would permanently reject every checkout from a brand that never
  // configured reCAPTCHA. Same shape as routes/marketing/contact/post.js.
  if (!ctx.isTesting()) {
    const recaptchaToken = settings.verification?.['g-recaptcha-response'];
    const recaptchaValid = await recaptcha.verify(recaptchaToken);
    if (!recaptchaValid) {
      return ctx.respond('Request could not be verified', { code: 403 });
    }
  }

  const uid = user.auth.uid;
  const processor = settings.processor;
  const productId = settings.productId;
  const frequency = settings.frequency;
  const attribution = settings.attribution;
  const trackingConsent = settings.trackingConsent;
  const discount = settings.discount;
  const supplemental = settings.supplemental;
  const simulate = settings.simulate;
  let trial = settings.trial;

  ctx.log(`Intent request: uid=${uid}, processor=${processor}, product=${productId}, frequency=${frequency}, trial=${trial}, simulate=${simulate || 'none'}`);

  // Validate product exists in config
  const product = (Manager.config.payment?.products || []).find(p => p.id === productId);
  if (!product) {
    ctx.log(`Product "${productId}" not found (available: ${(Manager.config.payment?.products || []).map(p => p.id).join(', ')})`);
    return ctx.respond(`Product '${productId}' not found`, { code: 400 });
  }

  const productType = product.type || 'subscription';

  ctx.log(`Product resolved: id=${product.id}, name=${product.name}, type=${productType}, trialDays=${product.trial?.days || 'none'}`);

  // Subscription-specific guards
  if (productType === 'subscription') {
    // Require frequency for subscriptions
    if (!frequency) {
      return ctx.respond('Frequency is required for subscription products', { code: 400 });
    }

    // Block checkout unless user has no subscription or is fully cancelled
    const subProductId = user.subscription?.product?.id || 'basic';
    const subStatus = user.subscription?.status;
    if (subProductId !== 'basic' && subStatus !== 'cancelled') {
      ctx.log(`User ${uid} has existing subscription: product=${subProductId}, status=${subStatus}, resourceId=${user.subscription.payment?.resourceId}`);
      return ctx.respond('You already have a subscription. Please cancel your existing subscription before purchasing a new one.', { code: 400 });
    }

    // Resolve trial eligibility: if requested but user has subscription history, silently downgrade
    if (trial) {
      const historySnapshot = await admin.firestore()
        .collection('payments-orders')
        .where('owner', '==', uid)
        .where('type', '==', 'subscription')
        .limit(1)
        .get();

      if (!historySnapshot.empty) {
        ctx.log(`User ${uid} not eligible for trial (has subscription history), continuing without trial`);
        trial = false;
      }
    }
  } else {
    // One-time purchases don't use trial or frequency
    trial = false;
  }

  // Validate discount code (if provided)
  let resolvedDiscount = null;
  if (discount) {
    const discountResult = discountCodes.validate(discount, user);
    if (!discountResult.valid) {
      return ctx.respond(`Invalid discount code: ${discount}`, { code: 400 });
    }
    resolvedDiscount = discountResult;
    ctx.log(`Discount validated: code=${resolvedDiscount.code}, percent=${resolvedDiscount.percent}, amount=${resolvedDiscount.amount}, duration=${resolvedDiscount.duration}`);
  }

  // Generate order ID
  const orderId = OrderId.generate();

  ctx.log(`Generated orderId=${orderId}`);

  // Build redirect URLs
  const confirmationUrl = buildConfirmationUrl(Manager.project.websiteUrl, { product, productId, productType, frequency, processor, trial, orderId, discount: resolvedDiscount });
  const cancelUrl = buildCancelUrl(Manager.project.websiteUrl, { productId, frequency });

  // Load the processor module
  let processorModule;
  try {
    processorModule = loadProcessor(path.join(__dirname, 'processors'), processor);
  } catch (e) {
    return ctx.respond(`Unknown processor: ${processor}`, { code: 400 });
  }

  // Create the intent via the processor
  let result;
  try {
    result = await processorModule.createIntent({
      uid,
      orderId,
      product,
      productId,
      frequency,
      trial,
      discount: resolvedDiscount,
      simulate,
      confirmationUrl,
      cancelUrl,
      ctx,
    });
  } catch (e) {
    // The processor's own words stay in the logs — a client gets one neutral
    // sentence, never an SDK message naming our internals ([#212]).
    ctx.error(`Failed to create ${processor} intent: uid=${uid}, product=${productId}, error=${e.message}`);
    return ctx.respond('We could not start your checkout right now. Please try again shortly.', { code: 500 });
  }

  ctx.log(`${processor} intent created: id=${result.id}, url=${result.url}`);

  // Build timestamps
  const now = powertools.timestamp(new Date(), { output: 'string' });
  const nowUNIX = powertools.timestamp(now, { output: 'unix' });

  // Save to payments-intents collection (keyed by orderId for consistent lookup with payments-orders)
  await admin.firestore().doc(`payments-intents/${orderId}`).set({
    id: orderId,
    intentId: result.id,
    processor: processor,
    owner: uid,
    status: 'pending',
    productId: productId,
    type: productType,
    frequency: frequency,
    trial: trial,
    attribution: attribution,
    trackingConsent: trackingConsent,
    // The CUSTOMER's request context, captured here because this is the only
    // moment the backend hears from their browser: the webhook that completes
    // the order arrives from the processor's servers. Meta and TikTok match a
    // server conversion to the browsing session on exactly this pair
    // ([#385](https://github.com/Omega-JS-Stack/omega/issues/385)), and the
    // order fold copies it off the intent.
    request: {
      ip: ctx.request.geolocation?.ip || null,
      userAgent: ctx.request.client?.userAgent || null,
    },
    discount: resolvedDiscount,
    supplemental: supplemental,
    raw: result.raw,
    metadata: {
      created: {
        timestamp: now,
        timestampUNIX: nowUNIX,
      },
    },
  });

  ctx.log(`Saved payments-intents/${orderId}: uid=${uid}, product=${productId}, type=${productType}, frequency=${frequency}, trial=${trial}`);

  return ctx.respond({
    id: result.id,
    orderId: orderId,
    url: result.url,
  });
};

/**
 * Which half of the purchaser is missing, if either
 *
 * @param {object} admin - The firebase-admin app
 * @param {string} uid - The authenticated caller's uid
 * @returns {Promise<string|null>} What is missing, phrased for the log line, or null when both exist
 */
async function findMissingPurchaser(admin, uid) {
  // The omega-admin-key lane authenticates with no user token, so there may be no
  // uid to look up at all — getUser('') throws, which would answer a 500 where the
  // whole point is a loud 403
  if (!uid) {
    return 'no auth user';
  }

  if (!await hasAuthUser(admin, uid)) {
    return 'no auth user';
  }

  const userDoc = await admin.firestore().doc(`users/${uid}`).get();

  return userDoc.exists ? null : 'no user doc';
}

/**
 * Build the confirmation/success redirect URL
 *
 * `amount` is what the customer is charged TODAY, not the list price: the
 * confirmation page hands that param straight to the client's analytics modules,
 * so quoting the list price on a discounted checkout over-reports revenue to
 * GA4/pixels. The discount comes off HERE rather than in a processor, because a
 * real processor applies the coupon on its own hosted page and never revisits
 * this URL — quoting it processor-side would have left every Stripe checkout
 * reporting the full price ([#239](https://github.com/Omega-JS-Stack/omega/issues/239)).
 */
function buildConfirmationUrl(baseUrl, { product, productId, productType, frequency, processor, trial, orderId, discount }) {
  const listPrice = productType === 'subscription'
    ? (product.prices?.[frequency] || 0)
    : (product.prices?.once || 0);

  // A trial charges nothing today; otherwise a validated coupon comes off the
  // first charge (every code is duration: 'once' — the renewal stays full price)
  const amount = trial && product.trial?.days
    ? 0
    : discountCodes.applyToAmount(listPrice, discount);

  const url = new URL('/payment/confirmation', baseUrl);
  url.searchParams.set('productId', productId);
  url.searchParams.set('productName', product.name || productId);
  url.searchParams.set('amount', String(amount));
  url.searchParams.set('currency', 'USD');
  url.searchParams.set('frequency', frequency || 'once');
  url.searchParams.set('paymentMethod', processor);
  url.searchParams.set('trial', String(!!trial && !!product.trial?.days));
  url.searchParams.set('orderId', orderId);
  url.searchParams.set('track', 'true');

  return url.toString();
}

/**
 * Build the cancel/back redirect URL
 */
function buildCancelUrl(baseUrl, { productId, frequency }) {
  const url = new URL('/payment/checkout', baseUrl);
  url.searchParams.set('product', productId);

  if (frequency) {
    url.searchParams.set('frequency', frequency);
  }

  url.searchParams.set('payment', 'cancelled');

  return url.toString();
}

// Exported for testing — the discounted `amount` is a processor-independent
// promise of this route, not of whichever processor happens to run
module.exports.buildConfirmationUrl = buildConfirmationUrl;
