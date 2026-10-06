const { TEST_ACCOUNTS } = require('../../../dist/test/test-accounts.js');
const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');

// SSOT: Affiliate code from referrer account definition
const REFERRER_AFFILIATE_CODE = TEST_ACCOUNTS.referrer.properties.affiliate.code;

/**
 * Test Suite: POST /user/signup
 * Tests the complete user signup flow including:
 * - Using pre-created referrer with an affiliate code
 * - Calling user signup with that referral code
 * - Verifying the referral tracking works
 * - Edge cases: unauthenticated, signing up for another user, invalid affiliate code
 *
 * Note: referrer and signup-referred accounts are pre-created by the test runner
 * The referrer has affiliate.code set at creation time (see test-accounts.js)
 */
module.exports = defineCases({
  description: 'User signup flow with affiliate tracking',
  type: 'suite',
  timeout: 60000, // Longer timeout for auth events to process

  tests: [
    // --- Edge case tests ---
    {
      name: 'signup-with-invalid-affiliate-code',
      async run({ http, expect }) {
        // Try to sign up with a non-existent affiliate code
        // Use dedicated account so it doesn't affect other tests
        const signupResponse = await http.as('signup-referred-invalid').post('omega/user/signup', {
          attribution: {
            affiliate: { code: 'INVALID_CODE_12345' },
          },
        });

        // Should succeed but without referral tracking (invalid code is ignored)
        expect(signupResponse, 'Signup should succeed even with invalid affiliate code').toBeSuccess();
      },
    },

    // --- Main signup flow tests ---
    {
      name: 'verify-referrer-exists',
      async run({ firestore, expect, state, accounts }) {
        // Use the pre-created static referrer account
        state.referrerUid = accounts.referrer.uid;
        state.referrerEmail = accounts.referrer.email;
        state.referrerAffiliateCode = REFERRER_AFFILIATE_CODE;

        // Verify the referrer account exists and has the affiliate code
        const referrerDoc = await firestore.get(`users/${state.referrerUid}`);

        expect(referrerDoc, 'Referrer user doc should exist').toBeTruthy();
        expect(referrerDoc?.affiliate?.code, 'Referrer should have affiliate code set').toBe(state.referrerAffiliateCode);
      },
    },

    {
      name: 'verify-referred-exists',
      async run({ firestore, expect, state, accounts }) {
        // Use the pre-created static referred account
        state.referredUid = accounts['signup-referred'].uid;
        state.referredEmail = accounts['signup-referred'].email;

        // Verify the referred account exists
        const referredDoc = await firestore.get(`users/${state.referredUid}`);

        expect(referredDoc, 'Referred user doc should exist').toBeTruthy();
      },
    },

    {
      name: 'call-user-signup-with-affiliate',
      async run({ http, expect, state }) {
        // Call POST /user/signup as the referred user with the new attribution format
        // This triggers the referral tracking logic
        // Use .as('signup-referred') to authenticate as that specific user via privateKey
        const signupResponse = await http.as('signup-referred').post('omega/user/signup', {
          attribution: {
            affiliate: {
              code: state.referrerAffiliateCode,
              timestamp: new Date().toISOString(),
              url: `https://example.com/?ref=${REFERRER_AFFILIATE_CODE}`,
              page: '/',
            },
            // The touch model: the affiliate block stays top level (processAffiliate
            // reads attribution.affiliate.code straight off it), and the campaign
            // context now arrives as first/last touches.
            first: {
              tags: {
                utm_source: 'test',
                utm_medium: 'referral',
                utm_campaign: 'signup-test',
              },
              referrer: 'https://google.com',
              timestamp: new Date().toISOString(),
              url: 'https://example.com/?utm_source=test',
              page: '/',
            },
            last: {
              tags: {
                utm_source: 'test',
                utm_medium: 'referral',
                utm_campaign: 'signup-test',
              },
              clickIds: {
                gclid: 'G-SIGNUP-1',
              },
              referrer: 'https://google.com',
              timestamp: new Date().toISOString(),
              url: 'https://example.com/?utm_source=test&gclid=G-SIGNUP-1',
              page: '/',
            },
          },
          context: {
            referrer: 'https://google.com',
            landingPage: 'https://example.com/',
          },
        });

        expect(signupResponse, `POST /user/signup should succeed: ${JSON.stringify(signupResponse, null, 2)}`).toBeSuccess();

        // @omega.js/backend API returns { data: { signedUp: true } }, http-client wraps in { data: response }
        const signedUp = signupResponse.data?.data?.signedUp || signupResponse.data?.signedUp;
        expect(signedUp === true, `Should return signedUp: true (got: ${JSON.stringify(signupResponse.data)})`).toBeTruthy();
      },
    },

    {
      name: 'duplicate-signup-blocked',
      async run({ http, expect, state }) {
        // Try to call POST /user/signup again for the same user
        // This should be blocked since signup has already been processed
        const signupResponse = await http.as('signup-referred').post('omega/user/signup', {
          attribution: {
            affiliate: { code: state.referrerAffiliateCode },
          },
        });

        expect(signupResponse, 'Duplicate signup should be blocked').toBeError(400);
        expect(signupResponse.error?.includes('already been processed'), `Error should mention already processed: ${signupResponse.error}`).toBeTruthy();
      },
    },

    {
      name: 'wait-for-referral-update',
      async run({ firestore, expect, state, waitFor }) {
        // Wait for the referral to be recorded
        // The user signup endpoint calls updateReferral() which updates the referrer

        const referralFound = await waitFor(async () => {
          const referrerDoc = await firestore.get(`users/${state.referrerUid}`);

          if (!referrerDoc) {
            return false;
          }

          const referrals = referrerDoc?.affiliate?.referrals || [];
          return referrals.some(r => r.uid === state.referredUid);
        }, 30000, 1000); // Wait up to 30s, check every 1s

        expect(referralFound, 'Referrer should have referred user in referrals array').toBeTruthy();
      },
    },

    {
      name: 'verify-referrer-has-referral',
      async run({ firestore, expect, state }) {
        // Verify the referrer now has the referred user in their referrals
        const referrerDoc = await firestore.get(`users/${state.referrerUid}`);

        expect(referrerDoc, 'Should read referrer doc').toBeTruthy();

        const referrals = referrerDoc?.affiliate?.referrals || [];

        expect(referrals.length > 0, 'Referrer should have at least one referral').toBeTruthy();

        const foundReferral = referrals.find(r => r.uid === state.referredUid);

        expect(foundReferral, `Referrer should have ${state.referredUid} in referrals`).toBeTruthy();
        expect(foundReferral.timestamp, 'Referral should have timestamp').toBeTruthy();
      },
    },

    {
      name: 'verify-attribution-data-saved',
      async run({ firestore, expect, state }) {
        // Verify the attribution data was saved correctly
        const referredDoc = await firestore.get(`users/${state.referredUid}`);

        expect(referredDoc, 'Should read referred user doc').toBeTruthy();

        // Check attribution object (single source of truth for referrer info)
        const attribution = referredDoc?.attribution;
        expect(attribution, 'Attribution object should exist').toBeTruthy();
        expect(attribution?.affiliate?.code === state.referrerAffiliateCode, 'Attribution should have affiliate code').toBeTruthy();
        expect(attribution?.first?.tags?.utm_source === 'test', 'Attribution should have first-touch UTM source').toBeTruthy();
        expect(attribution?.first?.tags?.utm_campaign === 'signup-test', 'Attribution should have first-touch UTM campaign').toBeTruthy();
        expect(attribution?.first?.referrer === 'https://google.com', 'Attribution should have the first-touch referrer').toBeTruthy();
        expect(attribution?.last?.clickIds?.gclid === 'G-SIGNUP-1', 'Attribution should have the last-touch click id').toBeTruthy();

        // Check activity context was merged
        const activity = referredDoc?.activity;
        expect(activity, 'Activity object should exist').toBeTruthy();
        expect(activity?.referrer === 'https://google.com', 'Activity should have referrer from context').toBeTruthy();
        expect(activity?.landingPage === 'https://example.com/', 'Activity should have landingPage from context').toBeTruthy();

        // Check flags
        expect(referredDoc?.flags?.signupProcessed === true, 'signupProcessed flag should be true').toBeTruthy();
      },
    },

    // --- Disposable email referral test ---
    {
      name: 'disposable-email-referral-skipped',
      async run({ http, firestore, expect, state, accounts }) {
        // Record current referral count before disposable signup
        const referrerBefore = await firestore.get(`users/${state.referrerUid}`);
        const referralsBefore = referrerBefore?.affiliate?.referrals || [];
        state.referralCountBefore = referralsBefore.length;

        // Sign up a disposable email account with the referrer's affiliate code
        // The signup itself should succeed (account was created via Admin SDK, bypassing beforeCreate)
        // But the referral credit should be SKIPPED because the email is disposable
        const signupResponse = await http.as('signup-referred-disposable').post('omega/user/signup', {
          attribution: {
            affiliate: { code: state.referrerAffiliateCode },
          },
        });

        expect(signupResponse, 'Disposable email signup should succeed').toBeSuccess();

        // Verify NO new referral was added to the referrer
        // Small delay to ensure any async writes would have completed
        await new Promise((resolve) => setTimeout(resolve, 3000));

        const referrerAfter = await firestore.get(`users/${state.referrerUid}`);
        const referralsAfter = referrerAfter?.affiliate?.referrals || [];

        expect(referralsAfter.length, `Referrer should NOT get credit for disposable email referral (before=${state.referralCountBefore}, after=${referralsAfter.length})`).toBe(state.referralCountBefore);

        const disposableReferral = referralsAfter.find(r => r.uid === accounts['signup-referred-disposable'].uid);
        expect(!disposableReferral, 'Disposable account should NOT appear in referrals').toBeTruthy();
      },
    },

    // --- Consent capture tests ---
    {
      name: 'consent-granted-both-records-canonical-shape',
      async run({ http, firestore, expect, accounts }) {
        const consentText = {
          legal: 'I agree to the Terms of Service and Privacy Policy.',
          marketing: 'Send me product updates and newsletters. You can unsubscribe anytime.',
        };

        // Use absurdly-old client timestamp to prove server time wins (defense vs clock skew)
        const signupResponse = await http.as('consent-granted').post('omega/user/signup', {
          consent: {
            legal: { granted: true, text: consentText.legal, timestamp: '2000-01-01T00:00:00.000Z' },
            marketing: { granted: true, text: consentText.marketing, timestamp: '2000-01-01T00:00:00.000Z' },
          },
        });

        expect(signupResponse, `Signup should succeed: ${JSON.stringify(signupResponse, null, 2)}`).toBeSuccess();

        const userDoc = await firestore.get(`users/${accounts['consent-granted'].uid}`);

        // Legal
        expect(userDoc?.consent?.legal?.status, 'consent.legal.status should be granted').toBe('granted');
        expect(userDoc?.consent?.legal?.grantedAt?.source, 'legal grantedAt.source should be signup-form').toBe('signup');
        expect(userDoc?.consent?.legal?.grantedAt?.text, 'legal grantedAt.text should match client payload').toBe(consentText.legal);
        expect(userDoc?.consent?.legal?.grantedAt?.timestamp, 'legal grantedAt.timestamp should be set').toBeTruthy();
        expect(typeof userDoc?.consent?.legal?.grantedAt?.timestampUNIX, 'legal grantedAt.timestampUNIX should be number').toBe('number');

        // Server-derived time MUST be used (the client-supplied 2000-01-01 should NOT appear).
        // grantedAt is stamped from Auth's creationTime, the same source as metadata.created,
        // so the two must be equal — and the client's 2000-01-01 (UNIX 946684800) is rejected.
        const legalUNIX = userDoc.consent.legal.grantedAt.timestampUNIX;
        const createdUNIX = userDoc.metadata.created.timestampUNIX;
        expect(legalUNIX, `legal grantedAt.timestampUNIX (${legalUNIX}) should match metadata.created (${createdUNIX}) — both from Auth creationTime`).toBe(createdUNIX);
        expect(legalUNIX, 'legal grantedAt must NOT be the client-supplied 2000-01-01 time').not.toBe(946684800);

        // Marketing
        expect(userDoc?.consent?.marketing?.status, 'consent.marketing.status should be granted').toBe('granted');
        expect(userDoc?.consent?.marketing?.grantedAt?.source, 'marketing grantedAt.source should be signup-form').toBe('signup');
        expect(userDoc?.consent?.marketing?.grantedAt?.text, 'marketing grantedAt.text should match client payload').toBe(consentText.marketing);
        expect(typeof userDoc?.consent?.marketing?.grantedAt?.timestampUNIX, 'marketing grantedAt.timestampUNIX should be number').toBe('number');

        // revokedAt should be all-null sibling object (NOT undefined, NOT missing)
        expect(userDoc?.consent?.marketing?.revokedAt, 'marketing.revokedAt object should exist (not null)').toBeTruthy();
        expect(userDoc?.consent?.marketing?.revokedAt?.timestamp, 'marketing revokedAt.timestamp should be null').toBe(null);
        expect(userDoc?.consent?.marketing?.revokedAt?.source, 'marketing revokedAt.source should be null').toBe(null);
      },
    },

    {
      name: 'consent-marketing-declined-records-revokedAt',
      async run({ http, firestore, expect, accounts }) {
        const legalText = 'I agree to the Terms of Service and Privacy Policy.';

        const signupResponse = await http.as('consent-declined').post('omega/user/signup', {
          consent: {
            legal: { granted: true, text: legalText },
            marketing: { granted: false, text: 'Send me updates.' },
          },
        });

        expect(signupResponse, `Signup should succeed: ${JSON.stringify(signupResponse, null, 2)}`).toBeSuccess();

        const userDoc = await firestore.get(`users/${accounts['consent-declined'].uid}`);

        // Legal — granted normally
        expect(userDoc?.consent?.legal?.status, 'legal.status should be granted').toBe('granted');
        expect(userDoc?.consent?.legal?.grantedAt?.source, 'legal grantedAt.source should be signup-form').toBe('signup');

        // Marketing — revoked at signup
        expect(userDoc?.consent?.marketing?.status, 'marketing.status should be revoked').toBe('revoked');

        // grantedAt MUST be all-null (never granted, even though client passed text)
        expect(userDoc?.consent?.marketing?.grantedAt?.timestamp, 'marketing grantedAt.timestamp should be null').toBe(null);
        expect(userDoc?.consent?.marketing?.grantedAt?.source, 'marketing grantedAt.source should be null').toBe(null);
        expect(userDoc?.consent?.marketing?.grantedAt?.text, 'marketing grantedAt.text should be null (declined)').toBe(null);

        // revokedAt MUST have signup-form-declined source + server time
        expect(userDoc?.consent?.marketing?.revokedAt?.source, 'marketing revokedAt.source should be signup-form-declined').toBe('signup');
        expect(userDoc?.consent?.marketing?.revokedAt?.timestamp, 'marketing revokedAt.timestamp should be set').toBeTruthy();
        expect(typeof userDoc?.consent?.marketing?.revokedAt?.timestampUNIX, 'marketing revokedAt.timestampUNIX should be number').toBe('number');
        expect(userDoc?.consent?.marketing?.revokedAt?.text, 'marketing revokedAt.text should be null (decline has no message)').toBe(null);
      },
    },

    {
      name: 'consent-missing-defaults-to-revoked',
      async run({ http, firestore, expect, accounts }) {
        // Client sends NO consent field at all (legacy or malformed payload).
        // Expected: both legal + marketing default to revoked. No crash, no marketing sync.
        const signupResponse = await http.as('consent-missing').post('omega/user/signup', {});

        expect(signupResponse, `Signup should succeed even with no consent: ${JSON.stringify(signupResponse, null, 2)}`).toBeSuccess();

        const userDoc = await firestore.get(`users/${accounts['consent-missing'].uid}`);

        expect(userDoc?.consent, 'consent object should exist').toBeTruthy();
        expect(userDoc?.consent?.legal?.status, 'legal.status should default to revoked').toBe('revoked');
        expect(userDoc?.consent?.legal?.grantedAt?.timestamp, 'legal grantedAt.timestamp should be null').toBe(null);
        expect(userDoc?.consent?.legal?.grantedAt?.source, 'legal grantedAt.source should be null').toBe(null);

        expect(userDoc?.consent?.marketing?.status, 'marketing.status should default to revoked').toBe('revoked');
        expect(userDoc?.consent?.marketing?.grantedAt?.timestamp, 'marketing grantedAt.timestamp should be null').toBe(null);

        // Even when consent is missing entirely, the revokedAt block gets stamped with signup-form-declined.
        // This ensures the user doc has a recorded decline event for audit.
        expect(userDoc?.consent?.marketing?.revokedAt?.source, 'marketing revokedAt.source should be signup-form-declined when consent missing').toBe('signup');
      },
    },

    // --- Consent downgrade-protection tests ---
    // Guards against data loss when a LEGACY account (signed up before the flags.signupProcessed
    // flow existed, so flag never set) re-fires /user/signup on page load. Its localStorage
    // consent is long gone, so the payload is empty — without the guard, buildConsentRecord
    // would compute 'revoked' and the {merge:true} write would wipe the consent the user
    // actually granted months ago. The guard preserves any existing 'granted' status.
    {
      name: 'consent-empty-payload-preserves-existing-grant',
      async run({ http, firestore, expect, accounts }) {
        const uid = accounts['consent-preserve'].uid;

        // Seed the doc as an established account whose consent is already granted (as a real
        // legacy signup would be after the OMEGA migration backfilled consent). flags is left
        // at the schema default (signupProcessed: false) to mimic the legacy state exactly.
        // merge:true — preserve the runner-provisioned auth.uid (pollForUserDoc needs it).
        await firestore.set(`users/${uid}`, {
          consent: {
            legal: {
              status: 'granted',
              grantedAt: { timestamp: '2025-01-01T00:00:00.000Z', timestampUNIX: 1735689600, source: 'signup', ip: null, text: 'Legacy legal grant' },
            },
            marketing: {
              status: 'granted',
              grantedAt: { timestamp: '2025-01-01T00:00:00.000Z', timestampUNIX: 1735689600, source: 'signup', ip: null, text: 'Legacy marketing grant' },
              revokedAt: { timestamp: null, timestampUNIX: null, source: null, ip: null, text: null },
            },
          },
          flags: { signupProcessed: false },
        }, { merge: true });

        // Re-fire signup with NO consent payload (the legacy page-load case).
        const signupResponse = await http.as('consent-preserve').post('omega/user/signup', {});
        expect(signupResponse, `Signup should succeed: ${JSON.stringify(signupResponse, null, 2)}`).toBeSuccess();

        const userDoc = await firestore.get(`users/${uid}`);

        // CRITICAL: the prior grants must survive — NOT be downgraded to revoked.
        expect(userDoc?.consent?.legal?.status, 'legal.status must stay granted (not downgraded by empty payload)').toBe('granted');
        expect(userDoc?.consent?.legal?.grantedAt?.text, 'legal grantedAt must be the preserved original, not wiped').toBe('Legacy legal grant');
        expect(userDoc?.consent?.legal?.grantedAt?.timestampUNIX, 'legal grantedAt timestamp must be preserved').toBe(1735689600);

        expect(userDoc?.consent?.marketing?.status, 'marketing.status must stay granted (not downgraded by empty payload)').toBe('granted');
        expect(userDoc?.consent?.marketing?.grantedAt?.text, 'marketing grantedAt must be the preserved original').toBe('Legacy marketing grant');
        // No spurious revokedAt should have been stamped over the preserved grant.
        expect(userDoc?.consent?.marketing?.revokedAt?.timestamp, 'marketing revokedAt must stay null (no decline was recorded)').toBe(null);

        // signupProcessed should now be flipped true by this run.
        expect(userDoc?.flags?.signupProcessed, 'signupProcessed should be set true after the run').toBe(true);
      },
    },
    {
      name: 'consent-explicit-decline-does-not-downgrade-existing-grant',
      async run({ http, firestore, expect, accounts }) {
        const uid = accounts['consent-preserve'].uid;

        // Re-seed: granted marketing + UNSET signupProcessed so the route processes this call.
        // Then send a payload that explicitly DECLINES marketing. The guard must still preserve
        // the existing grant — only an explicit RE-GRANT may overwrite; a decline-over-grant on
        // the signup path is treated as a non-grant and must not wipe a prior consent.
        // merge:true — preserve the runner-provisioned auth.uid (pollForUserDoc needs it).
        await firestore.set(`users/${uid}`, {
          consent: {
            marketing: {
              status: 'granted',
              grantedAt: { timestamp: '2025-01-01T00:00:00.000Z', timestampUNIX: 1735689600, source: 'signup', ip: null, text: 'Prior marketing grant' },
              revokedAt: { timestamp: null, timestampUNIX: null, source: null, ip: null, text: null },
            },
          },
          flags: { signupProcessed: false },
        }, { merge: true });

        const signupResponse = await http.as('consent-preserve').post('omega/user/signup', {
          consent: {
            legal: { granted: true, text: 'Legal grant on re-fire' },
            marketing: { granted: false, text: 'Declining marketing' },
          },
        });
        expect(signupResponse, `Signup should succeed: ${JSON.stringify(signupResponse, null, 2)}`).toBeSuccess();

        const userDoc = await firestore.get(`users/${uid}`);

        // Legal newly granted this call.
        expect(userDoc?.consent?.legal?.status, 'legal.status should be granted from this call').toBe('granted');
        // Marketing was already granted; an explicit decline must NOT downgrade it.
        expect(userDoc?.consent?.marketing?.status, 'marketing.status must stay granted (decline cannot downgrade an existing grant on signup path)').toBe('granted');
        expect(userDoc?.consent?.marketing?.grantedAt?.text, 'marketing grant must be the preserved original').toBe('Prior marketing grant');
      },
    },

    // --- buildUserRecord layered deep-merge tests ---
    // The signup write must: (a) fill every schema leaf so the doc is complete (no migration
    // churn), (b) PRESERVE existing real values (api keys, subscription, roles, affiliate.code,
    // custom non-schema fields), and (c) apply the signup data on top — without Firestore's
    // map-replace wiping nested data. These tests seed adversarial existing state and verify.
    {
      name: 'merge-preserves-existing-and-fills-schema',
      async run({ http, firestore, expect, accounts }) {
        const uid = accounts['signup-merge'].uid;

        // Capture the REAL api keys onCreate generated — the signup write must preserve these
        // exactly (regenerating them would break the user's API access AND this test's auth,
        // since http.as() authenticates with api.privateKey). We assert against the real values,
        // NOT a seeded fake (seeding a fake privateKey would 401 the request).
        const before = await firestore.get(`users/${uid}`);
        const realClientId = before?.api?.clientId;
        const realPrivateKey = before?.api?.privateKey;
        const realAffiliateCode = before?.affiliate?.code;

        // Seed adversarial NON-auth state the signup write must NOT clobber: a paid subscription,
        // admin role, a custom non-schema field, and a deliberately PARTIAL attribution (only
        // affiliate.code) to prove leaves get filled, not replaced-away. We do NOT touch api.* —
        // that's the auth credential and is asserted-preserved via the captured real values.
        await firestore.set(`users/${uid}`, {
          subscription: { product: { id: 'pro', name: 'Pro' }, status: 'active' },
          roles: { admin: true, betaTester: false, developer: false },
          attribution: { affiliate: { code: 'PARTIALONLY' } },
          myCustomIntegration: { slackWebhook: 'https://hooks.slack.com/services/XXX' },
        }, { merge: true });

        const signupResponse = await http.as('signup-merge').post('omega/user/signup', {
          consent: { legal: { granted: true, text: 'I agree.' }, marketing: { granted: true, text: 'Updates please.' } },
          attribution: {
            first: { tags: { utm_source: 'newsletter' }, referrer: 'https://news.ycombinator.com/', page: '/' },
            last: { tags: { utm_source: 'meta' }, clickIds: { fbclid: 'FB1' }, page: '/pricing' },
          },
          trackingConsent: { analytics: true, marketing: false, region: 'opt-in', timestamp: '2026-08-01T00:00:00.000Z', version: 1 },
        });
        expect(signupResponse, `Signup should succeed: ${JSON.stringify(signupResponse, null, 2)}`).toBeSuccess();

        const doc = await firestore.get(`users/${uid}`);

        // (b) Existing real values must survive untouched — NOT regenerated/reset by the schema layer.
        expect(doc?.api?.clientId, 'api.clientId must be preserved (not regenerated)').toBe(realClientId);
        expect(doc?.api?.privateKey, 'api.privateKey must be preserved (not regenerated)').toBe(realPrivateKey);
        expect(doc?.affiliate?.code, 'affiliate.code must be preserved (not regenerated)').toBe(realAffiliateCode);
        expect(doc?.subscription?.product?.id, 'subscription must be preserved (not reset to basic)').toBe('pro');
        expect(doc?.roles?.admin, 'roles.admin must be preserved (not reset to false)').toBe(true);

        // (b) Custom non-schema field must survive the merge.
        expect(doc?.myCustomIntegration?.slackWebhook, 'custom non-schema field must survive').toBe('https://hooks.slack.com/services/XXX');

        // (a) Every attribution leaf must be present (the bug: partial write flattened the map).
        expect(doc, 'attribution.affiliate.code must exist').toHaveProperty('attribution.affiliate.code');
        expect(doc, 'attribution.affiliate.url must exist (filled)').toHaveProperty('attribution.affiliate.url');
        expect(doc, 'attribution.affiliate.page must exist (filled)').toHaveProperty('attribution.affiliate.page');
        expect(doc, 'attribution.affiliate.timestamp must exist (filled)').toHaveProperty('attribution.affiliate.timestamp');
        expect(doc, 'attribution.first.url must exist (filled)').toHaveProperty('attribution.first.url');
        expect(doc, 'attribution.first.timestamp must exist (filled)').toHaveProperty('attribution.first.timestamp');
        expect(doc, 'attribution.first.clickIds must exist (filled)').toHaveProperty('attribution.first.clickIds');
        expect(doc, 'attribution.last.url must exist (filled)').toHaveProperty('attribution.last.url');
        expect(doc, 'attribution.last.referrer must exist (filled)').toHaveProperty('attribution.last.referrer');
        // filled leaves should be null, not undefined/missing
        expect(doc?.attribution?.affiliate?.url, 'unset attribution leaf should be null').toBe(null);

        // (c) Signup data applied on top.
        expect(doc?.attribution?.affiliate?.code, 'pre-existing affiliate.code preserved (signup did not send one)').toBe('PARTIALONLY');
        expect(doc?.attribution?.first?.tags?.utm_source, 'signup first-touch utm tag applied').toBe('newsletter');
        expect(doc?.attribution?.first?.referrer, 'signup first-touch referrer applied').toBe('https://news.ycombinator.com/');
        expect(doc?.attribution?.last?.tags?.utm_source, 'signup last-touch utm tag applied').toBe('meta');
        expect(doc?.attribution?.last?.clickIds?.fbclid, 'signup last-touch click id applied').toBe('FB1');
        expect(doc?.flags?.signupProcessed, 'flags.signupProcessed set true').toBe(true);
        expect(doc?.consent?.legal?.status, 'consent applied').toBe('granted');
        // The tracking-consent snapshot is stored VERBATIM beside attribution — its own
        // top-level field, never folded into the legal/marketing consent record.
        expect(doc?.trackingConsent, 'trackingConsent stored verbatim beside attribution').toEqual({ analytics: true, marketing: false, region: 'opt-in', timestamp: '2026-08-01T00:00:00.000Z', version: 1 });
      },
    },
    {
      name: 'merge-fills-all-leaves-on-schema-complete-doc',
      async run({ http, firestore, expect, accounts }) {
        // Sanity: after signup, the doc must contain the full set of top-level schema sections,
        // so a subsequent migration finds NOTHING to backfill. Reuses the signup-merge account
        // (already processed above → re-fire is rejected, but the doc from the prior test is the
        // artifact we assert against; this test just validates that doc's completeness).
        const uid = accounts['signup-merge'].uid;
        const doc = await firestore.get(`users/${uid}`);

        for (const section of ['auth', 'roles', 'flags', 'affiliate', 'metadata', 'activity', 'api', 'personal', 'attribution', 'trackingConsent', 'consent', 'subscription']) {
          expect(doc, `doc must have top-level '${section}' section after signup`).toHaveProperty(section);
        }
        // Nested completeness spot-checks across the sections signup writes.
        expect(doc, 'activity.geolocation.ip must exist').toHaveProperty('activity.geolocation.ip');
        expect(doc, 'activity.client.userAgent must exist').toHaveProperty('activity.client.userAgent');
        expect(doc, 'personal.name.first must exist').toHaveProperty('personal.name.first');
        expect(doc, 'consent.marketing.revokedAt.source must exist').toHaveProperty('consent.marketing.revokedAt.source');
        expect(doc, 'metadata.created.timestampUNIX must exist').toHaveProperty('metadata.created.timestampUNIX');
      },
    },

    // --- Auth rejection test (at end per convention) ---
    {
      name: 'unauthenticated-rejected',
      async run({ http, expect }) {
        // Try to call POST /user/signup without authentication
        const signupResponse = await http.as('none').post('omega/user/signup', {
          attribution: {
            affiliate: { code: REFERRER_AFFILIATE_CODE },
          },
        });

        expect(signupResponse, 'Signup should fail without authentication').toBeError(401);
      },
    },
  ],
});
