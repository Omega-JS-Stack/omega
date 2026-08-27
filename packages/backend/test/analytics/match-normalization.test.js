/**
 * Test: the per-provider match-parameter tables
 * ([#577](https://github.com/Omega-JS-Stack/omega/issues/577)).
 *
 * Meta scored the playground's StartTrial 6.2/10 on event match quality and its
 * CompleteRegistration around 4/10, because every server event carried `em` +
 * `external_id` and nothing else — while the account doc already held the name,
 * birthday, gender, location and phone the platforms accept. The plumbing now
 * exists for EVERY parameter each platform documents (Ian's ruling, 2026-08-24),
 * and a value a brand does not hold compacts away exactly as before.
 *
 * NORMALIZATION IS THE WHOLE JOB. An unnormalized hash is accepted by every one
 * of these APIs and matches NOBODY — the #397/#403 failure mode, one field at a
 * time. So each provider gets its OWN table, and this file walks it value by
 * value against the rule the platform's live spec states:
 *
 *   META  (developers.facebook.com/docs/marketing-api/conversions-api/parameters/
 *          customer-information-parameters, fetched 2026-08-24) — every one of
 *          fn ln ct st zp country db ge is "hashing required", each with its own
 *          normalization: names lowercase with no punctuation, city with no
 *          spaces either, `st` the 2-character ANSI code in lowercase, `zp` the
 *          first five digits of a US zip, `country` ISO 3166-1 alpha-2 lowercase,
 *          `db` YYYYMMDD, `ge` the lowercase initial.
 *   GA4   (developers.google.com/analytics/devguides/collection/ga4/uid-data) —
 *          names and street HASHED with digits and symbols removed; city, region,
 *          postal code and country sent in the CLEAR, and country UPPERCASE.
 *   TIKTOK (business-api.tiktok.com/portal/docs?id=1771101303285761) — its
 *          Events API `user` object accepts email, phone, external_id, ttclid,
 *          ttp, ip and user_agent, and NO name or address parameter at all. The
 *          absence is asserted, because inventing keys a platform does not read
 *          is the same silent nothing as an unnormalized hash.
 *
 * Run: npx omega test framework:analytics/match-normalization
 */
const crypto = require('crypto');
const matchData = require('../../src/manager/libraries/analytics/match-data.js');
const conversions = require('../../src/manager/libraries/analytics/conversions.js');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

// A user doc as the account schema stores one, with the values in the messy
// shapes real accounts carry: mixed case, punctuation, a spaced city, a state
// written out in full, a US zip with its +4, a birthday stamp.
function fullUserDoc() {
  return {
    auth: { uid: '_test-match-uid', email: '  Ada.Lovelace@Example.COM ' },
    personal: {
      name: { first: "  Ada-Marie ", last: "O'Byrne " },
      birthday: { timestamp: '1985-02-16T00:00:00.000Z', timestampUNIX: 477273600 },
      gender: 'female',
      location: { country: 'US', region: 'California', city: 'San Diego', zip: '94035-1234' },
      telephone: { countryCode: 1, national: 5550102030 },
    },
  };
}

