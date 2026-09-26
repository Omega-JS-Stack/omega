/**
 * The payment half of the OMEGA license
 * ([#320](https://github.com/Omega-JS-Stack/omega/issues/320)).
 *
 * A published OMEGA install needs a license to run the payment system live.
 * The check itself is a DEPLOY-time question the CLI asks
 * (@omega.js/devkit/license) — this runtime never phones home. What reaches
 * here is the verdict the deploy composed into the artifact's own .env:
 *
 *   OMEGA_LICENSE_STATUS=licensed  → nothing changes
 *   OMEGA_LICENSE_STATUS=keyless   → the real providers refuse to initialize
 *   (absent)                       → nothing changes
 *
 * ABSENT is the important case: only a deploy writes the key, so every local
 * lane — the emulator, `omega serve`, every test lane, a demo-* project —
 * behaves exactly as it did before this existed. The `test` provider is never
 * gated either: "payments gated" MEANS test mode still works (spec call 5).
 *
 * One gate, called from the three real providers' init(). They share no entry
 * module to hold it, so the assertion lives here and each init calls it in one
 * line rather than three copies of the rule.
 */
const env = require('../env.js');

/**
 * Refuse live payment processing on a keyless deploy.
 *
 * @param {string} provider - The provider being initialized (names the refusal).
 * @throws {Error} UnlicensedPaymentsError (code 500) when the deploy was keyless.
 */
function assertLicensedPayments(provider) {
  if (env.get('OMEGA_LICENSE_STATUS') !== 'keyless') { return; }

  const error = new Error(
    `${provider} is disabled: this backend was deployed WITHOUT an OMEGA license, so live payment processing is off. `
    + 'A license is a subscription on omegajs.dev; put its account API key in the brand .env as OMEGA_LICENSE_KEY and deploy again. '
    + 'Test-mode payments keep working without one.',
  );
  error.name = 'UnlicensedPaymentsError';
  error.code = 500;
  throw error;
}

module.exports = assertLicensedPayments;
