/**
 * Test: Marketing lifecycle (add → sync → remove)
 * End-to-end suite testing the full marketing contact flow via routes
 *
 * Requires TEST_EXTENDED_MODE=true and SENDGRID_API_KEY / BEEHIIV_API_KEY env vars.
 * These tests hit real external APIs.
 */

const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');
module.exports = defineCases({
  description: 'Marketing lifecycle (add → sync → remove)',
  type: 'suite',
  timeout: 60000,
  skip: !process.env.TEST_EXTENDED_MODE ? 'TEST_EXTENDED_MODE not set' : false,

  tests: [
    // Step 0: Pre-clean test contacts from providers (in case a previous run left them)
    {
      name: 'pre-clean-test-contacts',
      auth: 'admin',

      async run({ http, config, state }) {
        const testEmail = `lifecycle.test+bem@${config.domain}`;
        state.testEmail = testEmail;

        // Delete from all providers — handles "not found" gracefully
        await http.delete('omega/marketing/contact', { email: testEmail }).catch(() => {});
      },
    },

    // Step 1: Add a contact via POST /marketing/contact
    {
      name: 'add-contact',
      auth: 'admin',

      async run({ http, expect, state, config }) {
        const response = await http.post('omega/marketing/contact', {
          email: state.testEmail,
          firstName: 'Lifecycle',
          lastName: 'Test',
          source: 'backend-test-lifecycle',
          // skipValidation bypasses the mailbox verification check — the lifecycle
          // address has no real mailbox so the provider (correctly) marks it
          // undeliverable. This suite tests add → sync → remove against the real
          // providers, not deliverability (covered by email/validation + contact tests).
          skipValidation: true,
        });

        expect(response, 'Add contact should succeed').toBeSuccess();
        expect(response, 'success should be true').toHaveProperty('data.success', true);

        if (process.env.SENDGRID_API_KEY) {
          expect(response, 'Should have SendGrid result').toHaveProperty('data.providers.campaigns');
          expect(response, 'SendGrid add should succeed').toHaveProperty('data.providers.campaigns.success', true);
        }

        if (process.env.BEEHIIV_API_KEY && config.marketing?.newsletter?.providers?.beehiiv?.publicationId) {
          expect(response, 'Should have Beehiiv result').toHaveProperty('data.providers.newsletter');
          expect(response, 'Beehiiv add should succeed').toHaveProperty('data.providers.newsletter.success', true);
        }
      },
    },

    // Step 2: Sync by UID via PUT /marketing/contact
    // Tests the full sync pipeline: UID resolution → buildFields → upsert with custom fields
    {
      name: 'sync-contact-by-uid',
      auth: 'admin',

      async run({ http, expect, accounts, config, omega }) {
        // Dedicated journey account — its _test.allow_* prefix bypasses validation, and the
        // cleanup step's DELETE revokes its doc consent, so it must not be a shared sentinel
        // (consent-granted is used by the signup + consent-lifecycle suites).
        const grantedUid = accounts['journey-marketing-sync'].uid;
        const admin = omega.firebase.admin;
        await admin.firestore().doc(`users/${grantedUid}`).set({
          consent: { marketing: { status: 'granted' } },
        }, { merge: true });

        const response = await http.put('omega/marketing/contact', {
          uid: grantedUid,
        });

        expect(response, 'Sync contact should succeed').toBeSuccess();
        expect(response, 'success should be true').toHaveProperty('data.success', true);

        if (process.env.SENDGRID_API_KEY) {
          expect(response, 'Should have SendGrid result').toHaveProperty('data.providers.campaigns');
          expect(response, 'SendGrid sync should succeed').toHaveProperty('data.providers.campaigns.success', true);
        }

        if (process.env.BEEHIIV_API_KEY && config.marketing?.newsletter?.providers?.beehiiv?.publicationId) {
          expect(response, 'Should have Beehiiv result').toHaveProperty('data.providers.newsletter');
          expect(response, 'Beehiiv sync should succeed').toHaveProperty('data.providers.newsletter.success', true);
        }
      },
    },

    // Step 3: Remove the contact via DELETE /marketing/contact
    {
      name: 'remove-contact',
      auth: 'admin',

      async run({ http, expect, state, config }) {
        const response = await http.delete('omega/marketing/contact', {
          email: state.testEmail,
        });

        expect(response, 'Remove contact should succeed').toBeSuccess();
        expect(response, 'success should be true').toHaveProperty('data.success', true);

        if (process.env.SENDGRID_API_KEY) {
          expect(response, 'Should have SendGrid result').toHaveProperty('data.providers.campaigns');
          expect(response, 'SendGrid remove should succeed').toHaveProperty('data.providers.campaigns.success', true);
        }

        if (process.env.BEEHIIV_API_KEY && config.marketing?.newsletter?.providers?.beehiiv?.publicationId) {
          expect(response, 'Should have Beehiiv result').toHaveProperty('data.providers.newsletter');
          expect(response, 'Beehiiv remove should succeed').toHaveProperty('data.providers.newsletter.success', true);
        }
      },
    },

    // Step 4: Clean up the contact the sync step added to the live providers.
    // DELETE also mirrors revoked consent to the matching user doc — which is why this
    // targets the dedicated journey account (step 2 re-seeds granted before syncing, so
    // the suite is self-healing across runs).
    {
      name: 'cleanup-synced-contact',
      auth: 'admin',

      async run({ http, accounts }) {
        await http.delete('omega/marketing/contact', {
          email: accounts['journey-marketing-sync'].email,
        }).catch(() => {});
      },
    },
  ],
});
