/**
 * Chargeblast dispute alert processor
 * Normalizes Chargeblast webhook payloads into a standard dispute alert shape
 *
 * Chargeblast sends two event types:
 *   alert.created: id, card, cardBrand, amount, transactionDate, processor, etc.
 *   alert.updated: same + externalOrder (charge ID), metadata (payment intent), customerEmail, etc.
 *
 * Signing: Chargeblast DOES sign, over Svix's scheme (verified against their
 * webhook docs, 2026-08-06 — this is not a key-only provider like Chargebee).
 * Every delivery carries `svix-id`, `svix-timestamp`, and `svix-signature`; the
 * signature is base64 HMAC-SHA256 of `<svix-id>.<svix-timestamp>.<raw body>`
 * keyed by the base64-decoded half of the endpoint secret (`whsec_<base64>`).
 * The header holds a space-delimited list of `v<n>,<signature>` entries and we
 * accept a `v1` match. `CHARGEBLAST_WEBHOOK_SECRET` turns it on; unset, the
 * route stays on the shared `?key=` path and warns.
 */
const crypto = require('crypto');
const safeCompare = require('../../../../helpers/safe-compare.js');

// The Svix signature version this provider emits and we verify
const SIGNATURE_VERSION = 'v1';

// Deliveries older than this are refused: a captured alert must not be replayable
const TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;

module.exports = {
  /**
   * Verify Chargeblast's `svix-signature` header against the delivered bytes
   *
   * The shared `?key=` param is a defense layer; this is the boundary. It runs
   * strictly whenever CHARGEBLAST_WEBHOOK_SECRET is set — the endpoint's signing
   * secret from the Chargeblast dashboard. Unset, the route stays key-only.
   *
   * @param {object} req - The raw HTTP request
   * @returns {object} { status, reason }
   *   - status: 'verified' | 'invalid' | 'unconfigured'
   */
  verifySignature(req) {
    const secret = process.env.CHARGEBLAST_WEBHOOK_SECRET;

    if (!secret) {
      return { status: 'unconfigured', reason: 'CHARGEBLAST_WEBHOOK_SECRET is not set' };
    }

    const id = req.headers?.['svix-id'];
    const timestamp = req.headers?.['svix-timestamp'];
    const signatureHeader = req.headers?.['svix-signature'];

    if (!id || !timestamp || !signatureHeader) {
      return { status: 'invalid', reason: 'missing svix-id, svix-timestamp, or svix-signature header' };
    }

    // Reject a replayed capture before spending a hash on it
    const ageSeconds = Math.abs((Date.now() / 1000) - Number(timestamp));

    if (!Number.isFinite(ageSeconds) || ageSeconds > TIMESTAMP_TOLERANCE_SECONDS) {
      return { status: 'invalid', reason: `svix-timestamp is outside the ${TIMESTAMP_TOLERANCE_SECONDS}s tolerance` };
    }

    // Only the delivered bytes can be verified — re-serializing req.body would
    // check a guess. GCF/Firebase requests carry rawBody.
    if (!req.rawBody) {
      return { status: 'invalid', reason: 'raw request body unavailable' };
    }

    // `whsec_<base64>` — the key is the DECODED half, not the printed string
    const secretBytes = Buffer.from(secret.split('_')[1] || '', 'base64');

    if (secretBytes.length === 0) {
      return { status: 'invalid', reason: 'CHARGEBLAST_WEBHOOK_SECRET is not a whsec_<base64> secret' };
    }

    const expected = crypto
      .createHmac('sha256', secretBytes)
      .update(`${id}.${timestamp}.${req.rawBody.toString('utf8')}`)
      .digest('base64');

    // The header is a space-delimited list — any v1 entry may be the match
    const delivered = `${signatureHeader}`.split(' ')
      .map((entry) => entry.split(','))
      .filter(([version]) => version === SIGNATURE_VERSION)
      .map(([, signature]) => signature);

    if (delivered.length === 0) {
      return { status: 'invalid', reason: `no ${SIGNATURE_VERSION} signature in svix-signature` };
    }

    const matched = delivered.some((signature) => safeCompare(signature, expected));

    return matched
      ? { status: 'verified' }
      : { status: 'invalid', reason: 'no signature matched the delivered bytes' };
  },

  /**
   * Normalize a Chargeblast webhook payload
   *
   * @param {object} body - Raw request body from Chargeblast
   * @returns {object} Normalized dispute alert
   */
  normalize(body) {
    if (!body.id && !body.alertId) {
      throw new Error('Missing required field: id');
    }
    if (!body.card) {
      throw new Error('Missing required field: card');
    }
    if (!body.amount && body.amount !== 0) {
      throw new Error('Missing required field: amount');
    }
    if (!body.transactionDate) {
      throw new Error('Missing required field: transactionDate');
    }

    const cardStr = String(body.card);

    return {
      id: String(body.id || body.alertId),
      card: {
        last4: cardStr.slice(-4),
        brand: body.cardBrand ? String(body.cardBrand).toLowerCase() : null,
      },
      amount: parseFloat(body.amount),
      transactionDate: String(body.transactionDate).split(' ')[0], // date only, no time
      processor: body.processor ? String(body.processor).toLowerCase() : 'stripe',
      alertType: body.alertType || null,
      customerEmail: body.customerEmail || null,
      // Stripe-specific IDs provided by Chargeblast on alert.updated events
      chargeId: body.externalOrder || null,
      paymentIntentId: body.metadata || null,
      stripeUrl: body.externalUrl || null,
      reasonCode: body.reasonCode || null,
      subprovider: body.subprovider || null,
      isRefunded: body.isRefunded || false,
    };
  },
};
