/**
 * The users migration against @omega.js/account's schema: its backfill record,
 * validation, sentinel list and null-reset defaults are derived from that one
 * shape, so a field the schema declares is converged like every other.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const { resolveAccount } = require('@omega.js/account');

const { DEFAULT_USER, RESET_DEFAULTS } = require('../src/services/migrations/lib/user-schema.js');
const {
  USER_RECORD, brandConfig, fakeAuth, collectionOf, runService, convergedUser,
} = require('./lib/migrations-fixtures.js');

/** Every dotted path to a value that is not a plain object: the record's SHAPE. */
function leafPaths(record, prefix = '') {
  return Object.entries(record).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return value && typeof value === 'object' && !Array.isArray(value) ? leafPaths(value, path) : [path];
  });
}

module.exports = defineCases({
  type: 'group',
  description: 'migrations-account-schema',
  tests: [
    {
      name: 'users: the backfill record has exactly the account schema\'s shape',
      run: (ctx) => {
        ctx.expect(leafPaths(DEFAULT_USER).sort()).toEqual(leafPaths(resolveAccount({})).sort());
      },
    },

    {
      name: 'users: every account-schema field is validated and sentinel-normalized, location.postalCode and street included',
      run: async (ctx) => {
        const sentinels = convergedUser('uid-1');
        sentinels.data.personal.location = { country: null, region: null, city: null, postalCode: 'Unknown', street: '' };
        const wrongType = convergedUser('uid-2');
        wrongType.data.personal.location = { country: null, region: null, city: null, postalCode: 12345, street: null };
        const firestore = collectionOf([sentinels, wrongType]);

        const result = await runService(brandConfig(), {
          auth: fakeAuth({ getUser: USER_RECORD }), firestore, options: { migration: 'users', execute: true },
        });

        ctx.expect(firestore.of('patchDoc').map((c) => c.args)).toEqual([[
          'users/uid-1',
          { personal: { location: { postalCode: null, street: null } } },
          ['personal.location.postalCode', 'personal.location.street'],
        ]]);
        ctx.expect(result.output.users.invalidDocIds).toEqual(['uid-2']);
      },
    },

    {
      name: 'users: the null-reset defaults are the schema\'s non-nullable numbers, booleans and timestamps',
      run: (ctx) => {
        const schemaPaths = new Set(leafPaths(resolveAccount({})));

        ctx.expect(Object.keys(RESET_DEFAULTS).filter((path) => !schemaPaths.has(path))).toEqual([]);
        ctx.expect(RESET_DEFAULTS['subscription.discount.percent']).toBe(0);
        ctx.expect(RESET_DEFAULTS['subscription.discount.valid']).toBe(false);
        ctx.expect(RESET_DEFAULTS['personal.birthday.timestamp']).toBe('1970-01-01T00:00:00.000Z');
        for (const path of ['personal.gender', 'subscription.status', 'subscription.product.id', 'consent.legal.status', 'affiliate.referrals']) {
          ctx.expect(path in RESET_DEFAULTS, `${path} is never reset from null`).toBe(false);
        }
      },
    },

    {
      name: 'users: a null number resets to its schema default, a null status stays null and fails validation',
      run: async (ctx) => {
        const doc = convergedUser();
        doc.data.subscription.discount.percent = null;
        doc.data.subscription.status = null;
        const firestore = collectionOf([doc]);

        const result = await runService(brandConfig(), {
          auth: fakeAuth({ getUser: USER_RECORD }), firestore, options: { migration: 'users', execute: true },
        });

        ctx.expect(firestore.of('patchDoc').map((c) => c.args)).toEqual([[
          'users/uid-1',
          { subscription: { discount: { percent: 0 } } },
          ['subscription.discount.percent'],
        ]]);
        ctx.expect(result.output.users.invalidDocIds).toEqual(['uid-1']);
      },
    },
  ],
});
