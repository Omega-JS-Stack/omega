const { TEST_ACCOUNTS } = require('../../../src/test/test-accounts.js');

/**
 * Test: test/roster
 *
 * The dev-only persona roster ([#400](https://github.com/Omega-JS-Stack/omega/issues/400)):
 * the palette's account switcher used to hardcode its own copy of this list, so
 * the two drifted. The seed is the one owner now, and this route is how the
 * palette reads it: the `palette`-labeled personas, in the order the seeder
 * declares them, and nothing else.
 */
module.exports = {
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

        const expected = Object.values(TEST_ACCOUNTS)
          .filter((account) => account.palette)
          .map((account) => ({ localpart: account.email.split('@')[0], label: account.palette }));

        assert.deepEqual(response.data.personas, expected, 'The route hands over exactly the seed\'s palette-labeled personas, in its own order');
        assert.equal(response.data.personas.length, 14, 'The seeder labels fourteen human-facing personas');
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
  ],
};
