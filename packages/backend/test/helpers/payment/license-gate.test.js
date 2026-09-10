/**
 * Test: the deployed license verdict gates LIVE payment processing
 * ([#320](https://github.com/Omega-JS-Stack/omega/issues/320)).
 *
 * A deploy asks omegajs.dev once and composes the answer into the artifact's
 * own .env as OMEGA_LICENSE_STATUS; nothing here phones home. Every real
 * provider library refuses to initialize on `keyless`, and NOTHING else
 * changes: an absent status (every local lane, the emulator, every test) and a
 * `licensed` one both leave each init exactly as it was, and the `test`
 * provider is never gated — "payments gated" means test mode still works.
 *
 * Run: npx omega test backend:helpers/payment/license-gate
 */
const assert = require('node:assert');
const Stripe = require('../../../dist/manager/libraries/payment/providers/stripe.js');
const PayPal = require('../../../dist/manager/libraries/payment/providers/paypal.js');
const Chargebee = require('../../../dist/manager/libraries/payment/providers/chargebee.js');
const Coinbase = require('../../../dist/manager/libraries/payment/providers/coinbase.js');
const Test = require('../../../dist/manager/libraries/payment/providers/test.js');
const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');

const REAL_PROVIDERS = [['stripe', Stripe], ['paypal', PayPal], ['chargebee', Chargebee], ['coinbase', Coinbase]];

/** Run fn with OMEGA_LICENSE_STATUS set to `status` (undefined = unset), restored afterwards */
async function withStatus(status, fn) {
  const previous = process.env.OMEGA_LICENSE_STATUS;

  if (status === undefined) delete process.env.OMEGA_LICENSE_STATUS;
  else process.env.OMEGA_LICENSE_STATUS = status;

  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.OMEGA_LICENSE_STATUS;
    else process.env.OMEGA_LICENSE_STATUS = previous;
  }
}

/** The error a call throws, or a failure saying it did not throw */
async function throwsFrom(fn, why) {
  try {
    await fn();
  } catch (e) {
    return e;
  }

  assert.fail(why);
}

module.exports = defineCases({
  description: 'The deployed license verdict gates live payment processing (#320)',
  type: 'group',

  tests: [
    {
      name: 'a-keyless-deploy-refuses-every-real-provider',
      auth: 'none',

      async run() {
        await withStatus('keyless', async () => {
          for (const [name, library] of REAL_PROVIDERS) {
            const error = await throwsFrom(() => library.init(), `${name} must refuse to initialize on a keyless deploy`);

            assert.equal(error.name, 'UnlicensedPaymentsError', `${name} refuses for the license, not for credentials`);
            assert.equal(error.code, 500, 'a misconfigured server, never the caller\'s input');
            assert.match(error.message, /OMEGA_LICENSE_KEY/, 'the refusal names the key that fixes it');
            assert.match(error.message, /omegajs\.dev/, 'and where the license comes from');
          }
        });
      },
    },

    {
      name: 'the-test-provider-is-never-gated',
      auth: 'none',

      // "Payments gated" MEANS test mode keeps working (spec call 5) — the test
      // provider is the whole of test mode, so the gate must not touch it.
      async run() {
        await withStatus('keyless', async () => {
          assert.equal(Test.init(), null, 'the test provider initializes on a keyless deploy like always');
        });
      },
    },

    {
      name: 'licensed-and-absent-both-leave-init-exactly-as-it-was',
      auth: 'none',

      // Absent is the local shape: only a deploy writes the key, so an emulator
      // run, a test lane and a demo-* project must behave as they did before
      // the gate existed. Each init is then blocked by its OWN missing
      // credential, which is today's behavior.
      async run() {
        for (const status of ['licensed', undefined]) {
          await withStatus(status, async () => {
            for (const [name, library] of REAL_PROVIDERS) {
              const error = await throwsFrom(() => library.init(), `${name} still needs its credentials`);

              assert.notEqual(error.name, 'UnlicensedPaymentsError', `${name} must not be license-gated when status is ${status}`);
              assert.match(error.message, /environment variables? (is|are) required/, `${name} fails for its own missing credential`);
            }
          });
        }
      },
    },
  ],
});
