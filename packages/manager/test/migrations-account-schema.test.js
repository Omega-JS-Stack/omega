/**
 * The users migration against @omega.js/account's schema: its backfill record,
 * validation, sentinel list and null-reset defaults are derived from that one
 * shape, so a field the schema declares is converged like every other.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
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

test('users: the backfill record has exactly the account schema\'s shape', () => {
  assert.deepEqual(leafPaths(DEFAULT_USER).sort(), leafPaths(resolveAccount({})).sort());
});

test('users: every account-schema field is validated and sentinel-normalized, location.postalCode and street included', async () => {
  const sentinels = convergedUser('uid-1');
  sentinels.data.personal.location = { country: null, region: null, city: null, postalCode: 'Unknown', street: '' };
  const wrongType = convergedUser('uid-2');
  wrongType.data.personal.location = { country: null, region: null, city: null, postalCode: 12345, street: null };
  const firestore = collectionOf([sentinels, wrongType]);

  const result = await runService(brandConfig(), {
    auth: fakeAuth({ getUser: USER_RECORD }), firestore, options: { migration: 'users', execute: true },
  });

  assert.deepEqual(firestore.of('patchDoc').map((c) => c.args), [[
    'users/uid-1',
    { personal: { location: { postalCode: null, street: null } } },
    ['personal.location.postalCode', 'personal.location.street'],
  ]]);
  assert.deepEqual(result.output.users.invalidDocIds, ['uid-2']);
});

test('users: the null-reset defaults are the schema\'s non-nullable numbers, booleans and timestamps', () => {
  const schemaPaths = new Set(leafPaths(resolveAccount({})));

  assert.deepEqual(Object.keys(RESET_DEFAULTS).filter((path) => !schemaPaths.has(path)), []);
  assert.equal(RESET_DEFAULTS['subscription.discount.percent'], 0);
  assert.equal(RESET_DEFAULTS['subscription.discount.valid'], false);
  assert.equal(RESET_DEFAULTS['personal.birthday.timestamp'], '1970-01-01T00:00:00.000Z');
  for (const path of ['personal.gender', 'subscription.status', 'subscription.product.id', 'consent.legal.status', 'affiliate.referrals']) {
    assert.equal(path in RESET_DEFAULTS, false, `${path} is never reset from null`);
  }
});

test('users: a null number resets to its schema default, a null status stays null and fails validation', async () => {
  const doc = convergedUser();
  doc.data.subscription.discount.percent = null;
  doc.data.subscription.status = null;
  const firestore = collectionOf([doc]);

  const result = await runService(brandConfig(), {
    auth: fakeAuth({ getUser: USER_RECORD }), firestore, options: { migration: 'users', execute: true },
  });

  assert.deepEqual(firestore.of('patchDoc').map((c) => c.args), [[
    'users/uid-1',
    { subscription: { discount: { percent: 0 } } },
    ['subscription.discount.percent'],
  ]]);
  assert.deepEqual(result.output.users.invalidDocIds, ['uid-1']);
});
