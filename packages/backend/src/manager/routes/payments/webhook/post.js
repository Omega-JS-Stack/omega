const path = require('path');
const loadProcessor = require('../../../libraries/load-processor.js');
const powertools = require('node-powertools');
const safeCompare = require('../../../helpers/safe-compare.js');

// Processors already warned about running key-only, so the notice lands once per
// instance instead of once per event
const keyOnlyWarned = new Set();

/**
 * POST /payments/webhook?processor=stripe&key=XXX
 * Receives payment processor webhooks, validates them, and saves to Firestore
 * The Firestore onWrite trigger handles async processing
 *
 * This handler is processor-agnostic. Each processor module defines:
 *   - parseWebhook(req) — extracts { eventId, eventType, category, resourceType, resourceId, raw, uid }
 *   - isSupported(eventType) — returns true for events we should process
 *   - verifySignature(req) — optional; verifies the processor's native signature
 *     over the raw bytes, returning { status: 'verified' | 'invalid' | 'unconfigured' }
 */
module.exports = async ({ ctx, Manager, libraries }) => {
  const { admin } = libraries;
  const data = ctx.request.data;
  const query = ctx.request.query;

  // Get processor and key from query params
  const processor = query.processor;
  const key = query.key;

  // Validate processor
  if (!processor) {
    return ctx.respond('Missing processor parameter', { code: 400 });
  }

  // Validate key
  if (!safeCompare(key, process.env.OMEGA_WEBHOOK_KEY)) {
    return ctx.respond('Invalid key', { code: 401 });
  }

  // Guard: test processor is not available in production
  // (mirrors the intent side's guard — the webhook processors receive only the raw
  // req, so the dispatch layer is where this side has a ctx to ask)
  if (processor === 'test' && ctx.isProduction()) {
    return ctx.respond('Test processor is not available in production', { code: 403 });
  }

  // Validate brand — quit if a brand is specified and doesn't match ours
  const brand = query.brand;
  const ourBrand = Manager.config.brand?.id;
  if (brand && ourBrand && brand !== ourBrand) {
    ctx.log(`Ignoring webhook: explicit brand mismatch (received=${brand}, expected=${ourBrand})`);
    return ctx.respond({ received: true, ignored: true });
  }

  // Load the processor module
  let processorModule;
  try {
    processorModule = loadProcessor(path.join(__dirname, 'processors'), processor);
  } catch (e) {
    return ctx.respond(`Unknown processor: ${processor}`, { code: 400 });
  }

  // Verify the processor's native signature — the key param above is a defense
  // layer, not the boundary. A processor that ships a signing scheme verifies
  // strictly once its secret is configured; without it the route stays on the
  // key-only path and says so. Nothing is parsed or stored before this passes.
  if (processorModule.verifySignature) {
    const verification = processorModule.verifySignature(ctx.ref.req);

    if (verification.status === 'invalid') {
      ctx.error(`Rejected ${processor} webhook: signature verification failed (${verification.reason})`);
      return ctx.respond('Invalid signature', { code: 401 });
    }

    if (verification.status === 'unconfigured' && !keyOnlyWarned.has(processor)) {
      keyOnlyWarned.add(processor);
      ctx.warn(`${processor} webhooks are running key-only: ${verification.reason}. Set it to verify every event's signature.`);
    }
  }

  // Parse the webhook using the processor
  let parsed;
  try {
    parsed = processorModule.parseWebhook(ctx.ref.req);
  } catch (e) {
    return ctx.respond(`Failed to parse webhook: ${e.message}`, { code: 400 });
  }

  const { eventId, eventType, category, resourceType, resourceId, raw, uid } = parsed;

  ctx.log(`Parsed webhook: eventId=${eventId}, eventType=${eventType}, category=${category || 'null'}, resourceType=${resourceType || 'null'}, uid=${uid || 'null'}, api_version=${raw?.api_version || 'unknown'}`);

  // Let the processor decide if this event type is relevant
  if (processorModule.isSupported && !processorModule.isSupported(eventType)) {
    ctx.log(`Ignoring unsupported event type: ${eventType}`);
    return ctx.respond({ received: true, ignored: true });
  }

  // Skip events with no category (e.g., checkout.session.completed for subscription mode)
  if (!category) {
    ctx.log(`Ignoring event with no category: ${eventType}`);
    return ctx.respond({ received: true, ignored: true });
  }

  // Build timestamps
  const now = powertools.timestamp(new Date(), { output: 'string' });
  const nowUNIX = powertools.timestamp(now, { output: 'unix' });

  // Claim the event, then save — in ONE transaction. Processors retry, and a
  // retry can arrive while the first delivery is still in flight: a read
  // followed by a separate write leaves a window where both deliveries see no
  // doc and both write, so the pipeline runs the same event twice. The
  // transaction's read locks the document, so exactly one delivery claims it
  // and the other is told it is a duplicate ([#212]).
  const docRef = admin.firestore().doc(`payments-webhooks/${eventId}`);
  const claimed = await admin.firestore().runTransaction(async (transaction) => {
    const existingDoc = await transaction.get(docRef);

    if (existingDoc.exists) {
      const existingStatus = existingDoc.data()?.status;

      // A failed webhook is the one state that may be reclaimed — that IS the retry path
      if (existingStatus !== 'failed') {
        return { claimed: false, status: existingStatus };
      }
    }

    // Save with status=pending (trigger handles the rest)
    transaction.set(docRef, {
      id: eventId,
      processor: processor,
      status: 'pending',
      raw: raw,
      owner: uid,
      event: {
        type: eventType,
        category: category,
        resourceType: resourceType,
        resourceId: resourceId,
      },
      error: null,
      metadata: {
        created: {
          timestamp: now,
          timestampUNIX: nowUNIX,
        },
        completed: {
          timestamp: null,
          timestampUNIX: null,
        },
      },
    });

    return { claimed: true, retried: existingDoc.exists };
  });

  if (!claimed.claimed) {
    ctx.log(`Duplicate webhook ${eventId}, existing status=${claimed.status}, skipping`);
    return ctx.respond({ received: true, duplicate: true });
  }

  if (claimed.retried) {
    ctx.log(`Retrying previously failed webhook ${eventId}`);
  }

  ctx.log(`Saved payments-webhooks/${eventId}: eventType=${eventType}, category=${category}, processor=${processor}, uid=${uid}`);

  // Return 200 immediately
  return ctx.respond({ received: true });
};
