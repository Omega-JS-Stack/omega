/**
 * Test: POST /marketing/email-preferences
 *
 * Two modes:
 * - Anonymous HMAC: from email-footer unsubscribe link. Requires email + asmId + sig.
 *   Hits SendGrid ASM and (NEW) mirrors to user doc if email maps to a user.
 * - Authenticated: from account-page toggle. Requires only `action`.
 *   Writes consent.marketing to user doc with source='account' and hits SendGrid + Beehiiv
 *   via the email library.
 *
 * Set TEST_EXTENDED_MODE=true to hit real SendGrid + Beehiiv. Otherwise provider calls
 * are skipped but user-doc mutations still happen.
 */
const crypto = require('crypto');
const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');

const TEST_EMAIL = 'rachel.greene+backend-unsub@gmail.com';
const TEST_ASM_ID = '24077';

function generateSig(email) {
  return crypto.createHmac('sha256', process.env.UNSUBSCRIBE_HMAC_KEY).update(email.toLowerCase()).digest('hex');
}

module.exports = defineCases({
  description: 'Marketing email-preferences (anonymous HMAC + authenticated)',
  type: 'group',
  tests: [
    // ─── Anonymous HMAC flow ───

    {
      name: 'anon-unsubscribe-valid-sig-succeeds',
      auth: 'none',
      timeout: 15000,
      async run({ http, expect }) {
        const sig = generateSig(TEST_EMAIL);
        const response = await http.post('omega/marketing/email-preferences', {
          email: TEST_EMAIL,
          asmId: TEST_ASM_ID,
          action: 'unsubscribe',
          sig,
        });
        expect(response, 'Unsubscribe with valid sig should succeed').toBeSuccess();
        expect(response, 'success should be true').toHaveProperty('data.success', true);
      },
    },

    {
      name: 'anon-subscribe-valid-sig-succeeds',
      auth: 'none',
      timeout: 15000,
      async run({ http, expect }) {
        const sig = generateSig(TEST_EMAIL);
        const response = await http.post('omega/marketing/email-preferences', {
          email: TEST_EMAIL,
          asmId: TEST_ASM_ID,
          action: 'subscribe',
          sig,
        });
        expect(response, 'Subscribe with valid sig should succeed').toBeSuccess();
        expect(response, 'success should be true').toHaveProperty('data.success', true);
      },
    },

    {
      name: 'anon-resubscribe-rejected',
      auth: 'none',
      timeout: 15000,
      async run({ http, expect }) {
        // Old 'resubscribe' action is no longer accepted — must use 'subscribe'
        const sig = generateSig(TEST_EMAIL);
        const response = await http.post('omega/marketing/email-preferences', {
          email: TEST_EMAIL,
          asmId: TEST_ASM_ID,
          action: 'resubscribe',
          sig,
        });
        expect(response, 'Old "resubscribe" action should be rejected').toBeError(400);
      },
    },

    {
      name: 'anon-invalid-sig-rejected',
      auth: 'none',
      timeout: 15000,
      async run({ http, expect }) {
        const response = await http.post('omega/marketing/email-preferences', {
          email: TEST_EMAIL,
          asmId: TEST_ASM_ID,
          action: 'unsubscribe',
          sig: 'invalid-signature-value',
        });
        expect(response, 'Invalid sig should return 403').toBeError(403);
      },
    },

    {
      name: 'anon-missing-email-rejected',
      auth: 'none',
      timeout: 15000,
      async run({ http, expect }) {
        const response = await http.post('omega/marketing/email-preferences', {
          asmId: TEST_ASM_ID,
          action: 'unsubscribe',
          sig: 'anything',
        });
        expect(response, 'Missing email should return 400').toBeError(400);
      },
    },

    {
      name: 'anon-invalid-email-rejected',
      auth: 'none',
      timeout: 15000,
      async run({ http, expect }) {
        const sig = generateSig('not-an-email');
        const response = await http.post('omega/marketing/email-preferences', {
          email: 'not-an-email',
          asmId: TEST_ASM_ID,
          action: 'unsubscribe',
          sig,
        });
        expect(response, 'Invalid email format should return 400').toBeError(400);
      },
    },

    {
      name: 'anon-missing-asmid-rejected',
      auth: 'none',
      timeout: 15000,
      async run({ http, expect }) {
        const sig = generateSig(TEST_EMAIL);
        const response = await http.post('omega/marketing/email-preferences', {
          email: TEST_EMAIL,
          action: 'unsubscribe',
          sig,
        });
        expect(response, 'Missing asmId should return 400').toBeError(400);
      },
    },

    {
      name: 'anon-invalid-action-rejected',
      auth: 'none',
      timeout: 15000,
      async run({ http, expect }) {
        const sig = generateSig(TEST_EMAIL);
        const response = await http.post('omega/marketing/email-preferences', {
          email: TEST_EMAIL,
          asmId: TEST_ASM_ID,
          action: 'delete',
          sig,
        });
        expect(response, 'Invalid action should return 400').toBeError(400);
      },
    },

    {
      name: 'anon-wrong-email-sig-rejected',
      auth: 'none',
      timeout: 15000,
      async run({ http, expect }) {
        // sig generated for a different email — must not validate against TEST_EMAIL
        const sig = generateSig('someone-else@gmail.com');
        const response = await http.post('omega/marketing/email-preferences', {
          email: TEST_EMAIL,
          asmId: TEST_ASM_ID,
          action: 'unsubscribe',
          sig,
        });
        expect(response, 'Sig for different email should return 403').toBeError(403);
      },
    },

    // ─── Authenticated mode ───

    {
      name: 'auth-unsubscribe-writes-consent-and-records-source-account',
      auth: 'basic',
      timeout: 15000,
      async run({ http, firestore, expect, accounts }) {
        const uid = accounts.basic.uid;

        const beforeMs = Date.now();
        const response = await http.as('basic').post('omega/marketing/email-preferences', {
          action: 'unsubscribe',
        });
        const afterMs = Date.now();

        expect(response, `Authenticated unsubscribe should succeed: ${JSON.stringify(response, null, 2)}`).toBeSuccess();
        expect(response, 'success should be true').toHaveProperty('data.success', true);
        expect(response, 'action echoed in response').toHaveProperty('data.action', 'unsubscribe');

        const userDoc = await firestore.get(`users/${uid}`);

        expect(userDoc?.consent?.marketing?.status, 'consent.marketing.status should be revoked').toBe('revoked');
        expect(userDoc?.consent?.marketing?.revokedAt?.source, 'revokedAt.source should be account').toBe('account');
        expect(userDoc?.consent?.marketing?.revokedAt?.timestamp, 'revokedAt.timestamp should be set').toBeTruthy();
        expect(typeof userDoc?.consent?.marketing?.revokedAt?.timestampUNIX, 'revokedAt.timestampUNIX should be number').toBe('number');

        // Server time used (defense against clock manipulation).
        // Server uses Math.round, so the stamped value can be 1 second past Math.floor(afterMs/1000)
        // when the request takes >500ms. Use Math.round on the upper bound + a small fudge.
        const revokedUNIX = userDoc.consent.marketing.revokedAt.timestampUNIX;
        const beforeUNIX = Math.floor(beforeMs / 1000);
        const afterUNIX = Math.round(afterMs / 1000) + 1;
        expect(revokedUNIX >= beforeUNIX && revokedUNIX <= afterUNIX, `revokedAt.timestampUNIX (${revokedUNIX}) should be server time, between ${beforeUNIX} and ${afterUNIX}`).toBeTruthy();
      },
    },

    {
      name: 'auth-subscribe-after-unsubscribe-flips-status-keeps-prior-revokedAt',
      auth: 'basic',
      timeout: 15000,
      async run({ http, firestore, expect, accounts }) {
        const uid = accounts.basic.uid;

        // Capture revokedAt from the previous test
        const beforeDoc = await firestore.get(`users/${uid}`);
        const priorRevokedAt = beforeDoc?.consent?.marketing?.revokedAt;
        expect(priorRevokedAt?.timestamp, 'Prior test should have left a revokedAt timestamp').toBeTruthy();

        const response = await http.as('basic').post('omega/marketing/email-preferences', {
          action: 'subscribe',
        });

        expect(response, `Authenticated subscribe should succeed: ${JSON.stringify(response, null, 2)}`).toBeSuccess();

        const userDoc = await firestore.get(`users/${uid}`);

        // status flips
        expect(userDoc?.consent?.marketing?.status, 'status should flip to granted').toBe('granted');

        // grantedAt populated with new server time + source=account
        expect(userDoc?.consent?.marketing?.grantedAt?.source, 'grantedAt.source should be account').toBe('account');
        expect(userDoc?.consent?.marketing?.grantedAt?.timestamp, 'grantedAt.timestamp should be set').toBeTruthy();

        // revokedAt UNTOUCHED — still reflects the most recent revoke
        expect(userDoc?.consent?.marketing?.revokedAt?.timestamp, 'revokedAt.timestamp should be preserved from prior revoke').toBe(priorRevokedAt.timestamp);
        expect(userDoc?.consent?.marketing?.revokedAt?.source, 'revokedAt.source should be preserved from prior revoke').toBe(priorRevokedAt.source);
      },
    },

    {
      name: 'auth-invalid-action-rejected',
      auth: 'basic',
      timeout: 15000,
      async run({ http, expect }) {
        const response = await http.as('basic').post('omega/marketing/email-preferences', {
          action: 'delete',
        });
        expect(response, 'Invalid action should return 400').toBeError(400);
      },
    },

    {
      name: 'auth-opt-in-old-name-rejected',
      auth: 'basic',
      timeout: 15000,
      async run({ http, expect }) {
        // Old proposed 'opt-in' is NOT accepted — must use 'subscribe'
        const response = await http.as('basic').post('omega/marketing/email-preferences', {
          action: 'opt-in',
        });
        expect(response, 'Old "opt-in" name should be rejected (use "subscribe")').toBeError(400);
      },
    },

    {
      name: 'unauthenticated-without-sig-rejected',
      auth: 'none',
      timeout: 15000,
      async run({ http, expect }) {
        // Unauthenticated + no sig → email field is required for HMAC path → 400.
        // (No auth means we hit the anonymous path; no email/asmId means missing-required.)
        const response = await http.post('omega/marketing/email-preferences', {
          action: 'unsubscribe',
        });
        expect(response, 'Unauthenticated request without HMAC fields should 400').toBeError(400);
      },
    },
  ],
});
