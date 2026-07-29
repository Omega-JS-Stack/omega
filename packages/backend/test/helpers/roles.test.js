/**
 * Test: helpers/roles.js — the role table
 *
 * Run: npx omega test backend:helpers/roles
 *
 * Roles.list() is the SSOT mapping a raw role string a brand hands the
 * framework ('admin', 'mod', 'beta') onto a canonical role id. The table is
 * a WIRE contract: an id that changes silently re-permissions every user
 * carrying it, so both the id set and each entry's alias set are pinned.
 *
 * The entries' regexes carry the `g` flag, which makes `.test()` STATEFUL
 * (lastIndex advances) — the hazard is pinned below so a caller that loops
 * over the table cannot be surprised by it.
 */
const Roles = require('../../src/manager/helpers/roles.js');

const roles = new Roles({ libraries: {} });

// Match a raw input against the table the way a caller would — with a fresh,
// stateless copy of each entry's regex.
const idsMatching = (input) => roles.list()
  .filter((role) => new RegExp(role.regex.source, 'i').test(input))
  .map((role) => role.id);

module.exports = {
  description: 'Roles.list() role table',
  type: 'group',

  tests: [
    // ─── The table ───

    {
      name: 'the-role-id-set-is-exactly-these-ten',
      async run({ assert }) {
        assert.deepEqual(roles.list().map((role) => role.id), [
          'staff',
          'admin',
          'moderator',
          'moderatorJr',
          'blogger',
          'developer',
          'betaTester',
          'serverBooster',
          'og',
          'vip',
        ]);
      },
    },

    {
      name: 'every-entry-carries-an-id-name-and-regex',
      async run({ assert }) {
        for (const role of roles.list()) {
          assert.equal(typeof role.id, 'string');
          assert.equal(typeof role.name, 'string');
          assert.equal(role.regex instanceof RegExp, true);
        }
      },
    },

    {
      name: 'display-names-are-pinned',
      async run({ assert }) {
        const names = Object.fromEntries(roles.list().map((role) => [role.id, role.name]));

        assert.equal(names.admin, 'Administrator');
        assert.equal(names.moderatorJr, 'Jr. Moderator');
        assert.equal(names.betaTester, 'Beta Tester');
        assert.equal(names.serverBooster, 'Server Booster');
        assert.equal(names.og, 'OG');
        assert.equal(names.vip, 'VIP');
      },
    },

    // ─── Alias resolution ───

    {
      name: 'canonical-spellings-match-their-own-role',
      async run({ assert }) {
        assert.deepEqual(idsMatching('staff'), ['staff']);
        assert.deepEqual(idsMatching('administrator'), ['admin']);
        assert.deepEqual(idsMatching('moderator'), ['moderator']);
        assert.deepEqual(idsMatching('blogger'), ['blogger']);
        assert.deepEqual(idsMatching('developer'), ['developer']);
        assert.deepEqual(idsMatching('betatester'), ['betaTester']);
        assert.deepEqual(idsMatching('serverbooster'), ['serverBooster']);
        assert.deepEqual(idsMatching('og'), ['og']);
      },
    },

    {
      name: 'short-aliases-resolve-to-the-same-role',
      async run({ assert }) {
        assert.deepEqual(idsMatching('admin'), ['admin']);
        assert.deepEqual(idsMatching('mod'), ['moderator']);
        assert.deepEqual(idsMatching('modjr'), ['moderatorJr']);
        assert.deepEqual(idsMatching('moderatorjr'), ['moderatorJr']);
        assert.deepEqual(idsMatching('blog'), ['blogger']);
        assert.deepEqual(idsMatching('dev'), ['developer']);
        assert.deepEqual(idsMatching('beta'), ['betaTester']);
        assert.deepEqual(idsMatching('booster'), ['serverBooster']);
      },
    },

    {
      name: 'matching-is-case-insensitive',
      async run({ assert }) {
        assert.deepEqual(idsMatching('ADMIN'), ['admin']);
        assert.deepEqual(idsMatching('Moderator'), ['moderator']);
        assert.deepEqual(idsMatching('VIP'), ['vip']);
      },
    },

    {
      name: 'unknown-and-near-miss-inputs-match-nothing',
      async run({ assert }) {
        assert.deepEqual(idsMatching('superuser'), []);
        assert.deepEqual(idsMatching(''), []);
        // Anchored on both ends — a longer word is not the role.
        assert.deepEqual(idsMatching('administrators'), []);
        assert.deepEqual(idsMatching('super-admin'), []);
        assert.deepEqual(idsMatching('moderatorjrx'), []);
      },
    },

    {
      name: 'vip-is-deliberately-prefix-anchored-only',
      async run({ assert }) {
        // /(^vip)/ — unlike every other entry, vip has no trailing anchor.
        assert.deepEqual(idsMatching('vip'), ['vip']);
        assert.deepEqual(idsMatching('vip-plus'), ['vip']);
        assert.deepEqual(idsMatching('super-vip'), []);
      },
    },

    // ─── The `g`-flag hazard ───

    {
      name: 'the-table-regexes-are-stateful-so-callers-must-not-reuse-them',
      async run({ assert }) {
        const admin = roles.list().find((role) => role.id === 'admin');

        // The SAME regex object alternates because `g` advances lastIndex.
        assert.equal(admin.regex.test('admin'), true);
        assert.equal(admin.regex.test('admin'), false, 'second call is a false negative');
        assert.equal(admin.regex.lastIndex, 0, 'and the index resets after the miss');

        // list() hands out a FRESH table each call, so a caller that re-reads
        // the table (rather than caching an entry) never sees the drift.
        assert.equal(roles.list().find((role) => role.id === 'admin').regex.lastIndex, 0);
      },
    },
  ],
};
