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
const signup = require('../../dist/omega/libraries/analytics/signup.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

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

module.exports = defineCases({
  description: 'sign_up: the server half fires from the post-auth request, with the request\'s match data',
  type: 'group',

  tests: [
    {
      name: 'the-server-half-carries-the-requests-ip-user-agent-and-cookies',
      auth: 'none',

      async run({ expect }) {
        const fire = signup.buildSignupFire({
          authUser: authUser(),
          userRecord: userRecord(),
          request: { ip: IP, userAgent: USER_AGENT },
        });

        expect(fire.event).toBe('sign_up');
        expect(fire.eventId, 'the dedupe id is the one the browser half sends').toBe(`sign_up.${UID}`);
        expect(fire.providers, 'GA4 has no cross-source dedupe — the browser half owns it').toEqual(['meta', 'tiktok']);

        // The four things the auth trigger could never see.
        expect(fire.identity.ip, 'the request\'s IP').toBe(IP);
        expect(fire.identity.userAgent, 'and its user agent').toBe(USER_AGENT);
        expect(fire.attribution.fbp, 'the platform cookies the browser posted').toBe('fb.1.1754006400000.987654321');
        expect(fire.attribution.fbc).toBe('fb.1.1754006400000.REAL-COOKIE');
        expect(fire.attribution.ttp).toBe('TTP-COOKIE');
        expect(fire.attribution.source, 'and the campaign that brought them here').toBe('meta');

        // Plus the account itself, through the shared reader.
        expect(fire.identity.emailHash).toBe(sha256('ada.lovelace@example.com'));
        expect(fire.identity.meta.ct, 'the personal set rides too').toBe(sha256('sandiego'));
        expect(fire.trackingConsent.marketing, 'the consent snapshot the record stored gates the fire').toBe(true);
      },
    },

    {
      name: 'the-method-speaks-the-same-vocabulary-as-the-browser-half',
      auth: 'none',

      async run({ expect }) {
        // The client fires trackSignup('email') / trackSignup('google'); the
        // server twin must not say 'password' / 'google.com' for the same act.
        expect(signup.resolveSignupMethod({ providerData: [{ providerId: 'password' }] })).toBe('email');
        expect(signup.resolveSignupMethod({ providerData: [{ providerId: 'google.com' }] })).toBe('google');
        expect(signup.resolveSignupMethod({ providerData: [{ providerId: 'apple.com' }] })).toBe('apple');
        expect(signup.resolveSignupMethod({}), 'an unknown provider reads as the default email signup').toBe('email');

        const fire = signup.buildSignupFire({ authUser: authUser('google.com'), userRecord: userRecord(), request: {} });

        expect(fire.params.method, 'and the params carry it').toBe('google');
        expect(fire.params.user_id).toBe(UID);
      },
    },

    {
      name: 'a-signup-with-nothing-behind-it-still-fires-on-external-id',
      auth: 'none',

      async run({ expect }) {
        // A blocked pixel, a cleared jar, a request with no geolocation header:
        // absent match data never blocks the registration itself.
        const fire = signup.buildSignupFire({ authUser: { uid: UID }, userRecord: {}, request: {} });

        expect(Object.keys(fire.attribution), 'no attribution to send').toEqual([]);
        expect(Object.hasOwn(fire.identity, 'ip'), 'an absent key is absent, never empty').toBe(false);
        expect(fire.identity.externalId, 'external_id alone still identifies the registration').toBe(UID);
        expect(fire.trackingConsent, 'and an unrecorded snapshot is not a denial').toBe(null);
      },
    },
  ],
});
