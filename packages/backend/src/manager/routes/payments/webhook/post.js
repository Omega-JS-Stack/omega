const path = require('path');
const loadProcessor = require('../../../libraries/load-processor.js');
const powertools = require('node-powertools');
const safeCompare = require('../../../helpers/safe-compare.js');

/**
 * POST /payments/webhook?processor=stripe&key=XXX
 * Receives payment processor webhooks, validates them, and saves to Firestore
 * The Firestore onWrite trigger handles async processing
 *
 * This handler is processor-agnostic. Each processor module defines:
 *   - parseWebhook(req) — extracts { eventId, eventType, category, resourceType, resourceId, raw, uid }
 *   - isSupported(eventType) — returns true for events we should process
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

  // Check for duplicate (skip if already processing/completed)
  const existingDoc = await admin.firestore().doc(`payments-webhooks/${eventId}`).get();
  if (existingDoc.exists) {
    const existingStatus = existingDoc.data()?.status;
    if (existingStatus !== 'failed') {
      ctx.log(`Duplicate webhook ${eventId}, existing status=${existingStatus}, skipping`);
      return ctx.respond({ received: true, duplicate: true });
    }
    ctx.log(`Retrying previously failed webhook ${eventId}`);
  }

  // Build timestamps
  const now = powertools.timestamp(new Date(), { output: 'string' });
  const nowUNIX = powertools.timestamp(now, { output: 'unix' });

  // Save to Firestore with status=pending (trigger handles the rest)
  await admin.firestore().doc(`payments-webhooks/${eventId}`).set({
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

  ctx.log(`Saved payments-webhooks/${eventId}: eventType=${eventType}, category=${category}, processor=${processor}, uid=${uid}`);

  // Return 200 immediately
  return ctx.respond({ received: true });
};
