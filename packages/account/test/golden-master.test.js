/**
 * Golden-master gate: a `User` built the way @omega.js/backend builds one (the
 * class, with the generators the backend's LIVE user service installs) must
 * reproduce resolveAccount() byte-for-byte.
 *
 * Method:
 * - requires @omega.js/backend's actual src/omega/services/user.js from
 *   packages/backend and lets it install User.generators (a live comparison,
 *   not a snapshot: if the backend's generators change, this fails)
 * - freezes time (node:test mock timers, Date API) so both sides compute
 *   identical $now/$nowUNIX values
 * - $randomId is deterministic on both sides (the backend asks its utilities
 *   for it, handed a fixed one here; the account side injects the same value)
 * - $uuid and $apiKey are the backend's own (uuid v4 / uid-generator, not
 *   injectable): those two fields are format-asserted, then replaced with
 *   sentinels on both sides before the byte comparison
 * - deepStrictEqual for diffs + JSON.stringify equality for key-order parity
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const UserService = require(path.join(__dirname, '..', '..', 'backend', 'src', 'omega', 'services', 'user.js'));
const { User, resolveAccount, resolveSubscription } = require('../src/index.js');

const FIXED_NOW_MS = 1783300000000; // 2026-07-06T01:06:40.000Z
const FIXED_NOW_UNIX = Math.floor(FIXED_NOW_MS / 1000);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const API_KEY_RE = /^[A-Za-z0-9]{40,50}$/; // uid-generator, 256-bit base62
const RANDOM_ID = 'gm-rand8';

// The backend's user service asks its instance's utilities for the 8-char id:
// the one seam, handed a fixed value so both sides agree
new UserService({
  utilities: {
    randomId: (options) => {
      assert.deepStrictEqual(options, { size: 8 }, '@omega.js/backend should request an 8-char randomId');
      return RANDOM_ID;
    },
  },
});

// A User exactly as the backend builds one, as its stored document
const bemDocument = (fixture) => new User(fixture).toJSON();

// The subscription facts, as the User's getters answer them
const subscriptionOf = (user) => ({
  plan: user.plan,
  active: user.active,
  trialing: user.trialing,
  cancelling: user.cancelling,
  everPaid: user.everPaid,
});

// The account side injects sentinels directly; the @omega.js/backend side generates real
// values that get format-checked and replaced by the same sentinels.
const SENTINEL_GENERATORS = {
  uuid: () => '<uuid>',
  randomId: () => RANDOM_ID,
  apiKey: () => '<apiKey>',
};

function normalizeBem(properties, fixture) {
  // Only generated values need normalizing — fixture-supplied api values pass
  // through both engines untouched and stay byte-comparable as-is.
  if (typeof fixture?.api?.clientId !== 'string') {
    assert.match(properties.api.clientId, UUID_RE, '@omega.js/backend api.clientId should be a v4 uuid');
    properties.api.clientId = '<uuid>';
  }
  if (typeof fixture?.api?.privateKey !== 'string') {
    assert.match(properties.api.privateKey, API_KEY_RE, '@omega.js/backend api.privateKey should be a uid-generator token');
    properties.api.privateKey = '<apiKey>';
  }
  return properties;
}

const clone = (value) => structuredClone(value);

// ─── Fixtures ───

const FIXTURES = {
  'empty object': {},

  'paid premium (everPaid)': {
    auth: { uid: 'user-123', email: 'paid@example.com' },
    subscription: {
      product: { id: 'premium', name: 'Premium' },
      status: 'active',
      payment: {
        provider: 'stripe',
        orderId: 'or_123',
        resourceId: 'sub_123',
        frequency: 'monthly',
        price: 4.99,
        startDate: { timestamp: '2026-01-01T00:00:00.000Z', timestampUNIX: 1767225600 },
      },
    },
    api: { clientId: 'existing-client-id', privateKey: 'existing-private-key' },
    affiliate: { code: 'FRIEND', referrals: [{ uid: 'ref-1' }] },
  },

  'active trial': {
    subscription: {
      product: { id: 'premium' },
      status: 'active',
      trial: {
        claimed: true,
        expires: { timestamp: '2026-07-07T01:06:40.000Z', timestampUNIX: FIXED_NOW_UNIX + 86400 },
      },
    },
  },

  'expired trial with pending cancellation': {
    subscription: {
      product: { id: 'ultimate' },
      status: 'active',
      trial: {
        claimed: true,
        expires: { timestamp: '2026-07-05T01:06:40.000Z', timestampUNIX: FIXED_NOW_UNIX - 86400 },
      },
      cancellation: {
        pending: true,
        date: { timestamp: '2026-07-05T00:00:00.000Z', timestampUNIX: FIXED_NOW_UNIX - 90000 },
      },
    },
  },

  'suspended subscription': {
    subscription: {
      product: { id: 'premium', name: 'Premium' },
      status: 'suspended',
      payment: {
        startDate: { timestamp: '2025-01-01T00:00:00.000Z', timestampUNIX: 1735689600 },
      },
    },
  },

  'junk types (coercion paths)': {
    auth: { uid: 12345, email: null, temporary: 'true' },
    subscription: {
      product: { id: null },
      status: undefined,
      payment: { price: '4.99', frequency: 7 },
      trial: { claimed: 1 },
      cancellation: { pending: 0 },
    },
    personal: { gender: null, telephone: { countryCode: '49', national: 'not-a-number' } },
    affiliate: { code: null, referrals: 'not-an-array' },
    metadata: { created: { timestamp: 999, timestampUNIX: 'nope' } },
  },

  'passthrough branches ($passthrough + $template + strip unknowns)': {
    roles: { admin: 'true', customRole: true, another: 'yes' },
    flags: { signupProcessed: true, promoSeen: 'twice' },
    usage: {
      requests: { monthly: '5', daily: 2, total: null, last: { id: 'req-9' } },
      customFeature: { monthly: 1 },
    },
    connections: { google: { token: 'tok', nested: { deep: true } } },
    attribution: {
      utm: { tags: { source: 'newsletter', campaign: 'summer' }, url: 'https://x.example' },
    },
    unknownTopLevel: { should: 'be stripped' },
    anotherUnknown: 42,
  },
};

// ─── Byte-parity: resolveAccount vs the backend's new User() ───

for (const [name, fixture] of Object.entries(FIXTURES)) {
  test(`golden master: ${name}`, (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: FIXED_NOW_MS });

    const bem = normalizeBem(bemDocument(clone(fixture)), fixture);
    const ours = resolveAccount(clone(fixture), { generators: SENTINEL_GENERATORS });

    assert.deepStrictEqual(ours, bem);
    assert.strictEqual(JSON.stringify(ours), JSON.stringify(bem), 'key order must match too');
  });

  test(`golden master (subscription getters): ${name}`, (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: FIXED_NOW_MS });

    const bem = new User(clone(fixture));
    const ours = resolveAccount(clone(fixture), { generators: SENTINEL_GENERATORS });

    assert.deepStrictEqual(resolveSubscription(ours), subscriptionOf(bem));
  });
}

// No document at all: new User()
test('golden master: no settings at all', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: FIXED_NOW_MS });

  const bem = normalizeBem(new User().toJSON(), undefined);
  const ours = resolveAccount(undefined, { generators: SENTINEL_GENERATORS });

  assert.deepStrictEqual(ours, bem);
  assert.strictEqual(JSON.stringify(ours), JSON.stringify(bem));
});

// resolveSubscription reads a User instance the way it reads the plain document
test('golden master: resolveSubscription reads a User instance', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: FIXED_NOW_MS });

  const user = new User(clone(FIXTURES['paid premium (everPaid)']));

  assert.deepStrictEqual(resolveSubscription(user), subscriptionOf(user));
  assert.strictEqual(user.everPaid, true);
});
