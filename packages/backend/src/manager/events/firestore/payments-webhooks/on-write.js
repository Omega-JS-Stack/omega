const path = require('path');
const powertools = require('node-powertools');
const transitions = require('./transitions/index.js');
const { trackPayment } = require('./analytics.js');
const loadProvider = require('../../../libraries/load-provider.js');
const { hasAuthUser } = require('../../../libraries/auth-user.js');
const User = require('../../../helpers/user.js');

/**
 * Firestore trigger: payments-webhooks/{eventId} onWrite
 *
 * Processes pending webhook events:
 * 1. Loads the provider library
 * 2. Fetches the latest resource from the provider API (not the stale webhook payload)
 * 3. Branches on event.category to transform + write:
 *    - subscription → toUnifiedSubscription → users/{uid}.subscription + payments-orders/{orderId}
 *    - one-time    → toUnifiedOneTime → payments-orders/{orderId}
 * 4. Detects state transitions and dispatches handler files (non-blocking)
 * 5. Marks the webhook as completed
 */
module.exports = async ({ ctx, change, context }) => {
  const Manager = ctx.Manager;
  const admin = Manager.libraries.admin;

  const dataAfter = change.after.data();

  // Short-circuit: deleted doc or non-pending status
  if (!dataAfter || dataAfter.status !== 'pending') {
    return;
  }

  const eventId = context.params.eventId;
  const webhookRef = admin.firestore().doc(`payments-webhooks/${eventId}`);

  // A doc that already completed once and is pending again is a REPROCESS (a
  // redelivery, or a doc put back to pending) — the transitions that fire on the
  // event type alone must not dispatch their email a second time.
  const previouslyCompleted = change.before.data()?.status === 'completed';

  // Set status to processing
  await webhookRef.set({ status: 'processing' }, { merge: true });

  // Hoisted so orderId is available in catch block for audit trail
  let orderId = null;
  let passThruOrderId = null;
  let library = null;

  try {
    const provider = dataAfter.provider;
    let uid = dataAfter.owner;
    const raw = dataAfter.raw;
    const eventType = dataAfter.event?.type;
    const category = dataAfter.event?.category;
    const resourceType = dataAfter.event?.resourceType;
    const resourceId = dataAfter.event?.resourceId;

    ctx.log(`Processing webhook ${eventId}: provider=${provider}, eventType=${eventType}, category=${category}, resourceType=${resourceType}, resourceId=${resourceId}, uid=${uid || 'null'}`);

    // Validate category
    if (!category) {
      throw new Error(`Webhook event has no category — cannot process`);
    }

    // Load the shared library for this provider
    try {
      library = loadProvider(path.join(__dirname, '../../../libraries/payment/providers'), provider);
    } catch (e) {
      throw new Error(`Unknown provider library: ${provider}`);
    }

    // Fetch the latest resource from the provider API
    // This ensures we always work with the most current state, not stale webhook data
    const rawFallback = extractRawResource(library, raw) || {};
    const resource = await library.fetchResource(resourceType, resourceId, rawFallback, { admin, ctx, eventType, config: Manager.config });

    // A flagged resource is the webhook's own payload, not the API's answer — say which
    const source = resource._stale ? 'stale-fallback (webhook payload, provider API unreachable)' : 'provider API';

    // v2 resources spell the field `status`, v1 sale resources spell it `state` —
    // reading only the first reported `status=unknown` on a fetch that plainly
    // succeeded, which is exactly the confusion this line exists to prevent
    // ([#347](https://github.com/Omega-JS-Stack/omega/issues/347)).
    const resourceStatus = resource.status ?? resource.state ?? 'unknown';
    ctx.log(`Fetched resource: type=${resourceType}, id=${resourceId}, status=${resourceStatus}, source=${source}`);

    // Resolve UID from the fetched resource if not available from webhook parse
    // This handles events like PAYMENT.SALE where the Sale object doesn't carry custom_id
    // but the parent subscription (fetched via fetchResource) does
    if (!uid && library.getUid) {
      uid = library.getUid(resource);
      ctx.log(`UID resolved from fetched resource: uid=${uid || 'null'}, provider=${provider}, resourceType=${resourceType}`);

      // Update the webhook doc with the resolved UID so it's persisted for debugging
      if (uid) {
        await webhookRef.set({ owner: uid }, { merge: true });
      }
    }

    // Fallback: resolve UID from the hosted page's pass_thru_content
    // Chargebee hosted page checkouts don't forward subscription[meta_data] to the subscription,
    // but pass_thru_content is stored on the hosted page and contains our UID + orderId
    let resolvedFromPassThru = false;
    if (!uid && library.resolveUidFromHostedPage) {
      const passThruResult = await library.resolveUidFromHostedPage(resourceId, ctx);
      if (passThruResult) {
        uid = passThruResult.uid;
        passThruOrderId = passThruResult.orderId || null;
        resolvedFromPassThru = true;
        ctx.log(`UID resolved from hosted page pass_thru_content: uid=${uid}, orderId=${passThruOrderId}, resourceId=${resourceId}`);

        await webhookRef.set({ owner: uid }, { merge: true });
      }
    }

    // Validate UID — must have one by now
    if (!uid) {
      throw new Error(`Webhook event has no UID — could not extract from webhook parse, fetched ${resourceType} resource, or hosted page pass_thru_content`);
    }

    // Backfill: if UID was resolved from pass_thru_content, set meta_data on the subscription
    // so future webhooks (renewals, cancellations) can resolve the UID directly
    if (resolvedFromPassThru && resourceType === 'subscription' && library.setMetaData) {
      library.setMetaData(resource, { uid, orderId: passThruOrderId })
        .then(() => ctx.log(`Backfilled meta_data on subscription ${resourceId} + customer: uid=${uid}, orderId=${passThruOrderId}`))
        .catch((e) => ctx.error(`Failed to backfill meta_data on ${resourceType} ${resourceId}: ${e.message}`));
    }

    // Build timestamps
    const now = powertools.timestamp(new Date(), { output: 'string' });
    const nowUNIX = powertools.timestamp(now, { output: 'unix' });
    const webhookReceivedUNIX = dataAfter.metadata?.created?.timestampUNIX || nowUNIX;

    // Extract orderId from resource (provider-agnostic)
    // Falls back to pass_thru_content orderId when meta_data wasn't available on the resource
    orderId = library.getOrderId(resource) || passThruOrderId;

    // Process the payment event (subscription or one-time)
    if (category !== 'subscription' && category !== 'one-time') {
      throw new Error(`Unknown event category: ${category}`);
    }

    const { transition, refusal } = await processPaymentEvent({ category, library, resource, resourceType, uid, provider, eventType, eventId, resourceId, orderId, now, nowUNIX, webhookReceivedUNIX, previouslyCompleted, ctx, raw });

    // Mark webhook as completed (include transition name + any refusal for auditing/testing).
    // Both are written on EVERY pass, so a reprocess that now finds its order clears
    // the refusal it was stamped with rather than leaving a stale flag behind.
    await webhookRef.set({
      status: 'completed',
      owner: uid,
      orderId: orderId,
      transition: transition,
      refusal: refusal,
      metadata: {
        completed: {
          timestamp: now,
          timestampUNIX: nowUNIX,
        },
      },
    }, { merge: true });

    ctx.log(`Webhook ${eventId} completed`);
  } catch (e) {
    ctx.error(`Webhook ${eventId} failed: ${e.message}`, e);

    const now = powertools.timestamp(new Date(), { output: 'string' });
    const nowUNIX = powertools.timestamp(now, { output: 'unix' });

    // Mark as failed with error message, counting the attempt — the frequent cron's
    // sweep re-flips a failed doc to pending until this count reaches its ceiling
    // (events/cron/frequent/retry-failed-webhooks.js)
    await webhookRef.set({
      status: 'failed',
      error: e.message || String(e),
      retryCount: (dataAfter.retryCount || 0) + 1,
    }, { merge: true });

    // A throw before the orderId was resolved (a fetchResource failure, an
    // unresolvable UID) would otherwise leave the intent pending forever — resolve
    // it from what IS available: the webhook doc, or the raw payload the provider
    // library can read an orderId out of.
    if (!orderId) {
      orderId = resolveOrderIdAfterFailure({ dataAfter, library, ctx }) || passThruOrderId;

      if (orderId) {
        ctx.log(`Resolved orderId ${orderId} for failed webhook ${eventId} from the webhook payload`);
      } else {
        ctx.warn(`Webhook ${eventId} failed with no resolvable orderId — its payments-intents doc (if any) stays pending and needs manual reconciliation`);
      }
    }

    // Mark intent as failed if we resolved the orderId before the error
    if (orderId) {
      await admin.firestore().doc(`payments-intents/${orderId}`).set({
        status: 'failed',
        error: e.message || String(e),
        metadata: {
          completed: {
            timestamp: now,
            timestampUNIX: nowUNIX,
          },
        },
      }, { merge: true });
    }
  }
};

