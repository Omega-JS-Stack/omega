/**
 * Test: routes/user/signup/post.locationFromGeolocation
 * Unit tests for the `personal.location` fill signup derives from the request's
 * geolocation ([#638](https://github.com/Omega-JS-Stack/omega/issues/638)).
 *
 * Run (from the framework repo): npm test routes/user/signup-location
 *
 * Contract:
 *   - The request's country/region/city fill the matching `personal.location`
 *     fields, which nothing else ever wrote — so the ad-platform match keys
 *     (`libraries/analytics/match-data.js`) stopped shipping empty ct/st/country.
 *   - A value the user set (in the incoming settings or in the existing doc)
 *     ALWAYS wins: an IP guess never overwrites a self-reported location.
 *   - Nothing to fill returns an EMPTY object, so the write carries no
 *     `personal.location` key at all rather than a map of nulls.
 */
const post = require('../../../src/manager/routes/user/signup/post.js');

const { locationFromGeolocation } = post;

// The shape RouteContext resolves from the request headers (cf-ipcountry /
// x-country-code / x-appengine-*) — the extra fields are ignored by the fill.
const GEOLOCATION = {
  ip: '203.0.113.7',
  continent: 'NA',
  country: 'US',
  region: 'CA',
  city: 'San Francisco',
  latitude: 37.7749,
  longitude: -122.4194,
};

module.exports = {
  description: 'routes/user/signup/post.locationFromGeolocation',
  type: 'group',

  tests: [
    {
      name: 'fills-an-empty-location-from-the-request-geolocation',
      async run({ assert }) {
        // A doc resolved from the account schema carries the location leaves as nulls
        assert.deepEqual(
          locationFromGeolocation(GEOLOCATION, { country: null, region: null, city: null }),
          { country: 'US', region: 'CA', city: 'San Francisco' },
          'country/region/city come from the request geolocation',
        );
      },
    },

    {
      name: 'never-overwrites-a-location-the-user-set',
      async run({ assert }) {
        assert.deepEqual(
          locationFromGeolocation(GEOLOCATION, { country: 'FR', region: 'IDF', city: 'Paris' }),
          {},
          'a self-reported location is left entirely alone',
        );
      },
    },

    {
      name: 'fills-only-the-fields-the-user-left-empty',
      async run({ assert }) {
        assert.deepEqual(
          locationFromGeolocation(GEOLOCATION, { country: null, region: null, city: 'Oakland' }),
          { country: 'US', region: 'CA' },
          'the fill is per-field — the city the user set survives',
        );
      },
    },

    {
      name: 'writes-nothing-when-the-request-carries-no-geolocation',
      async run({ assert }) {
        assert.deepEqual(
          locationFromGeolocation({ ip: '203.0.113.7', country: null, region: null, city: null }, {}),
          {},
          'no geolocation means no personal.location key in the write',
        );
      },
    },
  ],
};
