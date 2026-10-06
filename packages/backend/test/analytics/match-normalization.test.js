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
const matchData = require('../../dist/omega/libraries/analytics/match-data.js');
const conversions = require('../../dist/omega/libraries/analytics/conversions.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');
const { User } = require('../../dist/omega/helpers/account.js');

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
      location: { country: 'US', region: 'California', city: 'San Diego', postalCode: '94035-1234' },
      telephone: { countryCode: 1, national: 5550102030 },
    },
  };
}

module.exports = defineCases({
  description: 'Match parameters: one normalization table per provider',
  type: 'group',

  tests: [
    {
      name: 'meta-normalizes-every-customer-information-parameter-its-own-way',
      auth: 'none',

      async run({ expect }) {
        const identity = matchData.buildIdentity({ uid: '_test-match-uid', user: fullUserDoc() });
        const meta = identity.meta;

        expect(meta.fn, 'fn: lowercase with no punctuation').toBe(sha256('adamarie'));
        expect(meta.ln, 'ln: the apostrophe is punctuation too').toBe(sha256('obyrne'));
        expect(meta.ct, 'ct: no spaces either (Meta\'s own example is newyork)').toBe(sha256('sandiego'));
        expect(meta.st, 'st: the 2-character ANSI code, lowercase').toBe(sha256('ca'));
        expect(meta.zp, 'zp: the first five digits of a US zip').toBe(sha256('94035'));
        expect(meta.country, 'country: ISO 3166-1 alpha-2, lowercase').toBe(sha256('us'));
        expect(meta.db, 'db: YYYYMMDD').toBe(sha256('19850216'));
        expect(meta.ge, 'ge: the lowercase initial').toBe(sha256('f'));

        // The hashes are of the NORMALIZED value, which is the entire point: a
        // digest of the stored string is accepted by Meta and matches nobody.
        expect(meta.ct === sha256('San Diego'), 'the raw city must never be what was hashed').toBe(false);
        expect(JSON.stringify(identity).includes('San Diego'), 'and no raw personal value rides the identity block').toBe(false);
        expect(JSON.stringify(identity).includes('Ada')).toBe(false);
      },
    },

    {
      name: 'meta-sends-nothing-it-cannot-normalize-to-the-spec',
      auth: 'none',

      async run({ expect }) {
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

        expect(Object.hasOwn(identity.meta, 'ge'), 'a gender outside Meta\'s two initials sends no key').toBe(false);
        expect(Object.hasOwn(identity.meta, 'db'), 'and no birthday means no key').toBe(false);
        expect(Object.hasOwn(identity.meta, 'country'), 'a country NAME is not the alpha-2 code Meta matches on').toBe(false);
        expect(identity.meta.st, 'a non-US state is lowercase with no spaces, per the same rule').toBe(sha256('bavaria'));
        expect(identity.meta.ct, 'a UTF-8 city keeps its own characters').toBe(sha256('münchen'));

        // Nothing at all is still nothing at all — the whole block goes.
        const empty = matchData.buildIdentity({ uid: '_test-match-uid' });

        expect(Object.hasOwn(empty, 'meta'), 'an account with no personal data carries no Meta block').toBe(false);
        expect(empty, 'external_id alone, exactly as before').toEqual({ externalId: '_test-match-uid', tiktokExternalIdHash: matchData.hashExternalId('_test-match-uid') });
      },
    },

    {
      name: 'the-schema-default-birthday-is-not-a-birthday',
      auth: 'none',

      async run({ expect, omega }) {
        // `personal.birthday` is a `$timestamp` branch, and its default is the
        // EPOCH — the same shape of trap `personal.telephone`'s `0` default is
        // (#388): hashing it would hand every account with no birthday on file
        // the digest of `19700101`, one junk match key shared by all of them.
        // The user comes from the production resolver, so the default is the
        // real one and not a hand-written stand-in.
        const user = new User({ auth: { uid: '_test-match-uid', email: 'buyer@example.com' } }).toJSON();

        expect(user.personal.birthday.timestampUNIX, 'precondition: the schema default is the epoch').toBe(0);

        const identity = matchData.buildIdentity({ uid: '_test-match-uid', user: user });

        expect(Object.hasOwn(identity, 'meta'), 'nothing on this account normalizes to a match key').toBe(false);
        expect(JSON.stringify(identity).includes(sha256('19700101')), 'the epoch must not be hashed under any key').toBe(false);

        // A real birthday still goes.
        const born = matchData.buildIdentity({
          uid: '_test-match-uid',
          user: { personal: { birthday: { timestamp: '1985-02-16T00:00:00.000Z', timestampUNIX: 477273600 } } },
        });

        expect(born.meta.db, 'a real date is still sent').toBe(sha256('19850216'));
      },
    },

    {
      // The account schema HOLDS an address now — `personal.location.postalCode`
      // and `.street` ([#663](https://github.com/Omega-JS-Stack/omega/issues/663))
      // — so the reader's `zip` key finally finds a value on a real doc. The bag
      // key stays `zip` because that is the parameter name Meta's own table
      // normalizes; the schema's name is the international one.
      name: 'the-postal-code-and-street-come-off-the-account-schema',
      auth: 'none',

      async run({ expect, omega }) {
        const user = new User({
          auth: { uid: '_test-match-uid', email: 'buyer@example.com' },
          personal: { location: { postalCode: '90210', street: '123 Main Street' } },
        }).toJSON();

        expect(user.personal.location.postalCode, 'precondition: the resolver keeps the schema field').toBe('90210');

        const fields = matchData.readUserMatchFields(user);

        expect(fields.zip, 'postalCode rides the platform\'s own zip key').toBe('90210');
        expect(fields.street, 'street reads as it always did').toBe('123 Main Street');

        const identity = matchData.buildIdentity({ uid: '_test-match-uid', user: user });

        expect(identity.meta.zp, 'and reaches Meta\'s zp, normalized by Meta\'s rule').toBe(sha256('90210'));

        // `personal.location.zip` was never a schema field — a doc carrying one
        // is read as the nothing it is, rather than as a second home for the value.
        const legacy = matchData.readUserMatchFields({ personal: { location: { zip: '90210' } } });

        expect(legacy.zip, 'personal.location.zip is not read any more').toBe(undefined);
      },
    },

    {
      name: 'ga4-normalizes-its-address-block-per-its-own-spec',
      auth: 'none',

      async run({ expect }) {
        // GA4's rules are NOT Meta's: names drop digits and symbols but keep
        // their spaces, city/region/postal code ride in the CLEAR, and the
        // country code is uppercase (its own reference sample sends 'US').
        expect(matchData.hashGA4Name('  Ada-Marie 2 '), 'names: digits and symbols removed, lowercased, trimmed').toBe(sha256('adamarie'));
        expect(matchData.hashGA4Street(' 123 Main Street. '), 'street keeps its digits, loses its symbols').toBe(sha256('123 main street'));
        expect(matchData.ga4Place('  San Diego '), 'city and region keep their spaces and are never hashed').toBe('san diego');
        expect(matchData.ga4Place('California'), 'GA4 wants the region NAME where Meta wants the ANSI code').toBe('california');
        expect(matchData.ga4PostalCode(' 94035-1234 '), 'only . and ~ come out of a postal code').toBe('94035-1234');
        expect(matchData.ga4Country('us'), 'the country code is uppercase alpha-2').toBe('US');
        expect(matchData.ga4Country('United States'), 'a country name is not a code, so nothing is sent').toBe('');
      },
    },

    {
      name: 'tiktok-carries-no-parameter-its-events-api-does-not-accept',
      auth: 'none',

      async run({ expect, ctx, omega }) {
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
          omega: omega,
        });

        const user = conversions.buildTikTokBody({
          descriptor: results.find((result) => result.provider === 'tiktok').descriptor,
          identity: identity,
          eventId: 'sign_up._test-match',
          pixelCode: '_TEST_PIXEL',
        }).data[0].user;

        expect(Object.keys(user).sort(), 'only the keys TikTok reads').toEqual(['email', 'external_id', 'phone']);

        for (const key of ['first_name', 'last_name', 'city', 'state', 'zip_code', 'country', 'fn', 'ln', 'ct', 'st', 'zp', 'db', 'ge']) {
          expect(Object.hasOwn(user, key), `${key} is not a TikTok parameter`).toBe(false);
        }
      },
    },
  ],
});
