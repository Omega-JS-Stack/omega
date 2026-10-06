/**
 * Test: POST /marketing/webhook
 *
 * Cross-provider unsubscribe webhook receiver. Phase E covers SendGrid;
 * Beehiiv will be added in a separate file.
 *
 * Dispatcher tests:
 *   - Auth via ?key= query param
 *   - Provider validation
 *   - Brand filter (ignore mismatched brand)
 *   - Idempotent re-delivery (handlers re-run safely; no dedup ledger)
 *
 * SendGrid provider tests:
 *   - Various event types (group_unsubscribe, unsubscribe, spamreport, bounce, dropped)
 *   - bounce/dropped only revoke on bounce_classification='Invalid Address' (hard bounce);
 *     technical bounces are sender-side issues and must NOT revoke consent
 *   - Email lookup → user doc mutation with source='sendgrid'
 *   - Silent skip when email doesn't map to a user (shared SendGrid account scenario)
 *   - Batched events processed independently
 *   - Unsupported event types ignored
 *
 * All revoke-event tests target the dedicated `journey-webhook-revoke` account: they
 * leave it with consent.marketing.status='revoked' (persistent side-effect data), which
 * must never land on the shared `basic` account — revoked consent persists for the rest
 * of the run and trips the email library's consent gate for later syncs of that account.
 */

// Helper — generate a unique sg_event_id per test

const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');
function sgEventId(name) {
  return `_test-sg-${name}-${Date.now()}`;
}

// Helper — build a SendGrid event payload
function sgEvent({ id, type, email, timestamp, asmGroupId, bounceClassification }) {
  return {
    sg_event_id: id,
    event: type,
    email,
    timestamp: timestamp || Math.floor(Date.now() / 1000),
    ...(asmGroupId !== undefined ? { asm_group_id: asmGroupId } : {}),
    ...(bounceClassification !== undefined ? { bounce_classification: bounceClassification } : {}),
  };
}

