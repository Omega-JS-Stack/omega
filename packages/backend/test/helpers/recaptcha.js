/**
 * Test: recaptcha.verify() owns the whole subscribe-verification decision
 * (cp265) — no RECAPTCHA_SECRET_KEY configured means PASS, even for a
 * missing/empty token. Unkeyed brands are a sanctioned population (cp257:
 * keys are optional and per-brand); the marketing/contact route no longer
 * pre-rejects empty tokens, so this leniency is what keeps their public
 * newsletter forms working.
 *
 * Run: npx omega test backend:helpers/recaptcha
 */
const { verify } = require('../../src/manager/libraries/recaptcha.js');

module.exports = {
  description: 'recaptcha.verify() no-secret leniency (unkeyed brands subscribe)',
  type: 'group',
  tests: [
    {
      name: 'no-secret-configured-passes-any-token-shape',
      run: async ({ assert }) => {
        const original = process.env.RECAPTCHA_SECRET_KEY;
        delete process.env.RECAPTCHA_SECRET_KEY;

        try {
          assert.equal(await verify(''), true, 'empty token passes without a secret');
          assert.equal(await verify(undefined), true, 'missing token passes without a secret');
          assert.equal(await verify('anything'), true, 'any token passes without a secret');
        } finally {
          if (original !== undefined) process.env.RECAPTCHA_SECRET_KEY = original;
        }
      },
    },
    {
      name: 'secret-configured-rejects-a-missing-token-before-any-network-call',
      run: async ({ assert }) => {
        const original = process.env.RECAPTCHA_SECRET_KEY;
        process.env.RECAPTCHA_SECRET_KEY = 'test-secret-never-sent';

        try {
          assert.equal(await verify(''), false, 'empty token fails closed with a secret');
          assert.equal(await verify(undefined), false, 'missing token fails closed with a secret');
        } finally {
          if (original === undefined) {
            delete process.env.RECAPTCHA_SECRET_KEY;
          } else {
            process.env.RECAPTCHA_SECRET_KEY = original;
          }
        }
      },
    },
  ],
};
