/**
 * Golden-master gate: @omegajs/account must reproduce backend-manager's LIVE
 * user.js output byte-for-byte before any framework adopts it.
 *
 * Method:
 * - requires BEM's actual src/manager/helpers/user.js from packages/backend
 *   (a live comparison, not a snapshot — if BEM's schema changes, this fails)
 * - freezes time (node:test mock timers, Date API) so both sides compute
 *   identical $now/$nowUNIX values
 * - $randomId is deterministic on both sides (mock Manager / injected generator)
 * - $uuid and $apiKey are module-internal in BEM (uuid v4 / uid-generator, not
 *   injectable) — those two fields are format-asserted, then replaced with
 *   sentinels on both sides before the byte comparison
 * - deepStrictEqual for diffs + JSON.stringify equality for key-order parity
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const User = require(path.join(__dirname, '..', '..', 'backend', 'src', 'manager', 'helpers', 'user.js'));
const { resolveAccount, resolveSubscription } = require('../src/index.js');

const FIXED_NOW_MS = 1783300000000; // 2026-07-06T01:06:40.000Z
const FIXED_NOW_UNIX = Math.floor(FIXED_NOW_MS / 1000);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const API_KEY_RE = /^[A-Za-z0-9]{40,50}$/; // uid-generator, 256-bit base62
const RANDOM_ID = 'gm-rand8';

const mockManager = {
  Utilities: () => ({
    randomId: (options) => {
      assert.deepStrictEqual(options, { size: 8 }, 'BEM should request an 8-char randomId');
      return RANDOM_ID;
    },
  }),
};

// The account side injects sentinels directly; the BEM side generates real
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
    assert.match(properties.api.clientId, UUID_RE, 'BEM api.clientId should be a v4 uuid');
    properties.api.clientId = '<uuid>';
  }
  if (typeof fixture?.api?.privateKey !== 'string') {
    assert.match(properties.api.privateKey, API_KEY_RE, 'BEM api.privateKey should be a uid-generator token');
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
        processor: 'stripe',
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
    oauth2: { google: { token: 'tok', nested: { deep: true } } },
    attribution: {
      utm: { tags: { source: 'newsletter', campaign: 'summer' }, url: 'https://x.example' },
    },
    unknownTopLevel: { should: 'be stripped' },
    anotherUnknown: 42,
  },
};

// ─── Byte-parity: resolveAccount vs new User().properties ───

for (const [name, fixture] of Object.entries(FIXTURES)) {
  test(`golden master: ${name}`, (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: FIXED_NOW_MS });

    const bem = normalizeBem(new User(mockManager, clone(fixture)).properties, fixture);
    const ours = resolveAccount(clone(fixture), { generators: SENTINEL_GENERATORS });

    assert.deepStrictEqual(ours, bem);
    assert.strictEqual(JSON.stringify(ours), JSON.stringify(bem), 'key order must match too');
  });

  test(`golden master (resolveSubscription): ${name}`, (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: FIXED_NOW_MS });

    const bem = new User(mockManager, clone(fixture)).properties;
    const ours = resolveAccount(clone(fixture), { generators: SENTINEL_GENERATORS });

    assert.deepStrictEqual(resolveSubscription(ours), User.resolveSubscription(bem));
  });
}

// undefined/null settings — User(Manager) with no settings
test('golden master: no settings at all', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: FIXED_NOW_MS });

  const bem = normalizeBem(new User(mockManager).properties, undefined);
  const ours = resolveAccount(undefined, { generators: SENTINEL_GENERATORS });

  assert.deepStrictEqual(ours, bem);
  assert.strictEqual(JSON.stringify(ours), JSON.stringify(bem));
});

// User-instance fallback: BEM's resolveSubscription accepts { properties: {...} }
test('golden master: resolveSubscription accepts a User-like wrapper', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: FIXED_NOW_MS });

  const user = new User(mockManager, clone(FIXTURES['paid premium (everPaid)']));

  assert.deepStrictEqual(resolveSubscription(user), User.resolveSubscription(user));
  assert.strictEqual(resolveSubscription(user).everPaid, true);
});