module.exports = defineCases({
  description: 'Marketing webhook endpoint (SendGrid)',
  type: 'group',
  timeout: 30000,

  tests: [
    // ─── Dispatcher auth + validation ───

    {
      name: 'rejects-missing-provider',
      auth: 'none',
      async run({ http, expect }) {
        const response = await http.as('none').post('omega/marketing/webhook', []);
        expect(response, 'Should reject missing provider').toBeError(400);
      },
    },

    {
      name: 'rejects-missing-key',
      auth: 'none',
      async run({ http, expect }) {
        const response = await http.as('none').post('omega/marketing/webhook?provider=sendgrid', []);
        expect(response, 'Should reject missing key').toBeError(401);
      },
    },

    {
      name: 'rejects-invalid-key',
      auth: 'none',
      async run({ http, expect }) {
        const response = await http.as('none').post('omega/marketing/webhook?provider=sendgrid&key=wrong-key', []);
        expect(response, 'Should reject invalid key').toBeError(401);
      },
    },

    {
      name: 'rejects-unknown-provider',
      auth: 'none',
      async run({ http, expect }) {
        const response = await http.as('none').post(
          `omega/marketing/webhook?provider=unknown&key=${process.env.OMEGA_WEBHOOK_KEY}`,
          []
        );
        expect(response, 'Should reject unknown provider').toBeError(400);
      },
    },

    {
      name: 'ignores-mismatched-brand',
      auth: 'none',
      async run({ http, expect }) {
        // Brand filter should silently ignore (200 with ignored: true), not error
        const response = await http.as('none').post(
          `omega/marketing/webhook?provider=sendgrid&key=${process.env.OMEGA_WEBHOOK_KEY}&brand=some-other-brand-that-does-not-exist`,
          []
        );
        expect(response, 'Should silently ignore mismatched brand (200 OK)').toBeSuccess();
        expect(response, 'Response should indicate ignored').toHaveProperty('data.ignored', true);
      },
    },

    // ─── SendGrid provider — supported events ───

    {
      name: 'sendgrid-group-unsubscribe-writes-consent',
      auth: 'none',
      async run({ http, firestore, expect, accounts }) {
        const uid = accounts['journey-webhook-revoke'].uid;
        const email = accounts['journey-webhook-revoke'].email;
        const eventId = sgEventId('group-unsub');
        const eventTimestamp = Math.floor(Date.now() / 1000);

        const response = await http.as('none').post(
          `omega/marketing/webhook?provider=sendgrid&key=${process.env.OMEGA_WEBHOOK_KEY}`,
          [sgEvent({ id: eventId, type: 'group_unsubscribe', email, timestamp: eventTimestamp, asmGroupId: 25928 })]
        );

        expect(response, `Webhook should accept group_unsubscribe: ${JSON.stringify(response, null, 2)}`).toBeSuccess();
        expect(response, 'Should report 1 event processed').toHaveProperty('data.processed', 1);

        // User doc should now show revoked marketing with source=sendgrid
        const userDoc = await firestore.get(`users/${uid}`);
        expect(userDoc?.consent?.marketing?.status, 'marketing.status should be revoked').toBe('revoked');
        expect(userDoc?.consent?.marketing?.revokedAt?.source, 'revokedAt.source should be sendgrid').toBe('sendgrid');
        expect(userDoc?.consent?.marketing?.revokedAt?.timestampUNIX, 'revokedAt.timestampUNIX should match event timestamp').toBe(eventTimestamp);
      },
    },

    {
      name: 'sendgrid-unsubscribe-event-handled',
      auth: 'none',
      async run({ http, firestore, expect, accounts }) {
        const uid = accounts['journey-webhook-revoke'].uid;
        const email = accounts['journey-webhook-revoke'].email;
        const eventId = sgEventId('unsub');

        const response = await http.as('none').post(
          `omega/marketing/webhook?provider=sendgrid&key=${process.env.OMEGA_WEBHOOK_KEY}`,
          [sgEvent({ id: eventId, type: 'unsubscribe', email })]
        );

        expect(response).toBeSuccess();
        expect(response, 'Should process the unsubscribe event').toHaveProperty('data.processed', 1);

        const userDoc = await firestore.get(`users/${uid}`);
        expect(userDoc?.consent?.marketing?.status, 'marketing.status should be revoked').toBe('revoked');
        expect(userDoc?.consent?.marketing?.revokedAt?.source, 'source should be sendgrid').toBe('sendgrid');
      },
    },

    {
      name: 'sendgrid-spamreport-event-handled',
      auth: 'none',
      async run({ http, firestore, expect, accounts }) {
        const uid = accounts['journey-webhook-revoke'].uid;
        const email = accounts['journey-webhook-revoke'].email;
        const eventId = sgEventId('spamreport');

        const response = await http.as('none').post(
          `omega/marketing/webhook?provider=sendgrid&key=${process.env.OMEGA_WEBHOOK_KEY}`,
          [sgEvent({ id: eventId, type: 'spamreport', email })]
        );

        expect(response).toBeSuccess();
        expect(response, 'Spamreport should be treated as a revoke').toHaveProperty('data.processed', 1);

        const userDoc = await firestore.get(`users/${uid}`);
        expect(userDoc?.consent?.marketing?.status).toBe('revoked');
      },
    },

    {
      name: 'sendgrid-hard-bounce-event-handled',
      auth: 'none',
      async run({ http, firestore, expect, accounts }) {
        const uid = accounts['journey-webhook-revoke'].uid;
        const email = accounts['journey-webhook-revoke'].email;
        const eventId = sgEventId('hard-bounce');

        // Only hard bounces (bounce_classification='Invalid Address') revoke consent.
        const response = await http.as('none').post(
          `omega/marketing/webhook?provider=sendgrid&key=${process.env.OMEGA_WEBHOOK_KEY}`,
          [sgEvent({ id: eventId, type: 'bounce', email, bounceClassification: 'Invalid Address' })]
        );

        expect(response).toBeSuccess();
        expect(response, 'Hard bounce should be treated as a revoke').toHaveProperty('data.processed', 1);

        const userDoc = await firestore.get(`users/${uid}`);
        expect(userDoc?.consent?.marketing?.status).toBe('revoked');
      },
    },

    {
      name: 'sendgrid-dropped-hard-bounce-handled',
      auth: 'none',
      async run({ http, firestore, expect, accounts }) {
        const uid = accounts['journey-webhook-revoke'].uid;
        const email = accounts['journey-webhook-revoke'].email;
        const eventId = sgEventId('dropped');

        // 'dropped' follows the same classification filter as 'bounce'.
        const response = await http.as('none').post(
          `omega/marketing/webhook?provider=sendgrid&key=${process.env.OMEGA_WEBHOOK_KEY}`,
          [sgEvent({ id: eventId, type: 'dropped', email, bounceClassification: 'Invalid Address' })]
        );

        expect(response).toBeSuccess();
        expect(response, 'Dropped with Invalid Address should be treated as a revoke').toHaveProperty('data.processed', 1);

        const userDoc = await firestore.get(`users/${uid}`);
        expect(userDoc?.consent?.marketing?.status).toBe('revoked');
      },
    },

    // ─── SendGrid provider — events we ignore ───

    {
      name: 'sendgrid-technical-bounce-ignored',
      auth: 'none',
      async run({ http, expect, accounts }) {
        const email = accounts['journey-webhook-revoke'].email;
        const eventId = sgEventId('technical-bounce');

        // Technical bounces (DMARC, TLS, DNS) are sender-side issues — the recipient's
        // mailbox is still valid, so consent must NOT be revoked.
        const response = await http.as('none').post(
          `omega/marketing/webhook?provider=sendgrid&key=${process.env.OMEGA_WEBHOOK_KEY}`,
          [sgEvent({ id: eventId, type: 'bounce', email, bounceClassification: 'Technical Failure' })]
        );

        expect(response, 'Should accept the request (not error) but ignore the event').toBeSuccess();
        expect(response, 'Technical bounce should not be processed').toHaveProperty('data.processed', 0);
        expect(response, '1 event should be skipped').toHaveProperty('data.skipped', 1);
      },
    },

    {
      name: 'sendgrid-bounce-without-classification-ignored',
      auth: 'none',
      async run({ http, expect, accounts }) {
        const email = accounts['journey-webhook-revoke'].email;
        const eventId = sgEventId('unclassified-bounce');

        // No bounce_classification — can't confirm a hard bounce, so skip.
        const response = await http.as('none').post(
          `omega/marketing/webhook?provider=sendgrid&key=${process.env.OMEGA_WEBHOOK_KEY}`,
          [sgEvent({ id: eventId, type: 'bounce', email })]
        );

        expect(response, 'Should accept the request (not error) but ignore the event').toBeSuccess();
        expect(response, 'Unclassified bounce should not be processed').toHaveProperty('data.processed', 0);
        expect(response, '1 event should be skipped').toHaveProperty('data.skipped', 1);
      },
    },

    {
      name: 'sendgrid-delivered-event-ignored',
      auth: 'none',
      async run({ http, firestore, expect, accounts }) {
        const email = accounts['journey-webhook-revoke'].email;
        const eventId = sgEventId('delivered');

        const response = await http.as('none').post(
          `omega/marketing/webhook?provider=sendgrid&key=${process.env.OMEGA_WEBHOOK_KEY}`,
          [sgEvent({ id: eventId, type: 'delivered', email })]
        );

        expect(response, 'Should accept the request (not error) but ignore the event').toBeSuccess();
        expect(response, 'No events should be processed').toHaveProperty('data.processed', 0);
        expect(response, '1 event should be skipped').toHaveProperty('data.skipped', 1);
      },
    },

    {
      name: 'sendgrid-open-event-ignored',
      auth: 'none',
      async run({ http, expect, accounts }) {
        const email = accounts['journey-webhook-revoke'].email;
        const eventId = sgEventId('open');

        const response = await http.as('none').post(
          `omega/marketing/webhook?provider=sendgrid&key=${process.env.OMEGA_WEBHOOK_KEY}`,
          [sgEvent({ id: eventId, type: 'open', email })]
        );

        expect(response).toBeSuccess();
        expect(response, 'Open events should be ignored').toHaveProperty('data.processed', 0);
      },
    },

    // ─── Email not mapped to a user ───

    {
      name: 'sendgrid-unknown-email-silent-skip',
      auth: 'none',
      async run({ http, expect }) {
        // Email that doesn't match any user in this brand's Firestore — shared SendGrid scenario
        const eventId = sgEventId('unknown-email');

        const response = await http.as('none').post(
          `omega/marketing/webhook?provider=sendgrid&key=${process.env.OMEGA_WEBHOOK_KEY}`,
          [sgEvent({ id: eventId, type: 'group_unsubscribe', email: '_test.never-existed@example.com' })]
        );

        // Dispatcher still runs the handler (which returns handled:false). From the
        // dispatcher's POV this counts as 'processed=1' since the handler didn't throw.
        // The handler's internal "user-not-found" branch is silent by design.
        expect(response, 'Should accept unknown-email gracefully').toBeSuccess();
        expect(response, 'No failures for unknown email').toHaveProperty('data.failed', 0);
      },
    },

    // ─── Batched events ───

    {
      name: 'sendgrid-batched-events-processed-independently',
      auth: 'none',
      async run({ http, firestore, expect, accounts }) {
        const uid = accounts['journey-webhook-revoke'].uid;
        const email = accounts['journey-webhook-revoke'].email;
        const e1 = sgEventId('batch-1');
        const e2 = sgEventId('batch-2');
        const e3 = sgEventId('batch-3');

        const response = await http.as('none').post(
          `omega/marketing/webhook?provider=sendgrid&key=${process.env.OMEGA_WEBHOOK_KEY}`,
          [
            sgEvent({ id: e1, type: 'group_unsubscribe', email }),
            sgEvent({ id: e2, type: 'open', email }), // ignored — unsupported type
            sgEvent({ id: e3, type: 'spamreport', email }),
          ]
        );

        expect(response).toBeSuccess();
        expect(response, '2 supported events should be processed').toHaveProperty('data.processed', 2);
        expect(response, '1 unsupported event should be skipped').toHaveProperty('data.skipped', 1);

        // User doc should be revoked
        const userDoc = await firestore.get(`users/${uid}`);
        expect(userDoc?.consent?.marketing?.status).toBe('revoked');
      },
    },

    // ─── Idempotent re-delivery (no dedup ledger) ───

    {
      name: 'sendgrid-duplicate-event-reprocessed-idempotently',
      auth: 'none',
      async run({ http, firestore, expect, accounts }) {
        const uid = accounts['journey-webhook-revoke'].uid;
        const email = accounts['journey-webhook-revoke'].email;
        const eventId = sgEventId('duplicate');

        // First delivery
        const response1 = await http.as('none').post(
          `omega/marketing/webhook?provider=sendgrid&key=${process.env.OMEGA_WEBHOOK_KEY}`,
          [sgEvent({ id: eventId, type: 'group_unsubscribe', email })]
        );
        expect(response1).toBeSuccess();
        expect(response1, 'First delivery should process').toHaveProperty('data.processed', 1);

        // Second delivery — same eventId. With no dedup ledger the handler runs
        // again, but the revoke is idempotent so the end state is unchanged.
        const response2 = await http.as('none').post(
          `omega/marketing/webhook?provider=sendgrid&key=${process.env.OMEGA_WEBHOOK_KEY}`,
          [sgEvent({ id: eventId, type: 'group_unsubscribe', email })]
        );
        expect(response2).toBeSuccess();
        expect(response2, 'Re-delivery reprocesses (idempotent), not skipped').toHaveProperty('data.processed', 1);

        const userDoc = await firestore.get(`users/${uid}`);
        expect(userDoc?.consent?.marketing?.status, 'User remains revoked after re-delivery').toBe('revoked');
      },
    },

    // ─── Missing event ID — still processed (no dedup requirement) ───

    {
      name: 'sendgrid-event-without-eventId-processed',
      auth: 'none',
      async run({ http, firestore, expect, accounts }) {
        const uid = accounts['journey-webhook-revoke'].uid;
        const email = accounts['journey-webhook-revoke'].email;

        const response = await http.as('none').post(
          `omega/marketing/webhook?provider=sendgrid&key=${process.env.OMEGA_WEBHOOK_KEY}`,
          [{ event: 'group_unsubscribe', email, timestamp: Math.floor(Date.now() / 1000) }] // NO sg_event_id
        );

        expect(response, 'Should accept the request').toBeSuccess();
        expect(response, 'Event without eventId is still processed (no dedup needed)').toHaveProperty('data.processed', 1);

        const userDoc = await firestore.get(`users/${uid}`);
        expect(userDoc?.consent?.marketing?.status, 'User should be revoked').toBe('revoked');
      },
    },

    // ──────────────────────────────────────────────────────────────────────
    // Beehiiv provider tests
    // ──────────────────────────────────────────────────────────────────────

    {
      name: 'beehiiv-subscription-unsubscribed-writes-consent',
      auth: 'none',
      async run({ http, firestore, expect, accounts, config, skip }) {
        const uid = accounts['journey-webhook-revoke'].uid;
        const email = accounts['journey-webhook-revoke'].email;
        const eventId = `_test-bh-unsub-${Date.now()}`;
        const eventISO = new Date().toISOString();
        const publicationId = config.marketing?.newsletter?.providers?.beehiiv?.publicationId;

        if (!publicationId) {
          return skip('No Beehiiv publication ID configured for this brand');
        }

        const response = await http.as('none').post(
          `omega/marketing/webhook?provider=beehiiv&key=${process.env.OMEGA_WEBHOOK_KEY}`,
          {
            id: eventId,
            event: 'subscription.unsubscribed',
            email,
            publication_id: publicationId,
            created_at: eventISO,
          }
        );

        expect(response, `Beehiiv unsub should succeed: ${JSON.stringify(response, null, 2)}`).toBeSuccess();
        expect(response, 'Should process 1 event').toHaveProperty('data.processed', 1);

        const userDoc = await firestore.get(`users/${uid}`);
        expect(userDoc?.consent?.marketing?.status, 'marketing.status should be revoked').toBe('revoked');
        expect(userDoc?.consent?.marketing?.revokedAt?.source, 'revokedAt.source should be beehiiv').toBe('beehiiv');
        expect(userDoc?.consent?.marketing?.revokedAt?.timestamp, 'revokedAt.timestamp should be set').toBeTruthy();
      },
    },

    {
      name: 'beehiiv-subscription-deleted-handled',
      auth: 'none',
      async run({ http, firestore, expect, accounts, config }) {
        const uid = accounts['journey-webhook-revoke'].uid;
        const email = accounts['journey-webhook-revoke'].email;
        const eventId = `_test-bh-deleted-${Date.now()}`;
        const publicationId = config.marketing?.newsletter?.providers?.beehiiv?.publicationId;

        const response = await http.as('none').post(
          `omega/marketing/webhook?provider=beehiiv&key=${process.env.OMEGA_WEBHOOK_KEY}`,
          {
            id: eventId,
            event: 'subscription.deleted',
            email,
            publication_id: publicationId,
            created_at: new Date().toISOString(),
          }
        );

        expect(response).toBeSuccess();
        expect(response, 'subscription.deleted should be processed as a revoke').toHaveProperty('data.processed', 1);

        const userDoc = await firestore.get(`users/${uid}`);
        expect(userDoc?.consent?.marketing?.status).toBe('revoked');
        expect(userDoc?.consent?.marketing?.revokedAt?.source).toBe('beehiiv');
      },
    },

    {
      name: 'beehiiv-subscription-paused-handled',
      auth: 'none',
      async run({ http, firestore, expect, accounts, config }) {
        const uid = accounts['journey-webhook-revoke'].uid;
        const email = accounts['journey-webhook-revoke'].email;
        const eventId = `_test-bh-paused-${Date.now()}`;
        const publicationId = config.marketing?.newsletter?.providers?.beehiiv?.publicationId;

        const response = await http.as('none').post(
          `omega/marketing/webhook?provider=beehiiv&key=${process.env.OMEGA_WEBHOOK_KEY}`,
          {
            id: eventId,
            event: 'subscription.paused',
            email,
            publication_id: publicationId,
            created_at: new Date().toISOString(),
          }
        );

        expect(response).toBeSuccess();
        expect(response, 'subscription.paused should be processed as a revoke').toHaveProperty('data.processed', 1);

        const userDoc = await firestore.get(`users/${uid}`);
        expect(userDoc?.consent?.marketing?.status).toBe('revoked');
      },
    },

    {
      name: 'beehiiv-publication-mismatch-silent-skip',
      auth: 'none',
      async run({ http, firestore, expect, accounts }) {
        // Send an event with a publication_id that does NOT match this brand's pub.
        // Simulates the shared-devbeans scenario where the parent forwarder fans
        // an event to brands that don't share the publication — they silent-skip.
        const email = accounts['journey-webhook-revoke'].email;
        const eventId = `_test-bh-pubmismatch-${Date.now()}`;

        // Snapshot revokedAt BEFORE the request so we can prove the pub-mismatch
        // handler didn't write anything new. (The basic account may already have
        // a beehiiv-sourced revoke from a prior test that legitimately fired.)
        const beforeDoc = await firestore.get(`users/${accounts['journey-webhook-revoke'].uid}`);
        const beforeRevokedAt = beforeDoc?.consent?.marketing?.revokedAt || null;

        const response = await http.as('none').post(
          `omega/marketing/webhook?provider=beehiiv&key=${process.env.OMEGA_WEBHOOK_KEY}`,
          {
            id: eventId,
            event: 'subscription.unsubscribed',
            email,
            publication_id: 'pub_does-not-belong-to-this-brand-xxxxxxxxxxxxxx',
            created_at: new Date().toISOString(),
          }
        );

        // The dispatcher counts this as 'processed' from its POV (the handler
        // ran without error), but the handler returned
        // { handled: false, reason: 'publication-mismatch' }.
        // What matters: the user doc should NOT have been mutated.
        expect(response, 'Pub-mismatch event should be accepted gracefully').toBeSuccess();

        // Reload the user doc and verify revokedAt is byte-equivalent to before —
        // pub-mismatch must not write a new revoke entry.
        const afterDoc = await firestore.get(`users/${accounts['journey-webhook-revoke'].uid}`);
        const afterRevokedAt = afterDoc?.consent?.marketing?.revokedAt || null;

        expect(afterRevokedAt, 'consent.marketing.revokedAt must be UNCHANGED after a pub-mismatch event (handler should silent-skip)').toEqual(beforeRevokedAt);
      },
    },

    {
      name: 'beehiiv-unknown-email-silent-skip',
      auth: 'none',
      async run({ http, expect, config }) {
        // Email that doesn't map to any user — shared publication scenario where
        // multiple brands receive the same event but only one has the user.
        const publicationId = config.marketing?.newsletter?.providers?.beehiiv?.publicationId;
        const eventId = `_test-bh-unknown-${Date.now()}`;

        const response = await http.as('none').post(
          `omega/marketing/webhook?provider=beehiiv&key=${process.env.OMEGA_WEBHOOK_KEY}`,
          {
            id: eventId,
            event: 'subscription.unsubscribed',
            email: '_test.no-such-user@example.com',
            publication_id: publicationId,
            created_at: new Date().toISOString(),
          }
        );

        expect(response, 'Unknown email should not error').toBeSuccess();
        expect(response, 'No failures for unknown email').toHaveProperty('data.failed', 0);
      },
    },

    {
      name: 'beehiiv-unsupported-event-ignored',
      auth: 'none',
      async run({ http, expect, accounts, config }) {
        // 'subscription.created' (new signup) is NOT a revoke — should be ignored.
        const email = accounts['journey-webhook-revoke'].email;
        const publicationId = config.marketing?.newsletter?.providers?.beehiiv?.publicationId;
        const eventId = `_test-bh-created-${Date.now()}`;

        const response = await http.as('none').post(
          `omega/marketing/webhook?provider=beehiiv&key=${process.env.OMEGA_WEBHOOK_KEY}`,
          {
            id: eventId,
            event: 'subscription.created',
            email,
            publication_id: publicationId,
            created_at: new Date().toISOString(),
          }
        );

        expect(response).toBeSuccess();
        expect(response, 'Unsupported events should not be processed').toHaveProperty('data.processed', 0);
        expect(response, 'Unsupported events should be skipped').toHaveProperty('data.skipped', 1);
      },
    },

    {
      name: 'beehiiv-duplicate-event-reprocessed-idempotently',
      auth: 'none',
      async run({ http, firestore, expect, accounts, config, skip }) {
        const uid = accounts['journey-webhook-revoke'].uid;
        const email = accounts['journey-webhook-revoke'].email;
        const publicationId = config.marketing?.newsletter?.providers?.beehiiv?.publicationId;
        const eventId = `_test-bh-dup-${Date.now()}`;

        if (!publicationId) {
          return skip('No Beehiiv publication ID configured for this brand');
        }

        const payload = {
          id: eventId,
          event: 'subscription.unsubscribed',
          email,
          publication_id: publicationId,
          created_at: new Date().toISOString(),
        };

        // First delivery
        const r1 = await http.as('none').post(
          `omega/marketing/webhook?provider=beehiiv&key=${process.env.OMEGA_WEBHOOK_KEY}`,
          payload
        );
        expect(r1).toBeSuccess();
        expect(r1, 'First delivery should process').toHaveProperty('data.processed', 1);

        // Second delivery — same id. No dedup ledger, so it reprocesses; the
        // revoke is idempotent so the end state is unchanged.
        const r2 = await http.as('none').post(
          `omega/marketing/webhook?provider=beehiiv&key=${process.env.OMEGA_WEBHOOK_KEY}`,
          payload
        );
        expect(r2).toBeSuccess();
        expect(r2, 'Re-delivery reprocesses (idempotent), not skipped').toHaveProperty('data.processed', 1);

        const userDoc = await firestore.get(`users/${uid}`);
        expect(userDoc?.consent?.marketing?.status, 'User remains revoked after re-delivery').toBe('revoked');
      },
    },
  ],
});