/**
 * Read the resource out of a webhook envelope
 *
 * Every provider nests it somewhere else — Stripe at data.object, Chargebee at
 * content.<type>, PayPal at resource — so each library names its own shape. Reading
 * Stripe's here degraded every other provider's stale fallback to nothing, and a
 * Chargebee API re-fetch failure threw instead of falling back at all.
 *
 * The Stripe-shaped default below serves the null-library case only (the library
 * failed to load); every provider library, test included, exports extractResource().
 *
 * @param {object|null} library - Provider library (null when loading it was what failed)
 * @param {object} raw - The raw webhook payload the provider sent
 * @returns {object|null}
 */
function extractRawResource(library, raw) {
  if (library?.extractResource) {
    return library.extractResource(raw);
  }

  return raw?.data?.object || null;
}

/**
 * Resolve the orderId for a webhook that threw before the happy path resolved one
 *
 * @param {object} options
 * @param {object} options.dataAfter - The webhook doc's data
 * @param {object|null} options.library - Provider library (null when loading it was what failed)
 * @param {object} options.ctx - Assistant instance
 * @returns {string|null}
 */
function resolveOrderIdAfterFailure({ dataAfter, library, ctx }) {
  // An earlier pass may already have stamped it on the doc
  if (dataAfter.orderId) {
    return dataAfter.orderId;
  }

  const rawObject = extractRawResource(library, dataAfter.raw);

  if (!library?.getOrderId || !rawObject) {
    return null;
  }

  // The same extraction the happy path uses, over the webhook payload instead of
  // the fetched resource
  try {
    return library.getOrderId(rawObject) || null;
  } catch (e) {
    ctx.error(`resolveOrderIdAfterFailure(): ${dataAfter.provider} getOrderId() threw on the webhook payload: ${e.message}`, e);
    return null;
  }
}

