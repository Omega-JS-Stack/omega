/**
 * Unit tests for @omega.js/config's secrets module — secret-shaped-key
 * detection (secrets live in .env, never in config).
 */
const defineCases = require('@omega.js/devkit/test/define-cases');

const { findSecretKeys, SECRET_KEY_PATTERN } = require('../src/index.js');

module.exports = defineCases({
  type: 'group',
  description: 'secrets',
  tests: [
    {
      name: 'flags secret-shaped keys at any depth, case-insensitive',
      run: (ctx) => {
        const found = findSecretKeys({
          stripeSecret: 'x',
          payment: { providers: { stripe: { apiSecret: 'x' } } },
          api: { privateKey: 'x' },
          GOOGLE_ANALYTICS_SECRET: 'x',
        });

        ctx.expect(found.sort()).toEqual([
          'GOOGLE_ANALYTICS_SECRET',
          'api.privateKey',
          'payment.providers.stripe.apiSecret',
          'stripeSecret',
        ]);
      },
    },

    {
      name: 'flags on key NAME even with empty/placeholder values, walks arrays with indices',
      run: (ctx) => {
        const found = findSecretKeys({
          webhookSecret: '',
          payment: { products: [{ stripe: { productId: 'x' } }, { signingSecret: null }] },
        });

        ctx.expect(found.sort()).toEqual(['payment.products[1].signingSecret', 'webhookSecret']);
      },
    },

    {
      name: 'public credentials pass by design',
      run: (ctx) => {
        const found = findSecretKeys({
          cloud: { config: { apiKey: 'public-web-key' } },
          payment: { providers: { stripe: { publishableKey: 'pk_test_x' }, paypal: { clientId: 'x' } } },
          connections: { google: { clientId: 'x' } },
          brand: { secrets: 'not-a-match-plural' },
        });

        ctx.expect(found).toEqual([]);
        ctx.expect(SECRET_KEY_PATTERN.test('publishableKey')).toBe(false);
      },
    },

    // ─── wave-4 regressions (F12, F15) ───

    {
      name: 'wave-4 secret shapes are flagged: service-account snake_case, secretKey, password, token forms',
      run: (ctx) => {
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
          ctx.expect(found.includes(expected), `missing ${expected}`).toBeTruthy();
        }
      },
    },

    {
      name: 'wave-4 public shapes still pass: vapidKey, siteKey, apiKey',
      run: (ctx) => {
        const found = findSecretKeys({
          cloud: { messaging: { vapidKey: 'B_public' }, config: { apiKey: 'public' } },
          captcha: { providers: { recaptcha: { siteKey: 'public' } } },
        });
        ctx.expect(found).toEqual([]);
      },
    },
  ],
});
