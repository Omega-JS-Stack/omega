const fs = require('fs');
const path = require('path');
const { resolvedBrandHost } = require('../../dist/vendor/config/index.js');
const { getAccountDefinitions } = require('../../dist/test/test-accounts.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

/**
 * Test: the persona email domain ([#708](https://github.com/Omega-JS-Stack/omega/issues/708))
 *
 * A persona's address has ONE derivation — the brand HOST — and every lane that
 * composes one reads it from @omega.js/config's `resolvedBrandHost`. It used to
 * have two: the seeder split `brand.contact.email`, the dev palette took
 * `brand.url`'s hostname. A brand whose support address sits on the apex while
 * the site lives on a subdomain therefore seeded accounts the palette could
 * never sign in as — silent at seed time, and it reads as a dead emulator.
 *
 * PURE: derivation and source, no emulator and no Firestore.
 *
 * Run: npx omega test helpers/persona-domain
 */

// The switchboard config that found the bug: a support address on the apex —
// a normal thing to publish — and a site on a subdomain of it.
const SPLIT_BRAND = {
  brand: {
    url: 'https://switchboard.streamforge.app',
    contact: { email: 'support@streamforge.app' },
  },
};

// Every lane that composes a persona address. Each reads the one derivation;
// none of them may go back to shaping the domain out of a contact address.
const SEEDING_LANES = [
  'dist/cli/commands/emulator.js',
  'dist/cli/commands/test.js',
  'dist/manager/routes/test/reset-account/post.js',
];

module.exports = defineCases({
  description: 'The persona email domain is the brand host, everywhere',
  type: 'group',
  auth: 'none',

  tests: [
    // The derivation itself: the host the site is served from, never the
    // domain the brand happens to answer support mail on.
    {
      name: 'persona-emails-follow-the-brand-host',
      async run({ assert }) {
        const domain = resolvedBrandHost(SPLIT_BRAND);

        assert.equal(domain, 'switchboard.streamforge.app', 'The persona domain is the brand host');
        assert.ok(domain !== 'streamforge.app', 'A support address on the apex must not shape persona identity');

        const definitions = getAccountDefinitions(domain, SPLIT_BRAND);

        assert.equal(
          definitions.admin.email,
          '_test.admin@switchboard.streamforge.app',
          'The seeder composes persona addresses on the brand host, which is what the palette signs in on',
        );
      },
    },

    // And the pin that keeps the second home from growing back: a lane that
    // splits `brand.contact.email` for a domain is the bug itself.
    {
      name: 'every-seeding-lane-reads-the-one-derivation',
      async run({ assert }) {
        for (const lane of SEEDING_LANES) {
          const source = fs.readFileSync(path.join(__dirname, '..', '..', lane), 'utf8');

          assert.ok(
            source.includes('resolvedBrandHost'),
            `${lane} must read the persona domain from @omega.js/config's resolvedBrandHost`,
          );
          // Multiline-tolerant on purpose: the pre-fix code read contact.email
          // on one line and split it on the next, which a one-line regex missed.
          assert.ok(
            !/contact(\?)?\.email[\s\S]{0,300}?split\('@'\)/.test(source),
            `${lane} must not derive a persona domain from brand.contact.email`,
          );
        }
      },
    },
  ],
});
