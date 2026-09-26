/**
 * Unit tests for the User class: the stored document as own fields, the
 * identity overlay and profile, the computed getters, the generators seam,
 * and byte parity with resolveAccount.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { User, resolveAccount } = require('../src/index.js');

const FIXED_NOW_MS = 1783300000000; // 2026-07-06T01:06:40.000Z
const FIXED_NOW_UNIX = Math.floor(FIXED_NOW_MS / 1000);

const GETTERS = ['authenticated', 'uid', 'email', 'plan', 'active', 'trialing', 'cancelling', 'everPaid'];

// ─── Signed out ───

test('new User() is the signed-out user: basic, inactive, never null', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: FIXED_NOW_MS });

  const user = new User();

  assert.strictEqual(user.authenticated, false);
  assert.strictEqual(user.uid, null);
  assert.strictEqual(user.email, null);
  assert.strictEqual(user.plan, 'basic');
  assert.strictEqual(user.active, false);
  assert.strictEqual(user.trialing, false);
  assert.strictEqual(user.cancelling, false);
  assert.strictEqual(user.everPaid, false);
  assert.deepStrictEqual(user.profile, { displayName: null, photoURL: null, emailVerified: false });
  assert.deepStrictEqual(user.toJSON(), resolveAccount({}));
  assert.strictEqual(JSON.stringify(user), JSON.stringify(resolveAccount({})));
});

// ─── Identity overlay & profile ───

test('identity fills auth only where the document lacks it, and fills profile', () => {
  const identity = {
    uid: 'fb-1',
    email: 'fb@example.com',
    displayName: 'Ada Lovelace',
    photoURL: 'https://example.com/ada.png',
    emailVerified: true,
  };

  const fresh = new User({}, identity);
  assert.strictEqual(fresh.authenticated, true);
  assert.strictEqual(fresh.uid, 'fb-1');
  assert.strictEqual(fresh.email, 'fb@example.com');
  assert.strictEqual(fresh.auth.uid, 'fb-1');
  assert.deepStrictEqual(fresh.profile, {
    displayName: 'Ada Lovelace',
    photoURL: 'https://example.com/ada.png',
    emailVerified: true,
  });

  const existing = new User({ auth: { uid: 'doc-1', email: 'doc@example.com' } }, identity);
  assert.strictEqual(existing.uid, 'doc-1');
  assert.strictEqual(existing.email, 'doc@example.com');
  assert.strictEqual(existing.profile.displayName, 'Ada Lovelace');
});

test('profile and the getters never reach the own keys or the serialized shape', () => {
  const user = new User({ subscription: { product: { id: 'premium' } } }, { uid: 'fb-1', email: 'fb@example.com', displayName: 'Ada' });
  const json = JSON.stringify(user);
  // The getter names also spell stored fields deeper down (auth.uid, a status of
  // 'active'), so the check is on the TOP-LEVEL keys the serialized shape carries
  const serializedKeys = Object.keys(JSON.parse(json));

  assert.strictEqual(Object.keys(user).includes('profile'), false);
  assert.strictEqual(serializedKeys.includes('profile'), false);
  assert.strictEqual(json.includes('"displayName"'), false);
  for (const name of GETTERS) {
    assert.strictEqual(Object.keys(user).includes(name), false, `own key: ${name}`);
    assert.strictEqual(serializedKeys.includes(name), false, `serialized: ${name}`);
  }
});

test('an identity with no profile fields still yields the one profile shape', () => {
  const user = new User({}, { uid: 'fb-1', email: 'fb@example.com' });

  assert.deepStrictEqual(user.profile, { displayName: null, photoURL: null, emailVerified: false });
});

// ─── Subscription getters ───

test('an active paid plan reads plan, active and everPaid', () => {
  const user = new User({
    subscription: {
      product: { id: 'premium' },
      status: 'active',
      payment: { startDate: { timestampUNIX: 1735689600 } },
    },
  });

  assert.strictEqual(user.plan, 'premium');
  assert.strictEqual(user.active, true);
  assert.strictEqual(user.trialing, false);
  assert.strictEqual(user.cancelling, false);
  assert.strictEqual(user.everPaid, true);
});

test('an unexpired claimed trial is trialing, and stops at its expiry', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: FIXED_NOW_MS });

  const user = new User({
    subscription: {
      product: { id: 'premium' },
      status: 'active',
      trial: { claimed: true, expires: { timestampUNIX: FIXED_NOW_UNIX + 86400 } },
      cancellation: { pending: true },
    },
  });

  assert.strictEqual(user.trialing, true);
  assert.strictEqual(user.cancelling, false, 'a pending cancel only counts once the trial is over');
  assert.strictEqual(user.plan, 'premium');

  // The getters read the clock on every access: past the expiry, the trial is over
  t.mock.timers.tick(86400 * 1000 + 1000);
  assert.strictEqual(user.trialing, false);
  assert.strictEqual(user.cancelling, true);
});

test('a pending cancellation on a paid plan is cancelling', () => {
  const user = new User({
    subscription: { product: { id: 'premium' }, status: 'active', cancellation: { pending: true } },
  });

  assert.strictEqual(user.cancelling, true);
  assert.strictEqual(user.active, true);
  assert.strictEqual(user.plan, 'premium');
});

test('a cancelled or suspended paid plan reads basic and inactive', () => {
  for (const status of ['cancelled', 'suspended']) {
    const user = new User({ subscription: { product: { id: 'premium' }, status } });

    assert.strictEqual(user.plan, 'basic', status);
    assert.strictEqual(user.active, false, status);
    assert.strictEqual(user.trialing, false, status);
    assert.strictEqual(user.cancelling, false, status);
  }
});

test('the getters follow an in-place mutation of the subscription', () => {
  const user = new User({ subscription: { product: { id: 'premium' }, status: 'active' } });
  assert.strictEqual(user.plan, 'premium');

  user.subscription.status = 'cancelled';

  assert.strictEqual(user.plan, 'basic');
  assert.strictEqual(user.active, false);
});

// ─── Generators ───

test('User.generators feed the token fields; unset, they resolve to null', (t) => {
  t.after(() => {
    User.generators = {};
  });

  User.generators = { uuid: () => '<uuid>', randomId: () => '<randomId>', apiKey: () => '<apiKey>' };
  const generated = new User();
  assert.strictEqual(generated.api.clientId, '<uuid>');
  assert.strictEqual(generated.api.privateKey, '<apiKey>');
  assert.strictEqual(generated.affiliate.code, '<randomId>');

  User.generators = {};
  const bare = new User();
  assert.strictEqual(bare.api.clientId, null);
  assert.strictEqual(bare.api.privateKey, null);
  assert.strictEqual(bare.affiliate.code, null);
});

// ─── Parity with resolveAccount ───

test('own keys and serialized bytes match resolveAccount, key order included', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: FIXED_NOW_MS });

  const fixtures = [
    {},
    {
      roles: { admin: true, customRole: true },
      connections: { google: { token: 'tok' } },
      unknownTopLevel: { stripped: true },
    },
    {
      auth: { uid: 12345, temporary: 'true' },
      subscription: { payment: { price: '4.99' }, trial: { claimed: 1 } },
      usage: { requests: { monthly: '5', last: { timestampUNIX: 1788397430 } } },
    },
  ];

  for (const fixture of fixtures) {
    const user = new User(fixture);

    assert.deepStrictEqual(Object.keys(user), Object.keys(resolveAccount(fixture)));
    assert.strictEqual(JSON.stringify(user), JSON.stringify(resolveAccount(fixture)));
  }
});

// ─── The cleared discount ───

test('User.EMPTY_DISCOUNT is the schema\'s own cleared discount node', () => {
  assert.deepStrictEqual(User.EMPTY_DISCOUNT, resolveAccount({}).subscription.discount);
});
