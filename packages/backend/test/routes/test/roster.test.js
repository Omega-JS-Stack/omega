const { TEST_ACCOUNTS, getPaletteRoster } = require('../../../dist/test/test-accounts.js');
const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');

/**
 * Test: test/roster
 *
 * The dev-only persona roster ([#400](https://github.com/Omega-JS-Stack/omega/issues/400)):
 * the palette's account switcher used to hardcode its own copy of this list, so
 * the two drifted. The seed is the one owner now, and this route is how the
 * palette reads it: the `palette`-labeled personas, in the order the seeder
 * declares them, and nothing else.
 */
module.exports = defineCases({
  description: 'The palette-facing personas the seeder defines (development/testing only)',
  type: 'group',

  tests: [
    // Test 1: The roster is the seed's own list, in the seed's own order, and
    // it needs no sign-in, because the palette asks before anybody is signed in
    {
      name: 'returns-the-labelled-personas-in-declaration-order',
      auth: 'none',
      async run({ http, assert }) {
        const response = await http.as('none').get('backend-manager/test/roster');

        assert.isSuccess(response, 'The roster is readable without signing in');

        // The framework's labeled personas must appear in declaration order,
        // as a SUBSEQUENCE: a consumer's test/_init.js may append its own
        // personas after them, or override a built-in's label in place (#712),
        // so neither a whole-array deepEqual nor a fixed count holds.
        const frameworkLocalparts = Object.values(TEST_ACCOUNTS)
          .filter((account) => account.palette)
          .map((account) => account.email.split('@')[0]);
        const served = response.data.personas.map((persona) => persona.localpart);

        let cursor = 0;
        for (const localpart of frameworkLocalparts) {
          const at = served.indexOf(localpart, cursor);
          assert.ok(at >= 0, `${localpart} must be offered, after the framework personas before it`);
          cursor = at + 1;
        }
        assert.ok(served.length >= frameworkLocalparts.length, 'Every framework palette persona is offered');
      },
    },

    // Test 2: What it does NOT offer: the machinery an automated suite drives
    // must never be handed to somebody mid-suite
    {
      name: 'machinery-personas-stay-invisible',
      auth: 'none',
      async run({ http, assert }) {
        const response = await http.as('none').get('backend-manager/test/roster');
        const localparts = response.data.personas.map((persona) => persona.localpart);

        assert.ok(localparts.includes('_test.referrer'), 'A human-facing persona is offered');

        for (const localpart of ['_test.delete', '_test.signup-merge', '_test.allow_consent-granted']) {
          assert.ok(!localparts.includes(localpart), `${localpart} is machinery, so the roster must not offer it`);
        }
      },
    },

    // Test 3: the OTHER half of the seed ([#712](https://github.com/Omega-JS-Stack/omega/issues/712)).
    // A project declares its own personas in `test/_init.js` — the documented
    // extension point every other seed surface merges in — and the roster used
    // to read the framework table alone, so a consumer persona seeded with a
    // label was seeded straight into invisibility. PURE: the composition the
    // route hands over, against a project table, no emulator.
    {
      name: 'project-personas-reach-the-roster',
      auth: 'none',
      async run({ assert }) {
        const projectAccounts = {
          'shop-owner': { id: 'shop-owner', uid: '_test-shop-owner', email: '_test.shop-owner@{domain}', palette: 'Shop Owner', properties: {} },
          'bulk-importer': { id: 'bulk-importer', uid: '_test-bulk-importer', email: '_test.bulk-importer@{domain}', properties: {} },
        };

        const roster = getPaletteRoster(projectAccounts);
        const localparts = roster.map((persona) => persona.localpart);

        assert.deepEqual(
          roster[roster.length - 1],
          { localpart: '_test.shop-owner', label: 'Shop Owner' },
          'A project persona carrying a palette label is offered, after the framework\'s own — declaration order, framework first',
        );
        assert.ok(
          !localparts.includes('_test.bulk-importer'),
          'A project persona with no label is machinery like any other, and stays invisible',
        );
        assert.ok(localparts.includes('_test.referrer'), 'The framework\'s own personas are still every one of them');

        assert.deepEqual(
          getPaletteRoster(),
          getPaletteRoster({}),
          'A project that declares no personas of its own gets the framework roster, unchanged',
        );
      },
    },
  ],
});