module.exports = {
  description: 'Match parameters: one normalization table per provider',
  type: 'group',

  tests: [
    {
      name: 'meta-normalizes-every-customer-information-parameter-its-own-way',
      auth: 'none',

      async run({ assert }) {
        const identity = matchData.buildIdentity({ uid: '_test-match-uid', user: fullUserDoc() });
        const meta = identity.meta;

        assert.equal(meta.fn, sha256('adamarie'), 'fn: lowercase with no punctuation');
        assert.equal(meta.ln, sha256('obyrne'), 'ln: the apostrophe is punctuation too');
        assert.equal(meta.ct, sha256('sandiego'), 'ct: no spaces either (Meta\'s own example is newyork)');
        assert.equal(meta.st, sha256('ca'), 'st: the 2-character ANSI code, lowercase');
        assert.equal(meta.zp, sha256('94035'), 'zp: the first five digits of a US zip');
        assert.equal(meta.country, sha256('us'), 'country: ISO 3166-1 alpha-2, lowercase');
        assert.equal(meta.db, sha256('19850216'), 'db: YYYYMMDD');
        assert.equal(meta.ge, sha256('f'), 'ge: the lowercase initial');

        // The hashes are of the NORMALIZED value, which is the entire point: a
        // digest of the stored string is accepted by Meta and matches nobody.
        assert.equal(meta.ct === sha256('San Diego'), false, 'the raw city must never be what was hashed');
        assert.equal(JSON.stringify(identity).includes('San Diego'), false, 'and no raw personal value rides the identity block');
        assert.equal(JSON.stringify(identity).includes('Ada'), false);
      },
    },

    {
      name: 'meta-sends-nothing-it-cannot-normalize-to-the-spec',
      auth: 'none',

      async run({ assert }) {
        // A value the platform's own rule cannot express is worth LESS than no
        // key: it matches nobody and reads as a field we tried and failed to
        // send. Meta accepts f and m alone, and a 2-letter country code alone.
        const identity = matchData.buildIdentity({
          uid: '_test-match-uid',
          user: {
            personal: {
              gender: 'non-binary',
              location: { country: 'United States', region: 'Bavaria', city: 'München' },
            },
          },
        });

        assert.equal(Object.hasOwn(identity.meta, 'ge'), false, 'a gender outside Meta\'s two initials sends no key');
        assert.equal(Object.hasOwn(identity.meta, 'db'), false, 'and no birthday means no key');
        assert.equal(Object.hasOwn(identity.meta, 'country'), false, 'a country NAME is not the alpha-2 code Meta matches on');
        assert.equal(identity.meta.st, sha256('bavaria'), 'a non-US state is lowercase with no spaces, per the same rule');
        assert.equal(identity.meta.ct, sha256('münchen'), 'a UTF-8 city keeps its own characters');

        // Nothing at all is still nothing at all — the whole block goes.
        const empty = matchData.buildIdentity({ uid: '_test-match-uid' });

        assert.equal(Object.hasOwn(empty, 'meta'), false, 'an account with no personal data carries no Meta block');
        assert.deepEqual(empty, { externalId: '_test-match-uid', tiktokExternalIdHash: matchData.hashExternalId('_test-match-uid') }, 'external_id alone, exactly as before');
      },
    },

    {
      name: 'the-schema-default-birthday-is-not-a-birthday',
      auth: 'none',

      async run({ assert, Manager }) {
        // `personal.birthday` is a `$timestamp` branch, and its default is the
        // EPOCH — the same shape of trap `personal.telephone`'s `0` default is
        // (#388): hashing it would hand every account with no birthday on file
        // the digest of `19700101`, one junk match key shared by all of them.
        // The user comes from the production resolver, so the default is the
        // real one and not a hand-written stand-in.
        const user = Manager.User({ auth: { uid: '_test-match-uid', email: 'buyer@example.com' } }).properties;

        assert.equal(user.personal.birthday.timestampUNIX, 0, 'precondition: the schema default is the epoch');

        const identity = matchData.buildIdentity({ uid: '_test-match-uid', user: user });

        assert.equal(Object.hasOwn(identity, 'meta'), false, 'nothing on this account normalizes to a match key');
        assert.equal(JSON.stringify(identity).includes(sha256('19700101')), false, 'the epoch must not be hashed under any key');

        // A real birthday still goes.
        const born = matchData.buildIdentity({
          uid: '_test-match-uid',
          user: { personal: { birthday: { timestamp: '1985-02-16T00:00:00.000Z', timestampUNIX: 477273600 } } },
        });

        assert.equal(born.meta.db, sha256('19850216'), 'a real date is still sent');
      },
    },

    {
      name: 'ga4-normalizes-its-address-block-per-its-own-spec',
      auth: 'none',

      async run({ assert }) {
        // GA4's rules are NOT Meta's: names drop digits and symbols but keep
        // their spaces, city/region/postal code ride in the CLEAR, and the
        // country code is uppercase (its own reference sample sends 'US').
        assert.equal(matchData.hashGA4Name('  Ada-Marie 2 '), sha256('adamarie'), 'names: digits and symbols removed, lowercased, trimmed');
        assert.equal(matchData.hashGA4Street(' 123 Main Street. '), sha256('123 main street'), 'street keeps its digits, loses its symbols');
        assert.equal(matchData.ga4Place('  San Diego '), 'san diego', 'city and region keep their spaces and are never hashed');
        assert.equal(matchData.ga4Place('California'), 'california', 'GA4 wants the region NAME where Meta wants the ANSI code');
        assert.equal(matchData.ga4PostalCode(' 94035-1234 '), '94035-1234', 'only . and ~ come out of a postal code');
        assert.equal(matchData.ga4Country('us'), 'US', 'the country code is uppercase alpha-2');
        assert.equal(matchData.ga4Country('United States'), '', 'a country name is not a code, so nothing is sent');
      },
    },

    {
      name: 'tiktok-carries-no-parameter-its-events-api-does-not-accept',
      auth: 'none',

      async run({ assert, ctx, Manager }) {
        // TikTok's Events API 2.0 `user` object documents email, phone,
        // external_id, ttclid, ttp, ip and user_agent — and nothing else. A
        // name or address key there is not rejected: it is read by nobody.
        const identity = matchData.buildIdentity({ uid: '_test-match-uid', user: fullUserDoc() });
        const results = conversions.deliverConversion({
          event: 'sign_up',
          params: { method: 'email', user_id: '_test-match-uid' },
          identity: identity,
          providers: ['tiktok'],
          eventId: 'sign_up._test-match',
          ctx: ctx,
          Manager: Manager,
        });

        const user = conversions.buildTikTokBody({
          descriptor: results.find((result) => result.provider === 'tiktok').descriptor,
          identity: identity,
          eventId: 'sign_up._test-match',
          pixelCode: '_TEST_PIXEL',
        }).data[0].user;

        assert.deepEqual(Object.keys(user).sort(), ['email', 'external_id', 'phone'], 'only the keys TikTok reads');

        for (const key of ['first_name', 'last_name', 'city', 'state', 'zip_code', 'country', 'fn', 'ln', 'ct', 'st', 'zp', 'db', 'ge']) {
          assert.equal(Object.hasOwn(user, key), false, `${key} is not a TikTok parameter`);
        }
      },
    },
  ],
};