/**
 * Process a payment event (subscription or one-time)
 * 1. Staleness check
 * 2. Read user doc (for transition detection)
 * 3. Transform raw resource → unified object
 * 4. Build order object
 * 5. Detect and dispatch transition handlers (non-blocking)
 * 6. Track analytics (non-blocking)
 * 7. Write to Firestore in ONE batch (user doc for subscriptions + payments-orders + payments-intents)
 *
 * @returns {Promise<{ transition: string|null, refusal: object|null }>} What the
 *   caller stamps back on the event doc: the transition detected, and the refusal
 *   when the pipeline declined to act on the event at all.
 */
async function processPaymentEvent({ category, library, resource, resourceType, uid, provider, eventType, eventId, resourceId, orderId, now, nowUNIX, webhookReceivedUNIX, previouslyCompleted, ctx, raw }) {
  const Manager = ctx.Manager;
  const admin = Manager.libraries.admin;
  const isSubscription = category === 'subscription';

  // Staleness check: skip if a newer webhook already wrote to this order
  let existingOrder = null;

  if (orderId) {
    const existingDoc = await admin.firestore().doc(`payments-orders/${orderId}`).get();
    if (existingDoc.exists) {
      existingOrder = existingDoc.data();
      const existingUpdatedUNIX = existingOrder.metadata?.updated?.timestampUNIX || 0;
      if (webhookReceivedUNIX < existingUpdatedUNIX) {
        ctx.log(`Stale webhook ${eventId}: received=${webhookReceivedUNIX}, existing updated=${existingUpdatedUNIX}, skipping`);
        return { transition: null, refusal: null };
      }
    }
  } else {
    // The guard keys on the order — without one, an out-of-order delivery cannot be
    // detected at all. Processing continues, but the unguarded window is visible.
    ctx.warn(`Webhook ${eventId} has no orderId (provider=${provider}, ${resourceType} ${resourceId}) — the staleness guard cannot run, so an out-of-order delivery for this resource would be applied as-is`);
  }

  // Unified refund details from the provider library (keeps the order record and
  // the transition handlers provider-agnostic). Every refund path needs them: the
  // subscription email's amount, the one-time refund's record on the order, and
  // the refusal below.
  const isRefund = transitions.REFUND_EVENTS.includes(eventType);
  const refundDetails = (isRefund && library.getRefundDetails) ? library.getRefundDetails(raw) : null;

  // A refund UPDATES a purchase — it can never DEFINE one. With no order record
  // behind it, the refund event used to be read as a fresh purchase definition:
  // payments-orders/{orderId} was minted with `unified.status: 'completed'` and the
  // REFUND's id as the resource, so a reversal was booked as revenue while the
  // trail said one-time/purchase-refunded. Reachable whenever the purchase write is
  // missing — a lost or failed purchase webhook, a webhook registered after the
  // sale, or PayPal delivering REFUNDED before the capture.
  //
  // So the pipeline refuses, loudly, and writes nothing else: the refusal is stamped
  // on the event's own doc for a human to reconcile from, which surfaces the lost
  // purchase webhook instead of letting it masquerade as revenue
  // ([#335](https://github.com/Omega-JS-Stack/omega/issues/335)).
  if (!isSubscription && isRefund && !existingOrder?.unified) {
    return {
      transition: null,
      refusal: refuseRefundWithoutOrder({ ctx, resource, refundDetails, eventId, eventType, provider, resourceType, resourceId, uid, orderId }),
    };
  }

  // Read current user doc (needed for transition detection + handler context)
  const userDoc = await admin.firestore().doc(`users/${uid}`).get();
  const userData = userDoc.exists ? userDoc.data() : {};
  const before = isSubscription ? (userData.subscription || null) : null;

  ctx.log(`User doc for ${uid}: exists=${userDoc.exists}, email=${userData?.auth?.email || 'null'}, name=${userData?.personal?.name?.first || 'null'}, subscription=${userData?.subscription?.product?.id || 'null'}`);

  // A user doc is born at SIGNUP, never at a payment event. A uid with no auth
  // user in this project is not this project's customer at all: a QA checkout run
  // against the emulator with real test-mode keys delivers its webhooks to the
  // DEPLOYED backend (the emulator has no webhook path), and the event minted a
  // LIVE users/{uid} holding nothing but a subscription block
  // ([#399](https://github.com/Omega-JS-Stack/omega/issues/399)).
  //
  // So an absent user doc has to prove the uid before anything is written under
  // it. A doc that already exists takes no auth lookup and no new behavior — an
  // update or a delete creates nothing, so it is left exactly as it was.
  if (!userDoc.exists && !(await hasAuthUser(admin, uid))) {
    return {
      transition: null,
      refusal: refuseUserWithoutAuth({ ctx, eventId, eventType, provider, uid, orderId }),
    };
  }

  // Auto-fill user name from payment provider if not already set
  if (!userData?.personal?.name?.first) {
    const customerName = extractCustomerName(resource, resourceType);
    if (customerName?.first) {
      await admin.firestore().doc(`users/${uid}`).set({
        personal: { name: customerName },
      }, { merge: true });
      ctx.log(`Auto-filled user name from ${resourceType}: ${customerName.first} ${customerName.last || ''}`);
    }
  }

  // Transform raw resource → unified object
  const transformOptions = { config: Manager.config, eventName: eventType, eventId: eventId };
  let unified = isSubscription
    ? library.toUnifiedSubscription(resource, transformOptions)
    : library.toUnifiedOneTime(resource, transformOptions);

  // Override: immediately suspend on payment denial
  // Providers keep the sub active while retrying, but we revoke access right away.
  // If the retry succeeds (e.g. PAYMENT.SALE.COMPLETED), it will restore active status.
  // PayPal: PAYMENT.SALE.DENIED, Stripe: invoice.payment_failed, Chargebee: payment_failed
  const PAYMENT_DENIED_EVENTS = ['PAYMENT.SALE.DENIED', 'invoice.payment_failed', 'payment_failed'];
  if (isSubscription && PAYMENT_DENIED_EVENTS.includes(eventType) && unified.status === 'active') {
    ctx.log(`Overriding status to suspended: ${eventType} received but provider still says active`);
    unified.status = 'suspended';
  }

  // A refund UPDATES a purchase record — it does not redefine the purchase.
  //
  // A one-time refund's resource is the bare charge that moved the money back: it
  // names no product and no price, so re-deriving the order from it degraded a
  // completed purchase to product=unknown and price=0, and replaced the checkout
  // resourceId with the charge id. Merge instead — the purchase stays exactly what
  // it was, and only the refund outcome is written
  // ([#212](https://github.com/Omega-JS-Stack/omega/issues/212)). A one-time refund
  // with no purchase to merge onto never reaches here — the guard above refused it.
  const isOneTimeRefund = !isSubscription && isRefund;

  if (isOneTimeRefund) {
    unified = applyRefundToPurchase(existingOrder.unified, unified, { refundDetails, now, nowUNIX });
  }

  ctx.log(`Unified ${category}: product=${unified.product.id}, status=${unified.status}`, unified);

  // Read checkout context from payments-intents (attribution, trackingConsent, request, discount, supplemental)
  let intentData = {};
  if (orderId) {
    const intentDoc = await admin.firestore().doc(`payments-intents/${orderId}`).get();
    intentData = intentDoc.exists ? intentDoc.data() : {};
  }

  // Build the order object (single source of truth for handlers + Firestore)
  const order = {
    id: orderId,
    type: category,
    owner: uid,
    productId: unified.product.id,
    provider: provider,
    // A refund event names the charge that reversed the payment, never the
    // checkout resource the purchase was made through — keep the purchase's own
    resourceId: isOneTimeRefund ? (existingOrder.resourceId || resourceId) : resourceId,
    unified: unified,
    attribution: intentData.attribution || {},
    trackingConsent: intentData.trackingConsent || null,
    // The requester's IP + user agent, captured when the intent was created —
    // what Meta and TikTok match a server conversion to the browsing session on
    // ([#385](https://github.com/Omega-JS-Stack/omega/issues/385)). A webhook's
    // own request is the PROVIDER's, never the customer's, so this can only
    // come from the intent.
    request: intentData.request || null,
    discount: intentData.discount || null,
    supplemental: intentData.supplemental || {},
    metadata: {
      created: {
        timestamp: now,
        timestampUNIX: nowUNIX,
      },
      updated: {
        timestamp: now,
        timestampUNIX: nowUNIX,
      },
      updatedBy: {
        event: {
          name: eventType,
          id: eventId,
        },
      },
    },
  };

  // Detect and dispatch transition (non-blocking)
  const shouldRunHandlers = !ctx.isTesting() || process.env.TEST_EXTENDED_MODE;
  const transitionName = transitions.detectTransition(category, before, unified, eventType, { previouslyCompleted });

  if (!transitionName && previouslyCompleted && isRefund) {
    ctx.log(`Transition suppressed (idempotency): webhook ${eventId} already completed once, so its refund email was already sent`);
  }

  if (transitionName) {
    ctx.log(`Transition detected: ${category}/${transitionName} (before.status=${before?.status || 'null'}, after.status=${unified.status})`);

    if (shouldRunHandlers) {
      transitions.dispatch(transitionName, category, {
        before, after: unified, order, uid, userDoc: userData, ctx, refundDetails,
      });
    } else {
      ctx.log(`Transition handler skipped (testing mode): ${category}/${transitionName}`);
    }
  }

  // Track payment analytics (non-blocking)
  // Fires independently of transitions — renewals have no transition but still need tracking.
  // `before` rides along for the same reason the transition detector reads it: a plan change
  // needs the plan it came from, and a trial's outcome is only legible against the prior term
  // ([#407](https://github.com/Omega-JS-Stack/omega/issues/407)).
  if (shouldRunHandlers) {
    trackPayment({ category, transitionName, eventType, unified, order, userDoc: userData, refundDetails, before, uid, provider, ctx });
  }

  // A persisted discount belongs to the subscription it was applied to, and to
  // that one only ([#333]). The unified object carries no discount key at all,
  // so the merge below would preserve the node forever: a customer who churned
  // and resubscribed kept a spent claim on the new subscription, where the
  // billing card reads `source: 'winback'` as "already claimed" and silently
  // never pitches the save offer again, one the backend would grant.
  //
  // So the claim's stamp is compared against the subscription THIS event is
  // about, and a mismatch clears the node: a new subscription is a clean slate.
  // A node with no stamp was written before the stamp existed and nothing can
  // prove it belongs to an older subscription, so it is read as riding the one
  // it is found on (no live discount is ever taken away on a guess) and stamped
  // there, so it clears on the next resubscribe like any other.
  //
  // The gate needs the RESOURCE to be a subscription, not just the category: a
  // subscription-category event can ride an invoice or sale resource (Stripe
  // charge.refunded, PayPal raw-payload fallback), whose id would never match
  // the stamp and would wrongly clear a live discount.
  const claimedDiscount = isSubscription && resourceType === 'subscription' && before?.discount?.valid === true ? before.discount : null;
  const liveResourceId = unified.payment?.resourceId || null;
  let discountWrite = null;

  if (claimedDiscount && liveResourceId) {
    if (!claimedDiscount.resourceId) {
      discountWrite = { resourceId: liveResourceId };
      ctx.log(`Adopting users/${uid}.subscription.discount onto ${liveResourceId}: the claim carries no subscription stamp, so it is the one it is riding`);
    } else if (claimedDiscount.resourceId !== liveResourceId) {
      discountWrite = User.EMPTY_DISCOUNT;
      ctx.log(`Clearing users/${uid}.subscription.discount: claimed on ${claimedDiscount.resourceId}, this event is for ${liveResourceId}, so the discount ended with the subscription it was applied to`);
    }
  }

  // The three writes this event produces — the user's subscription, the order and
  // the intent — land TOGETHER. As separate awaits, anything that threw between
  // them left the state split: a user paid with no order behind it, or an order
  // whose intent still says pending. The batch makes it all-or-nothing.
  const batch = admin.firestore().batch();

  // Write unified subscription to user doc (subscriptions only)
  if (isSubscription) {
    batch.set(admin.firestore().doc(`users/${uid}`), {
      subscription: discountWrite ? { ...unified, discount: discountWrite } : unified,
    }, { merge: true });
  }

  if (orderId) {
    const orderRef = admin.firestore().doc(`payments-orders/${orderId}`);
    const orderSnap = await orderRef.get();

    if (!orderSnap.exists) {
      // Initialize requests on first creation only (avoid overwriting cancel/refund data set by endpoints)
      order.requests = {
        cancellation: null,
        refund: null,
      };
    } else {
      // Preserve original created timestamp on subsequent webhook events
      order.metadata.created = orderSnap.data().metadata?.created || order.metadata.created;
    }

    // Write to payments-orders/{orderId}
    batch.set(orderRef, order, { merge: true });

    // Update payments-intents/{orderId} status to match webhook outcome
    batch.set(admin.firestore().doc(`payments-intents/${orderId}`), {
      status: 'completed',
      metadata: {
        completed: {
          timestamp: now,
          timestampUNIX: nowUNIX,
        },
      },
    }, { merge: true });
  }

  await batch.commit();

  if (isSubscription) {
    ctx.log(`Updated users/${uid}.subscription: status=${unified.status}, product=${unified.product.id}`);

    // Sync marketing contact with updated subscription data (non-blocking)
    if (shouldRunHandlers) {
      const email = Manager.Email(ctx);
      const updatedUserDoc = { ...userData, subscription: unified };
      email.sync(updatedUserDoc)
        .then((r) => ctx.log('Marketing sync after payment:', r))
        .catch((e) => ctx.error('Marketing sync after payment failed:', e));
    }
  }

  if (orderId) {
    ctx.log(`Updated payments-orders/${orderId}: type=${category}, uid=${uid}, eventType=${eventType}`);
    ctx.log(`Updated payments-intents/${orderId}: status=completed`);
  }

  // Mark abandoned cart as completed (non-blocking, fire-and-forget)
  const { COLLECTION } = require('../../../libraries/abandoned-cart-config.js');
  admin.firestore().doc(`${COLLECTION}/${uid}`).set({
    status: 'completed',
    metadata: {
      updated: {
        timestamp: now,
        timestampUNIX: nowUNIX,
      },
    },
  }, { merge: true })
    .then(() => ctx.log(`Updated ${COLLECTION}/${uid}: status=completed`))
    .catch((e) => {
      // Ignore not-found — cart may not exist for this user
      if (e.code !== 5) {
        ctx.error(`Failed to update ${COLLECTION}/${uid}: ${e.message}`);
      }
    });

  return { transition: transitionName, refusal: null };
}

