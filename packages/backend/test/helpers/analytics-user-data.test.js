/**
 * Test: the GA4 Measurement Protocol helper's `user_data` match block
 * ([#388](https://github.com/Omega-JS-Stack/omega/issues/388), the email
 * normalization pin of [#397](https://github.com/Omega-JS-Stack/omega/issues/397),
 * and the name normalization pin of
 * [#403](https://github.com/Omega-JS-Stack/omega/issues/403)).
 *
 * `sha256_phone_number` had never been sent by any event flowing through the
 * helper: it read `personal.telephone.number`, and the account schema's field is
 * `personal.telephone.national`. A key that is silently always absent looks
 * exactly like a user with no phone, so nothing ever complained.
 *
 * The authenticated user is a REAL resolved account doc (`Manager.User()` is the
 * production resolver) rather than a hand-written stand-in — which is what makes
 * the phoneless case honest: it carries the schema's own `0` default, the value
 * whose hash would hand every phoneless account one shared junk match key.
 *
 * `self.userData` IS the payload's `user_data` — `event()` passes it straight
 * into the Measurement Protocol body — so the assertions read it directly rather
 * than firing an event at Google.
 *
 * Run: npx omega test framework:helpers/analytics-user-data
 */

const crypto = require('crypto');
const Analytics = require('../../dist/manager/helpers/analytics.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

const UID = '_test-ga4-user-data-uid';
const EMAIL = 'buyer@example.com';
const NATIONAL = 5550102030;

// The same address as it might sit in an account doc, and the digest of its
// canonical form (`ada.lovelace@example.com`). The expected value is hard-coded
// rather than hashed here, so the pin fails if the helper's normalization ever
// drifts from the one every platform agrees on (#397).
const MESSY_EMAIL = '  Ada.Lovelace@Example.COM ';
const MESSY_EMAIL_DIGEST = 'e814ff3dc480a94c7ce9334062ec4733c75a002f4bcec0197f62ffea64059e2f';

// The same deal for the names GA4's user-data spec normalizes the same way, with
// the digests of `ada` and `lovelace` hard-coded (#403).
const MESSY_FIRST = '  Ada ';
const MESSY_FIRST_DIGEST = 'fdee430d40bd57deeac186cd9790033d0f06f909a8806e7ce6e717ab7c7d5029';
const MESSY_LAST = ' LOVELACE ';
const MESSY_LAST_DIGEST = 'fb1e7ec987523d2cb9e022cec1d6ae7c99dc46edfae4fe51254025fe4bea571f';

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

// The helper reads its user off `ctx.usage.user` — the resolved account doc the
// middleware attaches on an authenticated request.
function userDataFor(Manager, settings) {
  const ctx = Manager.RouteContext({}, { functionName: 'analytics-user-data' });

  ctx.usage = { user: Manager.User(settings).properties };

  return { userData: new Analytics(Manager, { ctx: ctx }).userData, user: ctx.usage.user };
}

module.exports = defineCases({
  description: 'analytics(): the GA4 user_data match block',
  type: 'group',

  tests: [
    {
      name: 'an-account-with-a-phone-sends-the-hashed-number',
      auth: 'none',

      run: async ({ assert, Manager }) => {
        const { userData } = userDataFor(Manager, {
          auth: { uid: UID, email: EMAIL },
          personal: { telephone: { countryCode: 1, national: NATIONAL } },
        });

        // GA4's spec hashes the E.164 form, plus included — the same digest
        // TikTok's Events API takes (#392).
        assert.equal(userData.sha256_phone_number, sha256(`+1${NATIONAL}`), 'the phone rides as SHA256 of the E.164 number');
        assert.equal(userData.sha256_email_address, sha256(EMAIL), 'the email key is untouched by the phone fix');
        assert.equal(JSON.stringify(userData).includes(`${NATIONAL}`), false, 'the raw number must never appear anywhere in the payload');
      },
    },

    {
      name: 'the-schema-default-sends-no-phone-hash',
      auth: 'none',

      run: async ({ assert, Manager }) => {
        const { userData, user } = userDataFor(Manager, { auth: { uid: UID, email: EMAIL } });

        // The premise: an account with no phone carries 0, not an absent branch.
        assert.equal(user.personal.telephone.national, 0, 'the schema default is 0');

        assert.equal(userData.sha256_phone_number, undefined, 'no phone on file means no match key, never a hash of 0');
        assert.equal(Object.values(userData).includes(sha256('0')), false, 'the default must not be hashed under any key');
      },
    },

    {
      name: 'a-messy-email-hashes-its-canonical-form',
      auth: 'none',

      run: async ({ assert, Manager }) => {
        const { userData } = userDataFor(Manager, { auth: { uid: UID, email: MESSY_EMAIL } });

        // Casing and padding are the account doc's business, never the match
        // key's: GA4 matches the digest of the trimmed, lowercased address, and
        // a raw hash silently misses every user whose email was stored with a
        // capital in it (#397).
        assert.equal(userData.sha256_email_address, MESSY_EMAIL_DIGEST, 'the email rides as SHA256 of the normalized address');
      },
    },

    {
      name: 'messy-names-hash-their-canonical-form',
      auth: 'none',

      run: async ({ assert, Manager }) => {
        const { userData } = userDataFor(Manager, {
          auth: { uid: UID, email: EMAIL },
          personal: { name: { first: MESSY_FIRST, last: MESSY_LAST } },
        });

        // GA4's user-data spec normalizes a name exactly like an email — trimmed
        // and lowercased — so hashing what the account happened to store missed
        // every user whose name carried a capital or a stray space (#403).
        assert.equal(userData.address.sha256_first_name, MESSY_FIRST_DIGEST, 'the given name rides as SHA256 of its normalized form');
        assert.equal(userData.address.sha256_last_name, MESSY_LAST_DIGEST, 'the family name rides as SHA256 of its normalized form');
      },
    },

    {
      name: 'an-account-with-no-name-sends-no-name-hash',
      auth: 'none',

      run: async ({ assert, Manager }) => {
        const { userData, user } = userDataFor(Manager, { auth: { uid: UID, email: EMAIL } });

        // The schema's default is null, and a normalizer must never turn an
        // absent name into the digest of '' — one junk key shared by everybody.
        assert.equal(user.personal.name.first, null, 'the schema default is null');

        assert.equal(userData.address.sha256_first_name, undefined, 'no name on file means no match key');
        assert.equal(userData.address.sha256_last_name, undefined, 'no name on file means no match key');
      },
    },

    {
      // GA4's user-data spec takes a whole ADDRESS block, and only the names and
      // the street are hashed: city, region, postal code and country ride in the
      // clear, normalized ([#577](https://github.com/Omega-JS-Stack/omega/issues/577)).
      // The ACCOUNT's own location wins over the request's geolocation — the
      // person's address is what the platform matches, not the exit node they
      // happened to browse from.
      name: 'the-address-block-comes-off-the-account-per-ga4-spec',
      auth: 'none',

      run: async ({ assert, Manager }) => {
        const { userData } = userDataFor(Manager, {
          auth: { uid: UID, email: EMAIL },
          personal: { location: { country: 'us', region: 'California', city: 'San Diego' } },
        });

        assert.equal(userData.address.city, 'san diego', 'city: lowercased and trimmed, never hashed');
        assert.equal(userData.address.region, 'california', 'region: the NAME, GA4\'s own sample shape');
        assert.equal(userData.address.country, 'US', 'country: uppercase ISO 3166-1 alpha-2');
        assert.equal(userData.address.postal_code, undefined, 'nothing on file means no key at all');
        assert.equal(userData.address.sha256_street, undefined);
      },
    },

    {
      // The postal code and the street have a home in the schema now
      // ([#663](https://github.com/Omega-JS-Stack/omega/issues/663)):
      // `personal.location.postalCode` and `personal.location.street`, filled by
      // the account page. Before that they were read off field names no account
      // carried, so GA4 got neither key from any user.
      name: 'the-postal-code-and-street-come-off-the-account-schema',
      auth: 'none',

      run: async ({ assert, Manager }) => {
        const { userData, user } = userDataFor(Manager, {
          auth: { uid: UID, email: EMAIL },
          personal: { location: { postalCode: '94035-1234', street: ' 123 Main Street. ' } },
        });

        assert.equal(user.personal.location.postalCode, '94035-1234', 'precondition: the resolver keeps the schema field');

        assert.equal(userData.address.postal_code, '94035-1234', 'the postal code rides in the clear, only . and ~ removed');
        assert.equal(userData.address.sha256_street, sha256('123 main street'), 'the street is hashed, its digits kept');
      },
    },
  ],
});
