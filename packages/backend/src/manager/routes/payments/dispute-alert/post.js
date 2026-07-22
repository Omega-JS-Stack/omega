const path = require('path');
const loadProcessor = require('../../../libraries/load-processor.js');
const powertools = require('node-powertools');
const safeCompare = require('../../../helpers/safe-compare.js');

/**
 * POST /payments/dispute-alert?provider=chargeblast&key=XXX
 * Receives dispute alert webhooks (e.g., from Chargeblast), validates them,
 * and saves to Firestore for async processing via onWrite trigger
 *
 * Query params:
 *   - provider: alert provider name (default: 'chargeblast')
 *   - key: must match OMEGA_WEBHOOK_KEY
 */
module.exports = async ({ ctx, Manager, libraries }) => {
  const { admin } = libraries;
  const body = ctx.request.body;
  const query = ctx.request.query;

  // Validate key
  const key = query.key;
  if (!safeCompare(key, process.env.OMEGA_WEBHOOK_KEY)) {
    return ctx.respond('Invalid key', { code: 401 });
  }

  // Determine alert provider (default: chargeblast)
  const provider = query.provider || 'chargeblast';

  // Load the processor module
  let processorModule;
  try {
    processorModule = loadProcessor(path.join(__dirname, 'processors'), provider);
  } catch (e) {
    return ctx.respond(`Unknown alert provider: ${provider}`, { code: 400 });
  }

  // Normalize the payload using the processor
  let alert;
  try {
    alert = processorModule.normalize(body);
  } catch (e) {
    return ctx.respond(`Failed to normalize alert: ${e.message}`, { code: 400 });
  }

  const alertId = alert.id;

  ctx.log(`Parsed dispute alert: id=${alertId}, provider=${provider}, processor=${alert.processor}, amount=${alert.amount}, card=****${alert.card.last4}`);

  // Check for duplicate (skip if already processing/completed)
  const existingDoc = await admin.firestore().doc(`payments-disputes/${alertId}`).get();
  if (existingDoc.exists) {
    const existingStatus = existingDoc.data()?.status;
    if (existingStatus !== 'failed') {
      ctx.log(`Duplicate dispute alert ${alertId}, existing status=${existingStatus}, skipping`);
      return ctx.respond({ received: true, duplicate: true });
    }
    ctx.log(`Retrying previously failed dispute alert ${alertId}`);
  }

  // Build timestamps
  const now = powertools.timestamp(new Date(), { output: 'string' });
  const nowUNIX = powertools.timestamp(now, { output: 'unix' });

  // Save to Firestore with status=pending (trigger handles the rest)
  await admin.firestore().doc(`payments-disputes/${alertId}`).set({
    id: alertId,
    provider: provider,
    status: 'pending',
    alert: alert,
    match: null,
    actions: {
      refund: 'pending',
      cancel: 'pending',
      email: 'pending',
    },
    errors: [],
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
    raw: body,
  });

  ctx.log(`Saved payments-disputes/${alertId}: provider=${provider}, processor=${alert.processor}`);

  // Return 200 immediately — async processing via Firestore trigger
  return ctx.respond({ received: true });
};