/**
 * Record a refund on the unified purchase it reversed
 *
 * The purchase — product, price, the resource it was bought through — is kept
 * exactly as the completed purchase wrote it. Only the outcome changes: the
 * status, the refund itself, and which event last touched the record.
 *
 * @param {object} purchase - The unified one-time object already on the order
 * @param {object} derived - The unified object derived from the refund's own resource
 * @param {object} options
 * @param {object|null} options.refundDetails - The library's { amount, currency, reason }
 * @param {string} options.now - Timestamp string
 * @param {number} options.nowUNIX - Timestamp seconds
 * @returns {object} Unified one-time object
 */
function applyRefundToPurchase(purchase, derived, { refundDetails, now, nowUNIX }) {
  return {
    ...purchase,
    status: 'refunded',
    payment: {
      ...purchase.payment,
      refund: {
        amount: refundDetails?.amount || null,
        currency: refundDetails?.currency || 'USD',
        reason: refundDetails?.reason || null,
        date: {
          timestamp: now,
          timestampUNIX: nowUNIX,
        },
      },
      updatedBy: derived.payment?.updatedBy || purchase.payment?.updatedBy || null,
    },
  };
}

/**
 * Refuse a refund that has no purchase behind it, loudly, and say so on the record
 *
 * The books are the point: nothing is written to payments-orders or
 * payments-intents, so no revenue is invented. What the reconciler needs is stamped
 * on the event's OWN doc, which already carries the refund payload as delivered
 * (`raw`), the owner and the order it named: the reason it was refused, and the id
 * of the capture the refund reversed — the only pointer back to the purchase whose
 * webhook never landed ([#335](https://github.com/Omega-JS-Stack/omega/issues/335)).
 *
 * @param {object} options
 * @param {object} options.ctx - Assistant instance
 * @param {object} options.resource - The refund resource fetched from the provider
 * @param {object|null} options.refundDetails - The library's { amount, currency, reason }
 * @param {string} options.eventId - The webhook doc id (the provider's event id)
 * @param {string} options.eventType - The provider's event name
 * @param {string} options.provider - The provider that sent it
 * @param {string} options.resourceType - The parsed event's resource type
 * @param {string} options.resourceId - The refund's own id
 * @param {string} options.uid - The owner the event resolved to
 * @param {string|null} options.orderId - The order the refund named, which does not exist
 * @returns {{ reason: string, captureId: string|null }} The refusal stamp for the event doc
 */
