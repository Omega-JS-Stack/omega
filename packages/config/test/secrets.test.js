/**
 * Unit tests for @omega.js/config's secrets module — secret-shaped-key
 * detection (secrets live in .env, never in config).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { findSecretKeys, SECRET_KEY_PATTERN } = require('../src/index.js');

test('flags secret-shaped keys at any depth, case-insensitive', () => {
  const found = findSecretKeys({
    stripeSecret: 'x',
    payment: { providers: { stripe: { apiSecret: 'x' } } },
    api: { privateKey: 'x' },
    GOOGLE_ANALYTICS_SECRET: 'x',
  });

  assert.deepStrictEqual(found.sort(), [
    'GOOGLE_ANALYTICS_SECRET',
    'api.privateKey',
    'payment.providers.stripe.apiSecret',
    'stripeSecret',
  ]);
});

test('flags on key NAME even with empty/placeholder values, walks arrays with indices', () => {
  const found = findSecretKeys({
    webhookSecret: '',
    payment: { products: [{ stripe: { productId: 'x' } }, { signingSecret: null }] },
  });

  assert.deepStrictEqual(found.sort(), ['payment.products.1.signingSecret', 'webhookSecret']);
});

test('public credentials pass by design', () => {
  const found = findSecretKeys({
    cloud: { config: { apiKey: 'public-web-key' } },
    payment: { providers: { stripe: { publishableKey: 'pk_test_x' }, paypal: { clientId: 'x' } } },
    connections: { google: { clientId: 'x' } },
    brand: { secrets: 'not-a-match-plural' },
  });

  assert.deepStrictEqual(found, []);
  assert.strictEqual(SECRET_KEY_PATTERN.test('publishableKey'), false);
});

// ─── wave-4 regressions (F12, F15) ───

test('wave-4 secret shapes are flagged: service-account snake_case, secretKey, password, token forms', () => {
  const found = findSecretKeys({
    cloud: { serviceAccount: { private_key: '-----BEGIN-----', private_key_id: 'abc' } },
    payment: { providers: { stripe: { secretKey: 'sk_live_x' } } },
    auth: { password: 'x', accessToken: 'x', refresh_token: 'x' },
    integrations: { github: { token: 'ghp_x' } },
  });

  for (const expected of [
    'cloud.serviceAccount.private_key',
    'cloud.serviceAccount.private_key_id',
    'payment.providers.stripe.secretKey',
    'auth.password',
    'auth.accessToken',
    'auth.refresh_token',
    'integrations.github.token',
  ]) {
    assert.ok(found.includes(expected), `missing ${expected}`);
  }
});

test('wave-4 public shapes still pass: vapidKey, siteKey, apiKey', () => {
  const found = findSecretKeys({
    cloud: { messaging: { vapidKey: 'B_public' }, config: { apiKey: 'public' } },
    captcha: { providers: { recaptcha: { siteKey: 'public' } } },
  });
  assert.deepStrictEqual(found, []);
});
