/**
 * Test: the SERVER half of `sign_up`, fired from the post-auth request
 * ([#577](https://github.com/Omega-JS-Stack/omega/issues/577)).
 *
 * It used to fire from the auth trigger, which has no HTTP request behind it:
 * no IP, no user agent, no `_fbc`/`_fbp`/`_ttp`, and an attribution the browser
 * had not posted yet. Meta scored the resulting CompleteRegistration around
 * 4/10 on match quality for exactly that reason.
 *
 * So the fire moved to the one request the browser ALREADY makes after auth
 * (`POST /user/signup`), which carries all four. The trigger fires nothing —
 * that is what keeps a registration from being counted twice — and this module
 * is the ONE home of the server half: its dedupe id, its provider selection and
 * its method vocabulary are the contract with the browser half.
 *
 *   THE DEDUPE ID IS `sign_up.<uid>`.
 *
 * Pure: `buildSignupFire()` is what `trackSignup()` hands to `deliverConversion`,
 * so the payload can be read without a route, a request or a platform.
 *
 * Run: npx omega test framework:analytics/signup-conversion
 */
const crypto = require('crypto');
const signup = require('../../src/manager/libraries/analytics/signup.js');

const UID = '_test-signup-conversion-uid';
const IP = '203.0.113.9';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)';

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

// The Auth record the route reads back, and the doc it just wrote — carrying the
// attribution the browser posted, cookies included (the checkout intent's shape).
function authUser(providerId = 'password') {
  return {
    uid: UID,
    email: 'Ada.Lovelace@Example.COM',
    providerData: [{ providerId: providerId }],
  };
}

function userRecord() {
  return {
    auth: { uid: UID, email: 'Ada.Lovelace@Example.COM' },
    personal: {
      name: { first: 'Ada', last: 'Lovelace' },
      location: { country: 'US', region: 'California', city: 'San Diego' },
    },
    attribution: {
      last: {
        tags: { utm_source: 'meta', utm_medium: 'cpc' },
        clickIds: { fbclid: 'FB-CLICK' },
        url: 'https://brand.test/signup',
        timestamp: '2026-08-01T00:00:00.000Z',
      },
      cookies: { fbc: 'fb.1.1754006400000.REAL-COOKIE', fbp: 'fb.1.1754006400000.987654321', ttp: 'TTP-COOKIE' },
    },
    trackingConsent: { analytics: true, marketing: true, region: 'opt-in', version: 1 },
  };
}

module.exports = {
  description: 'sign_up: the server half fires from the post-auth request, with the request\'s match data',
  type: 'group',

  tests: [
    {
      name: 'the-server-half-carries-the-requests-ip-user-agent-and-cookies',
      auth: 'none',

      async run({ assert }) {
        const fire = signup.buildSignupFire({
          authUser: authUser(),
          userRecord: userRecord(),
          request: { ip: IP, userAgent: USER_AGENT },
        });

        assert.equal(fire.event, 'sign_up');
        assert.equal(fire.eventId, `sign_up.${UID}`, 'the dedupe id is the one the browser half sends');
        assert.deepEqual(fire.providers, ['meta', 'tiktok'], 'GA4 has no cross-source dedupe — the browser half owns it');

        // The four things the auth trigger could never see.
        assert.equal(fire.identity.ip, IP, 'the request\'s IP');
        assert.equal(fire.identity.userAgent, USER_AGENT, 'and its user agent');
        assert.equal(fire.attribution.fbp, 'fb.1.1754006400000.987654321', 'the platform cookies the browser posted');
        assert.equal(fire.attribution.fbc, 'fb.1.1754006400000.REAL-COOKIE');
        assert.equal(fire.attribution.ttp, 'TTP-COOKIE');
        assert.equal(fire.attribution.source, 'meta', 'and the campaign that brought them here');

        // Plus the account itself, through the shared reader.
        assert.equal(fire.identity.emailHash, sha256('ada.lovelace@example.com'));
        assert.equal(fire.identity.meta.ct, sha256('sandiego'), 'the personal set rides too');
        assert.equal(fire.trackingConsent.marketing, true, 'the consent snapshot the record stored gates the fire');
      },
    },

    {
      name: 'the-method-speaks-the-same-vocabulary-as-the-browser-half',
      auth: 'none',

      async run({ assert }) {
        // The client fires trackSignup('email') / trackSignup('google'); the
        // server twin must not say 'password' / 'google.com' for the same act.
        assert.equal(signup.resolveSignupMethod({ providerData: [{ providerId: 'password' }] }), 'email');
        assert.equal(signup.resolveSignupMethod({ providerData: [{ providerId: 'google.com' }] }), 'google');
        assert.equal(signup.resolveSignupMethod({ providerData: [{ providerId: 'apple.com' }] }), 'apple');
        assert.equal(signup.resolveSignupMethod({}), 'email', 'an unknown provider reads as the default email signup');

        const fire = signup.buildSignupFire({ authUser: authUser('google.com'), userRecord: userRecord(), request: {} });

        assert.equal(fire.params.method, 'google', 'and the params carry it');
        assert.equal(fire.params.user_id, UID);
      },
    },

    {
      name: 'a-signup-with-nothing-behind-it-still-fires-on-external-id',
      auth: 'none',

      async run({ assert }) {
        // A blocked pixel, a cleared jar, a request with no geolocation header:
        // absent match data never blocks the registration itself.
        const fire = signup.buildSignupFire({ authUser: { uid: UID }, userRecord: {}, request: {} });

        assert.deepEqual(Object.keys(fire.attribution), [], 'no attribution to send');
        assert.equal(Object.hasOwn(fire.identity, 'ip'), false, 'an absent key is absent, never empty');
        assert.equal(fire.identity.externalId, UID, 'external_id alone still identifies the registration');
        assert.equal(fire.trackingConsent, null, 'and an unrecorded snapshot is not a denial');
      },
    },
  ],
};