function refuseRefundWithoutOrder({ ctx, resource, refundDetails, eventId, eventType, provider, resourceType, resourceId, uid, orderId }) {
  const captureId = extractParentResourceId(resource);

  ctx.error(`REFUND WITHOUT ORDER: ${eventType} (${provider}) reversed ${resourceType} ${resourceId} but payments-orders/${orderId || 'null'} does not exist — refusing to mint an order from a refund (owner=${uid}, capture=${captureId || 'unknown'}, amount=${refundDetails?.amount || 'unknown'} ${refundDetails?.currency || 'USD'}). Stamped on payments-webhooks/${eventId} as refusal.reason=refund-without-order: the purchase behind this refund never wrote an order and needs manual reconciliation`);

  return {
    reason: 'refund-without-order',
    captureId: captureId,
  };
}

/**
 * Refuse to create a user doc for a uid this project has no auth user for
 *
 * The event is acknowledged — the route answered 2xx when it stored it, and the
 * doc is completed rather than failed, so the provider stops redelivering an
 * event nothing here will ever act on. What a human needs to see it is the
 * warning plus the stamp on the event's own doc, which already carries the
 * payload as delivered ([#399](https://github.com/Omega-JS-Stack/omega/issues/399)).
 *
 * @param {object} options
 * @param {object} options.ctx - Assistant instance
 * @param {string} options.eventId - The webhook doc id (the provider's event id)
 * @param {string} options.eventType - The provider's event name
 * @param {string} options.provider - The provider that sent it
 * @param {string} options.uid - The owner the event resolved to
 * @param {string|null} options.orderId - The order the event named, if any
 * @returns {{ reason: string }} The refusal stamp for the event doc
 */
