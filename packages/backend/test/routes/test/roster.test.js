const { TEST_ACCOUNTS } = require('../../../dist/test/test-accounts.js');
const { getRoster } = require('../../../dist/test/roster.js');
const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');

/**
 * Test: test/roster
 *
 * The dev-only persona roster ([#400](https://github.com/Omega-JS-Stack/omega/issues/400)):
 * the palette's account switcher used to hardcode its own copy of this list, so
 * the two drifted. The seed is the one owner now, and this route is how the
 * palette reads it: the `palette`-labeled personas, in the order the seeder
 * declares them. A suite asking for machinery on a testing backend gets the
 * unlabeled personas beside them; the palette never asks.
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
        const response = await http.as('none').get('omega/test/roster');

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

    // Test 2: What the palette is NOT offered: the machinery an automated suite
    // drives must never be handed to a human mid-suite
    {
      name: 'machinery-stays-off-the-palette-roster',
      auth: 'none',
      async run({ http, assert }) {
        const response = await http.as('none').get('omega/test/roster');
        const localparts = response.data.personas.map((persona) => persona.localpart);

        assert.ok(localparts.includes('_test.referrer'), 'A human-facing persona is offered');

        for (const localpart of ['_test.delete', '_test.signup-merge', '_test.allow_consent-granted', '_test.desktop-auth-e2e']) {
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

        const roster = getRoster(projectAccounts, { testing: true });
        const localparts = roster.map((persona) => persona.localpart);

        assert.deepEqual(
          roster[roster.length - 1],
          { localpart: '_test.shop-owner', label: 'Shop Owner' },
          'A project persona carrying a palette label is offered, after the framework\'s own — declaration order, framework first',
        );
        assert.ok(
          !localparts.includes('_test.bulk-importer'),
          'A project persona with no label is machinery like any other, and stays off the palette roster',
        );
        assert.ok(localparts.includes('_test.referrer'), 'The framework\'s own personas are still every one of them');

        assert.deepEqual(
          getRoster(undefined, { testing: true }),
          getRoster({}, { testing: true }),
          'A project that declares no personas of its own gets the framework roster, unchanged',
        );
      },
    },

    // Test 4: a suite asks the SAME route for its own persona. The sign-in lanes
    // (desktop, extension, the web form) each drive a machinery persona, which
    // the roster offers only when asked for machinery on a testing backend.
    {
      name: 'a-testing-backend-offers-the-machinery-when-asked',
      auth: 'none',
      async run({ http, assert }) {
        const response = await http.as('none').get('omega/test/roster', { machinery: true });

        assert.isSuccess(response, 'The machinery roster is readable without signing in');

        const personas = response.data.personas;
        const localparts = personas.map((persona) => persona.localpart);

        for (const localpart of ['_test.desktop-auth-e2e', '_test.extension-auth-e2e', '_test.auth-token-e2e', '_test.flows-signin']) {
          assert.ok(localparts.includes(localpart), `${localpart} is a sign-in lane's own persona, so a testing roster offers it`);
        }
        assert.deepEqual(
          personas.find((persona) => persona.localpart === '_test.desktop-auth-e2e'),
          { localpart: '_test.desktop-auth-e2e', label: null },
          'Machinery carries no palette label',
        );
        assert.ok(localparts.includes('_test.referrer'), 'The human-facing personas are still offered beside it');
      },
    },

    // Test 5: the switch is honoured on a TESTING backend alone. PURE: the
    // composition the route hands over for each environment, no emulator.
    {
      name: 'the-machinery-switch-is-testing-only',
      auth: 'none',
      async run({ assert }) {
        const projectAccounts = {
          'bulk-importer': { id: 'bulk-importer', uid: '_test-bulk-importer', email: '_test.bulk-importer@{domain}', properties: {} },
        };
        const palette = getRoster(projectAccounts, { testing: true });

        const testing = getRoster(projectAccounts, { machinery: true, testing: true });
        const localparts = testing.map((persona) => persona.localpart);

        // Every sign-in lane's own persona: offered here, and never to the palette
        for (const localpart of ['_test.desktop-auth-e2e', '_test.extension-auth-e2e', '_test.auth-token-e2e', '_test.flows-signin']) {
          assert.ok(localparts.includes(localpart), `A testing backend offers ${localpart}`);
          assert.ok(!palette.some((persona) => persona.localpart === localpart), `${localpart} is machinery, so the palette never offers it`);
        }
        assert.deepEqual(
          testing[testing.length - 1],
          { localpart: '_test.bulk-importer', label: null },
          'A project machinery persona joins last, unlabeled',
        );
        assert.deepEqual(
          testing.filter((persona) => persona.label),
          palette,
          'The labeled personas are the palette roster, in its order',
        );

        assert.deepEqual(
          getRoster(projectAccounts, { machinery: true, testing: false }),
          palette,
          'A backend not running as testing ignores the switch and offers the palette alone',
        );

        // The caller always says whether the backend is testing, never a silent default
        let thrown = null;
        try {
          getRoster(projectAccounts, { machinery: true });
        } catch (error) {
          thrown = error;
        }
        assert.match(String(thrown?.message), /options\.testing/, 'A roster asked without `testing` fails loudly');
      },
    },
  ],
});
