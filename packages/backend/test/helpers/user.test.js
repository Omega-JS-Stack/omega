/**
 * Test: the backend's User (services/user.js installs its generators)
 * Unit tests for User schema-driven normalization
 *
 * Tests the declarative schema resolver: defaults, passthrough, templates, type coercion
 */
const { User } = require('../../dist/omega/helpers/account.js');
const { bootOmega } = require('./_boot-omega.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

// A real boot installs the backend's generators on User, once
let booted = false;

function createUser(settings) {
  if (!booted) {
    bootOmega();
    booted = true;
  }

  return new User(settings).toJSON();
}

module.exports = defineCases({
  description: 'User() schema resolver',
  type: 'group',

  tests: [
    // ─── Empty / new user ───

    {
      name: 'empty-settings-gets-all-defaults',
      async run({ expect }) {
        const user = createUser({});

        // Auth
        expect(user.auth.uid, 'auth.uid should be null').toBe(null);
        expect(user.auth.email, 'auth.email should be null').toBe(null);
        expect(user.auth.temporary, 'auth.temporary should be false').toBe(false);

        // Subscription
        expect(user.subscription.product.id, 'subscription.product.id should be basic').toBe('basic');
        expect(user.subscription.product.name, 'subscription.product.name should be Basic').toBe('Basic');
        expect(user.subscription.status, 'subscription.status should be active').toBe('active');
        expect(user.subscription.trial.claimed, 'subscription.trial.claimed should be false').toBe(false);
        expect(user.subscription.cancellation.pending, 'subscription.cancellation.pending should be false').toBe(false);

        // Timestamps should exist
        expect(user.subscription.expires.timestamp, 'subscription.expires.timestamp should exist').toBeTruthy();
        expect(typeof user.subscription.expires.timestampUNIX, 'subscription.expires.timestampUNIX should be number').toBe('number');

        // Roles
        expect(user.roles.admin, 'roles.admin should be false').toBe(false);
        expect(user.roles.betaTester, 'roles.betaTester should be false').toBe(false);
        expect(user.roles.developer, 'roles.developer should be false').toBe(false);

        // Flags
        expect(user.flags.signupProcessed, 'flags.signupProcessed should be false').toBe(false);

        // Affiliate
        expect(typeof user.affiliate.code, 'affiliate.code should be string').toBe('string');
        expect(user.affiliate.code.length > 0, 'affiliate.code should not be empty').toBeTruthy();
        expect(Array.isArray(user.affiliate.referrals), 'affiliate.referrals should be array').toBeTruthy();

        // Metadata
        expect(user.metadata.updated.timestamp, 'metadata.updated.timestamp should exist').toBeTruthy();
        expect(user.metadata.created.timestamp, 'metadata.created.timestamp should exist').toBeTruthy();
        expect(user.activity.geolocation.latitude, 'geolocation.latitude should be 0').toBe(0);
        expect(user.activity.geolocation.longitude, 'geolocation.longitude should be 0').toBe(0);
        expect(user.activity.client.mobile, 'client.mobile should be false').toBe(false);

        // API keys
        expect(typeof user.api.clientId, 'api.clientId should be string').toBe('string');
        expect(user.api.clientId.length > 0, 'api.clientId should not be empty').toBeTruthy();
        expect(typeof user.api.privateKey, 'api.privateKey should be string').toBe('string');
        expect(user.api.privateKey.length > 0, 'api.privateKey should not be empty').toBeTruthy();

        // Usage — no counters until a feature is consumed, and the override
        // map the schema always declares (#647)
        expect(user.usage, 'usage should hold only the empty override map by default').toEqual({ overrides: {} });

        // Personal
        expect(user.personal.name.first, 'personal.name.first should be null').toBe(null);
        expect(user.personal.name.last, 'personal.name.last should be null').toBe(null);
        expect(user.personal.telephone.countryCode, 'telephone.countryCode should be 0').toBe(0);

        // Connections
        expect(user.connections, 'connections should be empty object').toEqual({});

        // Attribution
        expect(user.attribution.affiliate.code, 'attribution.affiliate.code should be null').toBe(null);
        expect(user.attribution.first.tags, 'attribution.first.tags should be empty object').toEqual({});
        expect(user.attribution.first.clickIds, 'attribution.first.clickIds should be empty object').toEqual({});
        expect(user.attribution.last.referrer, 'attribution.last.referrer should be null').toBe(null);
      },
    },

    {
      name: 'undefined-settings-gets-all-defaults',
      async run({ expect }) {
        const user = createUser(undefined);

        expect(user.auth.uid, 'auth.uid should be null').toBe(null);
        expect(user.subscription.product.id, 'subscription.product.id should be basic').toBe('basic');
        expect(user.roles.admin, 'roles.admin should be false').toBe(false);
      },
    },

    // ─── Preserving real user data ───

    {
      name: 'real-data-takes-precedence-over-defaults',
      async run({ expect }) {
        const user = createUser({
          auth: { uid: 'user123', email: 'test@test.com', temporary: true },
          subscription: { product: { id: 'pro', name: 'Pro' }, status: 'cancelled' },
          roles: { admin: true, betaTester: true, developer: false },
          personal: { name: { first: 'Ian', last: 'W' } },
        });

        expect(user.auth.uid, 'auth.uid should be preserved').toBe('user123');
        expect(user.auth.email, 'auth.email should be preserved').toBe('test@test.com');
        expect(user.auth.temporary, 'auth.temporary should be preserved').toBe(true);
        expect(user.subscription.product.id, 'subscription.product.id should be preserved').toBe('pro');
        expect(user.subscription.status, 'subscription.status should be preserved').toBe('cancelled');
        expect(user.roles.admin, 'roles.admin should be preserved').toBe(true);
        expect(user.personal.name.first, 'personal.name.first should be preserved').toBe('Ian');
      },
    },

    // ─── $passthrough: connections ───

    {
      name: 'connections-passthrough-preserves-provider-data',
      async run({ expect }) {
        const googleToken = {
          access_token: 'ya29.xxx',
          refresh_token: '1//xxx',
          expiry_date: 1700000000,
        };
        const msToken = {
          access_token: 'eyJ.xxx',
          refresh_token: 'M.xxx',
        };

        const user = createUser({
          connections: {
            google: {
              'google-sub-1': {
                token: googleToken,
                identity: { id: 'google-sub-1', email: 'g@gmail.com', name: 'Test' },
              },
            },
            microsoft: {
              'ms-1': {
                token: msToken,
                identity: { id: 'ms-1' },
              },
            },
          },
        });

        expect(user.connections.google['google-sub-1'].token.access_token, 'google access_token preserved').toBe('ya29.xxx');
        expect(user.connections.google['google-sub-1'].token.refresh_token, 'google refresh_token preserved').toBe('1//xxx');
        expect(user.connections.google['google-sub-1'].identity.email, 'google identity preserved').toBe('g@gmail.com');
        expect(user.connections.microsoft['ms-1'].token.access_token, 'microsoft token preserved').toBe('eyJ.xxx');
      },
    },

    {
      name: 'connections-empty-when-not-provided',
      async run({ expect }) {
        const user = createUser({});
        expect(user.connections, 'connections should be empty object when not provided').toEqual({});
      },
    },

    // ─── $passthrough: roles (with defined defaults) ───

    {
      name: 'roles-passthrough-preserves-custom-roles',
      async run({ expect }) {
        const user = createUser({
          roles: { admin: true, customRole: true, moderator: false },
        });

        expect(user.roles.admin, 'admin should be true').toBe(true);
        expect(user.roles.customRole, 'customRole should be preserved').toBe(true);
        expect(user.roles.moderator, 'moderator should be preserved').toBe(false);
        expect(user.roles.betaTester, 'betaTester should get default').toBe(false);
        expect(user.roles.developer, 'developer should get default').toBe(false);
      },
    },

    // ─── $passthrough: flags (with defined defaults) ───

    {
      name: 'flags-passthrough-preserves-custom-flags',
      async run({ expect }) {
        const user = createUser({
          flags: { signupProcessed: true, featureX: true, betaOptIn: false },
        });

        expect(user.flags.signupProcessed, 'signupProcessed preserved').toBe(true);
        expect(user.flags.featureX, 'featureX preserved').toBe(true);
        expect(user.flags.betaOptIn, 'betaOptIn preserved').toBe(false);
      },
    },

    // ─── $template: usage with dynamic keys ───

    {
      name: 'usage-template-preserves-dynamic-keys',
      async run({ expect }) {
        const user = createUser({
          usage: {
            requests: { monthly: 10, total: 100, last: { timestamp: '2025-01-01T00:00:00.000Z', timestampUNIX: 1735689600 } },
            emails: { monthly: 5, total: 50, last: { timestamp: '2025-01-02T00:00:00.000Z', timestampUNIX: 1735776000 } },
            sends: { monthly: 3, total: 30 },
          },
        });

        // Defined key (requests)
        expect(user.usage.requests.monthly, 'requests.monthly preserved').toBe(10);
        expect(user.usage.requests.total, 'requests.total preserved').toBe(100);
        expect(user.usage.requests.last.timestamp, 'requests.last.timestamp preserved').toBe('2025-01-01T00:00:00.000Z');

        // Dynamic key (emails) — full data
        expect(user.usage.emails.monthly, 'emails.monthly preserved').toBe(5);
        expect(user.usage.emails.total, 'emails.total preserved').toBe(50);
        expect(user.usage.emails.last.timestamp, 'emails.last.timestamp preserved').toBe('2025-01-02T00:00:00.000Z');

        // Dynamic key (sends) — partial data, template fills in missing
        expect(user.usage.sends.monthly, 'sends.monthly preserved').toBe(3);
        expect(user.usage.sends.total, 'sends.total preserved').toBe(30);
        expect(user.usage.sends.last.timestamp, 'sends.last.timestamp defaulted').toBeTruthy();
        expect(typeof user.usage.sends.last.timestampUNIX, 'sends.last.timestampUNIX defaulted to number').toBe('number');
      },
    },

    {
      name: 'usage-empty-when-no-keys-provided',
      async run({ expect }) {
        const user = createUser({});

        expect(user.usage, 'usage should hold only the override map when no counters are provided').toEqual({ overrides: {} });
      },
    },

    // ─── $passthrough: touch tags + clickIds ───

    {
      name: 'touch-passthrough-preserves-all-tags-and-click-ids',
      async run({ expect }) {
        const user = createUser({
          attribution: {
            first: {
              tags: { utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'summer' },
              clickIds: { gclid: 'G1', gbraid: 'GB1' },
              referrer: 'https://google.com/',
              timestamp: '2025-06-01T00:00:00.000Z',
            },
            last: {
              tags: { utm_source: 'meta' },
              clickIds: { fbclid: 'FB9' },
              timestamp: '2025-08-01T00:00:00.000Z',
            },
          },
        });

        expect(user.attribution.first.tags.utm_source, 'first-touch utm source preserved').toBe('google');
        expect(user.attribution.first.tags.utm_medium, 'first-touch utm medium preserved').toBe('cpc');
        expect(user.attribution.first.tags.utm_campaign, 'first-touch utm campaign preserved').toBe('summer');
        expect(user.attribution.first.clickIds.gclid, 'first-touch click id preserved').toBe('G1');
        expect(user.attribution.first.clickIds.gbraid, 'every click id in the family passes through').toBe('GB1');
        expect(user.attribution.first.referrer, 'first-touch referrer preserved').toBe('https://google.com/');
        expect(user.attribution.first.timestamp, 'first-touch timestamp preserved').toBe('2025-06-01T00:00:00.000Z');
        expect(user.attribution.last.tags.utm_source, 'last-touch utm source preserved').toBe('meta');
        expect(user.attribution.last.clickIds.fbclid, 'last-touch click id preserved').toBe('FB9');
        expect(user.attribution.last.timestamp, 'last-touch timestamp preserved').toBe('2025-08-01T00:00:00.000Z');
      },
    },

    // ─── Type coercion ───

    {
      name: 'coerces-number-from-string',
      async run({ expect }) {
        const user = createUser({
          activity: { geolocation: { latitude: '42.5', longitude: '-73.2' } },
          personal: { telephone: { countryCode: '44', national: '7911123456' } },
        });

        expect(user.activity.geolocation.latitude, 'string "42.5" coerced to number').toBe(42.5);
        expect(user.activity.geolocation.longitude, 'string "-73.2" coerced to number').toBe(-73.2);
        expect(user.personal.telephone.countryCode, 'string "44" coerced to number').toBe(44);
      },
    },

    {
      name: 'coerces-boolean-from-number',
      async run({ expect }) {
        const user = createUser({
          auth: { temporary: 1 },
          activity: { client: { mobile: 0 } },
        });

        expect(user.auth.temporary, '1 coerced to true').toBe(true);
        expect(user.activity.client.mobile, '0 coerced to false').toBe(false);
      },
    },

    {
      name: 'coerces-boolean-from-string',
      async run({ expect }) {
        const user = createUser({
          auth: { temporary: 'true' },
          roles: { admin: 'false' },
        });

        expect(user.auth.temporary, '"true" coerced to true').toBe(true);
        expect(user.roles.admin, '"false" coerced to false').toBe(false);
      },
    },

    {
      name: 'invalid-coercion-falls-back-to-default',
      async run({ expect }) {
        const user = createUser({
          activity: { geolocation: { latitude: 'not-a-number', longitude: undefined } },
          personal: { telephone: { national: 'abc' } },
        });

        expect(user.activity.geolocation.latitude, 'invalid string falls back to default 0').toBe(0);
        expect(user.activity.geolocation.longitude, 'undefined falls back to default 0').toBe(0);
        expect(user.personal.telephone.national, 'non-numeric string falls back to default 0').toBe(0);
      },
    },

    // ─── Nullable fields ───

    {
      name: 'nullable-fields-preserve-null',
      async run({ expect }) {
        const user = createUser({
          auth: { uid: null, email: null },
          personal: { name: { first: null, last: null }, gender: null },
          activity: { geolocation: { ip: null, country: null } },
        });

        expect(user.auth.uid, 'null uid preserved').toBe(null);
        expect(user.auth.email, 'null email preserved').toBe(null);
        expect(user.personal.name.first, 'null first name preserved').toBe(null);
        expect(user.personal.gender, 'null gender preserved').toBe(null);
        expect(user.activity.geolocation.ip, 'null ip preserved').toBe(null);
      },
    },

    {
      name: 'non-nullable-fields-replace-null-with-default',
      async run({ expect }) {
        const user = createUser({
          auth: { temporary: null },
          roles: { admin: null },
          activity: { geolocation: { latitude: null } },
        });

        // These are non-nullable, so null should be replaced with the schema default
        expect(user.auth.temporary, 'null temporary replaced with false').toBe(false);
        expect(user.roles.admin, 'null admin replaced with false').toBe(false);
        expect(user.activity.geolocation.latitude, 'null latitude replaced with 0').toBe(0);
      },
    },

    // ─── Fragmented / incomplete users ───

    {
      name: 'partial-subscription-fills-missing-fields',
      async run({ expect }) {
        const user = createUser({
          subscription: { product: { id: 'premium' } },
        });

        expect(user.subscription.product.id, 'provided id preserved').toBe('premium');
        expect(user.subscription.product.name, 'missing name gets default').toBe('Basic');
        expect(user.subscription.status, 'missing status gets default').toBe('active');
        expect(user.subscription.trial.claimed, 'missing trial.claimed gets default').toBe(false);
        expect(user.subscription.expires.timestamp, 'missing expires gets default timestamp').toBeTruthy();
      },
    },

    {
      name: 'partial-activity-fills-missing-fields',
      async run({ expect }) {
        const user = createUser({
          activity: { geolocation: { country: 'US' } },
        });

        expect(user.activity.geolocation.country, 'provided country preserved').toBe('US');
        expect(user.activity.geolocation.ip, 'missing ip defaults to null').toBe(null);
        expect(user.activity.geolocation.latitude, 'missing latitude defaults to 0').toBe(0);
        expect(user.metadata.updated.timestamp, 'missing updated gets default').toBeTruthy();
        expect(user.metadata.created.timestamp, 'missing created gets default').toBeTruthy();
      },
    },

    {
      name: 'deeply-nested-partial-payment-fills-correctly',
      async run({ expect }) {
        const user = createUser({
          subscription: {
            payment: { provider: 'stripe', resourceId: 'sub_123' },
          },
        });

        expect(user.subscription.payment.provider, 'provider preserved').toBe('stripe');
        expect(user.subscription.payment.orderId, 'missing orderId defaults to null').toBe(null);
        expect(user.subscription.payment.resourceId, 'resourceId preserved').toBe('sub_123');
        expect(user.subscription.payment.frequency, 'missing frequency defaults to null').toBe(null);
        expect(user.subscription.payment.startDate.timestamp, 'missing startDate gets default').toBeTruthy();
        expect(user.subscription.payment.updatedBy.event.name, 'missing event.name defaults to null').toBe(null);
      },
    },

    // ─── Top-level structure ───

    {
      name: 'all-top-level-keys-present',
      async run({ expect }) {
        const user = createUser({});
        const expectedKeys = [
          'auth', 'subscription', 'roles', 'flags', 'affiliate',
          'activity', 'api', 'owns', 'usage', 'personal', 'connections', 'attribution', 'trackingConsent', 'consent', 'metadata',
        ];

        for (const key of expectedKeys) {
          expect(key in user, `Top-level key "${key}" should exist`).toBeTruthy();
        }
      },
    },

    {
      name: 'no-extra-top-level-keys',
      async run({ expect }) {
        const user = createUser({});
        const expectedKeys = [
          'auth', 'subscription', 'roles', 'flags', 'affiliate',
          'activity', 'api', 'owns', 'usage', 'personal', 'connections', 'attribution', 'trackingConsent', 'consent', 'metadata',
        ];

        for (const key of Object.keys(user)) {
          expect(expectedKeys.includes(key), `Unexpected top-level key "${key}"`).toBeTruthy();
        }
      },
    },

    // ─── Consent (legal + marketing) ───

    {
      name: 'consent-defaults-revoked-with-null-leaves',
      async run({ expect }) {
        const user = createUser({});

        // Legal
        expect(user.consent.legal.status, 'consent.legal.status defaults to revoked').toBe('revoked');
        expect(user.consent.legal.grantedAt.timestamp, 'legal.grantedAt.timestamp defaults to null').toBe(null);
        expect(user.consent.legal.grantedAt.timestampUNIX, 'legal.grantedAt.timestampUNIX defaults to null').toBe(null);
        expect(user.consent.legal.grantedAt.source, 'legal.grantedAt.source defaults to null').toBe(null);
        expect(user.consent.legal.grantedAt.ip, 'legal.grantedAt.ip defaults to null').toBe(null);
        expect(user.consent.legal.grantedAt.text, 'legal.grantedAt.text defaults to null').toBe(null);

        // Marketing
        expect(user.consent.marketing.status, 'consent.marketing.status defaults to revoked').toBe('revoked');
        expect(user.consent.marketing.grantedAt.timestamp, 'marketing.grantedAt.timestamp defaults to null').toBe(null);
        expect(user.consent.marketing.grantedAt.timestampUNIX, 'marketing.grantedAt.timestampUNIX defaults to null').toBe(null);
        expect(user.consent.marketing.grantedAt.source, 'marketing.grantedAt.source defaults to null').toBe(null);
        expect(user.consent.marketing.grantedAt.ip, 'marketing.grantedAt.ip defaults to null').toBe(null);
        expect(user.consent.marketing.grantedAt.text, 'marketing.grantedAt.text defaults to null').toBe(null);
        expect(user.consent.marketing.revokedAt.timestamp, 'marketing.revokedAt.timestamp defaults to null').toBe(null);
        expect(user.consent.marketing.revokedAt.timestampUNIX, 'marketing.revokedAt.timestampUNIX defaults to null').toBe(null);
        expect(user.consent.marketing.revokedAt.source, 'marketing.revokedAt.source defaults to null').toBe(null);
        expect(user.consent.marketing.revokedAt.ip, 'marketing.revokedAt.ip defaults to null').toBe(null);
        expect(user.consent.marketing.revokedAt.text, 'marketing.revokedAt.text defaults to null').toBe(null);
      },
    },

    {
      name: 'consent-objects-always-present-even-on-empty-input',
      async run({ expect }) {
        const user = createUser({});

        expect(user.consent, 'consent object exists').toBeTruthy();
        expect(user.consent.legal, 'consent.legal exists').toBeTruthy();
        expect(user.consent.legal.grantedAt, 'consent.legal.grantedAt object exists (not null)').toBeTruthy();
        expect(user.consent.marketing, 'consent.marketing exists').toBeTruthy();
        expect(user.consent.marketing.grantedAt, 'consent.marketing.grantedAt object exists (not null)').toBeTruthy();
        expect(user.consent.marketing.revokedAt, 'consent.marketing.revokedAt object exists (not null)').toBeTruthy();
      },
    },

    {
      name: 'consent-granted-marketing-preserves-fields',
      async run({ expect }) {
        const user = createUser({
          consent: {
            legal: {
              status: 'granted',
              grantedAt: {
                timestamp: '2026-05-15T12:00:00.000Z',
                timestampUNIX: 1779235200,
                source: 'signup',
                ip: '1.2.3.4',
                text: 'I agree to the Terms of Service and Privacy Policy.',
              },
            },
            marketing: {
              status: 'granted',
              grantedAt: {
                timestamp: '2026-05-15T12:00:00.000Z',
                timestampUNIX: 1779235200,
                source: 'signup',
                ip: '1.2.3.4',
                text: 'Send me product updates and newsletters.',
              },
            },
          },
        });

        expect(user.consent.legal.status, 'legal.status preserved').toBe('granted');
        expect(user.consent.legal.grantedAt.timestamp, 'legal grantedAt.timestamp preserved').toBe('2026-05-15T12:00:00.000Z');
        expect(user.consent.legal.grantedAt.timestampUNIX, 'legal grantedAt.timestampUNIX preserved').toBe(1779235200);
        expect(user.consent.legal.grantedAt.source, 'legal grantedAt.source preserved').toBe('signup');
        expect(user.consent.legal.grantedAt.ip, 'legal grantedAt.ip preserved').toBe('1.2.3.4');
        expect(user.consent.legal.grantedAt.text, 'legal grantedAt.text preserved').toBe('I agree to the Terms of Service and Privacy Policy.');

        expect(user.consent.marketing.status, 'marketing.status preserved').toBe('granted');
        expect(user.consent.marketing.grantedAt.source, 'marketing grantedAt.source preserved').toBe('signup');
        expect(user.consent.marketing.grantedAt.text, 'marketing grantedAt.text preserved').toBe('Send me product updates and newsletters.');

        // revokedAt still defaults to all nulls (not touched by input)
        expect(user.consent.marketing.revokedAt.timestamp, 'marketing revokedAt.timestamp defaults to null').toBe(null);
        expect(user.consent.marketing.revokedAt.source, 'marketing revokedAt.source defaults to null').toBe(null);
      },
    },

    {
      name: 'consent-marketing-declined-at-signup',
      async run({ expect }) {
        const user = createUser({
          consent: {
            legal: {
              status: 'granted',
              grantedAt: {
                timestamp: '2026-05-15T12:00:00.000Z',
                timestampUNIX: 1779235200,
                source: 'signup',
                ip: '1.2.3.4',
                text: 'I agree to the Terms of Service and Privacy Policy.',
              },
            },
            marketing: {
              status: 'revoked',
              revokedAt: {
                timestamp: '2026-05-15T12:00:00.000Z',
                timestampUNIX: 1779235200,
                source: 'signup',
                ip: '1.2.3.4',
                text: null,
              },
            },
          },
        });

        expect(user.consent.legal.status, 'legal.status granted').toBe('granted');
        expect(user.consent.marketing.status, 'marketing.status revoked').toBe('revoked');
        expect(user.consent.marketing.grantedAt.timestamp, 'marketing grantedAt.timestamp is null (never granted)').toBe(null);
        expect(user.consent.marketing.grantedAt.source, 'marketing grantedAt.source is null').toBe(null);
        expect(user.consent.marketing.revokedAt.timestamp, 'marketing revokedAt.timestamp preserved').toBe('2026-05-15T12:00:00.000Z');
        expect(user.consent.marketing.revokedAt.source, 'marketing revokedAt.source preserved').toBe('signup');
        expect(user.consent.marketing.revokedAt.ip, 'marketing revokedAt.ip preserved').toBe('1.2.3.4');
        expect(user.consent.marketing.revokedAt.text, 'marketing revokedAt.text is null for decline').toBe(null);
      },
    },

    {
      name: 'consent-revoked-then-regranted-keeps-prior-revokedAt',
      async run({ expect }) {
        const user = createUser({
          consent: {
            marketing: {
              status: 'granted',
              grantedAt: {
                timestamp: '2026-07-01T00:00:00.000Z',
                timestampUNIX: 1783785600,
                source: 'account-page',
                ip: '5.6.7.8',
                text: 'Send me product updates and newsletters.',
              },
              revokedAt: {
                timestamp: '2026-06-12T00:00:00.000Z',
                timestampUNIX: 1781251200,
                source: 'sendgrid-webhook',
                ip: null,
                text: null,
              },
            },
          },
        });

        expect(user.consent.marketing.status, 'status is granted (latest action)').toBe('granted');
        expect(user.consent.marketing.grantedAt.timestamp, 'grantedAt reflects most recent grant').toBe('2026-07-01T00:00:00.000Z');
        expect(user.consent.marketing.grantedAt.source, 'grantedAt.source is account-page').toBe('account-page');
        // revokedAt still reflects the prior revoke — informational
        expect(user.consent.marketing.revokedAt.timestamp, 'revokedAt preserves prior revoke').toBe('2026-06-12T00:00:00.000Z');
        expect(user.consent.marketing.revokedAt.source, 'revokedAt.source preserves prior source').toBe('sendgrid-webhook');
      },
    },

    {
      name: 'consent-partial-input-fills-missing-leaves-with-null',
      async run({ expect }) {
        const user = createUser({
          consent: {
            marketing: {
              status: 'granted',
              grantedAt: {
                timestamp: '2026-05-15T12:00:00.000Z',
                source: 'signup',
              },
            },
          },
        });

        expect(user.consent.marketing.status, 'marketing.status preserved').toBe('granted');
        expect(user.consent.marketing.grantedAt.timestamp, 'grantedAt.timestamp preserved').toBe('2026-05-15T12:00:00.000Z');
        expect(user.consent.marketing.grantedAt.source, 'grantedAt.source preserved').toBe('signup');
        // Missing leaves default to null
        expect(user.consent.marketing.grantedAt.timestampUNIX, 'missing grantedAt.timestampUNIX defaults to null').toBe(null);
        expect(user.consent.marketing.grantedAt.ip, 'missing grantedAt.ip defaults to null').toBe(null);
        expect(user.consent.marketing.grantedAt.text, 'missing grantedAt.text defaults to null').toBe(null);
        // Legal not provided — gets full defaults
        expect(user.consent.legal.status, 'untouched legal defaults to revoked').toBe('revoked');
        expect(user.consent.legal.grantedAt.timestamp, 'untouched legal grantedAt.timestamp is null').toBe(null);
      },
    },

    {
      name: 'consent-round-trip-preserves-shape',
      async run({ expect }) {
        const grantedDoc = {
          consent: {
            legal: {
              status: 'granted',
              grantedAt: {
                timestamp: '2026-05-15T12:00:00.000Z',
                timestampUNIX: 1779235200,
                source: 'signup',
                ip: '1.2.3.4',
                text: 'I agree to the Terms of Service.',
              },
            },
            marketing: {
              status: 'granted',
              grantedAt: {
                timestamp: '2026-05-15T12:00:00.000Z',
                timestampUNIX: 1779235200,
                source: 'signup',
                ip: '1.2.3.4',
                text: 'Send me updates.',
              },
              revokedAt: {
                timestamp: null,
                timestampUNIX: null,
                source: null,
                ip: null,
                text: null,
              },
            },
          },
        };

        // First pass — resolve from raw input
        const user1 = createUser(grantedDoc);

        // Second pass — resolve from the resolved doc (simulates Firestore read-back)
        const user2 = createUser(user1);

        expect(user1.consent, 'consent round-trips identically').toEqual(user2.consent);
      },
    },

    // ─── Unique/generated values ───

    {
      name: 'api-keys-are-unique-per-call',
      async run({ expect }) {
        const u1 = createUser({});
        const u2 = createUser({});

        // privateKey uses UIDGenerator which should produce unique values
        expect(u1.api.privateKey, 'privateKey should be unique per call').not.toBe(u2.api.privateKey);
        expect(u1.api.clientId, 'clientId should be unique per call').not.toBe(u2.api.clientId);
      },
    },

    {
      name: 'existing-api-keys-not-overwritten',
      async run({ expect }) {
        const user = createUser({
          api: { clientId: 'my-client-id', privateKey: 'my-secret-key' },
        });

        expect(user.api.clientId, 'existing clientId preserved').toBe('my-client-id');
        expect(user.api.privateKey, 'existing privateKey preserved').toBe('my-secret-key');
      },
    },

    // ─── Complex real-world user ───

    {
      name: 'full-real-world-user-preserves-everything',
      async run({ expect }) {
        const user = createUser({
          auth: { uid: 'V4U9wR0AiLUQRxpcP7WhgA4FX9H2', email: 'ian@example.com', temporary: false },
          subscription: {
            product: { id: 'premium', name: 'Premium' },
            status: 'active',
            expires: { timestamp: '2026-12-31T00:00:00.000Z', timestampUNIX: 1798761600 },
            trial: { claimed: true, expires: { timestamp: '2024-01-01T00:00:00.000Z', timestampUNIX: 1704067200 } },
            payment: { provider: 'stripe', resourceId: 'sub_abc', frequency: 'annually' },
          },
          roles: { admin: true, betaTester: true, developer: true, superAdmin: true },
          flags: { signupProcessed: true, onboarded: true },
          affiliate: { code: 'IAN7', referrals: ['ref1', 'ref2'] },
          api: { clientId: 'uuid-123', privateKey: 'key-456' },
          connections: {
            google: {
              'google-sub-ian': {
                token: { access_token: 'ya29.real', refresh_token: '1//real', expiry_date: 1700000000 },
                identity: { id: 'google-sub-ian', email: 'ian@gmail.com', name: 'Ian W', picture: 'https://photo.url' },
              },
            },
          },
          usage: {
            requests: { monthly: 100, total: 5000, last: { id: 'req-z', timestamp: '2025-12-01T00:00:00.000Z', timestampUNIX: 1764633600 } },
            emails: { monthly: 42, total: 2100, last: { id: 'em-z', timestamp: '2025-12-01T00:00:00.000Z', timestampUNIX: 1764633600 } },
          },
          personal: {
            name: { first: 'Ian', last: 'Wiedenman' },
            company: { name: 'ITW Creative Works', position: 'CEO' },
            birthday: { timestamp: '1990-05-15T00:00:00.000Z', timestampUNIX: 642988800 },
          },
          attribution: {
            affiliate: { code: 'PARTNER1', timestamp: '2024-06-01T00:00:00.000Z' },
            last: { tags: { utm_source: 'twitter', utm_campaign: 'launch' }, url: 'https://example.com' },
          },
        });

        // Everything should be preserved exactly
        expect(user.auth.uid, 'uid preserved').toBe('V4U9wR0AiLUQRxpcP7WhgA4FX9H2');
        expect(user.subscription.product.id, 'product preserved').toBe('premium');
        expect(user.roles.superAdmin, 'custom role preserved').toBe(true);
        expect(user.flags.onboarded, 'custom flag preserved').toBe(true);
        expect(user.affiliate.code, 'affiliate code preserved').toBe('IAN7');
        expect(user.affiliate.referrals, 'referrals preserved').toEqual(['ref1', 'ref2']);
        expect(user.api.clientId, 'api clientId preserved').toBe('uuid-123');
        expect(user.connections.google['google-sub-ian'].token.access_token, 'connections token preserved').toBe('ya29.real');
        expect(user.connections.google['google-sub-ian'].identity.email, 'connections identity preserved').toBe('ian@gmail.com');
        expect(user.usage.emails.monthly, 'usage emails preserved').toBe(42);
        expect(user.personal.name.first, 'name preserved').toBe('Ian');
        expect(user.personal.company.name, 'company preserved').toBe('ITW Creative Works');
        expect(user.personal.birthday.timestampUNIX, 'birthday preserved').toBe(642988800);
        expect(user.attribution.last.tags.utm_source, 'utm tags preserved').toBe('twitter');
      },
    },
  ],
});