function refuseUserWithoutAuth({ ctx, eventId, eventType, provider, uid, orderId }) {
  ctx.warn(`USER WITHOUT AUTH: ${eventType} (${provider}) resolved to uid=${uid}, which has no auth user in this project and no user doc — refusing to create one from a payment event (event=${eventId}, order=${orderId || 'null'}). Stamped on payments-webhooks/${eventId} as refusal.reason=user-without-auth: the checkout behind this event belongs to another project, typically a local QA run against the emulator with real test-mode keys`);

  // The stamp is the record; this is the alarm. A log line in Cloud Logging is
  // only ever read by someone already looking, and the whole point of the guard
  // is that nobody knows to look — money moved somewhere for a uid this project
  // does not have (Ian 2026-08-20).
  //
  // `libraries.sentry` is the backend's ONE capture handle (helpers/context/
  // respond.js reads the same one) and is null whenever no DSN is configured, so
  // the optional chain IS the no-op. WARNING, not an exception: nothing here
  // failed — the pipeline made a decision, correctly. Only the uid rides, the
  // join key back to the account; no email is assembled at all, so there is
  // nothing for the PII scrub to take out ([docs/shared/monitoring.md]).
  ctx.Manager.libraries.sentry?.captureMessage?.(`Payment webhook refused: user without auth (uid=${uid})`, {
    level: 'warning',
    tags: {
      refusal: 'user-without-auth',
      provider: provider,
    },
    user: {
      id: uid,
    },
    extra: {
      reason: 'user-without-auth',
      uid: uid,
      eventId: eventId,
      eventType: eventType,
      provider: provider,
      orderId: orderId || null,
    },
  });

  return {
    reason: 'user-without-auth',
  };
}

