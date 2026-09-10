/**
 * Unit tests for @omega.js/account — engine semantics, generator injection,
 * the frontend auth-user overlay, and resolveSubscription derivations.
 * (Byte-parity with @omega.js/backend's live user.js is covered by golden-master.test.js.)
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

test('#663: personal.location carries postalCode and street, null until filled', () => {
  const empty = resolveAccount({});

  assert.strictEqual(empty.personal.location.postalCode, null);
  assert.strictEqual(empty.personal.location.street, null);

  const filled = resolveAccount({ personal: { location: { postalCode: '90210', street: '123 Main Street' } } });

  assert.strictEqual(filled.personal.location.postalCode, '90210');
  assert.strictEqual(filled.personal.location.street, '123 Main Street');
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
    connections: { google: { token: 'tok' } },
    unknownTopLevel: { stripped: true },
  });

  assert.strictEqual(account.roles.customRole, true);
  assert.deepStrictEqual(account.connections, { google: { token: 'tok' } });
  assert.strictEqual('unknownTopLevel' in account, false);
});

test('$template resolves dynamic usage keys against the template shape', () => {
  const account = resolveAccount({
    usage: { requests: { monthly: '5', last: { timestampUNIX: 1788397430 } } },
  });

  assert.strictEqual(account.usage.requests.monthly, 5);
  assert.strictEqual(account.usage.requests.daily, 0);
  assert.strictEqual(account.usage.requests.total, 0);
  assert.strictEqual(account.usage.requests.last.timestampUNIX, 1788397430);
  assert.strictEqual(account.usage.requests.last.timestamp, '1970-01-01T00:00:00.000Z');
});

test('#647: usage.last carries only WHEN the counter moved — the retired `id` is gone', () => {
  const account = resolveAccount({ usage: { requests: { monthly: 1 } } });

  assert.deepStrictEqual(
    Object.keys(account.usage.requests.last),
    ['timestamp', 'timestampUNIX'],
    'a schema field nothing writes reads as a fact that is always null',
  );
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

// ─── The applied discount ───

test('an applied winback discount survives resolution, source and all', () => {
  // The card that renders it reads the RESOLVED account, and resolution strips
  // every key the schema does not name — so a claim the route persisted has to
  // come back out of the engine intact ([#325]).
  const account = resolveAccount({
    subscription: {
      product: { id: 'premium' },
      status: 'active',
      discount: {
        valid: true,
        code: 'WINBACK50',
        percent: 50,
        amount: 0,
        duration: 'once',
        source: 'winback',
        resourceId: 'sub_live',
      },
    },
  });

  assert.deepStrictEqual(account.subscription.discount, {
    valid: true,
    code: 'WINBACK50',
    percent: 50,
    amount: 0,
    duration: 'once',
    source: 'winback',
    resourceId: 'sub_live',
  });
});

test('the discount names the subscription it was applied to', () => {
  // The stamp is what makes the node clearable ([#333]): the webhook pipeline
  // compares it against the subscription the event is about, and a mismatch is a
  // NEW subscription that never claimed this discount. Resolution strips every
  // key the schema does not name, so a stamp the engine drops is a discount that
  // rides a resubscribe forever and silently retires the save offer.
  const account = resolveAccount({
    subscription: {
      discount: { valid: true, code: 'WINBACK50', percent: 50, duration: 'once', source: 'winback', resourceId: 'sub_old' },
    },
  });

  assert.strictEqual(account.subscription.discount.resourceId, 'sub_old');
});

test('a fresh account carries no discount at all', () => {
  const discount = resolveAccount({}).subscription.discount;

  assert.strictEqual(discount.valid, false, 'absent and denied are the same thing to a reader');
  assert.strictEqual(discount.code, null);
  assert.strictEqual(discount.source, null, 'and nothing claims to be a winback claim');
  assert.strictEqual(discount.resourceId, null, 'and none names a subscription');
});

test('a checkout discount keeps its OWN source — the winback claim is not the shape', () => {
  // A code typed at checkout sets this same node, and a winback pitch suppressed
  // by someone else's promo is an offer silently withheld. `source` is what the
  // pitch gate reads, so the two are never the same signal.
  const account = resolveAccount({
    subscription: {
      discount: { valid: true, code: 'WELCOME10OFF', amount: 10, duration: 'once', source: 'checkout' },
    },
  });

  assert.strictEqual(account.subscription.discount.source, 'checkout');
  assert.strictEqual(account.subscription.discount.amount, 10);
  assert.strictEqual(account.subscription.discount.percent, 0, 'the shape it is not reports zero, never undefined');
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
  for (const branch of ['auth', 'subscription', 'roles', 'flags', 'affiliate', 'metadata', 'activity', 'api', 'usage', 'personal', 'connections', 'attribution', 'trackingConsent', 'consent']) {
    assert.ok(USER_SCHEMA[branch], `missing branch: ${branch}`);
  }
});
