/**
 * Unit tests for @omegajs/account — engine semantics, generator injection,
 * the frontend auth-user overlay, and resolveSubscription derivations.
 * (Byte-parity with @omegajs/backend's live user.js is covered by golden-master.test.js.)
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { USER_SCHEMA, resolveAccount, resolveSubscription } = require('../src/index.js');

// ─── Defaults & generators ───

test('empty input resolves full defaults; generated fields are null without generators', () => {
  const account = resolveAccount({});

  assert.strictEqual(account.auth.uid, null);
  assert.strictEqual(account.subscription.product.id, 'basic');
  assert.strictEqual(account.subscription.status, 'active');
  assert.strictEqual(account.subscription.expires.timestamp, '1970-01-01T00:00:00.000Z');
  assert.strictEqual(account.subscription.expires.timestampUNIX, 0);
  assert.strictEqual(account.flags.signupProcessed, false);
  assert.strictEqual(account.consent.legal.status, 'revoked');

  // No generators injected → null (frontend mode: real values come from the backend)
  assert.strictEqual(account.api.clientId, null);
  assert.strictEqual(account.api.privateKey, null);
  assert.strictEqual(account.affiliate.code, null);
});

test('injected generators feed $uuid/$randomId/$apiKey', () => {
  const account = resolveAccount({}, {
    generators: { uuid: () => 'u-1', randomId: () => 'r-1', apiKey: () => 'k-1' },
  });

  assert.strictEqual(account.api.clientId, 'u-1');
  assert.strictEqual(account.api.privateKey, 'k-1');
  assert.strictEqual(account.affiliate.code, 'r-1');
});

test('metadata.created/updated default to now (ISO + unix pair)', () => {
  const before = Math.floor(Date.now() / 1000);
  const account = resolveAccount({});
  const after = Math.floor(Date.now() / 1000);

  assert.ok(account.metadata.created.timestampUNIX >= before && account.metadata.created.timestampUNIX <= after);
  assert.strictEqual(
    Math.floor(new Date(account.metadata.created.timestamp).getTime() / 1000),
    account.metadata.created.timestampUNIX,
  );
});

test('array defaults are fresh copies (no shared references)', () => {
  const first = resolveAccount({});
  first.affiliate.referrals.push('mutated');

  assert.deepStrictEqual(resolveAccount({}).affiliate.referrals, []);
});

// ─── Type handling ───

test('coercion: strings/numbers/booleans converge to schema types', () => {
  const account = resolveAccount({
    auth: { uid: 12345, temporary: 'true' },
    subscription: { payment: { price: '4.99' }, trial: { claimed: 1 } },
    personal: { telephone: { countryCode: '49', national: 'not-a-number' } },
  });

  assert.strictEqual(account.auth.uid, '12345');
  assert.strictEqual(account.auth.temporary, true);
  assert.strictEqual(account.subscription.payment.price, 4.99);
  assert.strictEqual(account.subscription.trial.claimed, true);
  assert.strictEqual(account.personal.telephone.countryCode, 49);
  assert.strictEqual(account.personal.telephone.national, 0); // NaN → default
});

test('nullable semantics: null survives on nullable fields, resets non-nullable ones', () => {
  const account = resolveAccount({
    personal: { gender: null },
    subscription: { product: { id: null }, payment: { price: null } },
  });

  assert.strictEqual(account.personal.gender, null);
  assert.strictEqual(account.subscription.product.id, 'basic');
  assert.strictEqual(account.subscription.payment.price, 0);
});

test('array type: non-array input falls back to default', () => {
  const account = resolveAccount({ affiliate: { referrals: 'not-an-array' } });

  assert.deepStrictEqual(account.affiliate.referrals, []);
});

// ─── Passthrough & template ───

test('$passthrough keeps unknown keys; plain branches strip them', () => {
  const account = resolveAccount({
    roles: { admin: true, customRole: true },
    oauth2: { google: { token: 'tok' } },
    unknownTopLevel: { stripped: true },
  });

  assert.strictEqual(account.roles.customRole, true);
  assert.deepStrictEqual(account.oauth2, { google: { token: 'tok' } });
  assert.strictEqual('unknownTopLevel' in account, false);
});

test('$template resolves dynamic usage keys against the template shape', () => {
  const account = resolveAccount({
    usage: { requests: { monthly: '5', last: { id: 'req-9' } } },
  });

  assert.strictEqual(account.usage.requests.monthly, 5);
  assert.strictEqual(account.usage.requests.daily, 0);
  assert.strictEqual(account.usage.requests.total, 0);
  assert.strictEqual(account.usage.requests.last.id, 'req-9');
  assert.strictEqual(account.usage.requests.last.timestamp, '1970-01-01T00:00:00.000Z');
});

// ─── Auth-user overlay (frontend semantic) ───

test('options.user fills missing auth identity but never overrides the doc', () => {
  const fresh = resolveAccount({}, { user: { uid: 'fb-1', email: 'fb@example.com' } });
  assert.strictEqual(fresh.auth.uid, 'fb-1');
  assert.strictEqual(fresh.auth.email, 'fb@example.com');

  const existing = resolveAccount(
    { auth: { uid: 'doc-1', email: 'doc@example.com' } },
    { user: { uid: 'fb-1', email: 'fb@example.com' } },
  );
  assert.strictEqual(existing.auth.uid, 'doc-1');
  assert.strictEqual(existing.auth.email, 'doc@example.com');
});

// ─── resolveSubscription ───

test('fresh account resolves to basic/inactive/never-paid', () => {
  assert.deepStrictEqual(resolveSubscription(resolveAccount({})), {
    plan: 'basic',
    active: false,
    trialing: false,
    cancelling: false,
    everPaid: false,
  });
});

test('active paid plan resolves plan/active/everPaid', () => {
  const account = resolveAccount({
    subscription: {
      product: { id: 'premium' },
      status: 'active',
      payment: { startDate: { timestampUNIX: 1735689600 } },
    },
  });

  assert.deepStrictEqual(resolveSubscription(account), {
    plan: 'premium',
    active: true,
    trialing: false,
    cancelling: false,
    everPaid: true,
  });
});

test('unexpired claimed trial is trialing; cancellation only counts when not trialing', () => {
  const future = Math.floor(Date.now() / 1000) + 86400;

  const trialing = resolveAccount({
    subscription: {
      product: { id: 'premium' },
      status: 'active',
      trial: { claimed: true, expires: { timestampUNIX: future } },
      cancellation: { pending: true },
    },
  });
  assert.deepStrictEqual(resolveSubscription(trialing), {
    plan: 'premium',
    active: true,
    trialing: true,
    cancelling: false,
    everPaid: false,
  });

  const cancelling = resolveAccount({
    subscription: {
      product: { id: 'premium' },
      status: 'active',
      cancellation: { pending: true },
    },
  });
  assert.deepStrictEqual(resolveSubscription(cancelling), {
    plan: 'premium',
    active: true,
    trialing: false,
    cancelling: true,
    everPaid: false,
  });
});

test('suspended paid plan falls back to basic', () => {
  const account = resolveAccount({
    subscription: { product: { id: 'premium' }, status: 'suspended' },
  });

  assert.deepStrictEqual(resolveSubscription(account), {
    plan: 'basic',
    active: false,
    trialing: false,
    cancelling: false,
    everPaid: false,
  });
});

// ─── Schema export sanity ───

test('USER_SCHEMA is exported and carries the canonical branches', () => {
  for (const branch of ['auth', 'subscription', 'roles', 'flags', 'affiliate', 'metadata', 'activity', 'api', 'usage', 'personal', 'oauth2', 'attribution', 'consent']) {
    assert.ok(USER_SCHEMA[branch], `missing branch: ${branch}`);
  }
});