/**
 * The id of the resource a refund reversed, read off the payload's `up` link
 *
 * PayPal points a refund at the capture it reversed with a HATEOAS link whose
 * `rel` is `up`, and the id is that URL's last segment. Providers that ship no
 * such links answer null, which the refusal stamp carries honestly rather than
 * guessing at a capture.
 *
 * @param {object} resource - The refund resource fetched from the provider
 * @returns {string|null}
 */
function extractParentResourceId(resource) {
  const up = (resource?.links || []).find((link) => link?.rel === 'up');

  if (!up?.href) {
    return null;
  }

  return up.href.split('/').filter(Boolean).pop() || null;
}

/**
 * Extract customer name from a raw payment provider resource
 *
 * @param {object} resource - Raw provider resource (Stripe subscription, session, invoice)
 * @param {string} resourceType - 'subscription' | 'session' | 'invoice'
 * @returns {{ first: string, last: string }|null}
 */
function extractCustomerName(resource, resourceType) {
  let fullName = null;

  // Checkout sessions have customer_details.name
  if (resourceType === 'session') {
    fullName = resource.customer_details?.name;
  }

  // Invoices have customer_name
  if (resourceType === 'invoice') {
    fullName = resource.customer_name;
  }

  // PayPal orders have payer.name
  if (resourceType === 'order') {
    const givenName = resource.payer?.name?.given_name;
    const surname = resource.payer?.name?.surname;

    if (givenName) {
      const { capitalize } = require('../../../libraries/infer-contact.js');
      return {
        first: capitalize(givenName) || null,
        last: capitalize(surname) || null,
      };
    }
  }

  // Chargebee subscriptions carry shipping_address / billing_address with first_name + last_name
  if (resourceType === 'subscription') {
    const addr = resource.shipping_address || resource.billing_address;
    if (addr?.first_name) {
      const { capitalize } = require('../../../libraries/infer-contact.js');
      return {
        first: capitalize(addr.first_name) || null,
        last: capitalize(addr.last_name) || null,
      };
    }
  }

  if (!fullName) {
    return null;
  }

  const { capitalize } = require('../../../libraries/infer-contact.js');
  const parts = fullName.trim().split(/\s+/);
  return {
    first: capitalize(parts[0]) || null,
    last: capitalize(parts.slice(1).join(' ')) || null,
  };
}
